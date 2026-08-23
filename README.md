# Dine Check

A mobile-first web app that puts Hyderabad's official food-safety inspection
scores in front of people before they order. It reads the CSV produced by the
inspection scraper, ranks every establishment by hygiene percentage, and can
sort by distance from wherever the visitor is standing.

Everything is static — one HTML file plus one JSON file, no build tooling, no
framework, no external requests. It drops straight onto GitHub Pages.

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
- Keyboard accessible, no external requests, works offline once loaded

---

## Files

```
build_data.py                     CSV → docs/data.json
areas.json                        locality gazetteer (edit this to add areas)
hyderabad_food_inspections.csv    input, copied from the scraper
docs/
  index.html                      the entire app
  data.json                       generated — do not edit by hand
  .nojekyll                       stops Pages from running Jekyll
```

## Attribution and limits

Scores are transcribed from public inspection reports published by
[@CMC_Offcl](https://x.com/CMC_Offcl) (Cyberabad Municipal Corporation),
[@cfs_telangana](https://x.com/cfs_telangana) (Commissioner of Food Safety,
Telangana) and [@GHMCOnline](https://x.com/GHMCOnline). Every listing links back
to the original report.

A score reflects one visit on one day. An establishment absent from the list has
not been inspected in the scraped window.
