#!/usr/bin/env python3
"""
Dine Check — search-engine pages for dinecheck.in.

Run after build_data.py (refresh.py does this for you):

    python build_seo.py

The site itself is a single page that draws everything with JavaScript, so a
search engine sees an empty list. This script writes plain HTML pages that a
crawler can read, all generated from the same docs/data.json + city-*.json:

  docs/<city>/index.html            one page per city: every place, by area
  docs/<city>/<venue>/index.html    one page per place with an inspection score
                                    or an enforcement record (certificate-only
                                    places are listed on the city page instead)
  docs/about/index.html             how Dine Check works + FAQ
  docs/sitemap.xml, docs/robots.txt
  docs/index.html                   only the block between <!--cities--> and
                                    <!--/cities--> (crawlable city links)

Pages are rewritten only when their content changes, so a refresh that changes
nothing leaves git clean. Venue pages that no longer have a record are removed
(only folders this script made — they carry a generator marker).

Set NOINDEX_ENFORCEMENT = True to keep enforcement-only pages out of search
results while still publishing them.
"""
import hashlib
import html
import json
import os
import re
import shutil
import sys
from urllib.parse import quote
from datetime import date, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(HERE, "docs")
SITE = "https://dinecheck.in"
MARK = '<meta name="generator" content="dinecheck build_seo">'
NOINDEX_ENFORCEMENT = False
STALE_AFTER_DAYS = 365
RESERVED = {"about", "check", "request", "privacy", "terms"}

GRADE = {"excellent": ("Excellent", "90–100"), "good": ("Good", "80–89"),
         "average": ("Average", "70–79"), "poor": ("Needs work", "under 70")}
MONTHS = "January February March April May June July August September October November December".split()

e = lambda s: html.escape(str(s if s is not None else ""), quote=True)
written = {"new": 0, "changed": 0, "same": 0}


def fdate(iso):
    try:
        d = date.fromisoformat(iso[:10])
        return f"{d.day} {MONTHS[d.month - 1]} {d.year}"
    except Exception:
        return iso or ""


def short_month(iso):
    try:
        d = date.fromisoformat(iso[:10])
        return f"{MONTHS[d.month - 1][:3]} {d.year}"
    except Exception:
        return ""


def slug(s):
    s = re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")
    return s or "place"


def src_label(h):
    s = (h.get("source") or "").lstrip("@")
    return {"c_tgsafe": "TG SAFE",
            "CMC_Offcl": "the Cyberabad Municipal Corporation food safety team",
            "cfs_telangana": "the Commissioner of Food Safety, Telangana"}.get(s, h.get("source") or "the authority")


def action_short(a):
    return (a or "").split(" — ")[0].strip()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    old = None
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            old = f.read()
    if old == text:
        written["same"] += 1
        return
    written["changed" if old is not None else "new"] += 1
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


CSS = """
.btn{display:inline-block;background:var(--accent);color:#fff!important;text-decoration:none;font-weight:600;
  padding:10px 16px;border-radius:10px;margin:8px 0 4px}
.crumbs{font-size:13.5px;color:var(--ink3);margin:0 0 10px}.crumbs a{color:var(--ink2)}
.stats{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}
.stats span{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:6px 12px;font-size:14px}
.vl{list-style:none;padding:0;margin:6px 0 0;columns:2 260px;column-gap:28px}
.vl li{break-inside:avoid;margin:0 0 6px;font-size:14.5px;line-height:1.4}
.vl small,.muted{color:var(--ink3)}
.rec{list-style:none;padding:0;margin:8px 0}
.rec li{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin:0 0 8px}
.rec li b a{text-decoration:none}
.box{background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:12px;padding:14px 18px;margin:16px 0}
.box.bad{border-left-color:#b91c1c}.box .big{font-size:30px;font-weight:700;line-height:1.1}
.areas{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:14px;margin:8px 0 0}
.areas a{text-decoration:none}
.top .brand{white-space:nowrap}
@media (max-width:480px){.top a:nth-child(2){display:none}}
"""


