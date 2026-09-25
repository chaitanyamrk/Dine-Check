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
import difflib
import json
import os
import re
import sys
import unicodedata
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CSV = os.path.join(HERE, "hyderabad_food_inspections.csv")
# Enforcement actions published only as images (e.g. TG SAFE's drive graphics), typed in by hand
# from the post and linked to it. Same columns as the scraper CSV; the scraper never overwrites it.
MANUAL_CSV = os.path.join(HERE, "enforcement_manual.csv")
FSSAI_CSV = os.path.join(HERE, "fssai_hygiene_ratings.csv")
DOCS = os.path.join(HERE, "docs")
OUT = os.path.join(DOCS, "data.json")
GAZETTEER = os.path.join(HERE, "areas.json")
CITIES = os.path.join(HERE, "cities.json")

# The X/press pipeline only covers Telangana, so everything it produces belongs
# to one city. The FSSAI directory carries its own city column.
INSPECTION_CITY = "Hyderabad"

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


def addr_key(address: str) -> str:
    """Identity key for a certification: its address, stripped to bare letters."""
    return re.sub(r"[^a-z0-9]+", "", squash(address).lower())[:90]


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


# ------------------------------------------------------- FSSAI hygiene ratings

# The five published bands, best to worst. These are NOT percentages and are not
# comparable with a FoSCoS inspection score, so they get their own scale and are
# never ranked against one.
BANDS = ["Excellent", "Very Good", "Good", "Needs Improvement", "Urgent Improvement", "Poor"]
BAND_RANK = {b: i for i, b in enumerate(BANDS)}


# Kept in capitals when the source shouts. Extend freely — a name wrongly
# lower-cased here is cosmetic, never a data error.
ACRONYMS = {
    "kfc", "itc", "pvr", "inox", "iit", "nit", "bel", "hal", "sez", "gst", "atm",
    "cbd", "pg", "ac", "tv", "usa", "uk", "vip", "ngo", "llp", "opc", "huda",
    "midc", "cidco", "gidc", "ncr", "omr", "ecr", "brts", "bpcl", "hpcl", "iocl",
    "dlf", "hsr", "btm", "rtc", "jw", "oyo", "kim", "mtr", "cmh", "ttk", "ecil",
    "bhel", "ongc", "nfc", "cbi", "aiims", "nims", "gvk", "gmr", "amb", "amc",
}

# Never treated as an acronym, however the source capitalises them.
NEVER_ACRONYM = {
    "ltd", "pvt", "and", "the", "no", "new", "old", "opp", "hut", "inn", "bar",
    "spa", "pub", "cafe", "hub", "top", "sky", "sun", "one", "two", "big", "hot",
    "raw", "red", "fig", "pot", "cup", "day", "eat", "egg", "fry", "wok", "tea",
}

SMALL_WORDS = {"and", "the", "of", "for", "on", "in", "at", "to", "by", "or",
               "a", "an", "de", "da"}


def is_city_name(text: str, banned) -> bool:
    """
    True when `text` is the city's own name, including a misspelling of it.

    The source data spells cities loosely — Ahmdabad, Banglore, Bengalore — and
    each variant that slips through becomes an "area" swallowing hundreds of
    venues, because every address ends with the city and the resolver takes the
    last match. An exact ban list never keeps up, so near-misses count too.

    0.85 is deliberately tight. Real localities that merely start with the city
    name stay well below it: "Mumbai Central" scores 0.75 against "Mumbai",
    "New Delhi" 0.71 against "Delhi".
    """
    low = squash(text).lower()
    if low in banned:
        return True
    for b in banned:
        if abs(len(low) - len(b)) <= 2 and difflib.SequenceMatcher(None, low, b).ratio() >= 0.85:
            return True
    return False


