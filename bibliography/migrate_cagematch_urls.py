#!/usr/bin/env python3
"""
Add VIRTUAL GENERATED `cagematch_url` columns to the territories and wrestlers
tables. The URL is computed from `cagematch_id` whenever it's read — no storage,
no risk of drift if cagematch_id changes.

URL patterns:
  Promotions: https://www.cagematch.net/?id=8&nr={cagematch_id}
  Wrestlers:  https://www.cagematch.net/?id=2&nr={cagematch_id}

Idempotent. Safe to re-run.
"""
import sqlite3
import os
DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wrestling_bibliography.db")

def col_exists(cur, table, col):
    cur.execute(f"PRAGMA table_info({table})")
    return any(r[1] == col for r in cur.fetchall())

def main():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    # Verify SQLite version supports generated columns (>= 3.31)
    cur.execute("SELECT sqlite_version()")
    ver = cur.fetchone()[0]
    parts = [int(p) for p in ver.split('.')]
    if parts < [3, 31, 0]:
        raise SystemExit(f"SQLite {ver} doesn't support generated columns (need >= 3.31)")
    print(f"SQLite version {ver} — generated columns supported")

    # Territories: id=8 in cagematch URL scheme
    if not col_exists(cur, "territories", "cagematch_url"):
        cur.execute("""
            ALTER TABLE territories
            ADD COLUMN cagematch_url TEXT
            GENERATED ALWAYS AS (
                CASE WHEN cagematch_id IS NOT NULL AND cagematch_id != ''
                     THEN 'https://www.cagematch.net/?id=8&nr=' || cagematch_id
                     ELSE NULL END
            ) VIRTUAL
        """)
        print("Added territories.cagematch_url (VIRTUAL generated)")
    else:
        print("territories.cagematch_url already exists — skipped")

    # Wrestlers: id=2 in cagematch URL scheme
    if not col_exists(cur, "wrestlers", "cagematch_url"):
        cur.execute("""
            ALTER TABLE wrestlers
            ADD COLUMN cagematch_url TEXT
            GENERATED ALWAYS AS (
                CASE WHEN cagematch_id IS NOT NULL AND cagematch_id != ''
                     THEN 'https://www.cagematch.net/?id=2&nr=' || cagematch_id
                     ELSE NULL END
            ) VIRTUAL
        """)
        print("Added wrestlers.cagematch_url (VIRTUAL generated)")
    else:
        print("wrestlers.cagematch_url already exists — skipped")

    conn.commit()

    # Verify
    print()
    print("=== Sample territories ===")
    cur.execute("""
        SELECT name, cagematch_id, cagematch_url
        FROM territories
        WHERE cagematch_id IS NOT NULL
        ORDER BY name
        LIMIT 5
    """)
    for r in cur.fetchall():
        print(f"  {r[0][:40]:<40}  cm{r[1]:>5}  {r[2]}")

    print()
    print("=== Sample wrestlers ===")
    cur.execute("""
        SELECT primary_ring_name, cagematch_id, cagematch_url
        FROM wrestlers
        WHERE cagematch_id IS NOT NULL
        ORDER BY primary_ring_name
        LIMIT 5
    """)
    for r in cur.fetchall():
        print(f"  {r[0][:40]:<40}  cm{r[1]:>5}  {r[2]}")

    print()
    cur.execute("SELECT COUNT(*) FROM territories WHERE cagematch_url IS NOT NULL")
    t_count = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM wrestlers WHERE cagematch_url IS NOT NULL")
    w_count = cur.fetchone()[0]
    print(f"Territories with cagematch_url: {t_count}")
    print(f"Wrestlers with cagematch_url:   {w_count}")

    conn.close()
if __name__ == "__main__":
    main()
