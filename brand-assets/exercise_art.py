"""The Arclo Coach, performing lifts. Drawn in code, not generated.

The app already ships a mascot (brand-assets/coach-poses, reference sheet in
tempo-coach-reference-sheet.jpeg): a solid, rounded, brand-blue figure. It idles,
waves, walks, sprints and does a jumping jack. It has never lifted anything.

These are the missing poses. Using the coach rather than a generic figure means
the exercise art IS the brand, costs nothing, stays consistent forever, and can
be corrected in one line when a joint angle is wrong.

BUILD. Founder, 2026-09-15: "maybe making the coach more buff". The shipped
mascot is a uniform-width stick. These are the same character with mass:
shoulders about 1.6x the waist, tapered arms and legs, rounded joints. It reads
as a lifter without becoming a different character.

COLOUR. The figure is the coach's own blue, sampled from idle.png (49,111,234).
Equipment is pale so it separates from the body; machines are a dim grey so they
sit behind it. Same hierarchy the reference sheet uses.

    from exercise_art import draw_exercise
    img = draw_exercise('overhead_press', 520)   # RGBA, transparent, trimmed
"""
from PIL import Image, ImageDraw

GRID = 1000
SS = 2  # supersample, then downscale — cheap antialiasing

COACH = (49, 111, 234, 255)     # sampled from coach-poses/idle.png
GEAR = (233, 239, 251, 255)     # bars, dumbbells, handles
MACHINE = (86, 95, 116, 255)    # frames, benches, cable stacks
# The slide ground. Body parts are drawn with a halo of it so an arm crossing the
# torso cuts a visible gap instead of dissolving into it. Flat single-colour
# figures are fine standing still (which is all the shipped mascot ever does) and
# turn to mush the moment limbs overlap the trunk, which is every lift.
HALO = (15, 16, 22, 255)
HALO_W = 16

HEAD_R = 74

# Limb widths, shoulder end to wrist end.
#
# Tuned down from a first pass that was genuinely too heavy: at shoulder
# half-width 150 with 82-wide arms the limbs merged into the trunk and the head
# vanished into the shoulders, so every pose read as a blob rather than a
# lifter. What makes a figure look strong is the RATIO — shoulders roughly 3.5x
# an upper arm, waist about two thirds of the shoulders — not absolute mass.
UPPER_ARM = (58, 46)
FOREARM = (46, 36)
THIGH = (76, 58)
CALF = (58, 44)
SHOULDER_W = 106   # half-width
WAIST_W = 68       # half-width


def _p(pt):
    return (pt[0] * SS, pt[1] * SS)


def taper(d, a, b, w, color=COACH, halo=False):
    """A stroke that changes width along its length, with round ends.

    Drawn as a run of circles rather than a polygon: a few lines of code, no
    mitre artefacts at the joins, and round ends for free. `w` is a scalar or an
    (start, end) pair."""
    if halo:
        hw = (w + HALO_W) if isinstance(w, (int, float)) else (w[0] + HALO_W, w[1] + HALO_W)
        taper(d, a, b, hw, HALO)
    w0, w1 = (w, w) if isinstance(w, (int, float)) else w
    ax, ay = a
    bx, by = b
    steps = max(12, int(((bx - ax) ** 2 + (by - ay) ** 2) ** 0.5 / 5))
    for i in range(steps + 1):
        t = i / steps
        x, y = ax + (bx - ax) * t, ay + (by - ay) * t
        r = (w0 + (w1 - w0) * t) / 2
        cx, cy = _p((x, y))
        rr = r * SS
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=color)


def torso(d, top, bottom, top_w=SHOULDER_W, bottom_w=WAIST_W, color=COACH):
    """Shoulders to waist, wide to narrow. The V is what makes this read as a
    lifter rather than the uniform-width mascot."""
    taper(d, top, bottom, (top_w * 2, bottom_w * 2), color)


def head(d, c, r=HEAD_R, color=COACH, halo=True):
    cx, cy = _p(c)
    if halo:
        hr = (r + HALO_W / 2) * SS
        d.ellipse([cx - hr, cy - hr, cx + hr, cy + hr], fill=HALO)
    rr = r * SS
    d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=color)


def arm(d, shoulder, elbow, hand, color=COACH):
    taper(d, shoulder, elbow, UPPER_ARM, color, halo=True)
    taper(d, elbow, hand, FOREARM, color, halo=True)


def leg(d, hip, knee, foot, color=COACH):
    taper(d, hip, knee, THIGH, color, halo=True)
    taper(d, knee, foot, CALF, color, halo=True)