def page(*, title, desc, path, body, depth, ld=None, robots="index,follow", og_type="website"):
    up = "../" * depth
    url = SITE + path
    lds = "".join(f'\n<script type="application/ld+json">{json.dumps(x, ensure_ascii=False, separators=(",", ":"))}</script>'
                  for x in (ld or []))
    return f"""<!doctype html>
<html lang="en-IN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; base-uri 'self'; form-action 'none'">
<meta name="referrer" content="strict-origin-when-cross-origin">
{MARK}
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<meta name="robots" content="{robots}">
<link rel="canonical" href="{e(url)}">
<meta property="og:site_name" content="Dine Check">
<meta property="og:type" content="{og_type}">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{e(url)}">
<meta property="og:image" content="{SITE}/logo-512.png">
<meta property="og:locale" content="en_IN">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#00635C">
<link rel="icon" href="{up}logo.svg" type="image/svg+xml">
<link rel="icon" href="{up}favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="{up}apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&family=IBM+Plex+Serif:wght@500&display=swap">
<link rel="stylesheet" href="{up}legal.css">
<style>{CSS}</style>{lds}

<div class="wrap">
  <nav class="top"><a class="brand" href="/"><img src="{up}logo.svg" alt="" width="26" height="26">Dine Check</a><a href="/about/">How it works</a><a href="/">Search all places →</a></nav>
{body}
  <div class="foot">
    <p><b>A record is a snapshot,</b> not a standing verdict — it reflects what an authority published about one visit on one day, and conditions change. Dine Check reproduces official records and links to each source; it does not inspect places itself unless a page says so.</p>
    <p>Is this your business, or is something here wrong or out of date? Write to <a href="mailto:privacy@dinecheck.in">privacy@dinecheck.in</a> and we will check it against the source.</p>
    <p><a href="/">Search</a> · <a href="/about/">How it works</a> · <a href="/request/">Ask for an audit</a> · <a href="/check/">Kitchen self-check</a> · <a href="/privacy/">Privacy</a> · <a href="/terms/">Terms</a></p>
  </div>
</div>
</html>
"""


def crumbs_ld(items):
    return {"@context": "https://schema.org", "@type": "BreadcrumbList",
            "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": n, "item": SITE + p}
                                for i, (n, p) in enumerate(items)]}


def venue_paths(city):
    """Stable, unique folder names. Ids can repeat inside a city (same name and
    area); the repeats get a short hash of their address so the name never
    depends on the order of the file."""
    seen = {}
    for v in city["venues"]:
        seen[v["id"]] = seen.get(v["id"], 0) + 1
    out = {}
    for i, v in enumerate(city["venues"]):
        s = slug(v["id"])
        if seen[v["id"]] > 1:
            key = "|".join(str(v.get(k) or "") for k in ("location", "kind", "name"))
            s += "-" + hashlib.md5(key.encode("utf-8")).hexdigest()[:5]
        out[i] = s
    return out


def has_page(v):
    return v.get("kind") in ("inspection", "enforcement")


