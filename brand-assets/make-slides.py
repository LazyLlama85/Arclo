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

def render(spec):
    kind = spec.get('kind', 'body')
    img = ground(glow_y=spec.get('glow', 0.34), glow_strength=spec.get('glow_s', 1.0))
    d = ImageDraw.Draw(img)
    eyebrow(d, spec.get('eyebrow'))
    box_w = W - MARGIN * 2

    if kind == 'hook':
        f, lines = fit(d, spec['text'], '800', 148, 72, box_w, 760, 1.03)
        block = len(lines) * f.size * 1.03
        y = int(H * 0.30 - block / 2)
        y = draw_lines(d, lines, f, MARGIN, y, INK, 1.03)
        if spec.get('sub'):
            fs, ls = fit(d, spec['sub'], '500', 54, 34, box_w, 300, 1.25)
            draw_lines(d, ls, fs, MARGIN, y + 44, ACCENT, 1.25)

    elif kind == 'body':
        f, lines = fit(d, spec['text'], '800', 110, 58, box_w, 720, 1.06)
        block = len(lines) * f.size * 1.06
        y = int(H * 0.36 - block / 2)
        y = draw_lines(d, lines, f, MARGIN, y, INK, 1.06)
        if spec.get('sub'):
            fs, ls = fit(d, spec['sub'], '400', 46, 30, box_w, 340, 1.3)
            draw_lines(d, ls, fs, MARGIN, y + 38, MUTED, 1.3)

    elif kind == 'tier':
        badge = spec['tier']
        col = {'S': ACCENT, 'A': GOOD, 'B': (230, 180, 70), 'C': MUTED, 'D': DANGER}[badge]
        bf = font('800', 150)
        d.text((MARGIN, int(H * 0.26)), badge, font=bf, fill=col)
        d.text((MARGIN + d.textlength(badge, font=bf) + 24, int(H * 0.26) + 52),
               'TIER', font=font('700', 34), fill=col)
        f, lines = fit(d, spec['text'], '800', 104, 56, box_w, 420, 1.06)
        y = draw_lines(d, lines, f, MARGIN, int(H * 0.44), INK, 1.06)
        if spec.get('sub'):
            fs, ls = fit(d, spec['sub'], '400', 44, 30, box_w, 320, 1.32)
            draw_lines(d, ls, fs, MARGIN, y + 36, MUTED, 1.32)

    elif kind == 'list':
        f, lines = fit(d, spec['text'], '800', 86, 52, box_w, 300, 1.06)
        y = draw_lines(d, lines, f, MARGIN, int(H * 0.20), INK, 1.06) + 56
        # "name|value" right-aligns the value, so a save slide scans as a table
        # rather than a paragraph. Runs of spaces cannot do this: the wrapper
        # splits on whitespace and rejoins with single spaces.
        rows = [i.split('|', 1) for i in spec['items']]
        vf = font('700', 44)
        for row in rows:
            name = row[0].strip()
            value = row[1].strip() if len(row) > 1 else None
            avail = box_w - 40 - (d.textlength(value, font=vf) + 40 if value else 0)
            fi, li = fit(d, name, '600', 50, 32, avail, 200, 1.2)
            d.ellipse([MARGIN, y + 18, MARGIN + 14, y + 32], fill=ACCENT)
            draw_lines(d, li, fi, MARGIN + 40, y, INK, 1.2)
            if value:
                # A bare tier letter takes its tier colour, so the save slide
                # matches the tier cards the viewer just swiped through.
                col = {'S': ACCENT, 'A': GOOD, 'B': (230, 180, 70),
                       'C': MUTED, 'D': DANGER}.get(value, ACCENT)
                d.text((W - MARGIN - d.textlength(value, font=vf), y + 4), value, font=vf, fill=col)
            y += int(len(li) * fi.size * 1.2) + 26

    elif kind == 'calendar':
        f, lines = fit(d, spec['text'], '800', 96, 52, box_w, 360, 1.06)
        y = draw_lines(d, lines, f, MARGIN, int(H * 0.22), INK, 1.06)
        calendar(d, spec['days'], y + 90)
        if spec.get('sub'):
            fs, ls = fit(d, spec['sub'], '400', 46, 30, box_w, 300, 1.3)
            draw_lines(d, ls, fs, MARGIN, y + 90 + 200, MUTED, 1.3)

    elif kind == 'cta':
        f, lines = fit(d, spec['text'], '800', 104, 56, box_w, 340, 1.05)
        y = draw_lines(d, lines, f, MARGIN, int(H * 0.11), INK, 1.05)
        if spec.get('sub'):
            fs, ls = fit(d, spec['sub'], '400', 42, 28, box_w, 260, 1.32)
            y = draw_lines(d, ls, fs, MARGIN, y + 28, MUTED, 1.32)
        # TikTok lays its caption, username and action rail over roughly the
        # bottom fifth of the frame. A call to action down there is simply not
        # read, so everything on this slide stays above SAFE_BOTTOM.
        phone(img, spec['shot'], y + 40, 700)
        ff = font('700', 44)
        foot = spec.get('foot', 'Free on iPhone and Android')
        tw = d.textlength(foot, font=ff)
        d.text(((W - tw) / 2, min(y + 40 + 700 + 46, SAFE_BOTTOM - 50)), foot, font=ff, fill=ACCENT)
        return img  # wordmark would collide with the footer

    wordmark(d)
    return img