def bar(d, y, x0, x1, color=GEAR, w=26):
    taper(d, (x0, y), (x1, y), w, color)


def plate(d, y, x, color=GEAR, h=190, w=40):
    x0, y0, x1, y1 = _p((x - w / 2, y - h / 2)) + _p((x + w / 2, y + h / 2))
    d.rounded_rectangle([x0, y0, x1, y1], radius=12 * SS, fill=color)


def loaded_bar(d, y, x0, x1, inset=52):
    bar(d, y, x0, x1)
    for x in (x0 + inset, x0 + inset + 54, x1 - inset - 54, x1 - inset):
        plate(d, y, x)


def dumbbell(d, c, vertical=False, color=GEAR):
    cx, cy = c
    if vertical:
        taper(d, (cx, cy - 62), (cx, cy + 62), 24, color)
        for dy in (-78, 78):
            x0, y0, x1, y1 = _p((cx - 48, cy + dy - 24)) + _p((cx + 48, cy + dy + 24))
            d.rounded_rectangle([x0, y0, x1, y1], radius=10 * SS, fill=color)
    else:
        taper(d, (cx - 62, cy), (cx + 62, cy), 24, color)
        for dx in (-78, 78):
            x0, y0, x1, y1 = _p((cx + dx - 24, cy - 48)) + _p((cx + dx + 24, cy + 48))
            d.rounded_rectangle([x0, y0, x1, y1], radius=10 * SS, fill=color)


def slab(d, box, color=MACHINE, radius=18):
    x0, y0, x1, y1 = _p((box[0], box[1])) + _p((box[2], box[3]))
    d.rounded_rectangle([x0, y0, x1, y1], radius=radius * SS, fill=color)


# ── Poses ────────────────────────────────────────────────────────────────────
# Machines and benches are drawn first so the coach always sits in front.

def overhead_press(d):
    head(d, (500, 250))
    torso(d, (500, 390), (500, 645))
    leg(d, (440, 645), (415, 800), (410, 915))
    leg(d, (560, 645), (585, 800), (590, 915))
    arm(d, (375, 405), (325, 295), (335, 190))
    arm(d, (625, 405), (675, 295), (665, 190))
    loaded_bar(d, 175, 180, 820)


def bench_press(d):
    slab(d, (240, 645, 800, 705))
    taper(d, (310, 705), (310, 885), 26, MACHINE)
    taper(d, (730, 705), (730, 885), 26, MACHINE)
    head(d, (255, 598))
    torso(d, (360, 618), (650, 628))
    leg(d, (650, 628), (770, 725), (780, 880))
    arm(d, (400, 585), (400, 465), (400, 365))
    loaded_bar(d, 350, 150, 650)


def incline_press(d):
    taper(d, (240, 835), (690, 500), 64, MACHINE)
    taper(d, (300, 850), (300, 920), 26, MACHINE)
    head(d, (690, 410))
    torso(d, (590, 545), (340, 775))
    leg(d, (340, 765), (255, 880), (250, 928))
    arm(d, (505, 575), (475, 445), (475, 335))
    arm(d, (615, 525), (665, 425), (670, 335))
    dumbbell(d, (475, 295))
    dumbbell(d, (670, 295))


def dips(d):
    taper(d, (195, 435), (195, 900), 24, MACHINE)
    taper(d, (805, 435), (805, 900), 24, MACHINE)
    bar(d, 435, 125, 350)
    bar(d, 435, 650, 875)
    head(d, (500, 315))
    torso(d, (500, 435), (500, 665))
    arm(d, (385, 445), (330, 437), (288, 432))
    arm(d, (615, 445), (670, 437), (712, 432))
    leg(d, (500, 665), (575, 795), (430, 855))


def cable_fly(d):
    taper(d, (135, 150), (135, 870), 20, MACHINE)
    taper(d, (865, 150), (865, 870), 20, MACHINE)
    head(d, (500, 285))
    torso(d, (500, 405), (500, 660))
    leg(d, (440, 660), (415, 800), (410, 915))
    leg(d, (560, 660), (585, 800), (590, 915))
    arm(d, (375, 415), (285, 355), (195, 305))
    arm(d, (625, 415), (715, 355), (805, 305))
    taper(d, (135, 305), (195, 305), 16, GEAR)
    taper(d, (865, 305), (805, 305), 16, GEAR)


