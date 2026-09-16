"""Render the TikTok slideshow series as finished 1080x1920 PNGs.

Playbook: https://claude.ai/code/artifact/f68a35ae-6a98-45b5-a9fa-4cf8822cea75

WHY GENERATE RATHER THAN SOURCE. Most slides in these series are type, not
photography, and type outperforms stock gym footage here for a mechanical
reason: TikTok auto-advances a slideshow roughly every two seconds, so a slide
has to be legible in about one. A bold line on a dark ground wins that; a photo
with text laid over it does not.

It also sidesteps two traps. Stock footage carries licensing questions, and
AI-generated lifting imagery gets form wrong in ways a fitness audience spots
instantly (bar path, grip width, joint angles, the occasional extra finger).
Publishing that under a training brand costs more credibility than the slide is
worth. So: exercises are typographic cards here, and the only photographs used
are real app screenshots.

Run:  python brand-assets/make-slides.py
Out:  brand-assets/slides/<series>/NN.png
"""
import os

from PIL import Image, ImageDraw, ImageFont

from exercise_art import draw_exercise

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FONTS = os.path.join(HERE, 'fonts')
SHOTS = os.path.join(ROOT, 'web', 'img', 'shots')
OUT = os.path.join(HERE, 'slides')

W, H = 1080, 1920
MARGIN = 96
# TikTok overlays caption, username and the action rail across the bottom of the
# frame. Nothing that has to be read may sit below this line.
SAFE_BOTTOM = 1500

# The app's own palette, so a slide and a screenshot sit together without a seam.
BG = (15, 16, 22)
GLOW = (28, 46, 96)
INK = (255, 255, 255)
MUTED = (154, 162, 178)
ACCENT = (78, 139, 255)
DANGER = (232, 90, 90)
GOOD = (95, 211, 163)

_font_cache = {}


def font(weight, size):
    key = (weight, size)
    if key not in _font_cache:
        _font_cache[key] = ImageFont.truetype(os.path.join(FONTS, f'Inter-{weight}.ttf'), size)
    return _font_cache[key]


def ground(glow_y=0.34, glow_strength=1.0):
    """Dark ground with one soft radial bloom. Concentric ellipses rather than a
    real gradient because it keeps the file small and banding invisible at this
    size."""
    img = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(img)
    cx, cy = int(W * 0.5), int(H * glow_y)
    for i in range(70, 0, -1):
        r = int(i * 15)
        t = i / 70.0
        col = tuple(
            int(BG[c] + (GLOW[c] - BG[c]) * (1 - t) * 0.55 * glow_strength) for c in range(3)
        )
        d.ellipse([cx - r, cy - int(r * 0.85), cx + r, cy + int(r * 0.85)], fill=col)
    return img


def wrap(draw, text, f, max_w):
    words, lines, cur = text.split(), [], ''
    for word in words:
        trial = f'{cur} {word}'.strip()
        if draw.textlength(trial, font=f) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def fit(draw, text, weight, start, min_size, max_w, max_h, leading=1.08):
    """Largest size at which `text` wraps inside the box. Slides carry wildly
    different amounts of copy and a fixed size would either clip the long ones or
    waste the short ones."""
    size = start
    while size > min_size:
        f = font(weight, size)
        lines = wrap(draw, text, f, max_w)
        if len(lines) * size * leading <= max_h:
            return f, lines
        size -= 4
    f = font(weight, min_size)
    return f, wrap(draw, text, f, max_w)


def draw_lines(d, lines, f, x, y, fill, leading=1.08):
    for line in lines:
        d.text((x, y), line, font=f, fill=fill)
        y += int(f.size * leading)
    return y


def wordmark(d):
    """Small, bottom-left, on every slide. Brand recall without an ad."""
    f = font('800', 34)
    y = H - MARGIN - 34
    d.text((MARGIN, y), 'arclo', font=f, fill=(120, 128, 145))
    w = d.textlength('arclo', font=f)
    d.ellipse([MARGIN + w + 10, y + 12, MARGIN + w + 24, y + 26], fill=ACCENT)


def eyebrow(d, text):
    if not text:
        return
    f = font('700', 28)
    spaced = ' '.join(text.upper())
    d.text((MARGIN, MARGIN + 6), spaced, font=f, fill=ACCENT)


