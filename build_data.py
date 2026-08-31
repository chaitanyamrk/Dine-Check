#!/usr/bin/env python3
"""
Build data.json for the Dine Check site from hyderabad_food_inspections.csv.

Pipeline:
  1. Read the scraper CSV.
  2. Drop non-venue posts (bulk enforcement drives with no named establishment).
  3. Recover missing localities from the raw post text.
  4. Normalise venue names (strip legal suffixes, collapse chain aliases).
  5. Merge repeat inspections of the same venue+area into one record.
  6. Attach lat/lng from the locality gazetteer.
  7. Emit docs/data.json

Usage:  python build_data.py [path/to/hyderabad_food_inspections.csv]
"""

import collections
import csv
import json
import os
import re
import sys
import unicodedata
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CSV = os.path.join(HERE, "hyderabad_food_inspections.csv")
OUT = os.path.join(HERE, "docs", "data.json")
GAZETTEER = os.path.join(HERE, "areas.json")

# ---------------------------------------------------------------- junk filters

# entity_name values the parser produced that are not actually venue names
BAD_ENTITY = re.compile(
    r"^\s*$|^the above|^food handling|^the establishment$|^above establishment|"
    r"^a cloud kitchen|^\W*$",
    re.I,
)

# fragments that mean the parser swallowed narrative prose into the name field
BAD_NAME_TAIL = re.compile(
    r"\band (?:reviewed|assessed|inspected)\b|\bto assess\b|\bwas conducted\b|"
    r"\bteams inspected\b",
    re.I,
)

# lines in raw_text that introduce the venue name
NAME_LINE = re.compile(
    r"^\s*(?:Establishment|Restaurant Name|Restaurant|Outlet|Unit|Name|Location)\s*[:\-]\s*(.+)$",
    re.I,
)

DATE_LINE = re.compile(r"^\s*(?:Date\s*[:\-]\s*)?\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\s*$")

# metadata lines that sit between the name and the locality
SKIP_LINE = re.compile(r"^\s*(?:Firm|Brand|FBO|Licen[cs]e|Trade Name|Operator|Owner)\s*[:\-]", re.I)

# noise that is never a locality
NOT_A_PLACE = re.compile(
    r"food safety|inspection|hygiene|compliance|good practice|violation|"
    r"non-compliance|notice|score|marks|fssai|cmc |ghmc|teams|drive|"
    r"establishment|premises|food handling|cloud kitchen|catering services|"
    r"to assess|@|http|^\W*$",
    re.I,
)

# ------------------------------------------------------- name normalisation

LEGAL_SUFFIX = re.compile(
    r"\b(private limited|pvt\.?\s*ltd\.?|pvt\.?\s*limited|limited|ltd\.?|"
    r"llp|inc\.?|india pvt\.?\s*ltd\.?|enterprises|"
    r"retail private limited|foods pvt\.?|foods private limited)\b\.?",
    re.I,
)

# Chain aliases -> canonical brand. Matched against the cleaned name, case-insensitive.
# Order matters: first match wins.
CHAIN_ALIASES = [
    (r"domino", "Domino's Pizza"),
    (r"\bkfc\b", "KFC"),
    (r"pizza hut", "Pizza Hut"),
    (r"burger king", "Burger King"),
    (r"\bsubway\b", "Subway"),
    (r"\bks bakers\b", "KS Bakers"),
    (r"pista house", "Pista House"),
    (r"babai hotel|friends factory", "Babai Hotel"),
    (r"ideal kitchen", "Ideal Kitchen"),
    (r"mandi king", "Mandi King"),
    (r"kanchi cafe", "Kanchi Cafe"),
    (r"la pino", "La Pino'z Pizza"),
    (r"wow!? momo", "Wow! Momo"),
    (r"chinese wok", "Chinese Wok"),
    (r"california burrito", "California Burrito"),
    (r"barbeque nation", "Barbeque Nation"),
    (r"rameshwaram cafe", "Rameshwaram Cafe"),
    (r"instamart|kwickbox", "Swiggy Instamart"),
    (r"\bzepto\b", "Zepto"),
    (r"bigbasket", "BigBasket"),
    (r"reliance retail|reliance smart", "Reliance Retail"),
    (r"lulu hyper", "Lulu Hypermarket"),
    (r"vijetha", "Vijetha Supermarket"),
    (r"pvr ?inox|^inox$", "PVR INOX"),
    (r"cinepolis", "Cinepolis"),
    (r"oakridge", "Oakridge International School"),
    (r"gaudium", "The Gaudium School"),
    (r"chirec", "CHIREC International School"),
    (r"glendale", "Glendale International School"),
    (r"narayana", "Narayana Educational Society"),
    (r"antera|anteral", "AnTeRa"),
    (r"brown bear|bake max", "Bake Max Foods (Brown Bear)"),
]

