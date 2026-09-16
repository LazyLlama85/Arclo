"""Flat vector exercise pictograms, drawn in code.

WHY DRAWN RATHER THAN GENERATED OR SOURCED.
AI image models get lifting wrong in ways a fitness audience spots instantly:
bar path, grip width, joint angles, plate counts, the occasional extra finger.
Stock illustration carries licensing questions and never matches a brand palette.
Drawing them means one consistent style, exact brand colours, zero licensing
risk, and a graphic that can be corrected in a line of code when it is wrong.

STYLE. Front or side view, single figure, thick rounded strokes, no faces, no
detail below what reads at a glance. The figure is muted so the EQUIPMENT and
the working limbs carry the accent colour, because the equipment is what makes
an exercise recognisable at slideshow speed, not the body.

Everything is drawn on a 1000x1000 grid at 2x and downsampled, which is how the
strokes get clean edges without any real antialiasing work.

    from exercise_art import draw_exercise
    img = draw_exercise('overhead_press', 520)   # RGBA, transparent ground
"""
from PIL import Image, ImageDraw

GRID = 1000
SS = 2  # supersample

BODY = (176, 186, 204, 255)
ACCENT = (78, 139, 255, 255)
GEAR = (232, 238, 250, 255)

STROKE = 46
HEAD_R = 72


def _p(pt):
    return (pt[0] * SS, pt[1] * SS)


def limb(d, a, b, color=BODY, w=STROKE):
    """A stroke with round caps. PIL's line joints do not round the ENDS, and
    square-ended limbs make a figure read as a robot."""
    a, b = _p(a), _p(b)
    ww = w * SS
    d.line([a, b], fill=color, width=int(ww))
    r = ww / 2
    for pt in (a, b):
        d.ellipse([pt[0] - r, pt[1] - r, pt[0] + r, pt[1] + r], fill=color)


def dot(d, c, r, color=BODY, outline=None, ow=0):
    c = _p(c)
    r = r * SS
    d.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], fill=color,
              outline=outline, width=int(ow * SS))


def bar(d, y, x0, x1, color=GEAR, w=22):
    limb(d, (x0, y), (x1, y), color, w)


def plates(d, y, x, color=ACCENT, h=150, w=34):
    """A weight plate, drawn as a tall rounded slab. Two per side reads as heavy
    without needing detail."""
    x0, y0, x1, y1 = _p((x - w / 2, y - h / 2)) + _p((x + w / 2, y + h / 2))
    d.rounded_rectangle([x0, y0, x1, y1], radius=10 * SS, fill=color)


def dumbbell(d, c, vertical=False, color=ACCENT):
    cx, cy = c
    if vertical:
        limb(d, (cx, cy - 55), (cx, cy + 55), color, 20)
        for dy in (-70, 70):
            x0, y0, x1, y1 = _p((cx - 42, cy + dy - 20)) + _p((cx + 42, cy + dy + 20))
            d.rounded_rectangle([x0, y0, x1, y1], radius=8 * SS, fill=color)
    else:
        limb(d, (cx - 55, cy), (cx + 55, cy), color, 20)
        for dx in (-70, 70):
            x0, y0, x1, y1 = _p((cx + dx - 20, cy - 42)) + _p((cx + dx + 20, cy + 42))
            d.rounded_rectangle([x0, y0, x1, y1], radius=8 * SS, fill=color)


def bench(d, y, x0, x1, color=(96, 104, 122, 255), legs=True):
    x0p, y0p, x1p, y1p = _p((x0, y)) + _p((x1, y + 44))
    d.rounded_rectangle([x0p, y0p, x1p, y1p], radius=18 * SS, fill=color)
    if legs:
        for x in (x0 + 60, x1 - 60):
            limb(d, (x, y + 44), (x, y + 190), color, 22)


# ── Poses ────────────────────────────────────────────────────────────────────
# Front view unless noted. Kept deliberately simple: a slideshow viewer has
# about one second, so the silhouette has to be right and nothing else matters.

def _standing_legs(d, hip=(500, 620)):
    limb(d, hip, (420, 790))
    limb(d, (420, 790), (420, 900))
    limb(d, hip, (580, 790))
    limb(d, (580, 790), (580, 900))


def overhead_press(d):
    dot(d, (500, 250), HEAD_R)
    limb(d, (500, 330), (500, 630))
    _standing_legs(d)
    for sx, ex, hx in ((420, 330, 330), (580, 670, 670)):
        limb(d, (sx, 370), (ex, 290), ACCENT)
        limb(d, (ex, 290), (hx, 175), ACCENT)
    bar(d, 165, 215, 785)
    for x in (255, 300, 700, 745):
        plates(d, 165, x)