def titlecase(s: str) -> str:
    """
    FSSAI publishes names and addresses in capitals. Rendering them as-is makes
    the whole list shout, so soften them without mangling the acronyms that
    carry meaning (KFC, ITC, MG Road, B.B.M.P, 5TH).
    """
    out = []
    for i, tok in enumerate(squash(s).split(" ")):
        letters = re.sub(r"[^A-Za-z]", "", tok)
        if not letters:
            out.append(tok)
            continue

        has_up = any(c.isupper() for c in letters)
        has_lo = any(c.islower() for c in letters)
        if has_up and has_lo:
            out.append(tok)                       # McDonald's, iPhone: leave alone
            continue

        low = letters.lower()
        if re.fullmatch(r"(?:[A-Za-z]\.){2,}|[A-Za-z]\.[A-Za-z]{1,3}\.?", tok):
            out.append(tok.upper())               # B.B.M.P, H.NO, D.No
            continue

        m = re.fullmatch(r"(\d+)(st|nd|rd|th)(\W*)", tok, re.I)
        if m:
            out.append(m.group(1) + m.group(2).lower() + m.group(3))
            continue

        if has_up and len(tok) <= 4 and re.search(r"\d", tok):
            out.append(tok)                       # A2B, B2B, 5G — brand-ish
            continue

        # An all-caps token is only kept as an acronym if it is on the list or
        # has no vowels. A length rule alone keeps HUT, AND, LTD and NO shouting.
        keep = has_up and (
            low in ACRONYMS or (len(letters) <= 4 and not re.search(r"[aeiou]", low))
        ) and low not in NEVER_ACRONYM
        if keep:
            out.append(tok)
            continue

        if low in SMALL_WORDS and i > 0:
            out.append(tok.lower())
            continue

        t = tok.lower()
        j = next(k for k, c in enumerate(t) if c.isalpha())
        out.append(t[:j] + t[j].upper() + t[j + 1:])
    return " ".join(out)


# Address parts that are part of a building, not a place. Without these, "G/F"
# came out as one of Delhi's largest "localities".
NOT_A_LOCALITY = re.compile(
    r"^[a-z]?/?[fg]$|^[gfs]/[fg]$|^\w{1,2}$"          # G/F, F/F, GF, A
    r"|\bfloor\b|\bflr\b|\bground\b|\bbasement\b|\bmezzanine\b|\bterrace\b"
    r"|\bwing\b|\btower\b|\bblock\b|\bshop\b|\bunit\b|\bgala\b|\bstall\b"
    r"|\bplot\b|\bsurvey\b|\bkhasra\b|\bkhata\b|\bcts\b|\bgat\b|\bmilkat\b"
    r"|\bchs\b|\bco-?op\b|\bsociety\b|\bpremises\b|\bcompound\b|\bgodown\b"
    r"|\broom\b|\bcabin\b|\bcounter\b|\bkiosk\b|\bgate\b",
    re.I,
)

# Prefixes that decorate a place name without changing it, so "Dist. Thane" and
# "Thane" are one area rather than two.
LEAD_NOISE = re.compile(
    r"^(?:dist{1,2}\.?|district|tal\.?|taluka|tehsil|teh\.?|village|vill\.?|"
    r"vil\.?|po|p\.o\.?|at post|at|opp\.?|opposite|near|nr\.?|behind|beside|"
    r"next to|above|the)\b[\s.\-,]*",
    re.I,
)


def locality_from_address(address: str, city_name: str, district: str, city=None) -> str:
    """
    Best locality guess when no gazetteer placed the venue.

    Addresses run specific -> broad, so the last comma part is usually the city
    itself and the part before it is the locality. Worth keeping even without
    coordinates: it still groups and filters the list. Falls back to the
    district, which is always present.
    """
    parts = [squash(p) for p in (address or "").split(",")]
    city_low = city_name.lower()
    # A district is an administrative unit, not a locality. "New Delhi" and
    # "Greater Mumbai" are too broad to be useful as an area, and the district
    # is already the fallback of last resort at the bottom of this function.
    banned = ({city_low}
              | {squash(d).lower() for d in ((city or {}).get("districts") or [])}
              | {squash(d).lower() for d in ((city or {}).get("aliases") or [])})
    for p in reversed(parts):
        prev = None
        while prev != p:
            prev = p
            p = squash(LEAD_NOISE.sub("", p))
        p = squash(re.sub(r"\b\d{6}\b", " ", p))
        low = p.lower()
        if not p or len(p) < 3 or len(p) > 40:
            continue
        # Exact match only. Rejecting anything *containing* the city name would
        # throw away Navi Mumbai and Chennai International Airport, which are
        # real places people search for.
        if is_city_name(p, banned):
            continue
        if NOT_A_PLACE.search(p) or NOT_A_LOCALITY.search(p):
            continue
        if re.search(r"\d", p):
            continue                                    # house/plot/floor numbers
        return titlecase(p)
    return titlecase(district) or ""


def load_cities(path=CITIES):
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return {k: v for k, v in json.load(f).items() if not k.startswith("_")}