# Parenthetical operator names to drop, e.g. "KFC (Devyani India Pvt. Ltd.)"
OPERATOR_PAREN = re.compile(
    r"\s*\((?:[^)]*(?:pvt|ltd|limited|private|india|foods|retail|concepts|"
    r"heritage|devyani|jubilant|innovative|trade name|as per|on zomato|"
    r"on swiggy)[^)]*)\)\s*",
    re.I,
)


def squash(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "")
    s = s.replace("’", "'").replace("‘", "'")
    s = re.sub(r"\s+", " ", s)
    return s.strip(" \t\n\r-–—,.|;:")


def clean_name(raw: str) -> str:
    n = squash(raw)
    n = OPERATOR_PAREN.sub(" ", n)
    n = re.sub(r"\bM/s\.?\s*", "", n, flags=re.I)
    stripped = squash(LEGAL_SUFFIX.sub("", n))
    # "S.R. Enterprises" -> "S.R" is worse than leaving it alone. Only drop the
    # legal suffix when a usable name survives it.
    if len(re.sub(r"[^A-Za-z0-9]", "", stripped)) >= 4:
        n = stripped
    return squash(n)


def canonical(name: str) -> str:
    """Canonical brand key for merging chain aliases."""
    low = name.lower()
    for pat, brand in CHAIN_ALIASES:
        if re.search(pat, low):
            return brand
    return name


def is_chain(name: str) -> bool:
    """True for brands that legitimately have one outlet per locality."""
    low = name.lower()
    return any(re.search(pat, low) for pat, _ in CHAIN_ALIASES)


ANY_PAREN = re.compile(r"\s*\([^)]*\)\s*")


def match_key(name: str) -> str:
    """
    Merge key. Never displayed — only used to decide whether two rows describe
    the same establishment.

    The source posts spell one venue several ways: "Multi cuisine" vs
    "Multicuisine", "All Rich Dairy (Swetha Diary)" vs "All Rich Dairy". So the
    key drops every parenthetical and every space and punctuation mark.

    Descriptor words are deliberately NOT stripped. Dropping "Restaurant" or
    "Bakery" would fuse genuinely different businesses that share a first word.
    """
    n = ANY_PAREN.sub(" ", squash(name).lower())
    return re.sub(r"[^a-z0-9]+", "", n)


# ------------------------------------------------------------- location logic


def recover_location(row: dict) -> str:
    """Pull the locality out of raw_text when the location column is blank."""
    loc = squash(row.get("location", ""))
    if loc and not NOT_A_PLACE.search(loc):
        return loc

    lines = [squash(l) for l in (row.get("raw_text") or "").split("\n")]
    lines = [l for l in lines if l]

    # Case A: "Establishment: X" followed by the locality on the next line
    for i, line in enumerate(lines[:6]):
        m = NAME_LINE.match(line)
        if not m:
            continue
        tail = squash(m.group(1))
        # "Location: Udupi Upahar, Moosapet" -> locality is the last comma part
        if re.match(r"^\s*Location\s*[:\-]", line, re.I) and "," in tail:
            return squash(tail.split(",")[-1])
        for nxt in lines[i + 1 : i + 4]:
            if DATE_LINE.match(nxt) or SKIP_LINE.match(nxt):
                continue
            if NOT_A_PLACE.search(nxt):
                break
            if len(nxt) <= 70:
                return nxt
        break

    # Case B: "...inspected/conducted at <Name>, <area>, <area2>, to assess ..."
    text = re.sub(r"\([^)]*\)", " ", row.get("raw_text") or "")  # drop operator parens
    m = re.search(
        r"(?:inspected|inspection\s+at|conducted\s+at|conducted\s+an\s+inspection\s+at)\s+"
        r"(.{5,200}?)(?:,?\s*to assess|\n|$)",
        text,
        re.I,
    )
    if m:
        parts = [squash(p) for p in m.group(1).split(",") if squash(p)]
        parts = [p for p in parts if p and not NOT_A_PLACE.search(p)]
        if len(parts) >= 2:
            return parts[-1]

    return ""