def bench_press(d):
    """Side view. The bench is what names this one."""
    bench(d, 640, 240, 760)
    dot(d, (255, 600), HEAD_R)
    limb(d, (330, 618), (640, 618))
    limb(d, (640, 618), (740, 730))
    limb(d, (740, 730), (740, 880))
    limb(d, (400, 600), (400, 460), ACCENT)
    limb(d, (400, 460), (400, 350), ACCENT)
    bar(d, 340, 170, 630)
    for x in (215, 260, 540, 585):
        plates(d, 340, x)


def incline_press(d):
    """Side view on an incline, dumbbells overhead."""
    a, b = (250, 780), (640, 520)
    limb(d, a, b, (96, 104, 122, 255), 46)
    limb(d, (300, 800), (300, 900), (96, 104, 122, 255), 22)
    dot(d, (600, 470), HEAD_R)
    limb(d, (330, 760), (560, 540))
    limb(d, (330, 760), (250, 890))
    limb(d, (470, 640), (450, 470), ACCENT)
    limb(d, (450, 470), (450, 340), ACCENT)
    dumbbell(d, (450, 300))
    dumbbell(d, (660, 300))
    limb(d, (540, 570), (640, 470), ACCENT)
    limb(d, (640, 470), (660, 340), ACCENT)


def dips(d):
    """Two parallel bars with the figure suspended between them. The bars have
    to read as two separate rails or this is just a person standing, so they get
    uprights and a clear gap either side of the body."""
    for x in (210, 790):
        limb(d, (x, 420), (x, 880), (70, 78, 96, 255), 20)
    bar(d, 420, 140, 360)
    bar(d, 420, 640, 860)
    dot(d, (500, 330), HEAD_R)
    limb(d, (500, 410), (500, 640))
    limb(d, (440, 430), (300, 415), ACCENT)
    limb(d, (560, 430), (700, 415), ACCENT)
    limb(d, (500, 640), (560, 760))
    limb(d, (560, 760), (430, 820))


def cable_fly(d):
    """Cables converging is the whole idea, so draw the lines long."""
    for x in (150, 850):
        limb(d, (x, 180), (x, 820), (70, 78, 96, 255), 16)
    dot(d, (500, 300), HEAD_R)
    limb(d, (500, 380), (500, 650))
    _standing_legs(d, (500, 650))
    limb(d, (430, 420), (330, 360), ACCENT)
    limb(d, (330, 360), (200, 300), ACCENT)
    limb(d, (570, 420), (670, 360), ACCENT)
    limb(d, (670, 360), (800, 300), ACCENT)
    limb(d, (150, 300), (200, 300), ACCENT, 16)
    limb(d, (850, 300), (800, 300), ACCENT, 16)


def lateral_raise(d):
    dot(d, (500, 270), HEAD_R)
    limb(d, (500, 350), (500, 640))
    _standing_legs(d, (500, 640))
    limb(d, (430, 390), (300, 400), ACCENT)
    limb(d, (300, 400), (200, 400), ACCENT)
    limb(d, (570, 390), (700, 400), ACCENT)
    limb(d, (700, 400), (800, 400), ACCENT)
    dumbbell(d, (180, 400), vertical=True)
    dumbbell(d, (820, 400), vertical=True)


def pushdown(d):
    """A cable stack and a rope coming down."""
    x0, y0, x1, y1 = _p((760, 130)) + _p((880, 560))
    d.rounded_rectangle([x0, y0, x1, y1], radius=16 * SS, fill=(70, 78, 96, 255))
    limb(d, (820, 150), (560, 150), (70, 78, 96, 255), 16)
    limb(d, (560, 150), (560, 400), ACCENT, 16)
    dot(d, (430, 300), HEAD_R)
    limb(d, (430, 380), (430, 650))
    _standing_legs(d, (430, 650))
    limb(d, (480, 420), (545, 400), ACCENT)
    limb(d, (545, 400), (560, 520), ACCENT)


def pushup(d):
    """Side view, body as one line. The supporting arm must actually reach the
    floor or the whole thing reads as a ramp rather than a person."""
    bar(d, 880, 120, 900, (70, 78, 96, 255), 14)
    limb(d, (210, 720), (700, 600), BODY, 52)
    dot(d, (780, 580), HEAD_R)
    limb(d, (690, 620), (690, 862), ACCENT)
    limb(d, (215, 725), (200, 862))


