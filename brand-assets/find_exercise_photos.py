"""Find real-form exercise photos on Wikimedia Commons, filtered by licence.

WHY COMMONS. The founder asked for real form rather than drawn figures, and for
free images. Commons is the only large source that exposes a machine-readable
licence per file, which is what makes this checkable rather than hopeful.

Ruled out on the way:
  * yuhonas/free-exercise-db — 800 exercises with images, but the image
    provenance is an open question on the repo (issues #2 and #13 ask where they
    came from and get no maintainer answer). Unknown provenance is not a licence.
  * Pexels / Unsplash — licences are fine, but they carry gym atmosphere, not
    specific lifts, and neither serves a queryable per-file licence.

PREFERENCE ORDER. CC0 and public domain first, because they need no attribution
and no share-alike, which is the only thing that works cleanly on a TikTok
slide. CC BY is usable with a credit line. CC BY-SA is reported but flagged: the
share-alike term is a poor fit for marketing material.

Run:  python brand-assets/find_exercise_photos.py
"""
import json
import os
import subprocess
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'photo-candidates.json')
UA = 'ArcloSlideshowBot/1.0 (https://fittempo.app; jacobalexanderroberts2011@gmail.com)'

# Each entry: slug -> search phrases, best first.
WANTED = {
    'incline_press': ['incline dumbbell press', 'incline bench press dumbbell'],
    'overhead_press': ['overhead press barbell', 'shoulder press dumbbell exercise'],
    'bench_press': ['barbell bench press', 'bench press exercise'],
    'dips': ['triceps dips parallel bars', 'chest dip exercise'],
    'cable_fly': ['cable crossover exercise', 'cable fly chest'],
    'lateral_raise': ['dumbbell lateral raise', 'side lateral raise shoulder'],
    'pushdown': ['triceps pushdown cable', 'tricep rope pushdown'],
    'pushup': ['push-up exercise', 'pushup'],
    'squat': ['barbell back squat', 'squat exercise barbell'],
    'row': ['bent over barbell row', 'dumbbell row exercise'],
    'pulldown': ['lat pulldown machine', 'lat pulldown exercise'],
    'pec_deck': ['pec deck machine', 'chest fly machine'],
}

FREE = ('cc0', 'public domain', 'pd', 'cc-zero')
ATTRIB = ('cc by 2.0', 'cc by 3.0', 'cc by 4.0', 'cc by-sa')

IMAGE_EXT = ('.jpg', '.jpeg', '.png', '.webp')


def search(phrase, limit=12):
    url = 'https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode({
        'action': 'query', 'format': 'json', 'generator': 'search',
        'gsrsearch': phrase, 'gsrnamespace': 6, 'gsrlimit': limit,
        'prop': 'imageinfo', 'iiprop': 'url|extmetadata|size',
    })
    # Wikimedia hard-rate-limits anonymous clients that do not identify
    # themselves, and it answers with a plain-text scolding rather than JSON —
    # which decodes to "no candidates" and looks exactly like a search that
    # found nothing. Descriptive UA plus a pause between calls is their
    # documented requirement, not politeness.
    raw = subprocess.run(
        ['curl', '-s', '-A', UA, url], capture_output=True, text=True).stdout
    time.sleep(1.2)
    try:
        pages = (json.loads(raw).get('query') or {}).get('pages') or {}
    except json.JSONDecodeError:
        return []
    out = []
    for p in pages.values():
        info = (p.get('imageinfo') or [{}])[0]
        meta = info.get('extmetadata') or {}
        name = p.get('title', '')
        if not name.lower().endswith(IMAGE_EXT):
            continue  # skip video/webm and svg diagrams
        lic = ((meta.get('LicenseShortName') or {}).get('value') or '').strip()
        out.append({
            'title': name,
            'licence': lic,
            'tier': 'free' if any(f in lic.lower() for f in FREE)
                    else 'attribution' if any(a in lic.lower() for a in ATTRIB)
                    else 'unclear',
            'author': ((meta.get('Artist') or {}).get('value') or '')[:120],
            'url': (info.get('url') or '').split('?')[0],
            'width': info.get('width'), 'height': info.get('height'),
        })
    return out


def main():
    found = {}
    for slug, phrases in WANTED.items():
        seen, rows = set(), []
        for phrase in phrases:
            for r in search(phrase):
                if r['url'] in seen:
                    continue
                seen.add(r['url'])
                rows.append(r)
        rows.sort(key=lambda r: {'free': 0, 'attribution': 1, 'unclear': 2}[r['tier']])
        found[slug] = rows
        free = sum(1 for r in rows if r['tier'] == 'free')
        print(f'{slug:16s} {len(rows):3d} candidates, {free:2d} CC0/PD')
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(found, f, indent=1)
    print(f'\n-> {OUT}')


main()