# ── The series ───────────────────────────────────────────────────────────────

MISSED = ('01-missed-push-day', [
    dict(kind='hook', eyebrow='push day', text='You missed push day.', sub='Do not just skip to pull.'),
    dict(kind='body', text='Here is what most people do.'),
    dict(kind='calendar', text='The week you actually had',
         days=[('M', 'miss'), ('T', 'done'), ('W', 'done'), ('T', 'plan'), ('F', 'plan'), ('S', 'plan'), ('S', 'rest')],
         sub='Push just vanishes.'),
    dict(kind='body', text='It never gets made up.'),
    dict(kind='body', text='On a 6 day split you push twice a week.'),
    dict(kind='body', text='Miss one and that is half your push volume, gone.', sub='Every week you do it.'),
    dict(kind='body', text='You are not undertrained. You are unbalanced.'),
    dict(kind='hook', text='Do this instead.', glow=0.5),
    dict(kind='body', text='Slide the whole rotation down one day.'),
    dict(kind='calendar', text='The week that still works',
         days=[('M', 'rest'), ('T', 'done'), ('W', 'done'), ('T', 'done'), ('F', 'done'), ('S', 'done'), ('S', 'done')],
         sub='Push moves to Tuesday. Everything follows. Nothing is skipped.'),
    dict(kind='body', text='Your rest day absorbs it.',
         sub='You do not train extra. You just stop skipping a muscle group.'),
    dict(kind='cta', text='Arclo does this in one tap.',
         sub='Miss a day and it slides your rotation, then rebuilds the week around it.',
         shot='home.webp'),
])

RANKED = ('02-push-ranked', [
    dict(kind='hook', eyebrow='ranked', text='Push exercises, ranked.',
         sub='You are not going to like where bench lands.'),
    dict(kind='tier', tier='S', text='Incline dumbbell press',
         sub='Upper chest is the difference between a big chest and a wide one.'),
    dict(kind='tier', tier='S', text='Overhead press',
         sub='The only push movement that builds shoulders you can see from behind.'),
    dict(kind='tier', tier='A', text='Dips',
         sub='Lean forward and it is the best chest builder you are not doing.'),
    dict(kind='tier', tier='A', text='Cable fly',
         sub='Constant tension where a dumbbell gives you none.'),
    dict(kind='tier', tier='B', text='Flat barbell bench'),
    dict(kind='body', text='Yes. B.',
         sub='Great for pressing heavy. Mediocre for building a chest. Those are different goals.'),
    dict(kind='tier', tier='C', text='Pec deck', sub='Fine as a finisher. Not a reason to skip a press.'),
    dict(kind='tier', tier='D', text='Push-ups, as your main lift', sub='You outgrew them in month two.'),
    dict(kind='list', text='The whole list', items=[
        'Incline dumbbell press|S', 'Overhead press|S', 'Dips|A',
        'Cable fly|A', 'Flat barbell bench|B', 'Pec deck|C']),
    dict(kind='cta', text='Arclo picks these for you.',
         sub='It builds the session around your gear, your level and your week.',
         shot='session.webp'),
])

