#!/usr/bin/env python3
"""
Add wrestlers / territories / wrestler_territory_runs tables to the existing
wrestling_bibliography.db. Idempotent — safe to re-run.

"""
import sqlite3
import os
import sys

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wrestling_bibliography.db")
SCHEMA = """
CREATE TABLE IF NOT EXISTS territories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    short_name TEXT,
    region TEXT,
    nwa_member INTEGER DEFAULT 0,
    headquarters_city TEXT,
    headquarters_state TEXT,
    year_founded INTEGER,
    year_closed INTEGER,
    promoter_lineage TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wrestlers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    legal_name TEXT,
    primary_ring_name TEXT NOT NULL,
    other_ring_names TEXT,
    born_date TEXT,
    died_date TEXT,
    living INTEGER,
    debut_year INTEGER,
    retired_year INTEGER,
    primary_role TEXT,
    hometown_billed TEXT,
    hometown_real TEXT,
    finisher TEXT,
    style TEXT,
    socials TEXT,
    convention_status TEXT,
    last_known_appearance TEXT,
    footage_notes TEXT,
    midcard_files_status TEXT,
    midcard_files_priority INTEGER,
    why_they_mattered TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wrestler_territory_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wrestler_id INTEGER NOT NULL,
    territory_id INTEGER NOT NULL,
    start_year INTEGER,
    start_month INTEGER,
    end_year INTEGER,
    end_month INTEGER,
    role_during_run TEXT,
    ring_name_during_run TEXT,
    primary_run INTEGER DEFAULT 0,
    notes TEXT,
    FOREIGN KEY (wrestler_id) REFERENCES wrestlers(id) ON DELETE CASCADE,
    FOREIGN KEY (territory_id) REFERENCES territories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wt_runs_wrestler ON wrestler_territory_runs(wrestler_id);
CREATE INDEX IF NOT EXISTS idx_wt_runs_territory ON wrestler_territory_runs(territory_id);
CREATE INDEX IF NOT EXISTS idx_wrestlers_midcard ON wrestlers(midcard_files_status);
CREATE INDEX IF NOT EXISTS idx_wrestlers_living ON wrestlers(living);
CREATE INDEX IF NOT EXISTS idx_territories_region ON territories(region);
"""

def main():
    conn = sqlite3.connect(DB)
    conn.executescript(SCHEMA)
    conn.commit()

    # Verify
    cur = conn.cursor()
    for tbl in ("territories", "wrestlers", "wrestler_territory_runs"):
        cur.execute(f"SELECT COUNT(*) FROM {tbl}")
        print(f"  {tbl}: {cur.fetchone()[0]} rows")

    conn.close()
    print("Migration complete.")

if __name__ == "__main__":
    main()
