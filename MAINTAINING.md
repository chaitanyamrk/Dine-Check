# Maintaining Dine Check

Everything needed to deploy, refresh and instrument the site. The reader-facing
overview lives in [README.md](README.md).

The site is static — one HTML file plus one generated JSON file, no build
tooling and no framework. Out of the box it makes zero external requests; the
only optional one is an analytics beacon you switch on yourself.

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

---

## Known coverage gap: TG SAFE

Telangana merged its Food Safety Department and Drugs Control Administration
into **TG SAFE** (Telangana Standards Authority for Food and Essential Drugs) on
16 August 2026. Two consequences:

- **`@cfs_telangana` has been deleted.** It is still listed as a source in the
  scraper and now resolves to a dead handle. Harmless beyond a wasted request,
  but remove it next time you touch `scrape_x_inspections.py`. The rows already
  collected from it stay valid.
- **TG SAFE publishes nothing itself.** Checked 31 August 2026: no official X
  account exists under any obvious handle, and the two legacy food-safety
  accounts are dormant (`@FoodsafetyTS` 0 posts, `@director_food` last posted
  2019). Its raids are reported only by journalists and news outlets.

Press reports are deliberately **not** ingested. Enforcement raids produce
violations rather than FoSCoS scores, so there is nothing to rank; outlets
disagree on which establishments were involved; and every listing on the site is
supposed to link to the inspecting authority's own post, which is the site's
main defence when a business objects.

The coverage panel on the site says so explicitly. **When TG SAFE launches an
official channel**, add it to the scraper and delete the TG SAFE paragraph from
the coverage note in `docs/app.js` — it is marked with a comment.

---

## Two kinds of record

The site carries two things that must never be confused:

| | Source | Has a score? | Ranked? |
|---|---|---|---|
| **Scored inspection** | `@CMC_Offcl` | Yes, FoSCoS marks | Yes |
| **Enforcement record** | `@c_tgsafe` (ex-CFS) | No | **No** |

Enforcement records come from a different regulator with a different method:
inspectors list violations and initiate action, but publish no marks. They are
shown with a square warning mark and a "Violations recorded" tag instead of a
score ring, are excluded from the ranking, and are excluded from the average and
the grade counts. `build_data.py` sets `kind` on every venue and every history
entry; `stats.scoredVenues` and `stats.enforcementVenues` keep the two apart.

`tgsafe_parser.py` handles the CFS/TG SAFE format — see its docstring for the
Unicode-bold header trick. Two behaviours worth knowing:

- **Statewide filter.** That account covers all of Telangana. `is_outside_hyderabad()`
  drops district inspections (Warangal, Khammam, Medak…) at build time, because
  this is a Hyderabad site. Patancheru, Ameenpur and RC Puram are kept — they are
  Sangareddy district on paper but sit inside the Hyderabad ring road.
- **A bullet is a violation by default.** These posts bullet everything
  together, so "Pest control records were available" sits beside "FSSAI licence
  not displayed". `classify()` records a bullet as a good practice **only** when
  it carries an explicit `POSITIVE_CUE` and no `NEGATIVE_CUE`. Anything
  ambiguous stays a violation.

  This default is deliberate and was learned the hard way. An earlier version
  had it inverted — anything without a negative keyword became a good practice —
  and it published *"Raw chicken directly dumped in the refrigerators"* and
  *"Iron knife was being used for vegetable cutting"* as **good practices** about
  a named restaurant. These lists are inspection findings; they overwhelmingly
  describe what was wrong, so violation is the safe default.

  Watch for the four patterns that broke it, all now covered: contractions
  (`doesn't provide adequate space`), `instead of`, `but` introducing the real
  problem (`wearing hairnets but handling food with bare hands`), and directives
  about what ought to happen (`personnel must be trained`).

  **If you change either regex, re-audit.** Dump every distinct string still
  classified as a good practice and read the list — there were only 95, so it
  takes minutes and it is the only way to catch this class of error.

## Record age

Enforcement records run back to 2024, while the scored inspections are recent.
Anything older than 18 months is tagged **Historic** on the card and carries a
dated warning in the detail view. Keep that: a 2024 violation shown without its
age reads as a current claim about a business that may have fixed everything.

---

## Security

The site is static — no server, no database, no logins, no cookies, no secrets
in the repo — so most classes of web vulnerability do not apply. Three things
still do.

### The page escapes its own data

`data.json` is built from text other people wrote (scraped inspection posts), so
the renderer treats it as untrusted:

- `esc()` escapes `< > & " '`. The quotes matter: a value containing `"` would
  otherwise break out of an HTML attribute. Do not replace this with the
  `textContent`/`innerHTML` trick — that leaves quotes intact.
- `safeUrl()` only lets `http(s)://` through to an `href`, so a `javascript:`
  URL in the data cannot become a clickable link.

Both were real, demonstrated bugs, not hypotheticals. Keep them in place.

### Content-Security-Policy

`index.html` carries a CSP in a `<meta>` tag. The policy denies everything by
default and allows only what the page actually needs: its own scripts plus the
Cloudflare beacon, `fetch` to itself and the Cloudflare RUM endpoint, inline
styles, and `data:` images for the favicon.

**This is why the JavaScript lives in `docs/app.js` rather than inline.**
`script-src` deliberately omits `'unsafe-inline'`, which is what makes the
policy worth having — it blocks injected inline event handlers and
`javascript:` URLs, giving a second layer under `esc()` and `safeUrl()`.
Inlining the script again would force `'unsafe-inline'` back in and silently
throw that away.

`style-src` does allow `'unsafe-inline'`, because the renderer sets `style`
attributes for the score rings and bars. CSS injection is far less dangerous
than script injection, so this is an accepted trade.

Two caveats of the `<meta>` form: `frame-ancestors` and `report-uri` are ignored
there — they only work as real HTTP headers, which GitHub Pages cannot set. And
**do not add `upgrade-insecure-requests`** while the site is reachable over
plain HTTP: it rewrites the same-origin `data.json` fetch to `https://`, which
fails before the certificate exists and leaves every visitor with an empty list.

### Accounts

The repository *is* the website, and the domain is the only thing that cannot be
recovered by re-pushing. Keep two-factor authentication on the GitHub account,
and two-factor plus domain lock and auto-renew at the registrar.

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