FORTYFIVE = ('03-45-minute-push', [
    dict(kind='hook', eyebrow='45 minutes', text='A push day that actually fits in 45 minutes.',
         sub='Six moves. No supersets you will not do.'),
    dict(kind='body', text='Incline DB press', sub='3 x 6-8    Leave one rep in the tank.'),
    dict(kind='body', text='Overhead press', sub='3 x 6-8    Brace before you press.'),
    dict(kind='body', text='Dips', sub='3 x 8-10    Lean forward for chest.'),
    dict(kind='body', text='Cable fly', sub='2 x 12-15    Slow on the way out.'),
    dict(kind='body', text='Lateral raise', sub='3 x 15    Lighter than your ego wants.'),
    dict(kind='body', text='Triceps pushdown', sub='2 x 12    Finish and go home.'),
    dict(kind='list', text='The full session', items=[
        'Incline DB press|3 x 6-8', 'Overhead press|3 x 6-8', 'Dips|3 x 8-10',
        'Cable fly|2 x 12-15', 'Lateral raise|3 x 15', 'Triceps pushdown|2 x 12']),
    dict(kind='cta', text='Only have 30 minutes today?',
         sub='Arclo trims the same session down to the time you actually have.',
         shot='quick.webp'),
])

PPL = ('04-ppl-explained', [
    dict(kind='hook', eyebrow='basics', text='Push. Pull. Legs.', sub='The whole system in 9 slides.'),
    dict(kind='body', text='Push', sub='Everything you press away from you. Chest, shoulders, triceps.'),
    dict(kind='body', text='Pull', sub='Everything you pull toward you. Back, biceps, rear delts.'),
    dict(kind='body', text='Legs', sub='Everything below the belt. Quads, hamstrings, glutes, calves.'),
    dict(kind='calendar', text='Run it once a week.',
         days=[('M', 'done'), ('T', 'rest'), ('W', 'done'), ('T', 'rest'), ('F', 'done'), ('S', 'rest'), ('S', 'rest')],
         sub='3 days. Enough to grow if you are new.'),
    dict(kind='calendar', text='Run it twice.',
         days=[('M', 'done'), ('T', 'done'), ('W', 'done'), ('T', 'done'), ('F', 'done'), ('S', 'done'), ('S', 'rest')],
         sub='6 days. Every muscle twice a week, which is where growth lives.'),
    dict(kind='list', text='That is the entire system.', items=[
        'Push', 'Pull', 'Legs', 'Push', 'Pull', 'Legs', 'Rest']),
    dict(kind='body', text='The hard part was never the split.',
         sub='It is finding six days that survive a real week.'),
    dict(kind='cta', text='Arclo finds the days for you.',
         sub='It reads the free time you already have and puts each session where it fits.',
         shot='plan.webp'),
])

THESIS = ('05-not-your-split', [
    dict(kind='hook', text='Your split is not the problem.', sub='Your Tuesday is.'),
    dict(kind='body', text='Every program assumes you train the same days every week.'),
    dict(kind='body', text='You do not. Nobody does.'),
    dict(kind='calendar', text='Then this lands on Wednesday.',
         days=[('M', 'done'), ('T', 'done'), ('W', 'miss'), ('T', 'plan'), ('F', 'plan'), ('S', 'plan'), ('S', 'rest')],
         sub='Work moves. Class moves. You get sick.'),
    dict(kind='body', text='So it breaks in week two.', sub='And you decide you are the one who failed.'),
    dict(kind='body', text='You did not fail. The plan could not move.'),
    dict(kind='hook', text='A plan that cannot move is not a plan. It is a wish.', glow=0.42),
    dict(kind='cta', text='Arclo moves with your week.',
         sub='It schedules around what is already in your calendar, and reschedules when life changes.',
         shot='adapt.webp'),
])


def main():
    total = 0
    for name, slides in (MISSED, RANKED, FORTYFIVE, PPL, THESIS):
        folder = os.path.join(OUT, name)
        os.makedirs(folder, exist_ok=True)
        for i, spec in enumerate(slides, 1):
            path = os.path.join(folder, f'{i:02d}.png')
            render(spec).save(path, 'PNG', optimize=True)
            total += 1
        print(f'{name}: {len(slides)} slides')
    print(f'\n{total} slides -> {OUT}')


main()