def venue_page(city, v, vslug):
    ck, cname = city["cityKey"], city["city"]
    latest = v["history"][0]
    enf = v["kind"] == "enforcement"
    area = v.get("area") or v.get("location") or cname
    path = f"/{ck}/{vslug}/"
    when = latest.get("date") or v.get("lastInspected") or ""
    act = action_short(latest.get("action"))
    if enf:
        title = f"{v['name']}, {area} — food safety enforcement record | Dine Check"
        desc = (f"{act or 'Enforcement action'} at {v['name']}, {area}, {cname} — as reported by "
                f"{src_label(latest)} on {fdate(when)}. See the official source and the full record.")
    else:
        g = GRADE.get(v.get("grade"), ("No score", ""))[0]
        title = f"{v['name']}, {area} — food safety inspection score {v.get('score')}/100 | Dine Check"
        desc = (f"{v['name']} in {area}, {cname} scored {v.get('score')}/100 ({g}) in a food safety inspection on "
                f"{fdate(when)}. Good practices, problems found and the official report.")
    stale = False
    try:
        stale = (date.today() - date.fromisoformat(when[:10])).days > STALE_AFTER_DAYS
    except Exception:
        pass

    b = [f'  <p class="crumbs"><a href="/">Dine Check</a> › <a href="/{ck}/">{e(cname)}</a> › '
         f'<a href="/{ck}/#{slug(area)}">{e(area)}</a></p>',
         f"  <h1>{e(v['name'])}</h1>",
         f'  <p class="meta">{e(v.get("location") or area)}, {e(cname)}'
         + (f' · also listed as {e(", ".join(v["aka"]))}' if v.get("aka") else "") + "</p>"]
    if enf:
        b.append(f'  <div class="box bad"><b>Enforcement record — no hygiene score.</b><br>'
                 f'{e(act or "Action recorded")} — reported {e(fdate(when))} by {e(src_label(latest))}.'
                 f'<br><span class="muted">This is not a scored audit and is not ranked against places that have one.</span></div>')
        if not latest.get("bad"):
            b.append('  <p class="muted">The authority named this place and the action it took, but not its own '
                     'violations. On a drive the violations are often listed for every place inspected together — '
                     'the original post has the full list.</p>')
    else:
        g, rng = GRADE.get(v.get("grade"), ("No score", ""))
        b.append(f'  <div class="box"><div class="big">{e(v.get("score"))}<span class="muted" style="font-size:16px">/100</span></div>'
                 f'<b>{e(g)}</b>{" · " + e(rng) + " band" if rng else ""}<br>Inspected {e(fdate(when))}'
                 + (f'<br>{e(latest["obtained"])} of {e(latest["total"])} marks on that checklist'
                    if latest.get("obtained") is not None and latest.get("total") else "") + "</div>")
    if stale:
        b.append(f'  <p class="muted"><b>This record is from {e(fdate(when))}.</b> It describes conditions on that day and may not reflect the place today.</p>')
    if latest.get("good"):
        b.append("  <h2>Good practices observed</h2>\n  <ul>" + "".join(f"<li>{e(x)}</li>" for x in latest["good"]) + "</ul>")
    if latest.get("bad"):
        b.append(f"  <h2>{'Violations recorded' if enf else 'Problems recorded'}</h2>\n  <ul>"
                 + "".join(f"<li>{e(x)}</li>" for x in latest["bad"]) + "</ul>")
    if latest.get("action"):
        b.append(f"  <h2>Action taken</h2>\n  <p>{e(latest['action'])}</p>")
    if latest.get("url"):
        b.append(f'  <p>Source: <a href="{e(latest["url"])}" rel="nofollow noopener" target="_blank">{e(src_label(latest))}, {e(fdate(when))}</a></p>')
    if len(v["history"]) > 1:
        rows = []
        for h in v["history"]:
            what = (f"Inspection score {h['pct']}/100" if h.get("pct") is not None else action_short(h.get("action")) or h.get("kind", "").title())
            link = f' — <a href="{e(h["url"])}" rel="nofollow noopener" target="_blank">source</a>' if h.get("url") else ""
            rows.append(f"<li><b>{e(fdate(h.get('date', '')))}</b> · {e(what)}{link}</li>")
        b.append("  <h2>Record history</h2>\n  <ul>" + "".join(rows) + "</ul>")
    b.append(f'  <p><a class="btn" href="/?city={e(ck)}&amp;q={e(quote(v["name"]))}">See {e(v["name"])} on the live list</a></p>')
    b.append(f'  <p class="muted">More places in <a href="/{ck}/#{slug(area)}">{e(area)}</a> and across <a href="/{ck}/">{e(cname)}</a>.</p>')

    fe = {"@context": "https://schema.org", "@type": "FoodEstablishment", "name": v["name"], "url": SITE + path,
          "address": {"@type": "PostalAddress", "addressLocality": area, "addressRegion": city.get("state"), "addressCountry": "IN"}}
    if v.get("lat") is not None:
        fe["geo"] = {"@type": "GeoCoordinates", "latitude": v["lat"], "longitude": v["lng"]}
    robots = "noindex,follow" if (enf and NOINDEX_ENFORCEMENT) else "index,follow"
    return path, when, page(title=title, desc=desc, path=path, depth=2, body="\n".join(b), robots=robots,
                            ld=[crumbs_ld([("Dine Check", "/"), (cname, f"/{ck}/"), (v["name"], path)]), fe])


