#!/usr/bin/env python3
"""
Wrestling Magazine Backfill Downloader
======================================

Downloads missing pro-wrestling magazine PDFs from the Internet Archive
collection `wrestlingmagazinesmisc` and places them in the standardized
Magazines/{decade}s/{year}/{Magazine}/ folder structure.

Scope: Big-name canonical magazines, 1960-1989.

Usage:
  pip install internetarchive requests
  python3 download_wrestling_magazines.py [--dry-run] [--limit N] [--year 1980] [--mag "Pro Wrestling Illustrated"]

Notes:
  - Skips files that already exist in Drive (matched by mag/year/month).
  - Writes a log to download_log.csv next to this script.
  - Set MAGAZINES_ROOT below if your Drive path differs.
"""
import os, re, sys, json, csv, time, argparse, urllib.parse
from pathlib import Path
import requests

# ---- Configuration ---------------------------------------------------------
MAGAZINES_ROOT = Path(
    "/Users/jschairb-gwp/Library/CloudStorage/"
    "GoogleDrive-josh@greatwesternproductions.com/My Drive/"
    "BACKGROUND_RESEARCH/Magazines"
)
COLLECTION = "wrestlingmagazinesmisc"
START_YEAR, END_YEAR = 1960, 1989

LOG_PATH = Path(__file__).parent / "download_log.csv"

# Canonical magazine names (regex -> normalized name)
CANON = [
    ("Pro Wrestling Illustrated", re.compile(r"pro[\s_-]*wrestling[\s_-]*illustrated|(?:^|[^a-z])pwi(?:[^a-z]|$)", re.I)),
    ("Best of The Wrestler",      re.compile(r"best[\s_-]of[\s_-]the[\s_-]wrestler", re.I)),
    ("The Wrestler",              re.compile(r"(?:^|[^a-z])the[\s_-]wrestler(?:[\s_,:-]|$)", re.I)),
    ("Inside Wrestling",          re.compile(r"inside[\s_-]+wrestling", re.I)),
    ("Wrestling Revue",           re.compile(r"wrestling[\s_-]+revue", re.I)),
    ("Sports Review Wrestling",   re.compile(r"sports[\s_-]review[\s_-]wrestling|(?:^|[^a-z])srw(?:[^a-z]|$)", re.I)),
    ("Wrestling World",           re.compile(r"wrestling[\s_-]+world", re.I)),
    ("The Ring's Wrestling",      re.compile(r"(?:the[\s_-])?ring(?:[\s_-]?'?s)?[\s_-]wrestling", re.I)),
    ("Wrestling Today",           re.compile(r"wrestling[\s_-]+today", re.I)),
    ("Wrestling Eye",             re.compile(r"wrestling[\s_-]+eye", re.I)),
    ("WWF Magazine",              re.compile(r"wwf[\s_-]+magazine|wwf[\s_-]+mag", re.I)),
    ("Wrestling Monthly",         re.compile(r"wrestling[\s_-]+monthly", re.I)),
    ("Wrestling's Main Event",    re.compile(r"wrestling.?s?[\s_-]+main[\s_-]+event", re.I)),
    ("Wrestling Superstars",      re.compile(r"wrestling[\s_-]+superstars", re.I)),
    ("Wrestling All Stars",       re.compile(r"wrestling[\s_-]+all[\s_-]?stars", re.I)),
    ("Big Time Wrestling",        re.compile(r"big[\s_-]+time[\s_-]+wrestling", re.I)),
    ("Wrestling Confidential",    re.compile(r"wrestling[\s_-]+confidential", re.I)),
    ("Wrestling Illustrated",     re.compile(r"(?:^|[^-_a-z])wrestling[\s_-]+illustrated(?:[^a-z]|$)", re.I)),
    ("Wrestling Life",            re.compile(r"wrestling[\s_-]+life", re.I)),
    ("Official Wrestling",        re.compile(r"official[\s_-]+wrestling", re.I)),
    ("Wrestling Scene",           re.compile(r"wrestling[\s_-]+scene", re.I)),
    ("Wrestling Picture Book",    re.compile(r"wrestling[\s_-]+picture[\s_-]+book", re.I)),
    ("Big Book of Wrestling",     re.compile(r"big[\s_-]book[\s_-]of[\s_-]wrestling", re.I)),
    ("Wrestling Guide",           re.compile(r"wrestling[\s_-]+guide", re.I)),
    ("Wrestling Ringside",        re.compile(r"wrestling[\s_-]+ringside", re.I)),
    ("Ringside Wrestling",        re.compile(r"ringside[\s_-]wrestling", re.I)),
    ("GLOW",                      re.compile(r"\bglow\b", re.I)),
    ("WCW Magazine",              re.compile(r"wcw[\s_-]+magazine", re.I)),
    ("Wrestling Classics",        re.compile(r"wrestling[\s_-]+classics", re.I)),
    ("Wrestling Yearbook",        re.compile(r"wrestling[\s_-]+yearbook", re.I)),
    ("Victory Sports Wrestling",  re.compile(r"victory[\s_-]sports[\s_-](?:series[\s_-])?wrestl", re.I)),
    ("Championship Wrestling",    re.compile(r"championship[\s_-]wrestling[\s_-]+magazine", re.I)),
    ("Wrestling Fury",            re.compile(r"wrestling[\s_-]+fury", re.I)),
    ("Wrestling Power",           re.compile(r"wrestling[\s_-]+power", re.I)),
    ("Wrestling News",            re.compile(r"wrestling[\s_-]+news[\s_-]+magazine", re.I)),
]