def load_gazetteer(path, city=None):
    """
    Load a locality gazetteer, refusing entries that would swallow the city.

    Addresses run specific -> broad and always end with the city, and
    `resolve_area` takes the LAST gazetteer match. So a single alias resolving to
    the city's own name (or one of its districts) files nearly every venue under
    it — on the first Mumbai build, one "mumbai" entry put 42% of the city in an
    area called "Mumbai". Dropping them here means a sloppy gazetteer can only
    lose precision, never destroy the area filter.
    """
    if not path or not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        gaz = {k: v for k, v in json.load(f).items() if not k.startswith("_")}
    if not city:
        return gaz
    banned = {city["name"].lower()}
    banned |= {squash(d).lower() for d in (city.get("districts") or [])}
    banned |= {squash(d).lower() for d in (city.get("aliases") or [])}
    dropped = {k: v for k, v in gaz.items()
               if is_city_name(k, banned) or is_city_name(v.get("area", ""), banned)}
    for k in dropped:
        gaz.pop(k)
    if dropped:
        load_gazetteer.dropped = getattr(load_gazetteer, "dropped", [])
        load_gazetteer.dropped.append((city["name"], sorted(dropped)))
    return gaz


def read_certifications(path, cities, gazetteers):
    """
    FSSAI Hygiene Rating rows -> venue records.

    These are a third kind of record. An inspection says what an officer found on
    a day; an enforcement record says what was wrong; a certification says only
    that the business paid for a voluntary audit and passed it. It carries no
    date, no marks and no findings, so it is never scored, never aged, and never
    ranked against the other two.
    """
    if not os.path.exists(path):
        return [], {}
    by_name = {c["name"]: (key, c) for key, c in cities.items()}
    out, unknown = [], collections.Counter()
    with open(path, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            if squash(r.get("dropped", "")):
                continue                      # no longer listed by FSSAI
            city_name = squash(r.get("city", ""))
            if city_name not in by_name:
                unknown[city_name] += 1
                continue
            city_key, city = by_name[city_name]
            name = clean_name(titlecase(r.get("name", "")))
            if len(name) < 3:
                continue
            address = titlecase(r.get("address", ""))
            district = squash(r.get("district", ""))
            gaz = gazetteers.get(city_key, {})
            display_loc, area, lat, lng, hits = resolve_area(address, gaz)
            if lat is None:
                # No gazetteer hit. Keep a usable locality name anyway — it still
                # groups and filters, it just cannot be distance-sorted.
                area = locality_from_address(address, city_name, district, city)
            rating = squash(r.get("rating", ""))
            out.append(
                {
                    "kind": "certification",
                    "city": city_name,
                    "cityKey": city_key,
                    "name": name,
                    "brand": canonical(name),
                    "location": display_loc or address,
                    "area": area or titlecase(district),
                    "areaHits": hits,
                    "lat": lat,
                    "lng": lng,
                    "district": district,
                    "date": "",               # the directory publishes no audit date
                    "firstSeen": squash(r.get("first_seen", "")),
                    "lastSeen": squash(r.get("last_seen", "")),
                    "band": rating,
                    "bandRank": BAND_RANK.get(rating, len(BANDS)),
                    "pct": None,
                    "obtained": None,
                    "total": None,
                    "good": [],
                    "bad": [],
                    "action": "",
                    "severity": "None",
                    "notice": False,
                    "source": "FSSAI Hygiene Rating",
                    "url": "https://hygiene.fssai.gov.in/knowRating.php",
                    "photo": "",
                }
            )
    return out, unknown


# --------------------------------------------------------------------- main


def read_inspections(src, areas):
    """The X/press pipeline: scored FoSCoS audits and unscored enforcement."""
    with open(src, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    inspections, skipped = [], 0
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
                "city": INSPECTION_CITY,
                "cityKey": "hyderabad",
                "name": name,
                "brand": canonical(name),
                "location": display_loc,
                "area": area,
                "areaHits": area_hits,
                "lat": lat,
                "lng": lng,
                "district": "",
                "date": parse_date(r.get("inspection_date", "")) or parse_date(r.get("post_date", "")),
                "firstSeen": "",
                "lastSeen": "",
                "band": "",
                "bandRank": len(BANDS),
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
    return inspections, skipped


def build_city(records):
    """Collapse one city's records into venue cards. Returns (venues, dupes, merges)."""

    # ---- drop duplicate posts of the same inspection (CMC posts multi-part threads)
    # Prefer the row that carries a date and a source URL as the canonical copy.
    records = sorted(records, key=lambda i: (i["date"] == "", i["url"] == ""))
    seen, deduped = set(), []
    for ins in records:
        if ins["kind"] == "certification":
            k = ("cert", match_key(ins["brand"]), addr_key(ins["location"]))
        elif ins["pct"] is not None:
            k = (match_key(ins["brand"]), ins["area"].lower(), ins["pct"], ins["obtained"], ins["total"])
        else:
            k = (match_key(ins["brand"]), ins["area"].lower(), ins["date"], ins["url"])
        if k in seen:
            continue
        seen.add(k)
        deduped.append(ins)
    dupes = len(records) - len(deduped)
    records = deduped

    # ---- merge into venues: one card per (name, area)
    #
    # Certifications are the exception, and it matters. FSSAI registers each
    # outlet under the OPERATING COMPANY, so Mumbai carries 86 rows all called
    # some spelling of "Tata Starbucks Pvt Ltd", and Pune has a dozen under
    # "Sapphire Foods India". Those are different shops at different addresses.
    # Keying them on (name, area) fused whole chains into a single card, so a
    # certification is identified by its ADDRESS instead, and the key is shaped
    # so it can never join an inspection group or the cross-area pass below.
    venues = {}
    for ins in records:
        if ins["kind"] == "certification":
            key = (match_key(ins["brand"]) + "|cert|" + addr_key(ins["location"]), ins["area"].lower())
        else:
            key = (match_key(ins["brand"]), ins["area"].lower())
        v = venues.setdefault(key, {"id": "", "areaHits": set(), "inspections": []})
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
        # Belt and braces: a certification is identified by address in pass one,
        # and must never be re-merged on a locality guess here.
        if any(any(i["kind"] == "certification" for i in venues[k]["inspections"]) for k in keys):
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

    # A certification record is mostly empty — no marks, no findings, no date —
    # and writing those blanks out cost megabytes across ten cities. Emitting
    # only the keys that carry something roughly halves each city file. The page
    # reads every one of these with a truthiness or `== null` check, so a missing
    # key behaves exactly like the empty value it replaces.
    EMPTY = (None, "", [], False)

    def prune(d, keep):
        return {k: val for k, val in d.items() if k in keep or val not in EMPTY}

    ALWAYS = {"id", "name", "area", "kind"}
    ALWAYS_H = {"kind"}

    out = []
    for v in venues.values():
        ins = sorted(v["inspections"], key=lambda x: x["date"] or "", reverse=True)
        latest = ins[0]
        v["name"] = name_of(v)
        v["area"] = area_of(v)
        v["location"] = max((i["location"] for i in ins), key=len, default="")
        v["aka"] = {n for i in ins for n in (i["name"], i["brand"]) if n and n != v["name"]}

        scored = [i for i in ins if i["pct"] is not None]
        certs = [i for i in ins if i["kind"] == "certification"]
        latest_scored = scored[0] if scored else None
        if scored:
            kind = "inspection"
        elif any(i["kind"] == "enforcement" for i in ins):
            kind = "enforcement"
        else:
            kind = "certification"
        best_cert = min(certs, key=lambda c: c["bandRank"]) if certs else None
        violations = sum(len(i["bad"]) for i in ins)
        slug = re.sub(r"[^a-z0-9]+", "-", f"{v['name']} {v['area']}".lower()).strip("-")
        geo = next(({"lat": i["lat"], "lng": i["lng"]} for i in ins if i["lat"] is not None), None)
        out.append(prune(
            {
                "id": slug,
                "name": v["name"],
                "aka": sorted(v["aka"]),
                "location": v["location"] or v["area"],
                "area": v["area"] or "Unspecified",
                # city/cityKey are deliberately NOT repeated on each venue —
                # the file is per-city and carries them once at the top.
                "lat": geo["lat"] if geo else None,
                "lng": geo["lng"] if geo else None,
                "kind": kind,
                "score": latest_scored["pct"] if latest_scored else None,
                "grade": grade(latest_scored["pct"]) if latest_scored else "unrated",
                "band": best_cert["band"] if best_cert else "",
                "bandRank": best_cert["bandRank"] if best_cert else None,
                "violations": violations,
                "lastScored": latest_scored["date"] if latest_scored else "",
                "lastInspected": latest["date"],
                "visits": len([i for i in ins if i["kind"] != "certification"]),
                "notice": any(i["notice"] for i in ins),
                "photo": next((i["photo"] for i in ins if i["photo"]), ""),
                "history": [
                    prune({
                        "kind": i["kind"],
                        "date": i["date"],
                        "pct": i["pct"],
                        "obtained": i["obtained"],
                        "total": i["total"],
                        "band": i["band"],
                        "good": i["good"],
                        "bad": i["bad"],
                        "action": i["action"],
                        "severity": "" if i["severity"] == "None" else i["severity"],
                        "notice": i["notice"],
                        "source": i["source"],
                        "url": i["url"],
                        # The venue already carries the address; repeating it on
                        # every history row was pure weight.
                        "location": "" if i["location"] == v["location"] else i["location"],
                        "firstSeen": i["firstSeen"],
                        "lastSeen": i["lastSeen"],
                    }, ALWAYS_H)
                    for i in ins
                ],
            },
            ALWAYS,
        ))

    # Ranking, within a city only. Scored inspections form the actual leaderboard.
    # Enforcement records sit below them, newest first. Voluntary FSSAI
    # certifications sit below those: they say a business paid for an audit and
    # passed, which is not evidence of the same kind and must not outrank it.
    order = {"inspection": 0, "enforcement": 1, "certification": 2}
    out.sort(key=lambda v: (
        order[v["kind"]],
        -(v.get("score") or 0) if v["kind"] == "inspection" else 0,
        _neg_date(v.get("lastInspected", "")) if v["kind"] == "enforcement" else "",
        v.get("bandRank") or 0 if v["kind"] == "certification" else 0,
        v["name"],
    ))
    return out, dupes, merged


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CSV
    # Second argument (or DINECHECK_FSSAI_CSV) points at the hygiene-rating CSV.
    # Handy for building against a fixture without touching the real file.
    fssai = (sys.argv[2] if len(sys.argv) > 2 else os.environ.get("DINECHECK_FSSAI_CSV")) or FSSAI_CSV

    cities = load_cities()
    if not cities:
        sys.exit(f"cities.json not found at {CITIES} — it defines which cities exist.")

    gazetteers = {}
    for key, c in cities.items():
        path = c.get("gazetteer")
        gazetteers[key] = load_gazetteer(os.path.join(HERE, path) if path else None, c)

    hyd_gaz = gazetteers.get("hyderabad", {})
    inspections, skipped = read_inspections(src, hyd_gaz)
    if os.path.exists(MANUAL_CSV):
        manual, m_skipped = read_inspections(MANUAL_CSV, hyd_gaz)
        print(f"manual enforcement records: {len(manual)} (skipped {m_skipped})")
        inspections += manual
    certifications, unknown_cities = read_certifications(fssai, cities, gazetteers)

    records = collections.defaultdict(list)
    for r in inspections + certifications:
        records[r["cityKey"]].append(r)

    os.makedirs(DOCS, exist_ok=True)
    index, total_dupes, all_merges, written = [], 0, [], set()
    for key, city in cities.items():
        recs = records.get(key, [])
        if not recs:
            continue
        out, dupes, merges = build_city(recs)
        total_dupes += dupes
        all_merges += [f"[{city['name']}] {m}" for m in merges]

        scored = [v for v in out if v.get("score") is not None]
        enf = [v for v in out if v["kind"] == "enforcement"]
        cert = [v for v in out if v["kind"] == "certification"]
        area_counts, area_geo = {}, {}
        for v in out:
            area_counts[v["area"]] = area_counts.get(v["area"], 0) + 1
            if v.get("lat") is not None:
                area_geo[v["area"]] = (v["lat"], v["lng"])
        located = sum(1 for v in out if v.get("lat") is not None)

        payload = {
            "city": city["name"],
            "cityKey": key,
            "state": city.get("stateName", ""),
            "lat": city["lat"],
            "lng": city["lng"],
            "generated": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "stats": {
                "venues": len(out),
                "scoredVenues": len(scored),
                "enforcementVenues": len(enf),
                "certifiedVenues": len(cert),
                "inspections": len([r for r in recs if r["kind"] != "certification"]),
                "avgScore": round(sum(v["score"] for v in scored) / len(scored)) if scored else 0,
                "excellent": sum(1 for v in scored if v["grade"] == "excellent"),
                "good": sum(1 for v in scored if v["grade"] == "good"),
                "average": sum(1 for v in scored if v["grade"] == "average"),
                "poor": sum(1 for v in scored if v["grade"] == "poor"),
                "areas": len([a for a in area_counts if a and a != "Unspecified"]),
                "located": located,
                "latest": max((v.get("lastInspected","") for v in out if v.get("lastInspected")), default=""),
                "earliest": min((r["date"] for r in recs if r["date"]), default=""),
                "sources": [
                    {"handle": h, "count": c}
                    for h, c in sorted(
                        # Inspection publishers only. The FSSAI directory is
                        # credited separately; listing it here would read as if
                        # it published inspection reports, which it does not.
                        collections.Counter(
                            r["source"] for r in recs
                            if r["source"] and r["kind"] != "certification"
                        ).items(),
                        key=lambda kv: -kv[1],
                    )
                ],
                "bands": [
                    {"band": b, "count": c}
                    for b, c in sorted(
                        collections.Counter(v.get("band","") for v in cert if v.get("band")).items(),
                        key=lambda kv: BAND_RANK.get(kv[0], 99),
                    )
                ],
                "ungeocoded": sorted({v["area"] for v in out if v.get("lat") is None and v["area"] != "Unspecified"})[:40],
            },
            "areas": sorted(
                [{"name": a, "count": c,
                  "lat": area_geo.get(a, (None, None))[0],
                  "lng": area_geo.get(a, (None, None))[1]}
                 for a, c in area_counts.items() if a and a != "Unspecified"],
                key=lambda x: (-x["count"], x["name"]),
            ),
            "venues": out,
        }

        path = os.path.join(DOCS, f"city-{key}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        written.add(f"city-{key}.json")

        index.append(
            {
                "key": key,
                "name": city["name"],
                "state": city.get("stateName", ""),
                "lat": city["lat"],
                "lng": city["lng"],
                "file": f"city-{key}.json",
                "bytes": os.path.getsize(path),
                # Distance sorting is only offered where a gazetteer actually
                # placed the venues. Nothing is faked to a city centroid.
                "hasGeo": located > 0,
                "venues": len(out),
                "scoredVenues": len(scored),
                "enforcementVenues": len(enf),
                "certifiedVenues": len(cert),
                "latest": payload["stats"]["latest"],
            }
        )

    # A city file left behind from an earlier build — a city removed from
    # cities.json, or one whose rows were dropped — would keep being served with
    # stale contents, and the picker would still link to it. Remove them.
    stale = [f for f in os.listdir(DOCS)
             if f.startswith("city-") and f.endswith(".json") and f not in written]
    for f_ in stale:
        os.remove(os.path.join(DOCS, f_))

    index.sort(key=lambda c: (-c["venues"], c["name"]))
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(
            {
                "generated": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
                "defaultCity": next(
                    (c["key"] for c in index if cities.get(c["key"], {}).get("default")),
                    index[0]["key"] if index else "",
                ),
                "totals": {
                    "cities": len(index),
                    "venues": sum(c["venues"] for c in index),
                    "scoredVenues": sum(c["scoredVenues"] for c in index),
                    "enforcementVenues": sum(c["enforcementVenues"] for c in index),
                    "certifiedVenues": sum(c["certifiedVenues"] for c in index),
                },
                "cities": index,
            },
            f,
            ensure_ascii=False,
            indent=1,
        )

    print(f"cities={len(index)}  venues={sum(c['venues'] for c in index)}  "
          f"scored={sum(c['scoredVenues'] for c in index)}  "
          f"enforcement={sum(c['enforcementVenues'] for c in index)}  "
          f"certified={sum(c['certifiedVenues'] for c in index)}  dupes_merged={total_dupes}  "
          f"non_venue_posts={skipped}")
    for c in index:
        geo = f"{c['venues']} venues" if c["hasGeo"] else f"{c['venues']} venues, NO gazetteer (distance off)"
        print(f"  {c['name']:12} {geo:44} {c['bytes']/1024:7.0f} KB")
    if all_merges:
        print(f"split venues re-merged ({len(all_merges)}):")
        for m in sorted(all_merges):
            print("   ", m)
    if stale:
        print("removed stale city files:", ", ".join(sorted(stale)))
    for city_name, keys in getattr(load_gazetteer, "dropped", []):
        print(f"IGNORED gazetteer entries in {city_name} that resolve to the city or a "
              f"district (they would swallow the area filter): {', '.join(keys)}")
    if unknown_cities:
        print("FSSAI rows skipped, city not in cities.json:",
              ", ".join(f"{k or '(blank)'}={v}" for k, v in unknown_cities.most_common()))
    print("wrote", OUT, "+ per-city files")


if __name__ == "__main__":
    main()