def squat(d):
    dot(d, (500, 250), HEAD_R)
    limb(d, (500, 330), (500, 560))
    limb(d, (500, 560), (380, 700))
    limb(d, (380, 700), (380, 870))
    limb(d, (500, 560), (620, 700))
    limb(d, (620, 700), (620, 870))
    limb(d, (420, 360), (330, 330), ACCENT)
    limb(d, (580, 360), (670, 330), ACCENT)
    bar(d, 330, 210, 790)
    for x in (255, 300, 700, 745):
        plates(d, 330, x)


def row(d):
    """Hinged side view with a bar hanging. Pull day's icon."""
    dot(d, (270, 400), HEAD_R)
    limb(d, (345, 420), (660, 470))
    limb(d, (660, 470), (660, 700))
    limb(d, (660, 700), (660, 870))
    limb(d, (430, 440), (430, 620), ACCENT)
    bar(d, 640, 230, 640)
    for x in (280, 325, 545, 590):
        plates(d, 640, x)


def pulldown(d):
    x0, y0, x1, y1 = _p((420, 110)) + _p((580, 170))
    d.rounded_rectangle([x0, y0, x1, y1], radius=14 * SS, fill=(70, 78, 96, 255))
    bar(d, 250, 230, 770)
    limb(d, (330, 250), (330, 170), ACCENT, 14)
    limb(d, (670, 250), (670, 170), ACCENT, 14)
    limb(d, (500, 170), (500, 140), (70, 78, 96, 255), 14)
    dot(d, (500, 430), HEAD_R)
    limb(d, (500, 510), (500, 740))
    limb(d, (430, 540), (370, 400), ACCENT)
    limb(d, (370, 400), (330, 260), ACCENT)
    limb(d, (570, 540), (630, 400), ACCENT)
    limb(d, (630, 400), (670, 260), ACCENT)
    limb(d, (500, 740), (420, 860))
    limb(d, (500, 740), (580, 860))


def clock(d):
    """Not an exercise. Used on time-budget slides."""
    dot(d, (500, 500), 300, (0, 0, 0, 0), ACCENT, 34)
    limb(d, (500, 500), (500, 320), ACCENT, 30)
    limb(d, (500, 500), (640, 560), ACCENT, 30)


def calendar_icon(d):
    x0, y0, x1, y1 = _p((180, 240)) + _p((820, 820))
    d.rounded_rectangle([x0, y0, x1, y1], radius=40 * SS, outline=BODY, width=30 * SS)
    limb(d, (180, 400), (820, 400), BODY, 26)
    for x in (320, 680):
        limb(d, (x, 180), (x, 300), BODY, 26)
    for i, cx in enumerate((320, 500, 680)):
        for j, cy in enumerate((520, 680)):
            col = ACCENT if (i + j) % 2 == 0 else (70, 78, 96, 255)
            dot(d, (cx, cy), 46, col)


EXERCISES = {
    'overhead_press': overhead_press,
    'bench_press': bench_press,
    'incline_press': incline_press,
    'dips': dips,
    'cable_fly': cable_fly,
    'lateral_raise': lateral_raise,
    'pushdown': pushdown,
    'pushup': pushup,
    'squat': squat,
    'row': row,
    'pulldown': pulldown,
    'clock': clock,
    'calendar': calendar_icon,
}


def draw_exercise(name, size=520, pad=0.06):
    """Render, then trim to the drawing's own bounds and re-centre it in a
    square.

    Without the trim every pose keeps whatever slice of the 1000x1000 grid it
    happened to be drawn in, so a tall figure and a wide one come out at wildly
    different visual sizes and none of them sit in the middle of their box. On a
    slide that reads as sloppy even though each icon is individually fine. Trim
    and re-centre makes the whole set land at one consistent weight."""
    img = Image.new('RGBA', (GRID * SS, GRID * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    EXERCISES[name](d)

    box = img.getbbox()
    if box:
        img = img.crop(box)
    side = int(max(img.size) * (1 + pad * 2))
    square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    square.paste(img, ((side - img.width) // 2, (side - img.height) // 2), img)
    return square.resize((size, size), Image.LANCZOS)


def contact_sheet(path, cell=300):
    """Every pictogram on one dark sheet, for eyeballing them together. A set
    like this only works if it is consistent, and consistency is invisible one
    at a time."""
    names = list(EXERCISES)
    cols = 5
    rows = (len(names) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * cell, rows * cell), (15, 16, 22))
    for i, n in enumerate(names):
        art = draw_exercise(n, cell - 20)
        sheet.paste(art, ((i % cols) * cell + 10, (i // cols) * cell + 10), art)
    sheet.save(path)
    return path


if __name__ == '__main__':
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    print(contact_sheet(os.path.join(here, 'pictogram-sheet.png')))