def lateral_raise(d):
    head(d, (500, 255))
    torso(d, (500, 385), (500, 640))
    leg(d, (440, 640), (415, 795), (410, 910))
    leg(d, (560, 640), (585, 795), (590, 910))
    arm(d, (375, 400), (275, 404), (190, 406))
    arm(d, (625, 400), (725, 404), (810, 406))
    dumbbell(d, (168, 406), vertical=True)
    dumbbell(d, (832, 406), vertical=True)


def pushdown(d):
    slab(d, (780, 110, 900, 640))
    taper(d, (840, 140), (580, 140), 18, MACHINE)
    # Cable runs all the way down to the hands, or the pose is a person standing
    # near a box rather than pulling anything.
    taper(d, (580, 140), (575, 600), 18, GEAR)
    head(d, (420, 290))
    torso(d, (420, 430), (420, 675))
    leg(d, (362, 675), (345, 800), (340, 915))
    leg(d, (478, 675), (498, 800), (503, 915))
    arm(d, (495, 470), (525, 580), (566, 606))


def pushup(d):
    taper(d, (95, 895), (925, 895), 18, MACHINE)
    head(d, (820, 520))
    torso(d, (700, 620), (250, 752))
    leg(d, (250, 752), (168, 856), (148, 880))
    arm(d, (706, 660), (706, 770), (706, 876))


def squat(d):
    head(d, (500, 250))
    torso(d, (500, 390), (500, 585))
    leg(d, (425, 585), (352, 722), (357, 888))
    leg(d, (575, 585), (648, 722), (643, 888))
    arm(d, (375, 408), (325, 375), (303, 358))
    arm(d, (625, 408), (675, 375), (697, 358))
    loaded_bar(d, 352, 180, 820)


def row(d):
    head(d, (196, 330))
    torso(d, (380, 430), (690, 492))
    leg(d, (690, 492), (700, 690), (700, 886))
    # Hangs from well down the trunk so the lower half clears the torso outline.
    arm(d, (398, 505), (398, 600), (398, 686))
    loaded_bar(d, 712, 200, 600)


def pulldown(d):
    slab(d, (430, 95, 570, 165))
    bar(d, 250, 205, 795)
    taper(d, (500, 165), (500, 250), 18, MACHINE)
    head(d, (500, 425))
    torso(d, (500, 552), (500, 762))
    arm(d, (378, 568), (330, 405), (300, 268))
    arm(d, (622, 568), (670, 405), (700, 268))
    leg(d, (440, 762), (408, 878), (403, 928))
    leg(d, (560, 762), (592, 878), (597, 928))


def clock(d):
    cx, cy, r = 500, 500, 300
    x0, y0, x1, y1 = _p((cx - r, cy - r)) + _p((cx + r, cy + r))
    d.ellipse([x0, y0, x1, y1], outline=COACH, width=int(38 * SS))
    taper(d, (cx, cy), (cx, cy - 190), 34, COACH)
    taper(d, (cx, cy), (cx + 150, cy + 62), 34, COACH)


def calendar_icon(d):
    x0, y0, x1, y1 = _p((170, 250)) + _p((830, 830))
    d.rounded_rectangle([x0, y0, x1, y1], radius=44 * SS, outline=COACH, width=int(34 * SS))
    taper(d, (170, 412), (830, 412), 30, COACH)
    taper(d, (320, 180), (320, 310), 30, COACH)
    taper(d, (680, 180), (680, 310), 30, COACH)
    for i, cx in enumerate((320, 500, 680)):
        for j, cy in enumerate((545, 700)):
            col = COACH if (i + j) % 2 == 0 else MACHINE
            r = 50 * SS
            px, py = _p((cx, cy))
            d.ellipse([px - r, py - r, px + r, py + r], fill=col)


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
    """Render, then trim to the drawing's own bounds and re-centre it.

    Without the trim every pose keeps whatever slice of the 1000x1000 grid it was
    drawn in, so a tall figure and a wide one come out at different visual sizes
    and none sit in the middle of their box. Across a set that reads as sloppy
    even though each icon is individually fine."""
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
    """Every pose on one dark sheet. A set like this only works if it is
    consistent, and consistency is invisible one icon at a time."""
    names = list(EXERCISES)
    cols = 5
    rows = (len(names) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * cell, rows * cell), (15, 16, 22))
    for i, n in enumerate(names):
        a = draw_exercise(n, cell - 20)
        sheet.paste(a, ((i % cols) * cell + 10, (i // cols) * cell + 10), a)
    sheet.save(path)
    return path


if __name__ == '__main__':
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    print(contact_sheet(os.path.join(here, 'pictogram-sheet.png')))