def sweep_for_area(raw_text: str, gaz: dict) -> str:
    """Last resort: find any known locality name anywhere in the post."""
    head = squash(" ".join((raw_text or "").split("\n")[:8])).lower()
    best = None
    for alias in sorted(gaz, key=len, reverse=True):
        m = re.search(r"\b" + re.escape(alias) + r"\b", head)
        if m and (best is None or m.start() < best[0]):
            best = (m.start(), gaz[alias]["area"])
    return best[1] if best else ""


STRIP_PREFIX = re.compile(
    r"^(near|nearby|opp\.?|opposite|beside|behind|backside of|next to|at)\s+", re.I
)


def resolve_area(loc: str, gaz: dict):
    """
    Return (display_location, canonical_area, lat, lng, hits).

    An address runs specific -> broad ("GSM Mall, Madinaguda"), so the LAST
    comma-part that matches the gazetteer is the safest locality to group by.

    `hits` is every gazetteer area the address touches, not just the last one.
    "Tolichowki, Mehdipatnam" groups under Mehdipatnam but also records
    Tolichowki, which is what lets a second post naming only "Tolichowki" be
    recognised as the same place.
    """
    loc = squash(loc)
    if not loc:
        return "", "", None, None, set()

    parts = [STRIP_PREFIX.sub("", squash(p)) for p in loc.split(",")]
    parts = [p for p in parts if p and not NOT_A_PLACE.search(p)]

    hit, hits = None, set()
    for p in parts:
        low = p.lower()
        if low in gaz:
            hit = gaz[low]
            hits.add(hit["area"])
            continue
        # substring match against aliases, longest alias first
        for alias in sorted(gaz, key=len, reverse=True):
            if alias.startswith("_"):
                continue
            if re.search(r"\b" + re.escape(alias) + r"\b", low):
                hit = gaz[alias]
                hits.add(hit["area"])
                break

    if hit:
        return loc, hit["area"], hit["lat"], hit["lng"], hits

    area = parts[-1] if parts else squash(STRIP_PREFIX.sub("", loc))
    return loc, area, None, None, ({area} if area else set())


# ------------------------------------------------------------------ scoring


def _neg_date(d):
    """Sort key that puts the most recent date first among unscored records."""
    return "".join(chr(ord("9") - int(c)) if c.isdigit() else c for c in (d or ""))


def grade(pct):
    if pct is None:
        return "unrated"
    if pct >= 90:
        return "excellent"
    if pct >= 80:
        return "good"
    if pct >= 70:
        return "average"
    return "poor"


