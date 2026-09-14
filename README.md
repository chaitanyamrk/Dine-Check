# Dine Check

A mobile-first web app that puts India's official food-safety records in front of
people before they order. It ranks establishments by hygiene percentage wherever
a score exists, and can sort by distance from wherever the visitor is standing.

Coverage is city by city, because the data is. Hyderabad has the richest record —
scored FoSCoS audits and enforcement findings, taken from what the regulators
publish. Other cities currently rest on the national FSSAI hygiene-rating
directory, which is voluntary and paid for, and so is shown as a certification
rather than a score. The three record types are kept strictly apart and never
ranked against each other; MAINTAINING.md explains why that matters.

Everything is static — one HTML file, one script, a JSON index and a JSON file
per city. No build tooling and no framework. It drops straight onto GitHub
Pages.

---

## Running it locally

`fetch()` is blocked on `file://` URLs, so open it through a server rather than
double-clicking the HTML:

```bash
cd docs && python -m http.server 8000
# then visit http://localhost:8000
```

Geolocation is allowed on `localhost` as a special case, so "Near me" works
there too — but not if you open the file directly from disk.

---

## Updating the data

The site reads `docs/data.json`. Regenerate it whenever the scraper produces new
rows:

```bash
python build_data.py                                  # uses ./hyderabad_food_inspections.csv
python build_data.py "../Inspection Scraper/hyderabad_food_inspections.csv"
git add docs/data.json && git commit -m "Refresh inspections" && git push
```

The script prints a summary and, importantly, a list of any locality it could
not place on the map:

```
venues=86  inspections=88  scored=83  avg=74  areas=34  dupes_merged=8  non_venue_posts=17
NO COORDINATES for: Bagh Ameer, CGR School, PNR Empire, Phoenix Towers, SMR Vinay Technopolis
```

Anything named there still appears on the site and is still filterable by area —
it just cannot be distance-sorted. Add it to `areas.json` to fix that (see
below).

---

## What the build script does to the raw CSV

The scraper's CSV is a faithful record of what was posted, which means it needs
cleaning before it can be ranked. `build_data.py` does five things:

1. **Drops non-venue posts.** Bulk enforcement summaries ("12 highway outlets
   inspected along NH-65") have no single establishment to score, so they are
   excluded from the directory. 17 of the current rows fall in this bucket.
2. **Recovers missing localities.** 42 rows had a blank `location` column. The
   locality is almost always sitting in `raw_text`, either on the line after
   `Establishment:` or inside the "…inspected X, Jaya Bheri, Kompally, to
   assess…" sentence. A final pass sweeps the post for any locality name known
   to `areas.json`.
3. **Normalises names.** Legal suffixes and operator names are stripped
   (`KFC (Devyani India Pvt. Ltd.)` → `KFC`), and a chain alias table folds
   variants together (`KS Bakers Private Limited` → `KS Bakers`).
4. **Merges duplicates.** CMC often posts the same inspection twice as a
   multi-part thread. Rows with identical venue, area and marks collapse into
   one, keeping the copy that carries a date and a source URL.
5. **Merges repeat visits.** One card per venue per area, showing the most
   recent score with the full inspection history behind it.

### Scores are percentages, deliberately

FoSCoS checklist totals vary by business profile — 92, 98, 106, 110 marks and so
on — because the applicable checklist depends on the kind of establishment. Raw
marks are therefore not comparable between two places. The site only ever ranks
and displays the percentage, and the detail view shows the raw marks as context
alongside it.

---

## `areas.json` — the locality gazetteer

This is the only file you are likely to edit by hand. Each key is a lowercase
alias that appears somewhere in the inspection data; it maps to a canonical area
name and that area's approximate centroid:

```json
"gsm mall":   {"area": "Madinaguda", "lat": 17.4948, "lng": 78.3352},
"madeenaguda":{"area": "Madinaguda", "lat": 17.4948, "lng": 78.3352}
```

Two things follow from this design. Spelling variants and landmarks
(`Madeenaguda`, `GSM Mall`, `Genpact Lane`) collapse into one real locality
instead of fragmenting the area filter. And because addresses run
specific → broad, the build script takes the **last** matching part of an
address as the locality, so `"Opp. Biodiversity Park, Raidurg, Gachibowli Road"`
groups under Gachibowli.

**Distances are locality-level, not door-level.** A restaurant is placed at the
centre of its locality, which is accurate to roughly one to two kilometres.
That is fine for "what's clean near me" and wrong for turn-by-turn navigation;
the site says so in the footer.

---

## What the site does

- **Ranked list** by hygiene percentage, with position numbers on the default view
- **Grades** — Excellent 90–100, Good 80–89, Average 70–79, Needs work under 70
- **Near me** — browser geolocation, distance-sorted, with a plain-language
  fallback to the area dropdown if permission is declined (it never blocks on
  the permission prompt)
- **Search** across name, area, address and former names
- **Filter** by grade and by locality; **sort** by highest, lowest, most recent
  or A–Z
- **Detail view** — score breakdown, good practices found, violations recorded,
  action taken, full inspection history, and a link to the original report
- **Saved places** kept in the visitor's browser via `localStorage`
- **Dark mode** following the system setting, with a manual override
- Keyboard accessible and works offline once loaded

---

## Files

```
build_data.py                     CSVs → docs/data.json + docs/city-*.json
cities.json                       which cities exist, and their FSSAI districts
areas.json                        Hyderabad locality gazetteer
areas.<city>.json                 per-city gazetteer, built by geocode_areas.py
hyderabad_food_inspections.csv    input, copied from the scraper
fssai_hygiene_ratings.csv         input, from fssai_hygiene_scraper.py
docs/
  index.html                      markup and styles
  app.js                          the app (separate file so the CSP can ban
                                  inline script — do not inline it again)
  data.json                       generated index of cities, NOT the venue list
  city-<key>.json                 generated venues, one file per city
  .nojekyll                       stops Pages from running Jekyll
  CNAME                           written by GitHub when you set a custom
                                  domain — never delete it, and always
                                  `git pull` after changing the domain
```

Living in `../Inspection Scraper/`:

```
scrape_x_inspections.py           X posts  → raw_posts.jsonl
build_csv.py                      raw_posts.jsonl → hyderabad_food_inspections.csv
fssai_hygiene_scraper.py          FSSAI directory → fssai_hygiene_ratings.csv
geocode_areas.py                  addresses → ../dine-check/areas.<city>.json
```

## Attribution and limits

Scores are transcribed from public inspection reports published by
[@CMC_Offcl](https://x.com/CMC_Offcl) (Cyberabad Municipal Corporation),
[@cfs_telangana](https://x.com/cfs_telangana) (Commissioner of Food Safety,
Telangana) and [@GHMCOnline](https://x.com/GHMCOnline). Every listing links back
to the original report.

A score reflects one visit on one day. An establishment absent from the list has
not been inspected in the scraped window, which is not itself a mark against it.
Keep that framing on the page — it is what makes the site fair to publish.
