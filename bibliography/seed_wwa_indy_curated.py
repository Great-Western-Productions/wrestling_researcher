#!/usr/bin/env python3
"""
Seed the eight wrestlers cagematch lists on the All-Time Roster page for the
Indianapolis WWA (cmId 103).

Source: https://www.cagematch.net/?id=8&nr=103&page=16  (All-Time Roster)
This is cagematch's curated/manual roster — the safe well. Wrestlers who
appeared in WWA Indy events but aren't tagged to the promotion are not
imported here; those need explicit signoff before being added.

The 8 wrestlers, with cmId / appearance-year ranges from the matched event
data we scraped earlier:

  1. Bounty Hunter #2   cm18430   1972-1987   (masked, never-revealed)
  2. Dick The Bruiser   cm 1149   1964-1987   (co-owner)
  3. El Bracero         cm21615   1972-1987
  4. Farmer Luke         no cm    1987 only   (single documented show)
  5. Golden Lion         no cm    1987 only
  6. Moose Cholak       cm  942   1964-1987
  7. Shotgun Willie      no cm    1987 only
  8. Strangler          cm 1616   1987 only

Idempotent.
"""
import sqlite3, os, shutil, tempfile

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wrestling_bibliography.db")

ROSTER = [
    # (primary_ring_name, cagematch_id_or_None, start_year, end_year, role, notes)
    ("Bounty Hunter #2",  "18430", 1972, 1987, "mid",
     "Masked Indianapolis WWA tag-team character; identity not publicly revealed. Appeared on the 1987-08-08 Bucyrus card among others."),
    ("Dick The Bruiser",  "1149",  1964, 1987, "top",
     "WWA Indianapolis co-owner with Wilbur Snyder. Real name William Afflis."),
    ("El Bracero",        "21615", 1972, 1987, "mid",
     "WWA Indianapolis longtime undercard worker. [VERIFY] real name and whether identical to other 'El Bracero' lucha workers."),
    ("Farmer Luke",       None,    1987, 1987, "mid",
     "WWA Indianapolis 1987 appearance (Bucyrus card). No cagematch profile. [VERIFY] full name."),
    ("Golden Lion",       None,    1987, 1987, "mid",
     "WWA Indianapolis 1987 appearance (Bucyrus card). No cagematch profile. [VERIFY] identity."),
    ("Moose Cholak",      "942",   1964, 1987, "upper-mid",
     "WWA Indianapolis fixture across the territory's full run. Real name Edward Cholak; the Moose head was the gimmick."),
    ("Shotgun Willie",    None,    1987, 1987, "mid",
     "WWA Indianapolis 1987 appearance. No cagematch profile. [VERIFY] identity."),
    ("Strangler",         "1616",  1987, 1987, "mid",
     "WWA Indianapolis 1987-08-08 single documented appearance. [VERIFY] which 'Strangler' — many wrestlers used the name."),
]

def find_or_create_wrestler(cur, name, cm_id):
    if cm_id:
        cur.execute("SELECT id FROM wrestlers WHERE cagematch_id = ?", (cm_id,))
        row = cur.fetchone()
        if row:
            return row[0], 'matched_cm'
    cur.execute("SELECT id FROM wrestlers WHERE LOWER(primary_ring_name) = LOWER(?)", (name,))
    row = cur.fetchone()
    if row:
        if cm_id:
            cur.execute("UPDATE wrestlers SET cagematch_id = ? WHERE id = ?", (cm_id, row[0]))
        return row[0], 'matched_name'
    cur.execute("""
        INSERT INTO wrestlers (primary_ring_name, primary_role, cagematch_id, notes)
        VALUES (?, 'wrestler', ?, ?)
    """, (name, cm_id, "Imported from WWA Indianapolis All-Time Roster (cagematch curated). Pending bio fill-in."))
    return cur.lastrowid, 'inserted'

def main():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    cur.execute("SELECT id FROM territories WHERE cagematch_id = '103'")
    row = cur.fetchone()
    if not row:
        raise SystemExit("WWA Indy territory (cagematch_id=103) not found")
    wwa_id = row[0]
    print(f"WWA Indy territory id = {wwa_id}")

    counts = {'matched_cm': 0, 'matched_name': 0, 'inserted': 0, 'runs_added': 0, 'runs_skipped': 0}
    for name, cm_id, sy, ey, role, notes in ROSTER:
        wid, kind = find_or_create_wrestler(cur, name, cm_id)
        counts[kind] += 1

        # Insert run if not already present
        cur.execute("""
            SELECT id FROM wrestler_territory_runs
            WHERE wrestler_id = ? AND territory_id = ? AND start_year = ? AND end_year = ?
        """, (wid, wwa_id, sy, ey))
        if cur.fetchone():
            counts['runs_skipped'] += 1
            continue
        cur.execute("""
            INSERT INTO wrestler_territory_runs
            (wrestler_id, territory_id, start_year, end_year, role_during_run, primary_run, notes)
            VALUES (?, ?, ?, ?, ?, 1, ?)
        """, (wid, wwa_id, sy, ey, role, notes))
        counts['runs_added'] += 1

    conn.commit()

    cur.execute("SELECT COUNT(*) FROM wrestlers")
    total_w = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM wrestler_territory_runs WHERE territory_id = ?", (wwa_id,))
    wwa_r = cur.fetchone()[0]

    print()
    print(f"Matched by cagematch_id: {counts['matched_cm']}")
    print(f"Matched by name:         {counts['matched_name']}")
    print(f"Inserted new wrestlers:  {counts['inserted']}")
    print(f"Runs added:              {counts['runs_added']}")
    print(f"Runs skipped:            {counts['runs_skipped']}")
    print()
    print(f"Total wrestlers now: {total_w}")
    print(f"WWA Indy runs now:   {wwa_r}")

    print("\n=== WWA Indy roster (curated 8) ===")
    cur.execute("""
        SELECT w.primary_ring_name, w.cagematch_id, r.start_year, r.end_year, r.role_during_run
        FROM wrestlers w JOIN wrestler_territory_runs r ON r.wrestler_id = w.id
        WHERE r.territory_id = ?
        ORDER BY w.primary_ring_name
    """, (wwa_id,))
    for n, cm, sy, ey, role in cur.fetchall():
        cm_str = f"cm{cm}" if cm else "no cm"
        print(f"  ({sy}-{ey})  {role or '?':<10}  {cm_str:<8}  {n}")

    conn.close()
if __name__ == "__main__":
    main()