def check(d, box, color, kind):
    """Drawn marks, not glyphs. Inter has no tick or cross, and a missing glyph
    renders as a blank box on some machines."""
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    s = (x1 - x0) * 0.26
    wdt = 7
    if kind == 'done':
        d.line([(cx - s, cy), (cx - s * 0.2, cy + s * 0.75), (cx + s, cy - s * 0.7)],
               fill=color, width=wdt, joint='curve')
    elif kind == 'miss':
        d.line([(cx - s * 0.75, cy - s * 0.75), (cx + s * 0.75, cy + s * 0.75)], fill=color, width=wdt)
        d.line([(cx + s * 0.75, cy - s * 0.75), (cx - s * 0.75, cy + s * 0.75)], fill=color, width=wdt)


def calendar(d, days, top):
    """days: list of (letter, state) where state is done | miss | plan | rest."""
    n = len(days)
    gap = 18
    cell = (W - MARGIN * 2 - gap * (n - 1)) // n
    x = MARGIN
    for letter, state in days:
        box = [x, top, x + cell, top + cell]
        if state == 'done':
            d.rounded_rectangle(box, radius=20, fill=(24, 44, 88), outline=ACCENT, width=4)
            check(d, box, ACCENT, 'done')
        elif state == 'miss':
            d.rounded_rectangle(box, radius=20, outline=DANGER, width=4)
            check(d, box, DANGER, 'miss')
        elif state == 'plan':
            d.rounded_rectangle(box, radius=20, outline=(70, 78, 96), width=4)
        else:
            d.rounded_rectangle(box, radius=20, fill=(23, 25, 33))
        f = font('700', 30)
        tw = d.textlength(letter, font=f)
        d.text((x + (cell - tw) / 2, top + cell + 16), letter, font=f, fill=MUTED)
        x += cell + gap


