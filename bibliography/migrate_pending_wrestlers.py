#!/usr/bin/env python3
"""
migrate_pending_wrestlers.py

Adds a staging table for ranking-entry names that don't resolve to the
curated `wrestlers` table. Lets us avoid creating duplicate stub rows in
the curated table while still tracking who PWI ranks across decades.

Dedupe key: ProFightDB wrestler id (extracted from issue-page wrestler links).
Falls back to normalized_name when no PFDB link exists.

Promotion path: insert a real row into `wrestlers`, set
`pending_wrestlers.resolved_wrestler_id`, then backfill ranking_entries.

Idempotent.

Run: python3 migrate_pending_wrestlers.py
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "wrestling_bibliography.db"

DDL = """
CREATE TABLE IF NOT EXISTS pending_wrestlers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profightdb_id INTEGER UNIQUE,                 -- e.g. 138 for Ric Flair
    profightdb_slug TEXT,                          -- 'ric-flair-138'
    printed_name TEXT NOT NULL,                    -- canonical display
    normalized_name TEXT NOT NULL,                 -- lower/accent-folded
    other_printed_names TEXT,                      -- '|'-separated alt spellings
    first_seen_date TEXT,                          -- earliest publication_date seen
    last_seen_date TEXT,                           -- latest publication_date seen
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    resolved_wrestler_id INTEGER REFERENCES wrestlers(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_pending_wrestlers_pfdb ON pending_wrestlers(profightdb_id);
CREATE INDEX IF NOT EXISTS idx_pending_wrestlers_resolved ON pending_wrestlers(resolved_wrestler_id);
CREATE INDEX IF NOT EXISTS idx_pending_wrestlers_count ON pending_wrestlers(occurrence_count);

DROP VIEW IF EXISTS v_pending_wrestlers_queue;
CREATE VIEW v_pending_wrestlers_queue AS
SELECT
    pw.id,
    pw.profightdb_id,
    pw.profightdb_slug,
    pw.printed_name,
    pw.other_printed_names,
    pw.occurrence_count,
    pw.first_seen_date,
    pw.last_seen_date,
    pw.resolved_wrestler_id,
    w.primary_ring_name AS resolved_name,
    CASE WHEN pw.resolved_wrestler_id IS NOT NULL THEN 1 ELSE 0 END AS merged
FROM pending_wrestlers pw
LEFT JOIN wrestlers w ON pw.resolved_wrestler_id = w.id;
"""

# ranking_entries.pending_wrestler_id needs an ALTER if missing
ADD_COLUMN_SQL = (
    "ALTER TABLE ranking_entries ADD COLUMN "
    "pending_wrestler_id INTEGER REFERENCES pending_wrestlers(id) ON DELETE SET NULL"
)
ADD_INDEX_SQL = (
    "CREATE INDEX IF NOT EXISTS idx_ranking_entries_pending "
    "ON ranking_entries(pending_wrestler_id)"
)


def column_exists(cur, table: str, column: str) -> bool:
    for row in cur.execute(f"PRAGMA table_info({table})"):
        if row[1] == column:
            return True
    return False


def main():
    if not DB_PATH.exists():
        raise SystemExit(f"DB not found at {DB_PATH}")
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA foreign_keys = ON")
    cur = conn.cursor()
    cur.executescript(DDL)
    if not column_exists(cur, "ranking_entries", "pending_wrestler_id"):
        cur.execute(ADD_COLUMN_SQL)
    cur.execute(ADD_INDEX_SQL)
    conn.commit()

    print("Migration applied.")
    print("\nSchema for pending_wrestlers:")
    for r in cur.execute("PRAGMA table_info(pending_wrestlers)"):
        print(f"  {r}")
    print("\nranking_entries columns:")
    for r in cur.execute("PRAGMA table_info(ranking_entries)"):
        print(f"  {r[1]}")
    print("\nViews:")
    for (n,) in cur.execute("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name"):
        print(f"  {n}")
    conn.close()


if __name__ == "__main__":
    main()