MONTHS = {"jan":1,"feb":2,"mar":3,"apr":4,"may":5,"jun":6,"jul":7,"aug":8,"sep":9,"sept":9,"oct":10,"nov":11,"dec":12,
          "january":1,"february":2,"march":3,"april":4,"june":6,"july":7,"august":8,"september":9,"october":10,"november":11,"december":12}
MONTH_NAMES = {1:"January",2:"February",3:"March",4:"April",5:"May",6:"June",7:"July",8:"August",9:"September",10:"October",11:"November",12:"December"}

def norm(s: str) -> str:
    return re.sub(r"[\s\W]+", " ", (s or "")).lower().strip()

def magazine_of(text: str):
    t = (text or "").replace("_", " ")
    for name, rx in CANON:
        if rx.search(t):
            return name
    return None

def parse_year_month(ident: str, title: str, year_field):
    text = f"{ident} {title}"
    m = re.search(r"(?:^|[^0-9])(19[5-9]\d|20[0-2]\d)[-_\s](0?[1-9]|1[0-2])(?:[^0-9]|$)", text)
    if m:
        return int(m.group(1)), int(m.group(2))
    m2 = re.search(
        r"(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|"
        r"january|february|march|april|june|july|august|september|october|november|december)"
        r"[a-z\s,]*?(19\d\d|20\d\d)",
        (title or "").lower(),
    )
    if m2:
        return int(m2.group(2)), MONTHS[m2.group(1)]
    if year_field:
        return int(year_field), None
    return None, None

# ---- IA fetch --------------------------------------------------------------
def fetch_collection():
    """Pull all items in the IA collection via search API."""
    url = "https://archive.org/advancedsearch.php"
    params = {
        "q": f"collection:{COLLECTION}",
        "fl[]": ["identifier","title","date","year"],
        "rows": 5000,
        "page": 1,
        "output": "json",
    }
    r = requests.get(url, params=params, timeout=60)
    r.raise_for_status()
    return r.json()["response"]["docs"]

def fetch_metadata(ident: str):
    r = requests.get(f"https://archive.org/metadata/{ident}", timeout=30)
    r.raise_for_status()
    return r.json()

def pick_pdf(meta: dict):
    """Pick the main image-container PDF (skip _text.pdf which is OCR-only)."""
    files = meta.get("files", [])
    pdfs = [f for f in files if f["name"].lower().endswith(".pdf") and "_text" not in f["name"].lower()]
    if not pdfs:
        pdfs = [f for f in files if f["name"].lower().endswith(".pdf")]
    if not pdfs:
        return None
    # Prefer the largest (image container PDFs are bigger than additional text)
    pdfs.sort(key=lambda f: int(f.get("size", 0) or 0), reverse=True)
    return pdfs[0]

def download_url(meta: dict, file_name: str) -> str:
    server = meta.get("server")
    d = meta.get("dir")
    return f"https://{server}{d}/{urllib.parse.quote(file_name)}"

# ---- Drive scan ------------------------------------------------------------
def scan_existing(root: Path):
    """Return set of (norm_mag, year, month) keys already in Drive."""
    have = set()
    name_re = re.compile(r"(.+?) - (\d{4}) - (.+?)(?: \(\d+\))?\.pdf$")
    for decade in ("1960s","1970s","1980s"):
        d = root / decade
        if not d.exists(): continue
        for path in d.rglob("*.pdf"):
            m = name_re.match(path.name)
            if not m: continue
            mag, yr, month_str = m.group(1), int(m.group(2)), m.group(3).strip()
            mo = MONTHS.get(month_str.lower())
            if mo:
                have.add((norm(mag), yr, mo))
    return have

def target_path(root: Path, mag: str, year: int, month: int, month_label: str = None) -> Path:
    decade = f"{(year//10)*10}s"
    label = month_label or MONTH_NAMES[month]
    safe_mag = mag.replace("/", "-")
    return root / decade / str(year) / safe_mag / f"{safe_mag} - {year} - {label}.pdf"