def city_page(city, entry, slugs):
    ck, cname, st = city["cityKey"], city["city"], city["stats"]
    path = f"/{ck}/"
    parts = []
    if st.get("scoredVenues"): parts.append(f"{st['scoredVenues']} inspection scores")
    if st.get("enforcementVenues"): parts.append(f"{st['enforcementVenues']} enforcement records")
    if st.get("certifiedVenues"): parts.append(f"{st['certifiedVenues']} FSSAI hygiene ratings")
    what = ", ".join(parts[:-1]) + (" and " if len(parts) > 1 else "") + parts[-1] if parts else "food safety records"
    title = f"{cname} restaurant hygiene ratings & food safety inspections | Dine Check"
    desc = (f"Check a restaurant's food safety record in {cname} before you eat: {what} across "
            f"{st.get('areas', 0)} areas, from official sources. Search by name or area.")

    b = [f'  <p class="crumbs"><a href="/">Dine Check</a> › {e(cname)}</p>',
         f"  <h1>Food safety records for restaurants in {e(cname)}</h1>",
         f'  <p class="meta">{e(st["venues"])} places in {e(st.get("areas", 0))} areas · {e(city.get("state") or "")}'
         + (f' · latest record {e(fdate(st["latest"]))}' if st.get("latest") else "") + "</p>",
         '  <div class="stats">'
         + (f'<span><b>{st["scoredVenues"]}</b> inspection scores</span>' if st.get("scoredVenues") else "")
         + (f'<span><b>{st["enforcementVenues"]}</b> with violations</span>' if st.get("enforcementVenues") else "")
         + (f'<span><b>{st["certifiedVenues"]}</b> FSSAI hygiene ratings</span>' if st.get("certifiedVenues") else "")
         + "</div>"]
    intro = (f"Dine Check brings together the public food-safety records for restaurants, cafés, cloud kitchens, "
             f"sweet shops and stores in {e(cname)}")
    if st.get("scoredVenues") or st.get("enforcementVenues"):
        srcs = sorted({s["handle"].lstrip("@") for s in st.get("sources", [])})
        names = sorted({src_label({"source": s}) for s in srcs}, key=lambda n: n.replace("the ", "").lower())
        names = ", ".join(names[:-1]) + " and " + names[-1] if len(names) > 1 else "".join(names)
        intro += (f": inspection scores and enforcement action — licence suspensions, show-cause and improvement "
                  f"notices — as published by {e(names)}")
        intro += ", alongside FSSAI Hygiene Ratings." if st.get("certifiedVenues") else "."
    else:
        intro += (": FSSAI Hygiene Ratings from the official FSSAI directory. A hygiene rating is awarded after a "
                  "voluntary audit by an FSSAI-recognised agency and is shown as a band such as Excellent or Very Good.")
    b.append(f"  <p>{intro} Every entry links back to its source.</p>")
    b.append(f'  <p><a class="btn" href="/?city={ck}">Search, filter and sort {e(cname)} →</a></p>')

    V = city["venues"]
    newest = lambda kind: sorted(sorted((i for i, v in enumerate(V) if v["kind"] == kind), key=lambda i: V[i]["name"].lower()),
                                 key=lambda i: V[i].get("lastInspected") or "", reverse=True)
    enf, insp = newest("enforcement"), newest("inspection")

    def rec(i, text):
        v = V[i]
        return (f'<li><b><a href="/{ck}/{slugs[i]}/">{e(v["name"])}</a></b> · {e(v.get("area") or "")}<br>'
                f'<span class="muted">{e(text)}</span></li>')
    if enf:
        b.append(f'  <h2 id="enforcement">Recent enforcement action in {e(cname)}</h2>')
        b.append("  <p class=\"muted\">Licence suspensions, closures and notices reported by the food safety authorities, newest first.</p>")
        b.append('  <ul class="rec">' + "".join(
            rec(i, f"{action_short(V[i]['history'][0].get('action')) or 'Enforcement action'} · {fdate(V[i]['history'][0].get('date', ''))}")
            for i in enf[:60]) + "</ul>")
        if len(enf) > 60:
            b.append(f'  <p class="muted">…and {len(enf) - 60} earlier records, listed by area below.</p>')
    if insp:
        b.append(f'  <h2 id="scores">Latest inspection scores in {e(cname)}</h2>')
        b.append('  <ul class="rec">' + "".join(
            rec(i, f"{V[i].get('score')}/100 · {GRADE.get(V[i].get('grade'), ('No score',))[0]} · inspected {fdate(V[i].get('lastInspected') or '')}")
            for i in insp[:40]) + "</ul>")

    by_area = {}
    for i, v in enumerate(V):
        by_area.setdefault(v.get("area") or "Other", []).append(i)
    order = sorted(by_area, key=lambda a: a.lower())
    b.append(f'  <h2 id="areas">All places in {e(cname)} by area</h2>')
    b.append('  <nav class="areas" aria-label="Areas">' + " ".join(
        f'<a href="#{slug(a)}">{e(a)}</a>' for a in order) + "</nav>")
    for a in order:
        items = []
        for i in sorted(by_area[a], key=lambda i: V[i]["name"].lower()):
            v = V[i]
            if v["kind"] == "inspection":
                tag = f"{v.get('score')}/100 inspection score"
            elif v["kind"] == "enforcement":
                tag = action_short(v["history"][0].get("action")) or "enforcement record"
            else:
                tag = f"FSSAI hygiene rating: {v.get('band') or 'rated'}"
            name = f'<a href="/{ck}/{slugs[i]}/">{e(v["name"])}</a>' if has_page(v) else e(v["name"])
            items.append(f"<li>{name} <small>· {e(tag)}</small></li>")
        b.append(f'  <h3 id="{slug(a)}">{e(a)} <small class="muted">({len(by_area[a])})</small></h3>\n  <ul class="vl">{"".join(items)}</ul>')

    others = [c for c in INDEX["cities"] if c["key"] != ck]
    b.append("  <h2>Other cities</h2>\n  <p>" + " · ".join(f'<a href="/{c["key"]}/">{e(c["name"])}</a>' for c in others) + "</p>")
    ld = [crumbs_ld([("Dine Check", "/"), (cname, path)]),
          {"@context": "https://schema.org", "@type": "CollectionPage", "name": title, "url": SITE + path,
           "description": desc, "about": {"@type": "City", "name": cname}}]
    return path, st.get("latest") or "", page(title=title, desc=desc, path=path, depth=1, body="\n".join(b), ld=ld)


