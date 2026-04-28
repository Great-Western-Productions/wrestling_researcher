#!/usr/bin/env python3
"""
Scan the Magazines library and produce a Catalog CSV ready to paste into
the 'Periodical Catalog' Google Sheet (new tab).

Columns match the existing Catalog sheet:
    Filename | Publication | Issue | Publication Date | Date Added to Catalog | What's on the Cover | Folder Path

Usage:
  python3 build_catalog.py
"""
import re, csv, datetime
from pathlib import Path

MAGAZINES_ROOT = Path(
    "/Users/jschairb-gwp/Library/CloudStorage/"
    "GoogleDrive-josh@greatwesternproductions.com/My Drive/"
    "BACKGROUND_RESEARCH/Magazines"
)
OUT = Path(__file__).parent / "catalog_full.csv"

NAME_RE = re.compile(r"(.+?) - (\d{4}) - (.+?)(?: \(\d+\))?\.pdf$")
MONTHS_NUM = {"January":"01","February":"02","March":"03","April":"04","May":"05","June":"06",
              "July":"07","August":"08","September":"09","October":"10","November":"11","December":"12"}

def main():
    rows = []
    today = datetime.date.today().isoformat()
    for path in sorted(MAGAZINES_ROOT.rglob("*.pdf")):
        rel = path.relative_to(MAGAZINES_ROOT)
        # skip top-level NATIONAL_GEOGRAPHIC
        if rel.parts[0] == "NATIONAL_GEOGRAPHIC":
            continue
        folder_path = "/".join(rel.parts[:-1])
        m = NAME_RE.match(path.name)
        if m:
            mag, yr, label = m.group(1), m.group(2), m.group(3).strip()
            issue = f"{label} {yr}"
            month_num = MONTHS_NUM.get(label, "")
            pub_date = f"{yr}-{month_num}-01" if month_num else f"{yr} ({label})"
        else:
            mag = ""
            issue = path.stem
            pub_date = ""
        rows.append([path.name, mag, issue, pub_date, today, "", folder_path])

    with OUT.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Filename","Publication","Issue","Publication Date","Date Added to Catalog","What's on the Cover","Folder Path"])
        w.writerows(rows)
    print(f"Wrote {len(rows)} rows to {OUT}")
    print("Open the CSV in your sheet via File → Import → Upload, or copy-paste contents into a new tab.")

if __name__ == "__main__":
    main()
