# Exercise photos

Drop a file in here named after the art slug and every slide using that slug
switches from the drawn pictogram to the photo. Nothing else changes.

```
photos/bench_press.jpg      -> used by series 02 and 03
photos/incline_press.jpg
photos/lateral_raise.png
photos/pushdown.jpg
photos/cable_fly.jpg
photos/dips.jpg
photos/overhead_press.jpg
photos/squat.jpg  photos/row.jpg  photos/pulldown.jpg
```

Accepted: `.jpg` `.jpeg` `.png` `.webp`. Any aspect ratio. It gets a square
centre crop biased slightly upward, then a duotone into the brand blues, then
rounded corners. The duotone is not decoration: real exercise photos come from
different gyms, lighting and decades, and six untreated ones in a row read as a
scrapbook rather than a brand.

Then re-run:

```
python brand-assets/make_slides.py
python brand-assets/audit_slides.py
```

## What the free-image search actually found

`find_exercise_photos.py` queries Wikimedia Commons, which is the only large
source that serves a machine-readable licence per file. Results, 2026-09-15:

| Exercise | CC0 / public domain | Verdict |
|---|---|---|
| Incline DB press | 2 | **one genuinely usable** |
| Bench press | 1 | usable, cluttered background |
| Overhead press | 7 | all US Army outdoor PT, subject tiny |
| Squat | 6 | best one is a crowd scene |
| Push-up | 5 | subject off in a corner, or a handstand |
| Dips | 2 | **a farm landscape and a photo of a mouth** |
| Pushdown | 1 | **a computer-science automaton diagram** |
| Lat pulldown | 2 | empty machine, no person |
| Cable fly | 0 | CC BY only, and two have a supplement brand on the shirt |
| Lateral raise | 0 | CC BY only |
| Row | 0 | CC BY only, nobody actually rowing |
| Pec deck | 0 | CC BY only, same branded shirt |

So: roughly a third of the lifts have a correctly licensed, correctly framed
photo, and the ones that exist are visually inconsistent with each other.

Also ruled out:

- **yuhonas/free-exercise-db** — 800 exercises with images, but image provenance
  is an open question on the repo (issues #2 and #13 ask where they came from and
  get no maintainer answer). Unknown provenance is not a licence.
- **Pexels / Unsplash** — licences are fine and need no attribution, but they
  carry gym *atmosphere*, not specific lifts. A search for "lateral raise"
  returns one photo of a lateral raise and five of someone holding a dumbbell.

## Recommendation

Film six clips yourself. Phone on a tripod, framed neck-down or from behind so
it stays faceless, one set each of the six push movements. Twenty minutes gets
correct form, one consistent look, your own gym, and no licensing question
anywhere. Export a still per exercise into this folder.

It is the only option that produces a set rather than a collection, and you are
the one person who can guarantee the form is right.

## Licence discipline

Whatever you use, record where each file came from. If a photo is CC BY it needs
a visible credit; if it is CC BY-SA, do not use it at all, because share-alike
is a bad fit for marketing material. CC0 and public domain need nothing.

Candidate metadata from the search, including licence and author per file, is in
`../photo-candidates.json`. Raw downloads for review are in `../photo-raw/`.
Neither is used by the renderer; only files in this folder are.
