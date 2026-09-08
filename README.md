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
per city. No build tooling and no framework. Out of the box it makes zero
external requests; the only optional one is an analytics beacon you switch on
yourself. It drops straight onto GitHub Pages.

---

## Deploy to GitHub Pages

### 1. Create the repository

On github.com: **+ → New repository**.

- **Name:** `dine-check`
- **Visibility:** **Public**. On a free account GitHub Pages only serves public
  repositories; private repos need Pro, Team or Enterprise. The source data is
  already public, so public is the natural choice.
- Do **not** tick "Add a README", ".gitignore" or "license" — this folder
  already has them, and an initialising commit will collide with the first push.

### 2. Push the files

```bash
cd dine-check
git init
git add .
git commit -m "Dine Check"
git branch -M main
git remote add origin https://github.com/<you>/dine-check.git
git push -u origin main
```

No git installed? GitHub Desktop ("Add local repository", point it at this
folder, Publish) or dragging the files into the web uploader both work — the
site does not care how the files arrive.

### 3. Turn on Pages

In the repository: **Settings → Pages** (under "Code and automation" in the
left sidebar).

- **Source:** Deploy from a branch
- **Branch:** `main`
- **Folder:** `/docs`  ← not `/ (root)`
- **Save**

Tick **Enforce HTTPS** once it becomes available. This is not cosmetic: browsers
only expose the Geolocation API on secure origins, so **"Near me" silently fails
over plain HTTP**. GitHub issues the certificate automatically.

The first build takes a minute or two; afterwards the Pages panel shows the live
URL, `https://<you>.github.io/dine-check/`.

### 4. Check it

Open the URL on a phone and confirm: the list renders, "Near me" prompts for
location, and the area dropdown filters. A blank list means `docs/data.json`
did not get committed — check it is in the repo, not caught by `.gitignore`.

### Optional: your own domain

**Settings → Pages → Custom domain**, enter the domain, Save. Then at your DNS
provider add a `CNAME` record pointing `www` (or the subdomain you chose) at
`<you>.github.io`. For an apex domain like `dinecheck.in`, add `A` records to
GitHub's four Pages IPs instead. GitHub writes a `CNAME` file into `docs/` when
you save — leave it there, and re-add it if you ever rebuild the folder from
scratch.

### Things that quietly break Pages

- **Renaming `docs/`** — the publishing source is bound to that exact folder.
- **Deleting `docs/.nojekyll`** — without it, Pages runs the files through
  Jekyll, which ignores paths beginning with an underscore. Harmless today, a
  silent 404 the moment a file is named that way. It costs nothing to keep.
- **Case** — Pages is case-sensitive, unlike Windows. `Data.json` will 404.

### Running it locally

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
- Keyboard accessible, works offline once loaded, and makes no external requests
  unless you enable analytics

---

## Analytics and uptime

GitHub Pages gives you **no server logs** — you don't own the server and GitHub
exposes nothing about requests. (The repo's Insights → Traffic tab counts visits
to the *repo page*, not to the site.) So everything is measured either from the
browser or by probing the site from outside.

### Traffic — Cloudflare Web Analytics

Cookieless, stores nothing on the visitor's device, so no consent banner is
needed under the DPDP Act.

1. Cloudflare dashboard → **Web Analytics** → **Add a site** → `dinecheck.in`
2. It shows a snippet containing `"token": "abc123…"` — copy just the token
3. In `docs/index.html`, find the analytics block at the bottom and paste it in:

   ```js
   var TOKEN = "abc123…";
   ```

4. Commit and push

You do **not** need to move your DNS to Cloudflare for this — the beacon works
on any host.

The block is written to fail safe. With `TOKEN` empty nothing loads at all and
the site stays request-free, and it never fires from `localhost` or a `file://`
URL, so your own testing is not counted in your numbers. If Cloudflare is
unreachable the page carries on regardless.

### Uptime — UptimeRobot

The free tier covers 50 monitors at 5-minute intervals. Create **two**, because
they catch different failures:

| Monitor | Type | Checks |
|---|---|---|
| `https://dinecheck.in/` | HTTP(s) | The site is reachable at all |
| `https://dinecheck.in/data.json` | Keyword, expecting `venues` | The data file is actually being served |

The second one matters more than it looks. If a build ships a broken or missing
`data.json`, the homepage still returns HTTP 200 and a plain uptime check stays
green — while every visitor sees an empty list. The keyword monitor catches that.

### Build failures

Every push runs a "pages build and deployment" job under the repo's **Actions**
tab. Turn on failure notifications (GitHub → Settings → Notifications → Actions)
so a bad build doesn't quietly leave a stale site up.

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