FAQ = [
    ("What is Dine Check?",
     "Dine Check is a free site that gathers the public food-safety records for restaurants, cafés, cloud kitchens and "
     "stores in Indian cities — official inspection scores, enforcement action and FSSAI Hygiene Ratings — so you can "
     "check a place before you eat there. Every record links back to where it was published."),
    ("Where does the data come from?",
     "Inspection scores and enforcement records come from what the food safety authorities publish, such as TG SAFE, "
     "the Commissioner of Food Safety, Telangana and the Cyberabad Municipal Corporation food safety team. FSSAI "
     "Hygiene Ratings come from the official FSSAI hygiene rating directory. Dine Check does not change the findings; "
     "it organises them and links to the source."),
    ("What is an FSSAI Hygiene Rating?",
     "It is a rating awarded under FSSAI's Hygiene Rating Scheme after a voluntary audit carried out by an "
     "FSSAI-recognised audit agency. The directory publishes a band such as Excellent or Very Good, but no audit date, "
     "marks or findings. It is a certificate the business applied for, not a routine inspection, so Dine Check never "
     "ranks it against inspection scores."),
    ("How should I read an inspection score?",
     "Inspection checklists differ by type of business, so total marks vary. Dine Check shows the score as a percentage "
     "so places can be compared: 90–100 is Excellent, 80–89 Good, 70–79 Average and under 70 Needs work. A score "
     "reflects one visit on one day."),
    ("What does it mean when a licence is 'being suspended', or a notice was issued?",
     "During enforcement drives the authorities report the action they took at each place: suspension of the FSSAI "
     "licence, a show-cause notice asking the business to explain lapses, or an improvement notice asking it to fix "
     "them. Dine Check shows the action exactly as reported, with the date and a link to the original post. The "
     "business may have fixed the problems since."),
    ("A restaurant I eat at is not listed. Is that bad?",
     "No. A missing place has simply not appeared in a published record. That is not a mark against it, and not a "
     "clean bill of health either. You can ask Dine Check to audit it."),
    ("How often is Dine Check updated?",
     "The records are refreshed regularly as the authorities publish new inspections and drives, and the FSSAI "
     "directory is re-read on each refresh."),
    ("I run a restaurant. How do I get a good record?",
     "Take the free five-minute kitchen self-check to see how your kitchen would fare in an inspection, and write to "
     "privacy@dinecheck.in if a record about your business is wrong or out of date."),
]