# ---- Main ------------------------------------------------------------------
def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true", help="Don't actually download or write files")
    p.add_argument("--limit", type=int, default=0, help="Cap downloads in this run (0=all)")
    p.add_argument("--year", type=int, default=0, help="Only this year")
    p.add_argument("--mag", default="", help="Only this magazine name (substring match)")
    p.add_argument("--seasonal", action="store_true", help="Include seasonal/annual (no month) issues")
    args = p.parse_args()

    print(f"[scan] Reading existing files in {MAGAZINES_ROOT}")
    have = scan_existing(MAGAZINES_ROOT)
    print(f"[scan] Existing keyed files: {len(have)}")

    print(f"[ia] Fetching collection {COLLECTION}")
    docs = fetch_collection()
    print(f"[ia] Items in collection: {len(docs)}")

    candidates = []
    for d in docs:
        ident = d.get("identifier","")
        title = d.get("title","")
        yr_field = d.get("year")
        year, month = parse_year_month(ident, title, yr_field)
        if not year or year < START_YEAR or year > END_YEAR:
            continue
        mag = magazine_of(f"{ident} {title}")
        if not mag:
            continue
        if args.year and year != args.year:
            continue
        if args.mag and args.mag.lower() not in mag.lower():
            continue
        if not month and not args.seasonal:
            continue
        if month and (norm(mag), year, month) in have:
            continue
        candidates.append({"id": ident, "mag": mag, "year": year, "month": month, "title": title})

    print(f"[plan] Candidates to download: {len(candidates)}")
    if args.limit:
        candidates = candidates[: args.limit]
        print(f"[plan] Limited to {len(candidates)}")

    log_rows = []
    if not LOG_PATH.exists():
        with LOG_PATH.open("w", newline="") as f:
            csv.writer(f).writerow(["timestamp","ident","mag","year","month","status","target","url","size","error"])

    sess = requests.Session()
    for i, c in enumerate(candidates, 1):
        mag, yr, mo = c["mag"], c["year"], c["month"]
        # Determine month label (if seasonal use the title's seasonal word)
        label = None
        if not mo:
            ml = c["title"].lower()
            for k in ("spring","summer","fall","autumn","winter","annual","yearbook"):
                if k in ml:
                    label = k.capitalize(); break
            if not label: label = "Annual"
            mo_for_path = 13  # placeholder, won't collide with month numbers
        else:
            label = MONTH_NAMES[mo]; mo_for_path = mo
        tgt = target_path(MAGAZINES_ROOT, mag, yr, mo or 0, label)
        if tgt.exists():
            print(f"[{i}/{len(candidates)}] SKIP exists: {tgt.name}")
            log_rows.append([time.strftime("%FT%T"), c["id"], mag, yr, mo or "", "skip-exists", str(tgt), "", "", ""])
            continue
        try:
            meta = fetch_metadata(c["id"])
            pdf = pick_pdf(meta)
            if not pdf:
                print(f"[{i}/{len(candidates)}] no PDF on item {c['id']}")
                log_rows.append([time.strftime("%FT%T"), c["id"], mag, yr, mo or "", "no-pdf", "", "", "", ""])
                continue
            url = download_url(meta, pdf["name"])
            size_bytes = int(pdf.get("size", 0) or 0)
            print(f"[{i}/{len(candidates)}] {mag} {yr}-{mo or label} ({size_bytes/1e6:.1f} MB)")
            if args.dry_run:
                log_rows.append([time.strftime("%FT%T"), c["id"], mag, yr, mo or "", "dry-run", str(tgt), url, size_bytes, ""])
                continue
            tgt.parent.mkdir(parents=True, exist_ok=True)
            with sess.get(url, stream=True, timeout=120) as r:
                r.raise_for_status()
                tmp = tgt.with_suffix(".pdf.part")
                with tmp.open("wb") as f:
                    for chunk in r.iter_content(1 << 16):
                        if chunk: f.write(chunk)
                tmp.rename(tgt)
            log_rows.append([time.strftime("%FT%T"), c["id"], mag, yr, mo or "", "downloaded", str(tgt), url, size_bytes, ""])
        except Exception as e:
            print(f"[{i}/{len(candidates)}] ERROR {c['id']}: {e}")
            log_rows.append([time.strftime("%FT%T"), c["id"], mag, yr, mo or "", "error", str(tgt), "", "", str(e)])

        # flush log every 10 items
        if len(log_rows) >= 10:
            with LOG_PATH.open("a", newline="") as f:
                csv.writer(f).writerows(log_rows)
            log_rows = []

    if log_rows:
        with LOG_PATH.open("a", newline="") as f:
            csv.writer(f).writerows(log_rows)

    print(f"[done] Log: {LOG_PATH}")

if __name__ == "__main__":
    main()