def parse_date(s):
    s = squash(s)
    for fmt in ("%d-%m-%Y", "%d.%m.%Y", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    return ""


def split_list(s):
    s = squash(s)
    if not s:
        return []
    return [squash(x) for x in s.split("|") if squash(x)]


def to_int(s):
    s = squash(s)
    return int(s) if re.fullmatch(r"\d+", s) else None


# --------------------------------------------------------------------- main


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CSV
    with open(src, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    areas = {}
    if os.path.exists(GAZETTEER):
        with open(GAZETTEER, encoding="utf-8") as f:
            areas = {k: v for k, v in json.load(f).items() if not k.startswith("_")}

    inspections = []
    skipped = 0

    for r in rows:
        raw_name = r.get("entity_name", "")
        if BAD_ENTITY.match(raw_name or ""):
            skipped += 1
            continue
        name = clean_name(raw_name)
        if len(name) < 3:
            skipped += 1
            continue

        if BAD_NAME_TAIL.search(name) or len(name) > 70:
            skipped += 1
            continue

        loc_raw = recover_location(r)
        display_loc, area, lat, lng, area_hits = resolve_area(loc_raw, areas)
        if lat is None:
            swept = sweep_for_area(r.get("raw_text", ""), areas)
            if swept:
                g = next(v for v in areas.values() if v["area"] == swept)
                area, lat, lng = swept, g["lat"], g["lng"]
                area_hits = area_hits | {swept}
                display_loc = display_loc or swept

        obtained = to_int(r.get("score_obtained", ""))
        total = to_int(r.get("score_total", ""))
        pct = to_int(r.get("score_percent", ""))
        if pct is None and obtained is not None and total:
            pct = round(obtained * 100 / total)
        # Always trust the percentage, never raw marks (checklist totals differ
        # by business profile — see project notes).
        if pct is not None and not (0 <= pct <= 100):
            pct = None

        inspections.append(
            {
                # A scored FoSCoS audit (CMC) or an unscored enforcement record
                # (TG SAFE / CFS). The two are never ranked against each other.
                "kind": "inspection" if pct is not None else "enforcement",
                "name": name,
                "brand": canonical(name),
                "location": display_loc,
                "area": area,
                "areaHits": area_hits,
                "lat": lat,
                "lng": lng,
                "date": parse_date(r.get("inspection_date", "")) or parse_date(r.get("post_date", "")),
                "pct": pct,
                "obtained": obtained,
                "total": total,
                "good": split_list(r.get("good_practices", "")),
                "bad": split_list(r.get("non_compliances", "")),
                "action": squash(r.get("action_taken", "")),
                "severity": squash(r.get("finding_severity", "")) or "None",
                "notice": squash(r.get("notice_issued", "")).lower() == "yes",
                "source": squash(r.get("source_handle", "")),
                "url": squash(r.get("post_url", "")),
                "photo": (split_list(r.get("media_urls", "")) or [""])[0],
            }
        )

    # ---- drop duplicate posts of the same inspection (CMC posts multi-part threads)
    # Prefer the row that carries a date and a source URL as the canonical copy.
    inspections.sort(key=lambda i: (i["date"] == "", i["url"] == ""))
    seen, deduped = set(), []
    for ins in inspections:
        if ins["pct"] is not None:
            k = (match_key(ins["brand"]), ins["area"].lower(), ins["pct"], ins["obtained"], ins["total"])
        else:
            k = (match_key(ins["brand"]), ins["area"].lower(), ins["date"], ins["url"])
        if k in seen:
            continue
        seen.add(k)
        deduped.append(ins)
    dupes = len(inspections) - len(deduped)
    inspections = deduped

    # ---- merge into venues: one card per (name, area)
    venues = {}
    for ins in inspections:
        key = (match_key(ins["brand"]), ins["area"].lower())
        v = venues.setdefault(
            key,
            {"id": "", "areaHits": set(), "inspections": []},
        )
        v["areaHits"] |= ins["areaHits"]
        v["inspections"].append(ins)

    # ---- second pass: the same establishment split across spelling or locality
    #
    # Pass one keys on (name, area), so one venue still ends up on two cards
    # when the posts disagree about where it is:
    #   "Tolichowki"            vs "Tolichowki, Mehdipatnam"   (nested locality)
    #   "Abdullapurmet"         vs no locality at all          (missing locality)
    # Both are the same place, and both are now caught below.
    #
    # Chains are exempt: two KFCs in overlapping localities really are two
    # restaurants, and merging them would hide one of the two scores.
    def same_place(a, b, pair_only):
        blank = {"", "unspecified"}
        if area_of(a).lower() in blank or area_of(b).lower() in blank:
            # A placeless record joins its named twin only when there is exactly
            # one twin to join; with three candidates the choice would be a guess.
            return pair_only
        return bool(a["areaHits"] & b["areaHits"])

    def area_of(v):
        newest = max(v["inspections"], key=lambda i: i["date"] or "")
        return newest["area"]

    def name_of(v):
        newest_date = max((i["date"] or "") for i in v["inspections"])
        # Among the most recent posts, prefer the fullest spelling.
        return max(
            (i for i in v["inspections"] if (i["date"] or "") == newest_date),
            key=lambda i: len(i["brand"]),
        )["brand"]

    by_name = collections.defaultdict(list)
    for key in venues:
        by_name[key[0]].append(key)

    merged = []
    for nkey, keys in by_name.items():
        if len(keys) < 2:
            continue
        if any(is_chain(name_of(venues[k])) for k in keys):
            continue
        pair_only = len(keys) == 2
        rest = list(keys)
        i = 0
        while i < len(rest):
            base = venues[rest[i]]
            j = i + 1
            while j < len(rest):
                other = venues[rest[j]]
                if same_place(base, other, pair_only):
                    merged.append(
                        f"{name_of(other)} ({area_of(other) or 'no locality'}) "
                        f"-> {name_of(base)} ({area_of(base) or 'no locality'})"
                    )
                    base["inspections"] += other["inspections"]
                    base["areaHits"] |= other["areaHits"]
                    del venues[rest[j]]
                    rest.pop(j)
                    continue
                j += 1
            i += 1

    out = []
    for v in venues.values():
        ins = sorted(v["inspections"], key=lambda x: x["date"] or "", reverse=True)
        latest = ins[0]
        v["name"] = name_of(v)
        v["area"] = area_of(v)
        v["location"] = max((i["location"] for i in ins), key=len, default="")
        v["aka"] = {
            n
            for i in ins
            for n in (i["name"], i["brand"])
            if n and n != v["name"]
        }
        scored = [i for i in ins if i["pct"] is not None]
        latest_scored = scored[0] if scored else None
        kind = "inspection" if scored else "enforcement"
        violations = sum(len(i["bad"]) for i in ins)
        slug = re.sub(r"[^a-z0-9]+", "-", f"{v['name']} {v['area']}".lower()).strip("-")
        geo = next(({"lat": i["lat"], "lng": i["lng"]} for i in ins if i["lat"] is not None), None)
        out.append(
            {
                "id": slug,
                "name": v["name"],
                "aka": sorted(v["aka"]),
                "location": v["location"] or v["area"],
                "area": v["area"] or "Unspecified",
                "lat": geo["lat"] if geo else None,
                "lng": geo["lng"] if geo else None,
                "kind": kind,
                "score": latest_scored["pct"] if latest_scored else None,
                "grade": grade(latest_scored["pct"]) if latest_scored else "unrated",
                "violations": violations,
                "lastScored": latest_scored["date"] if latest_scored else "",
                "lastInspected": latest["date"],
                "visits": len(ins),
                "notice": any(i["notice"] for i in ins),
                "photo": next((i["photo"] for i in ins if i["photo"]), ""),
                "history": [
                    {
                        "kind": i["kind"],
                        "date": i["date"],
                        "pct": i["pct"],
                        "obtained": i["obtained"],
                        "total": i["total"],
                        "good": i["good"],
                        "bad": i["bad"],
                        "action": i["action"],
                        "severity": i["severity"],
                        "notice": i["notice"],
                        "source": i["source"],
                        "url": i["url"],
                        "location": i["location"],
                    }
                    for i in ins
                ],
            }
        )

    # Scored venues form the ranking. Enforcement-only records are not ranked
    # against them - they fall below, newest first.
    out.sort(key=lambda v: (
        v["score"] is None,
        -(v["score"] or 0) if v["score"] is not None else 0,
        "" if v["score"] is not None else _neg_date(v["lastInspected"]),
        v["name"],
    ))

    scored = [v for v in out if v["score"] is not None]
    enforcement = [v for v in out if v["score"] is None]
    area_counts, area_geo = {}, {}
    for v in out:
        area_counts[v["area"]] = area_counts.get(v["area"], 0) + 1
        if v["lat"] is not None:
            area_geo[v["area"]] = (v["lat"], v["lng"])

    payload = {
        "generated": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "stats": {
            "venues": len(out),
            "scoredVenues": len(scored),
            "enforcementVenues": len(enforcement),
            "inspections": len(inspections),
            "scored": len(scored),
            "avgScore": round(sum(v["score"] for v in scored) / len(scored)) if scored else 0,
            "excellent": sum(1 for v in scored if v["grade"] == "excellent"),
            "good": sum(1 for v in scored if v["grade"] == "good"),
            "average": sum(1 for v in scored if v["grade"] == "average"),
            "poor": sum(1 for v in scored if v["grade"] == "poor"),
            "areas": len([a for a in area_counts if a and a != "Unspecified"]),
            "latest": max((v["lastInspected"] for v in out if v["lastInspected"]), default=""),
            "skippedPosts": skipped,
            "duplicatePosts": dupes,
            "ungeocoded": sorted({v["area"] for v in out if v["lat"] is None and v["area"] != "Unspecified"}),
            "sources": [
                {"handle": h, "count": c}
                for h, c in sorted(
                    collections.Counter(i["source"] for i in inspections if i["source"]).items(),
                    key=lambda kv: -kv[1],
                )
            ],
            "earliest": min((i["date"] for i in inspections if i["date"]), default=""),
        },
        "areas": sorted(
            [{"name": a, "count": c, "lat": area_geo.get(a, (None, None))[0], "lng": area_geo.get(a, (None, None))[1]}
             for a, c in area_counts.items() if a and a != "Unspecified"],
            key=lambda x: (-x["count"], x["name"]),
        ),
        "venues": out,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)

    s = payload["stats"]
    print(f"venues={s['venues']}  inspections={s['inspections']}  scored={s['scored']}  "
          f"avg={s['avgScore']}  areas={s['areas']}  "
          f"dupes_merged={s['duplicatePosts']}  non_venue_posts={s['skippedPosts']}")
    if merged:
        print(f"split venues re-merged ({len(merged)}):")
        for m in sorted(merged):
            print("   ", m)
    if s["ungeocoded"]:
        print("NO COORDINATES for:", ", ".join(s["ungeocoded"]))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