def about_page():
    path = "/about/"
    t = INDEX["totals"]
    title = "How Dine Check works — restaurant food safety records in India | Dine Check"
    desc = ("How Dine Check collects restaurant inspection scores, enforcement action and FSSAI Hygiene Ratings, how to "
            "read them, and answers to common questions.")
    cities = " · ".join(f'<a href="/{c["key"]}/">{e(c["name"])}</a>' for c in INDEX["cities"])
    b = ['  <p class="crumbs"><a href="/">Dine Check</a> › How it works</p>',
         "  <h1>How Dine Check works</h1>",
         f'  <p class="meta">{t["venues"]:,} places across {t["cities"]} cities</p>',
         f"  <p>Know before you eat. Dine Check puts the official food-safety record of a restaurant in one place: "
         f"{t['scoredVenues']} inspection scores, {t['enforcementVenues']} enforcement records and "
         f"{t['certifiedVenues']:,} FSSAI Hygiene Ratings today.</p>",
         f"  <p>Cities: {cities}</p>",
         '  <p><a class="btn" href="/">Search a restaurant →</a></p>',
         "  <h2>Questions</h2>"]
    for q, a in FAQ:
        b.append(f"  <h3>{e(q)}</h3>\n  <p>{e(a)}</p>")
    ld = [crumbs_ld([("Dine Check", "/"), ("How it works", path)]),
          {"@context": "https://schema.org", "@type": "FAQPage",
           "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in FAQ]}]
    return path, page(title=title, desc=desc, path=path, depth=1, body="\n".join(b), ld=ld)


def update_index_cities():
    p = os.path.join(DOCS, "index.html")
    with open(p, encoding="utf-8") as f:
        t = f.read()
    links = " · ".join(f'<a href="{c["key"]}/">{e(c["name"])}</a>' for c in INDEX["cities"])
    block = f'<!--cities--><p class="cities"><b>Food safety records by city:</b> {links} · <a href="about/">How it works</a></p><!--/cities-->'
    if "<!--cities-->" not in t:
        print("  index.html has no <!--cities--> marker; city links not updated")
        return
    t2 = re.sub(r"<!--cities-->.*?<!--/cities-->", lambda m: block, t, flags=re.S)
    write(p, t2)


def remove_stale(ck, keep):
    d = os.path.join(DOCS, ck)
    if not os.path.isdir(d):
        return
    gone = []
    for name in os.listdir(d):
        f = os.path.join(d, name, "index.html")
        if name in keep or not os.path.isfile(f):
            continue
        with open(f, encoding="utf-8") as fh:
            if MARK not in fh.read(2000):
                continue
        try:
            shutil.rmtree(os.path.join(d, name))
            gone.append(name)
        except OSError as ex:
            print(f"  could not remove stale page {ck}/{name}: {ex}")
    if gone:
        print(f"  removed {len(gone)} stale pages in {ck}: {', '.join(gone[:8])}{' …' if len(gone) > 8 else ''}")


def main():
    global INDEX
    with open(os.path.join(DOCS, "data.json"), encoding="utf-8") as f:
        INDEX = json.load(f)
    today = datetime.utcnow().strftime("%Y-%m-%d")
    urls = [("/", (INDEX.get("generated") or today)[:10], "daily", "1.0")]
    for c in INDEX["cities"]:
        if c["key"] in RESERVED:
            sys.exit(f"city key {c['key']} clashes with a site folder")
        with open(os.path.join(DOCS, c["file"]), encoding="utf-8") as f:
            city = json.load(f)
        slugs = venue_paths(city)
        path, last, text = city_page(city, c, slugs)
        write(os.path.join(DOCS, c["key"], "index.html"), text)
        urls.append((path, (last or today)[:10], "daily", "0.9"))
        keep = set()
        for i, v in enumerate(city["venues"]):
            if not has_page(v):
                continue
            vpath, when, text = venue_page(city, v, slugs[i])
            write(os.path.join(DOCS, c["key"], slugs[i], "index.html"), text)
            keep.add(slugs[i])
            if not (v["kind"] == "enforcement" and NOINDEX_ENFORCEMENT):
                urls.append((vpath, (when or today)[:10], "monthly", "0.6"))
        remove_stale(c["key"], keep)
    apath, text = about_page()
    write(os.path.join(DOCS, "about", "index.html"), text)
    urls.append((apath, (INDEX.get("generated") or today)[:10], "monthly", "0.7"))
    for p, pr in (("/check/", "0.6"), ("/request/", "0.5"), ("/privacy/", "0.2"), ("/terms/", "0.2")):
        f = os.path.join(DOCS, p.strip("/"), "index.html")
        if os.path.isfile(f):
            urls.append((p, datetime.utcfromtimestamp(os.path.getmtime(f)).strftime("%Y-%m-%d"), "monthly", pr))
    update_index_cities()

    sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for p, last, freq, pr in urls:
        sm.append(f"  <url><loc>{e(SITE + p)}</loc><lastmod>{last}</lastmod><changefreq>{freq}</changefreq><priority>{pr}</priority></url>")
    sm.append("</urlset>\n")
    write(os.path.join(DOCS, "sitemap.xml"), "\n".join(sm))
    write(os.path.join(DOCS, "robots.txt"),
          "User-agent: *\nAllow: /\n"
          f"\nSitemap: {SITE}/sitemap.xml\n")
    print(f"seo: {len(urls)} URLs in sitemap · pages new={written['new']} changed={written['changed']} unchanged={written['same']}")


if __name__ == "__main__":
    main()
