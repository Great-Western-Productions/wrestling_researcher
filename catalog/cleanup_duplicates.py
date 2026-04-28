#!/usr/bin/env python3
"""
Remove duplicate '(1).pdf' / '(2).pdf' copies in the Magazines library.
A duplicate is deleted only if the un-suffixed canonical file exists in the
same folder AND has the same byte size (sanity check). Logs every action.

Usage:
  python3 cleanup_duplicates.py --dry-run   # see what would be removed
  python3 cleanup_duplicates.py             # actually delete
"""
import re, argparse, csv, time
from pathlib import Path

MAGAZINES_ROOT = Path(
    "/Users/jschairb-gwp/Library/CloudStorage/"
    "GoogleDrive-josh@greatwesternproductions.com/My Drive/"
    "BACKGROUND_RESEARCH/Magazines"
)
LOG_PATH = Path(__file__).parent / "cleanup_log.csv"
DUPE_RE = re.compile(r"^(.+) \((\d+)\)\.pdf$", re.IGNORECASE)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    rows = [["timestamp","action","duplicate","canonical","size_dup","size_canonical","note"]]
    for path in MAGAZINES_ROOT.rglob("*.pdf"):
        m = DUPE_RE.match(path.name)
        if not m:
            continue
        canonical_name = m.group(1) + ".pdf"
        canonical = path.with_name(canonical_name)
        if not canonical.exists():
            rows.append([time.strftime("%FT%T"),"keep-no-canonical",str(path),"", path.stat().st_size,"","canonical missing"])
            continue
        size_dup = path.stat().st_size
        size_can = canonical.stat().st_size
        if size_dup != size_can:
            rows.append([time.strftime("%FT%T"),"keep-size-mismatch",str(path),str(canonical),size_dup,size_can,"size differs - inspect manually"])
            continue
        if args.dry_run:
            rows.append([time.strftime("%FT%T"),"would-delete",str(path),str(canonical),size_dup,size_can,""])
            print(f"[dry-run] would delete {path.name}")
        else:
            path.unlink()
            rows.append([time.strftime("%FT%T"),"deleted",str(path),str(canonical),size_dup,size_can,""])
            print(f"deleted {path.name}")

    with LOG_PATH.open("w", newline="") as f:
        csv.writer(f).writerows(rows)
    actions = {}
    for r in rows[1:]:
        actions[r[1]] = actions.get(r[1],0)+1
    print(f"\nSummary: {actions}\nLog: {LOG_PATH}")

if __name__ == "__main__":
    main()