def phone(img, shot_name, top, height):
    """Real app screenshot in a drawn bezel. Never a mockup."""
    path = os.path.join(SHOTS, shot_name)
    shot = Image.open(path).convert('RGB')
    ratio = height / shot.height
    shot = shot.resize((max(1, int(shot.width * ratio)), height), Image.LANCZOS)
    bez, rad = 10, 44
    dev = Image.new('RGBA', (shot.width + bez * 2, shot.height + bez * 2), (0, 0, 0, 0))
    ImageDraw.Draw(dev).rounded_rectangle(
        [0, 0, dev.width - 1, dev.height - 1], radius=rad, fill=(26, 28, 36, 255))
    mask = Image.new('L', shot.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, shot.width - 1, shot.height - 1], radius=rad - bez, fill=255)
    dev.paste(shot, (bez, bez), mask)
    img.paste(dev, ((W - dev.width) // 2, top), dev)


# ── Slide renderers ──────────────────────────────────────────────────────────
#
# Every slide carries a graphic and at least one row of real information. The
# first version of these was mostly empty dark space with one line of text on
# it, which is pleasant to design and useless to watch: a viewer swiping at two
# seconds a slide should collect something on each one, or they stop swiping.

ROW_LABEL = 30
ROW_VALUE = 42


def info_rows(d, rows, top, label_col=MUTED):
    """Label above value, hairline between. Reads as a spec sheet, which is what
    someone screenshotting a workout actually wants."""
    y = top
    for label, value in rows:
        d.text((MARGIN, y), ' '.join(label.upper()), font=font('700', ROW_LABEL), fill=ACCENT)
        vf, vl = fit(d, value, '600', ROW_VALUE, 30, W - MARGIN * 2, 140, 1.22)
        y = draw_lines(d, vl, vf, MARGIN, y + ROW_LABEL + 14, INK, 1.22)
        y += 22
        d.line([(MARGIN, y), (W - MARGIN, y)], fill=(44, 50, 64), width=2)
        y += 26
    return y


def art(img, name, size, top, center=True, x=None):
    a = draw_exercise(name, size)
    px = (W - size) // 2 if center else x
    img.paste(a, (px, top), a)


def tier_badge(d, letter, x, y):
    col = {'S': ACCENT, 'A': GOOD, 'B': (230, 180, 70), 'C': MUTED, 'D': DANGER}[letter]
    r = 54
    d.ellipse([x, y, x + r * 2, y + r * 2], outline=col, width=6)
    f = font('800', 58)
    tw = d.textlength(letter, font=f)
    d.text((x + r - tw / 2, y + r - 38), letter, font=f, fill=col)
    return x + r * 2 + 22


def render(spec):
    kind = spec.get('kind', 'point')
    img = ground(glow_y=spec.get('glow', 0.32), glow_strength=spec.get('glow_s', 1.0))
    d = ImageDraw.Draw(img)
    eyebrow(d, spec.get('eyebrow'))
    box_w = W - MARGIN * 2

    if kind == 'hook':
        f, lines = fit(d, spec['text'], '800', 140, 70, box_w, 620, 1.03)
        y = draw_lines(d, lines, f, MARGIN, 250, INK, 1.03)
        if spec.get('sub'):
            fs, ls = fit(d, spec['sub'], '500', 52, 34, box_w, 260, 1.25)
            y = draw_lines(d, ls, fs, MARGIN, y + 34, ACCENT, 1.25)
        if spec.get('art'):
            art(img, spec['art'], 560, min(y + 60, 880))

    elif kind == 'point':
        f, lines = fit(d, spec['text'], '800', 104, 56, box_w, 400, 1.06)
        y = draw_lines(d, lines, f, MARGIN, 210, INK, 1.06)
        if spec.get('sub'):
            fs, ls = fit(d, spec['sub'], '400', 46, 30, box_w, 280, 1.3)
            y = draw_lines(d, ls, fs, MARGIN, y + 26, MUTED, 1.3)
        if spec.get('art'):
            art(img, spec['art'], 460, y + 40)
            y += 460 + 70
        if spec.get('rows'):
            info_rows(d, spec['rows'], max(y + 20, 960))

    elif kind == 'ex':
        x = MARGIN
        if spec.get('tier'):
            x = tier_badge(d, spec['tier'], MARGIN, 168)
        f, lines = fit(d, spec['name'], '800', 86, 48, W - x - MARGIN, 260, 1.05)
        draw_lines(d, lines, f, x, 178, INK, 1.05)
        art(img, spec['art'], 470, 370)
        info_rows(d, spec['rows'], 900)

    elif kind == 'list':
        f, lines = fit(d, spec['text'], '800', 86, 52, box_w, 240, 1.06)
        y = draw_lines(d, lines, f, MARGIN, 190, INK, 1.06) + 40
        rows = [i.split('|', 1) for i in spec['items']]
        vf = font('700', 44)
        for row in rows:
            name = row[0].strip()
            value = row[1].strip() if len(row) > 1 else None
            avail = box_w - 40 - (d.textlength(value, font=vf) + 40 if value else 0)
            fi, li = fit(d, name, '600', 48, 30, avail, 200, 1.2)
            d.ellipse([MARGIN, y + 16, MARGIN + 13, y + 29], fill=ACCENT)
            draw_lines(d, li, fi, MARGIN + 38, y, INK, 1.2)
            if value:
                col = {'S': ACCENT, 'A': GOOD, 'B': (230, 180, 70),
                       'C': MUTED, 'D': DANGER}.get(value, ACCENT)
                d.text((W - MARGIN - d.textlength(value, font=vf), y + 2), value, font=vf, fill=col)
            y += int(len(li) * fi.size * 1.2) + 24
        if spec.get('foot'):
            fs, ls = fit(d, spec['foot'], '400', 42, 28, box_w, 200, 1.3)
            draw_lines(d, ls, fs, MARGIN, min(y + 40, SAFE_BOTTOM - 120), MUTED, 1.3)

    elif kind == 'calendar':
        f, lines = fit(d, spec['text'], '800', 92, 52, box_w, 300, 1.06)
        y = draw_lines(d, lines, f, MARGIN, 200, INK, 1.06)
        calendar(d, spec['days'], y + 70)
        y = y + 70 + 175
        if spec.get('sub'):
            fs, ls = fit(d, spec['sub'], '400', 46, 30, box_w, 240, 1.3)
            y = draw_lines(d, ls, fs, MARGIN, y, MUTED, 1.3)
        if spec.get('rows'):
            info_rows(d, spec['rows'], y + 40)

    elif kind == 'cta':
        f, lines = fit(d, spec['text'], '800', 100, 54, box_w, 300, 1.05)
        y = draw_lines(d, lines, f, MARGIN, 150, INK, 1.05)
        if spec.get('sub'):
            fs, ls = fit(d, spec['sub'], '400', 42, 28, box_w, 240, 1.32)
            y = draw_lines(d, ls, fs, MARGIN, y + 24, MUTED, 1.32)
        phone(img, spec['shot'], y + 34, 680)
        ff = font('700', 44)
        foot = spec.get('foot', 'Free on iPhone and Android')
        tw = d.textlength(foot, font=ff)
        d.text(((W - tw) / 2, min(y + 34 + 680 + 40, SAFE_BOTTOM - 50)), foot, font=ff, fill=ACCENT)
        return img

    wordmark(d)
    return img


# ── The series ───────────────────────────────────────────────────────────────

# Founder, 2026-09-15, rejecting the first version of this series: "it's just
# promoting a random feature of our app, not very relevant. A better way to
# solve the problem is do your next day's workout and a quick workout of what
# you missed."
#
# He is right on the coaching, which is the part that matters. Sliding the
# rotation reorders the week but never recovers the missed session. Training
# tomorrow as planned and bolting a short version of the missed day onto it
# recovers the volume AND keeps the week on its normal days.
#
# The call to action is written to Quick Workout, which exists and does build a
# short session in the time you have. It deliberately does NOT claim the app
# trims "the session you missed" specifically, because that is not built.
MISSED = ('01-missed-push-day', [
    dict(kind='hook', eyebrow='missed a day', text='You missed push day.',
         sub='Do not just write it off.', art='calendar'),
    dict(kind='point', text='Do not push the whole week back a day.',
         sub='Everything drifts, your rest day gets eaten, and you still never did the push session.'),
    dict(kind='point', text='Train tomorrow exactly as planned.',
         sub='Pull day stays pull day. Your week keeps the shape you built it in.',
         rows=[('why', 'Moving sessions is how a split quietly turns into no split at all.')]),
    dict(kind='point', text='Then bolt ten minutes of push onto the end.',
         art='clock',
         rows=[('cost', 'About 10 minutes'), ('recovers', 'Most of the volume you lost')]),
    dict(kind='ex', eyebrow='the make-up', name='Incline DB press', art='incline_press',
         rows=[('sets', '2 x 8'), ('why this one', 'It is the compound. If you only do one, do this.'),
               ('cue', 'Bench at 30 degrees. Steeper turns it into a shoulder press.')]),
    dict(kind='ex', eyebrow='the make-up', name='Lateral raise', art='lateral_raise',
         rows=[('sets', '2 x 15'), ('why this one', 'Side delts recover fast and cost you almost nothing.'),
               ('cue', 'Lead with your elbows, not your hands.')]),
    dict(kind='ex', eyebrow='the make-up', name='Triceps pushdown', art='pushdown',
         rows=[('sets', '1 x 15'), ('why this one', 'One burnout set and you are done.'),
               ('cue', 'Elbows pinned to your sides.')]),
    dict(kind='point', text='One rule.',
         sub='Only make up the compound and one or two accessories. Chase everything you missed and a 45 minute session becomes 90.'),
    dict(kind='list', text='The 10 minute make-up', items=[
        'Incline DB press|2 x 8', 'Lateral raise|2 x 15', 'Triceps pushdown|1 x 15'],
        foot='Add it to the end of tomorrow. Your week never moves.'),
    dict(kind='cta', text='Only have 10 minutes?',
         sub='Arclo builds a real session around the time you actually have, with the gear you actually own.',
         shot='quick.webp'),
])

RANKED = ('02-push-ranked', [
    dict(kind='hook', eyebrow='ranked', text='Push exercises, ranked.',
         sub='You are not going to like where bench lands.'),
    dict(kind='ex', tier='S', name='Incline dumbbell press', art='incline_press',
         rows=[('builds', 'Upper chest, front delts, triceps'),
               ('why S', 'Upper chest is the difference between a big chest and a wide one.'),
               ('cue', 'Bench at 30 degrees. Steeper and it becomes a shoulder press.')]),
    dict(kind='ex', tier='S', name='Overhead press', art='overhead_press',
         rows=[('builds', 'Front and side delts, triceps'),
               ('why S', 'The only press that builds shoulders you can see from behind.'),
               ('cue', 'Squeeze your glutes so you do not lean back under the bar.')]),
    dict(kind='ex', tier='A', name='Dips', art='dips',
         rows=[('builds', 'Lower chest, triceps, front delts'),
               ('why A', 'Loadable, deep stretch, and most people never do them.'),
               ('cue', 'Lean forward for chest. Stay upright for triceps.')]),
    dict(kind='ex', tier='A', name='Cable fly', art='cable_fly',
         rows=[('builds', 'Chest, across the whole range'),
               ('why A', 'Constant tension where a dumbbell gives you none at the top.'),
               ('cue', 'Soft elbow, held. If the angle changes you are pressing.')]),
    dict(kind='ex', tier='B', name='Flat barbell bench', art='bench_press',
         rows=[('builds', 'Chest, front delts, triceps'),
               ('why only B', 'Brilliant for pressing heavy. Average for building a chest.'),
               ('cue', 'Those are different goals. Pick which one you are training for.')]),
    dict(kind='point', text='Yes. B.',
         sub='Bench is a strength lift that happens to hit chest. If your goal is size, it is not the best tool you own.'),
    dict(kind='ex', tier='C', name='Pec deck', art='cable_fly',
         rows=[('builds', 'Chest, short range'),
               ('why C', 'Fine as a finisher. Not a reason to skip a press.'),
               ('cue', 'Use it at the end, never at the start.')]),
    dict(kind='ex', tier='D', name='Push-ups as your main lift', art='pushup',
         rows=[('builds', 'Chest, triceps, core'),
               ('why D', 'Great for your first month. You outgrew them in your second.'),
               ('cue', 'If you can do 20, you need load, not more reps.')]),
    dict(kind='list', text='The whole list', items=[
        'Incline dumbbell press|S', 'Overhead press|S', 'Dips|A',
        'Cable fly|A', 'Flat barbell bench|B', 'Pec deck|C'],
        foot='Two presses, one fly, one dip. That is a push day.'),
    dict(kind='cta', text='Arclo picks these for you.',
         sub='It builds the session around your gear, your level and the time you have.',
         shot='session.webp'),
])

FORTYFIVE = ('03-45-minute-push', [
    dict(kind='hook', eyebrow='45 minutes', text='A push day that actually fits in 45 minutes.',
         sub='Six moves. Nothing you will skip.', art='clock'),
    dict(kind='ex', eyebrow='1 of 6', name='Incline DB press', art='incline_press',
         rows=[('sets', '3 x 6-8'), ('rest', '2 minutes'),
               ('cue', 'Leave one rep in the tank on the first two sets.')]),
    dict(kind='ex', eyebrow='2 of 6', name='Overhead press', art='overhead_press',
         rows=[('sets', '3 x 6-8'), ('rest', '2 minutes'),
               ('cue', 'Brace your ribs down before the bar moves.')]),
    dict(kind='ex', eyebrow='3 of 6', name='Dips', art='dips',
         rows=[('sets', '3 x 8-10'), ('rest', '90 seconds'),
               ('cue', 'Lean forward. Upright turns this into a triceps move.')]),
    dict(kind='ex', eyebrow='4 of 6', name='Cable fly', art='cable_fly',
         rows=[('sets', '2 x 12-15'), ('rest', '60 seconds'),
               ('cue', 'Slow on the way out. That half is the whole exercise.')]),
    dict(kind='ex', eyebrow='5 of 6', name='Lateral raise', art='lateral_raise',
         rows=[('sets', '3 x 15'), ('rest', '45 seconds'),
               ('cue', 'Lighter than your ego wants. Swinging trains nothing.')]),
    dict(kind='ex', eyebrow='6 of 6', name='Triceps pushdown', art='pushdown',
         rows=[('sets', '2 x 12'), ('rest', '45 seconds'),
               ('cue', 'Finish it and go home. No fourth set.')]),
    dict(kind='list', text='The full session', items=[
        'Incline DB press|3 x 6-8', 'Overhead press|3 x 6-8', 'Dips|3 x 8-10',
        'Cable fly|2 x 12-15', 'Lateral raise|3 x 15', 'Triceps pushdown|2 x 12'],
        foot='16 working sets. 45 minutes if you keep the rests honest.'),
    dict(kind='cta', text='Only have 30 minutes today?',
         sub='Arclo trims the same session to the time you actually have, without gutting it.',
         shot='quick.webp'),
])

PPL = ('04-ppl-explained', [
    dict(kind='hook', eyebrow='basics', text='Push. Pull. Legs.',
         sub='The whole system in 9 slides.'),
    dict(kind='ex', eyebrow='day 1', name='Push', art='overhead_press',
         rows=[('trains', 'Chest, shoulders, triceps'),
               ('the idea', 'Everything you press away from your body.'),
               ('staples', 'Incline press, overhead press, dips, lateral raise')]),
    dict(kind='ex', eyebrow='day 2', name='Pull', art='pulldown',
         rows=[('trains', 'Back, biceps, rear delts'),
               ('the idea', 'Everything you pull toward your body.'),
               ('staples', 'Pull-up, row, face pull, curl')]),
    dict(kind='ex', eyebrow='day 3', name='Legs', art='squat',
         rows=[('trains', 'Quads, hamstrings, glutes, calves'),
               ('the idea', 'Everything below the belt, plus the hardest sets you will do.'),
               ('staples', 'Squat, RDL, leg curl, calf raise')]),
    dict(kind='calendar', text='Run it once a week.',
         days=[('M', 'done'), ('T', 'rest'), ('W', 'done'), ('T', 'rest'), ('F', 'done'), ('S', 'rest'), ('S', 'rest')],
         rows=[('frequency', 'Each muscle once a week'),
               ('best for', 'Your first year, or a genuinely busy season')]),
    dict(kind='calendar', text='Run it twice.',
         days=[('M', 'done'), ('T', 'done'), ('W', 'done'), ('T', 'done'), ('F', 'done'), ('S', 'done'), ('S', 'rest')],
         rows=[('frequency', 'Each muscle twice a week'),
               ('best for', 'Growth. Twice a week beats once, if you can hold the days')]),
    dict(kind='list', text='The week', items=[
        'Monday|Push', 'Tuesday|Pull', 'Wednesday|Legs',
        'Thursday|Push', 'Friday|Pull', 'Saturday|Legs', 'Sunday|Rest'],
        foot='That is the entire system. There is nothing else to it.'),
    dict(kind='point', text='The hard part was never the split.',
         sub='It is finding six days that survive a real week of work, class and everything else.',
         art='calendar'),
    dict(kind='cta', text='Arclo finds the days for you.',
         sub='It reads the free time you already have and puts each session where it fits.',
         shot='plan.webp'),
])

THESIS = ('05-not-your-split', [
    dict(kind='hook', text='Your split is not the problem.', sub='Your Tuesday is.'),
    dict(kind='point', text='Every program assumes you train the same days every week.',
         sub='Monday push, Tuesday pull, forever, as though nothing in your life moves.'),
    dict(kind='point', text='You do not. Nobody does.', art='calendar'),
    dict(kind='calendar', text='Then this lands on Wednesday.',
         days=[('M', 'done'), ('T', 'done'), ('W', 'miss'), ('T', 'plan'), ('F', 'plan'), ('S', 'plan'), ('S', 'rest')],
         sub='Work moves. Class moves. You get sick.',
         rows=[('what happens next', 'One missed day turns into a missed week')]),
    dict(kind='point', text='So it breaks in week two.',
         sub='And you decide you are the one who failed.'),
    dict(kind='point', text='You did not fail. The plan could not move.'),
    dict(kind='hook', text='A plan that cannot move is not a plan. It is a wish.', glow=0.4),
    dict(kind='cta', text='Arclo moves with your week.',
         sub='It schedules around what is already in your calendar, and reschedules when life changes.',
         shot='adapt.webp'),
])


def main():
    total = 0
    for name, slides in (MISSED, RANKED, FORTYFIVE, PPL, THESIS):
        folder = os.path.join(OUT, name)
        os.makedirs(folder, exist_ok=True)
        for old in os.listdir(folder):
            if old.endswith('.png'):
                os.remove(os.path.join(folder, old))
        for i, spec in enumerate(slides, 1):
            render(spec).save(os.path.join(folder, f'{i:02d}.png'), 'PNG', optimize=True)
            total += 1
        print(f'{name}: {len(slides)} slides')
    print(f'\n{total} slides -> {OUT}')


main()
