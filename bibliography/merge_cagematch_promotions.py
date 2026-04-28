#!/usr/bin/env python3
"""
Merge cagematch_us_promotions.tsv into the territories table.

For each row:
  - Parse start_year/end_year from cagematch's 'years' field (handles "1948-",
    "1992-2001", "xx.11.1957-xx.09.1972", "1956-19xx", etc.)
  - If a territory with the same name already exists, update only its
    cagematch_id (don't overwrite curated metadata).
  - Otherwise, insert a new territory row with cagematch_id, name, country,
    headquarters_city/state (parsed from location), year_founded, year_closed.

Idempotent: re-running won't duplicate rows (cagematch_id is the dedupe key).
"""
import sqlite3
import os
import re
import csv

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wrestling_bibliography.db")

_TSV_CANDIDATES = [
    "/Users/jschairb-gwp/Documents/Claude/Projects/ProWrestling Researcher/bibliography/cagematch_us_promotions.tsv",
    "/sessions/happy-gracious-cannon/mnt/ProWrestling Researcher/bibliography/cagematch_us_promotions.tsv",
]
TSV_PATH = next((p for p in _TSV_CANDIDATES if os.path.exists(p)), _TSV_CANDIDATES[0])

def parse_years(s):
    """Return (start_year_int_or_none, end_year_int_or_none).
    Examples handled:
      '1948-'                 -> (1948, None)
      '1992-2001'             -> (1992, 2001)
      'xx.11.1957-xx.09.1972' -> (1957, 1972)
      '1956-19xx'             -> (1956, None)   # 19xx is vague decade
      '1912-25.11.1956'       -> (1912, 1956)
      '1929-197x'             -> (1929, None)
      '1900-'                 -> (1900, None)
    """
    if not s:
        return None, None
    parts = s.split('-', 1)
    left = parts[0] if parts else ''
    right = parts[1] if len(parts) == 2 else ''

    def first_full_year(text):
        m = re.search(r'\b(19|20)\d{2}\b', text)
        return int(m.group(0)) if m else None

    return first_full_year(left), first_full_year(right)

def parse_location(loc):
    """'Memphis, Tennessee, USA' -> ('Memphis', 'TN', 'US').
    'Puerto Rico, USA'           -> (None, None, 'PR').
    'USA'                         -> (None, None, 'US').
    'Tennessee, USA'              -> (None, 'TN', 'US').
    """
    STATE_TO_ABBREV = {
        "Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA",
        "Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA",
        "Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS",
        "Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD","Massachusetts":"MA",
        "Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO","Montana":"MT",
        "Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM",
        "New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK",
        "Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC",
        "South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT",
        "Virginia":"VA","Washington":"WA","West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY",
    }
    parts = [p.strip() for p in loc.split(',')]
    if not parts:
        return None, None, 'US'
    last = parts[-1]
    country = 'US'
    if 'Puerto Rico' in loc:
        country = 'PR'
    if len(parts) == 1:
        return None, None, country
    if len(parts) == 2:
        # 'Tennessee, USA' or 'Puerto Rico, USA'
        if parts[0] == 'Puerto Rico':
            return None, None, 'PR'
        return None, STATE_TO_ABBREV.get(parts[0]), country
    if len(parts) >= 3:
        # 'Memphis, Tennessee, USA' or 'San Juan, Puerto Rico, USA'
        if parts[1] == 'Puerto Rico':
            return parts[0], None, 'PR'
        return parts[0], STATE_TO_ABBREV.get(parts[1]), country
    return None, None, country

def main():
    rows = []
    with open(TSV_PATH, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f, delimiter='\t')
        for r in reader:
            rows.append(r)
    print(f"Loaded {len(rows)} rows from TSV")
    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    # Pre-load existing territories by lowercase name for matching
    cur.execute("SELECT id, name FROM territories")
    existing = {name.lower(): tid for tid, name in cur.fetchall()}

    # Manual aliases — existing curated names that don't match cagematch verbatim
    ALIASES = {
        # existing curated name (lowercased) -> cagematch_id (string)
        "mid-south wrestling": "64",                 # cagematch's UWF/Watts territory entry
        "world class championship wrestling": "62",  # cagematch's "World Class Wrestling Association"
        "big time wrestling (dallas)": "62",         # same lineage as above; both flow into one cm row
    }
    for ex_name_lc, cm_id in ALIASES.items():
        tid = existing.get(ex_name_lc)
        if tid:
            cur.execute("UPDATE territories SET cagematch_id = ? WHERE id = ? AND (cagematch_id IS NULL OR cagematch_id = '')",
                        (cm_id, tid))

    matched_existing = 0
    inserted_new = 0
    skipped = 0

    for r in rows:
        cm_id = r['cmId']
        name = r['name'].strip()
        loc = r['location'].strip()
        years = r['years'].strip()
        start_y, end_y = parse_years(years)
        city, state, country = parse_location(loc)

        # Already known cagematch_id?
        cur.execute("SELECT id FROM territories WHERE cagematch_id = ?", (cm_id,))
        if cur.fetchone():
            skipped += 1
            continue

        # Match by exact name
        tid = existing.get(name.lower())
        if tid:
            cur.execute("UPDATE territories SET cagematch_id = ? WHERE id = ?", (cm_id, tid))
            matched_existing += 1
            continue

        # New row — handle UNIQUE(name) conflicts by disambiguating with city/state
        insert_name = name
        cur.execute("SELECT 1 FROM territories WHERE name = ?", (insert_name,))
        if cur.fetchone():
            disambig = city or state or "?"
            insert_name = f"{name} ({disambig})"
            # If still conflicting, add cmId
            cur.execute("SELECT 1 FROM territories WHERE name = ?", (insert_name,))
            if cur.fetchone():
                insert_name = f"{name} (cm{cm_id})"
        cur.execute("""
            INSERT INTO territories
            (name, cagematch_id, country, headquarters_city, headquarters_state,
             year_founded, year_closed, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (insert_name, cm_id, country, city, state, start_y, end_y,
              f"Imported from cagematch.net (cmId {cm_id}). Cagematch name: {name!r}. Years string: {years!r}."))
        inserted_new += 1

    conn.commit()

    cur.execute("SELECT COUNT(*) FROM territories")
    total = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM territories WHERE cagematch_id IS NOT NULL")
    with_cm = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM territories WHERE country = 'PR'")
    pr = cur.fetchone()[0]

    print(f"\n=== Merge results ===")
    print(f"  Matched existing territories (set cagematch_id): {matched_existing}")
    print(f"  Inserted new territories:                        {inserted_new}")
    print(f"  Skipped (cagematch_id already present):          {skipped}")
    print(f"  Total territories now:                           {total}")
    print(f"    with cagematch_id:                             {with_cm}")
    print(f"    country = PR (Puerto Rico):                    {pr}")

    # Sanity check: which existing territories still have no cagematch_id?
    cur.execute("SELECT name FROM territories WHERE cagematch_id IS NULL ORDER BY name")
    unmatched = [r[0] for r in cur.fetchall()]
    print(f"\n  Existing territories without cagematch_id ({len(unmatched)}):")
    for n in unmatched:
        print(f"    - {n}")

    conn.close()
if __name__ == "__main__":
    main()
