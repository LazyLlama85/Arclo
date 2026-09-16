// Tempo — a minimal, purpose-built in-memory fake of the Supabase client's
// chainable query builder (B5.5 — integration coverage for the state machines
// that keep breaking; audit "recurring near-catastrophic bug classes").
//
// This is NOT a general Postgrest mock. It supports exactly the filter/write
// shapes the modules under test actually use (eq/gte/lt/in, the one .or()
// shape shared by retireWorkouts.ts + missedWorkouts.ts, delete, update,
// insert, maybeSingle, select-after-update, plus order/limit/is/count for
// generatePlan.test.ts's rollover coverage). Extend it only when a new
// integration test needs a new shape — a bigger mock than the tests require
// is exactly the kind of unrequested abstraction CLAUDE.md's guardrails warn
// against.

type Row = Record<string, any>
type Table = Row[]
type Tables = Record<string, Table>

interface FakeOptions {
  /** Force a `{ error }` result for a given "table.op" (e.g. 'scheduled_workouts.delete') —
   *  the only way to test a real-world write failure (the FK race retireWorkouts.ts
   *  guards against) without a real Postgres connection. */
  failOps?: Set<string>
  /** Force a specific Postgres error CODE for a "table.op", for the paths that
   *  branch on one — workoutRemoval falls back from delete to skip only on
   *  23503 (foreign key violation) and must rethrow anything else. */
  failOpCodes?: Record<string, string>
}

function parseOrClause(expr: string): (row: Row) => boolean {
  // Only shape ever used in this codebase: 'col.not.is.null,col2.eq.value'
  const clauses = expr.split(',')
  return (row: Row) => clauses.some((c) => {
    const parts = c.split('.')
    const col = parts[0]
    const op = parts.slice(1).join('.')
    if (op === 'not.is.null') return row[col] != null
    const m = /^eq\.(.*)$/.exec(op)
    if (m) return String(row[col]) === m[1]
    return false
  })
}

/** A fake `{ data, error }`-shaped Postgrest error, matching the real client's contract. */
export function fakeError(message: string): { message: string } {
  return { message }
}

export function createFakeSupabase(tables: Tables, options: FakeOptions = {}) {
  let autoId = 0
  const failOps = options.failOps ?? new Set<string>()

  function makeBuilder(table: string) {
    const filters: ((r: Row) => boolean)[] = []
    let op: { kind: 'select' } | { kind: 'delete' } | { kind: 'update'; patch: Row } | { kind: 'insert'; rows: Row[] } = { kind: 'select' }
    let single = false
    let wantCount = false
    let headOnly = false
    // Postgrest applies chained .order() calls in sequence (date, then time).
    // This used to keep a single column and let each call OVERWRITE the last,
    // so `.order('planned_date').order('planned_start_time')` silently sorted by
    // time alone — every row in the wrong order, with no error. Any module that
    // walks its rows in schedule order (the rotation shift, the plan rollover)
    // was then tested against a scrambled list, which is worse than not testing
    // it: the test still passes or fails for reasons unrelated to the code.
    const orders: { col: string; asc: boolean }[] = []
    let limitN: number | null = null

    const api: any = {
      select: (_cols?: string, opts?: { count?: 'exact'; head?: boolean }) => {
        if (opts?.count === 'exact') wantCount = true
        if (opts?.head) headOnly = true
        return api
      },
      eq: (col: string, val: any) => { filters.push((r) => r[col] === val); return api },
      neq: (col: string, val: any) => { filters.push((r) => r[col] !== val); return api },
      is: (col: string, val: any) => { filters.push((r) => r[col] === val); return api },
      // Only shape used in this codebase: .not('col', 'is', value) — e.g.
      // excluding warm-up sets with .not('is_warmup', 'is', true).
      not: (col: string, op: string, val: any) => {
        if (op === 'is') filters.push((r) => r[col] !== val)
        return api
      },
      gte: (col: string, val: any) => { filters.push((r) => r[col] >= val); return api },
      lte: (col: string, val: any) => { filters.push((r) => r[col] <= val); return api },
      lt: (col: string, val: any) => { filters.push((r) => r[col] < val); return api },
      in: (col: string, vals: any[]) => { filters.push((r) => vals.includes(r[col])); return api },
      or: (expr: string) => { filters.push(parseOrClause(expr)); return api },
      order: (col: string, opts?: { ascending?: boolean }) => {
        orders.push({ col, asc: opts?.ascending !== false })
        return api
      },
      limit: (n: number) => { limitN = n; return api },
      delete: () => { op = { kind: 'delete' }; return api },
      update: (patch: Row) => { op = { kind: 'update', patch }; return api },
      insert: (rows: Row | Row[]) => { op = { kind: 'insert', rows: Array.isArray(rows) ? rows : [rows] }; return api },
      maybeSingle: () => { single = true; return api },
      then: (resolve: (v: { data: any; error: any; count?: number }) => void, reject?: (e: any) => void) => {
        try {
          const opKey = `${table}.${op.kind}`
          const forcedCode = options.failOpCodes?.[opKey]
          if (failOps.has(opKey) || forcedCode) {
            const error: Row = fakeError(`simulated failure: ${opKey}`)
            if (forcedCode) error.code = forcedCode
            resolve({ data: null, error })
            return
          }
          if (op.kind === 'insert') {
            // Give every inserted row an id, the way the real table's uuid
            // default does. Without this, generated rows all carried
            // `id: undefined`, which is not merely untidy: `.eq('id', undefined)`
            // then matches EVERY such row, so one delete wipes the lot. The
            // journey harness hit exactly that — dedupe appeared to erase a
            // whole schedule — and it was an artefact of the fake, not a real
            // defect. A fake that cannot tell two rows apart cannot test any
            // module that identifies rows by id.
            const withIds = op.rows.map((r) =>
              r.id === undefined ? { ...r, id: `fake-${++autoId}` } : r)
            tables[table] = [...(tables[table] ?? []), ...withIds]
            resolve({ data: withIds, error: null })
            return
          }
          const all = tables[table] ?? []
          let matched = all.filter((r) => filters.every((f) => f(r)))
          if (orders.length) {
            matched = [...matched].sort((a, b) => {
              for (const { col, asc } of orders) {
                if (a[col] === b[col]) continue
                const cmp = a[col] > b[col] ? 1 : -1
                return asc ? cmp : -cmp
              }
              return 0
            })
          }
          if (limitN != null) matched = matched.slice(0, limitN)

          let result: any
          if (op.kind === 'select') {
            result = matched
          } else if (op.kind === 'delete') {
            tables[table] = all.filter((r) => !matched.includes(r))
            result = matched
          } else {
            for (const r of matched) Object.assign(r, op.patch)
            result = matched
          }
          const data = headOnly ? null : (single ? (result[0] ?? null) : result)
          if (wantCount) { resolve({ data, error: null, count: result.length }); return }
          resolve({ data, error: null })
        } catch (e) {
          if (reject) reject(e); else throw e
        }
      },
    }
    return api
  }

  return { from: (table: string) => makeBuilder(table) } as any
}
