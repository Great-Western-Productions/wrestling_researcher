#!/usr/bin/env python3
"""
Ingest the cagematch WWA Indianapolis roster into the wrestlers and
wrestler_territory_runs tables.

What this does:
  1. Adds `cagematch_id` column to the wrestlers table if not present.
  2. For each row in cagematch_wwa_roster.tsv:
     - If a wrestler with the same cagematch_id exists -> reuse.
     - If a wrestler with the same primary_ring_name exists -> link cagematch_id.
     - Otherwise -> insert a new wrestler row (primary_role='wrestler',
       midcard_files_status NULL, low metadata, marked as imported).
  3. Inserts a `wrestler_territory_runs` row linking each wrestler to the WWA
     (territory id matched by cagematch_id 103) with start_year/end_year from
     the first/last cagematch-documented appearance.

Idempotent: re-running won't duplicate runs (matched on wrestler_id +
territory_id + start_year + end_year).
"""
import sqlite3
import os
import csv
import re

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wrestling_bibliography.db")

_TSV_CANDIDATES = [
    "/Users/jschairb-gwp/Documents/Claude/Projects/ProWrestling Researcher/bibliography/cagematch_wwa_roster.tsv",
    "/sessions/happy-gracious-cannon/mnt/ProWrestling Researcher/bibliography/cagematch_wwa_roster.tsv",
]
TSV_PATH = next((p for p in _TSV_CANDIDATES if os.path.exists(p)), _TSV_CANDIDATES[0])

CAGEMATCH_PROMOTION_ID = "103"  # WWA Indianapolis

def col_exists(cur, table, col):
    cur.execute(f"PRAGMA table_info({table})")
    return any(r[1] == col for r in cur.fetchall())

def ensure_schema(cur):
    """Add cagematch_id column to wrestlers if it doesn't exist yet."""
    if not col_exists(cur, "wrestlers", "cagematch_id"):
        cur.execute("ALTER TABLE wrestlers ADD COLUMN cagematch_id TEXT")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_wrestlers_cm ON wrestlers(cagematch_id)")
        return True
    return False

def find_or_create_wrestler(cur, cm_id, name):
    """Return wrestler.id. Create if not present."""
    # Match by cagematch_id first
    cur.execute("SELECT id FROM wrestlers WHERE cagematch_id = ?", (cm_id,))
    row = cur.fetchone()
    if row:
        return row[0], 'matched_cm'

    # Match by ring name (case-insensitive)
    cur.execute("SELECT id, cagematch_id FROM wrestlers WHERE LOWER(primary_ring_name) = LOWER(?)", (name,))
    row = cur.fetchone()
    if row:
        wid, existing_cm = row
        if not existing_cm:
            cur.execute("UPDATE wrestlers SET cagematch_id = ? WHERE id = ?", (cm_id, wid))
        return wid, 'matched_name'

    # New wrestler row
    _tag_pat = r"\b(Brothers|Twins|Boys|Gang|Duo|Squad|Kangaroos|Blackjacks|Hunters|Volkoffs|Hillbillies|Vachons|Dolls|Graduates|Legionnaires|Mongols|Three Rivers|Annihilation)\b"
    is_tag_team_alias = bool(re.search(_tag_pat, name, re.IGNORECASE))
    primary_role = 'tag_team' if is_tag_team_alias else 'wrestler'
    cur.execute("""
        INSERT INTO wrestlers (primary_ring_name, primary_role, cagematch_id, notes)
        VALUES (?, ?, ?, ?)
    """, (name, primary_role, cm_id,
          f"Imported from cagematch.net WWA roster (cmId {cm_id}). Metadata sparse — verify before publishing."))
    return cur.lastrowid, 'inserted'

def insert_run(cur, wrestler_id, territory_id, start_year, end_year, notes):
    cur.execute("""
        SELECT id FROM wrestler_territory_runs
        WHERE wrestler_id = ? AND territory_id = ? AND start_year = ? AND end_year = ?
    """, (wrestler_id, territory_id, start_year, end_year))
    if cur.fetchone():
        return False
    cur.execute("""
        INSERT INTO wrestler_territory_runs
        (wrestler_id, territory_id, start_year, end_year, role_during_run, notes)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (wrestler_id, territory_id, start_year, end_year, None, notes))
    return True

def main():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    schema_changed = ensure_schema(cur)
    if schema_changed:
        print("Added cagematch_id column to wrestlers")

    # WWA territory id
    cur.execute("SELECT id FROM territories WHERE cagematch_id = ?", (CAGEMATCH_PROMOTION_ID,))
    row = cur.fetchone()
    if not row:
        raise SystemExit(f"WWA territory not found by cagematch_id={CAGEMATCH_PROMOTION_ID}")
    wwa_id = row[0]
    print(f"WWA territory id = {wwa_id}")

    # Ingest TSV
    counts = {'matched_cm': 0, 'matched_name': 0, 'inserted': 0, 'runs_added': 0, 'runs_skipped': 0}
    with open(TSV_PATH, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f, delimiter='\t')
        for r in reader:
            cm_id = r['cmId'].strip()
            name = r['name'].strip()
            count = int(r['matchCount'])
            first_y = int(r['firstDate'][:4])
            last_y = int(r['lastDate'][:4])

            wid, kind = find_or_create_wrestler(cur, cm_id, name)
            counts[kind] += 1

            note = f"{count} cagematch-documented appearances {r['firstDate']} through {r['lastDate']}."
            inserted = insert_run(cur, wid, wwa_id, first_y, last_y, note)
            counts['runs_added' if inserted else 'runs_skipped'] += 1

    conn.commit()

    # Final stats
    cur.execute("SELECT COUNT(*) FROM wrestlers")
    total_w = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM wrestlers WHERE cagematch_id IS NOT NULL")
    cm_w = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM wrestler_territory_runs")
    total_r = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM wrestler_territory_runs WHERE territory_id = ?", (wwa_id,))
    wwa_r = cur.fetchone()[0]

    print(f"\n=== Ingest results ===")
    print(f"  Matched existing by cagematch_id: {counts['matched_cm']}")
    print(f"  Matched existing by name:         {counts['matched_name']}")
    print(f"  Inserted new wrestlers:           {counts['inserted']}")
    print(f"  WWA runs added:                   {counts['runs_added']}")
    print(f"  WWA runs skipped (existed):       {counts['runs_skipped']}")
    print()
    print(f"  Total wrestlers now:              {total_w}")
    print(f"    with cagematch_id:              {cm_w}")
    print(f"  Total runs now:                   {total_r}")
    print(f"  WWA runs:                         {wwa_r}")

    # Top WWA hands now in DB
    print(f"\n=== Top 15 WWA hands by appearance count (in DB) ===")
    cur.execute("""
        SELECT w.primary_ring_name, w.cagematch_id, r.start_year, r.end_year, r.notes
        FROM wrestlers w
        JOIN wrestler_territory_runs r ON r.wrestler_id = w.id
        WHERE r.territory_id = ?
        ORDER BY CAST(SUBSTR(r.notes, 1, INSTR(r.notes, ' cagematch') - 1) AS INTEGER) DESC
        LIMIT 15
    """, (wwa_id,))
    for n, cm, sy, ey, notes in cur.fetchall():
        c = notes.split()[0]
        print(f"  cm{cm:>5}  {sy}-{ey}  {c:>4} appearances  {n}")

    conn.close()
if __name__ == "__main__":
    main()
