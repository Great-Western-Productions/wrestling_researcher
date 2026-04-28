#!/usr/bin/env python3
"""
Add cagematch_id, country, aliases columns to territories table.
Backfill country='US' for existing entries that don't have it.
Idempotent.
"""
import sqlite3, os, shutil, tempfile

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wrestling_bibliography.db")

def col_exists(cur, table, col):
    cur.execute(f"PRAGMA table_info({table})")
    return any(r[1] == col for r in cur.fetchall())

def main():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    if not col_exists(cur, "territories", "cagematch_id"):
        cur.execute("ALTER TABLE territories ADD COLUMN cagematch_id TEXT")
    if not col_exists(cur, "territories", "country"):
        cur.execute("ALTER TABLE territories ADD COLUMN country TEXT")
    if not col_exists(cur, "territories", "aliases"):
        cur.execute("ALTER TABLE territories ADD COLUMN aliases TEXT")

    cur.execute("CREATE INDEX IF NOT EXISTS idx_territories_cm ON territories(cagematch_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_territories_country ON territories(country)")

    # Backfill country=US for the existing seeded territories. WWC = Puerto Rico.
    cur.execute("""
        UPDATE territories
        SET country = CASE
            WHEN name = 'World Wrestling Council'        THEN 'PR'
            WHEN name = 'Stampede Wrestling'             THEN 'CA'
            ELSE 'US'
        END
        WHERE country IS NULL OR country = ''
    """)
    conn.commit()

    cur.execute("SELECT country, COUNT(*) FROM territories GROUP BY country")
    print("territories.country backfill:", dict(cur.fetchall()))
    conn.close()
    print("Migration complete.")

if __name__ == "__main__":
    main()
