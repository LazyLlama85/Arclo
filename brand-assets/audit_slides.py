"""Prove no slide overlaps itself or runs off the frame.

Founder, 2026-09-15: "analyze and make sure things aren't overlapping and stuff."

Eyeballing 47 slides does not scale and does not stay true after the next copy
edit: text is auto-fitted, so a longer sentence silently pushes the block below
it into whatever comes next. This renders every slide, reads the bounding boxes
each block recorded while drawing, and fails on:

  * any two blocks intersecting
  * anything crossing the left or right margin
  * anything below SAFE_BOTTOM, where TikTok's own caption and action rail sit
  * anything above the top margin

Run:  python brand-assets/audit_slides.py
Exit: 0 clean, 1 with problems listed.
"""
import sys

import make_slides as ms

# The wordmark sits below SAFE_BOTTOM deliberately: it is decoration that is
# fine to lose under the caption, unlike anything anyone has to read.
BOTTOM_EXEMPT = {'wordmark'}


def intersect(a, b):
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    ox = min(ax1, bx1) - max(ax0, bx0)
    oy = min(ay1, by1) - max(ay0, by0)
    return (ox, oy) if ox > 0 and oy > 0 else None


def audit():
    problems = []
    checked = 0

    for series, slides in (ms.MISSED, ms.RANKED, ms.FORTYFIVE, ms.PPL, ms.THESIS):
        for i, spec in enumerate(slides, 1):
            ms.render(spec)
            boxes = [dict(b) for b in ms.LAYOUT]
            where = f'{series}/{i:02d}'
            checked += 1

            for n, blk in enumerate(boxes):
                x0, y0, x1, y1 = blk['box']
                name = blk['name']
                if x0 < ms.MARGIN - 1:
                    problems.append(f'{where}: {name} starts at x={x0}, inside the left margin')
                if x1 > ms.W - ms.MARGIN + 1:
                    problems.append(f'{where}: {name} ends at x={x1}, past the right margin')
                if y0 < ms.MARGIN - 40:
                    problems.append(f'{where}: {name} starts at y={y0}, above the top margin')
                if name not in BOTTOM_EXEMPT and y1 > ms.SAFE_BOTTOM:
                    problems.append(
                        f'{where}: {name} reaches y={y1}, below SAFE_BOTTOM '
                        f'({ms.SAFE_BOTTOM}) where TikTok draws its caption')

                for other in boxes[n + 1:]:
                    if other['name'] in BOTTOM_EXEMPT or name in BOTTOM_EXEMPT:
                        continue
                    hit = intersect(blk['box'], other['box'])
                    if hit:
                        problems.append(
                            f'{where}: {name} overlaps {other["name"]} '
                            f'by {hit[0]}x{hit[1]}px')

    print(f'checked {checked} slides')
    if not problems:
        print('no overlaps, nothing out of bounds')
        return 0
    print(f'\n{len(problems)} problem(s):')
    for p in problems:
        print('  ' + p)
    return 1


if __name__ == '__main__':
    sys.exit(audit())
