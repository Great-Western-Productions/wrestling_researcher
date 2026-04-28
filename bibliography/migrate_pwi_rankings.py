#!/usr/bin/env python3
"""
migrate_pwi_rankings.py

Adds support for periodical issues, factions (tag teams + stables), cover
subjects, and rankings (top-10s, tag teams, territory ratings, etc.).

Scoped to support PWI ingestion from ProFightDB but generalizable to any
periodical that prints ranked lists.

New tables:
  - factions, faction_members
  - periodical_issues
  - issue_cover_subjects
  - ranking_lists
  - ranking_entries

Plus two views:
  - v_ranking_history     -- flat ranking history per wrestler
  - v_issue_browser       -- issue list for the Flask reader

Idempotent: uses CREATE TABLE IF NOT EXISTS.

Run: python3 migrate_pwi_rankings.py
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "wrestling_bibliography.db"

DDL = """
-- ============================================================
-- Factions: tag teams, stables, families, armies
--   Option A consolidation -- a tag team is a faction of type 'tag_team'.
-- ============================================================

CREATE TABLE IF NOT EXISTS factions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('tag_team', 'stable', 'family', 'army')),
    formed_year INTEGER,
    disbanded_year INTEGER,
    primary_territory_id INTEGER REFERENCES territories(id),
    notes TEXT,
    confidence TEXT DEFAULT 'medium',
    source_url TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name, formed_year)
);

CREATE INDEX IF NOT EXISTS idx_factions_type ON factions(type);
CREATE INDEX IF NOT EXISTS idx_factions_name ON factions(name);

CREATE TABLE IF NOT EXISTS faction_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    faction_id INTEGER NOT NULL REFERENCES factions(id) ON DELETE CASCADE,
    wrestler_id INTEGER NOT NULL REFERENCES wrestlers(id) ON DELETE CASCADE,
    role TEXT,                        -- 'core' | 'satellite' | 'manager'
    joined_year INTEGER,
    left_year INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(faction_id, wrestler_id, joined_year)
);

CREATE INDEX IF NOT EXISTS idx_faction_members_wrestler ON faction_members(wrestler_id);
CREATE INDEX IF NOT EXISTS idx_faction_members_faction ON faction_members(faction_id);

-- ============================================================
-- Periodical Issues
-- ============================================================

CREATE TABLE IF NOT EXISTS periodical_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    periodical_id INTEGER NOT NULL REFERENCES periodicals(id) ON DELETE CASCADE,
    publication_date TEXT NOT NULL,        -- cover date 'YYYY-MM-DD' (1st of month for monthlies)
    period_date TEXT,                      -- 'as of' date PWI prints (e.g., 'Mar 9th, 1984' -> '1984-03-09')
    issue_number TEXT,                     -- TEXT to allow 'Vol 23 No 4' or '#187'
    volume INTEGER,
    cover_image_url TEXT,
    cover_description TEXT,                -- free-text: 'Hogan front and center, Andre inset top-right'
    cover_story TEXT,                      -- the main feature article tied to the cover
    profightdb_id INTEGER,                 -- numeric id from /pwi-monthly/{slug}-{id}.html
    drive_pdf_path TEXT,                   -- path to magazine PDF in Google Drive, if owned
    in_collection INTEGER DEFAULT 0,
    source_url TEXT,
    confidence TEXT DEFAULT 'medium',
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(periodical_id, publication_date),
    UNIQUE(periodical_id, profightdb_id)
);

CREATE INDEX IF NOT EXISTS idx_issues_periodical_date ON periodical_issues(periodical_id, publication_date);
CREATE INDEX IF NOT EXISTS idx_issues_profightdb ON periodical_issues(profightdb_id);

-- ============================================================
-- Cover Subjects (junction): who appears on the cover
--   Allows wrestler_id, faction_id, or just subject_name (for non-wrestlers).
-- ============================================================

CREATE TABLE IF NOT EXISTS issue_cover_subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id INTEGER NOT NULL REFERENCES periodical_issues(id) ON DELETE CASCADE,
    wrestler_id INTEGER REFERENCES wrestlers(id) ON DELETE SET NULL,
    faction_id INTEGER REFERENCES factions(id) ON DELETE SET NULL,
    subject_name TEXT,                     -- printed name (used when wrestler_id/faction_id NULL)
    position TEXT,                         -- 'main' | 'inset' | 'background'
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    CHECK (wrestler_id IS NOT NULL OR faction_id IS NOT NULL OR subject_name IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_cover_subjects_issue ON issue_cover_subjects(issue_id);
CREATE INDEX IF NOT EXISTS idx_cover_subjects_wrestler ON issue_cover_subjects(wrestler_id);
CREATE INDEX IF NOT EXISTS idx_cover_subjects_faction ON issue_cover_subjects(faction_id);

-- ============================================================
-- Ranking Lists: one per ranked list per issue
--   Top 10, Tag Teams, Most Popular, Women, WWF, Florida, etc.
-- ============================================================

CREATE TABLE IF NOT EXISTS ranking_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id INTEGER NOT NULL REFERENCES periodical_issues(id) ON DELETE CASCADE,
    list_label TEXT NOT NULL,              -- 'Top 10' | 'Tag Teams' | 'Women' | 'WWF' | 'Florida' | etc.
    list_scope TEXT NOT NULL CHECK (list_scope IN (
        'singles',          -- 'Top 10'
        'tag',              -- 'Tag Teams'
        'women',
        'jr_heavyweight',
        'cruiserweight',
        'most_popular',
        'most_hated',
        'promotion',        -- WWF/WCW/NWA/AWA/ECW/AEW/etc. (national)
        'territory',        -- Florida, Mid-Atlantic, World Class, Mid-South, etc.
        'international',    -- All Japan, New Japan, EMLL, AAA, Promo Azteca
        'other'
    )),
    territory_id INTEGER REFERENCES territories(id),  -- when scope='territory' or 'promotion'
    list_size INTEGER,
    source_url TEXT,                       -- ProFightDB rankings page (specific anchor)
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(issue_id, list_label)
);

CREATE INDEX IF NOT EXISTS idx_ranking_lists_issue ON ranking_lists(issue_id);
CREATE INDEX IF NOT EXISTS idx_ranking_lists_scope ON ranking_lists(list_scope);
CREATE INDEX IF NOT EXISTS idx_ranking_lists_territory ON ranking_lists(territory_id);

-- ============================================================
-- Ranking Entries: one slot on a list
--   Singles list: wrestler_id set; faction_id NULL.
--   Tag list:     faction_id set; wrestler_id NULL.
--   Unresolved:   both NULL, only entry_name (printed) populated.
-- ============================================================

CREATE TABLE IF NOT EXISTS ranking_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ranking_list_id INTEGER NOT NULL REFERENCES ranking_lists(id) ON DELETE CASCADE,
    rank INTEGER NOT NULL CHECK (rank >= 1),
    wrestler_id INTEGER REFERENCES wrestlers(id) ON DELETE SET NULL,
    faction_id INTEGER REFERENCES factions(id) ON DELETE SET NULL,
    entry_name TEXT NOT NULL,              -- as printed; required for searchability
    previous_rank INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(ranking_list_id, rank)
);

CREATE INDEX IF NOT EXISTS idx_ranking_entries_list ON ranking_entries(ranking_list_id);
CREATE INDEX IF NOT EXISTS idx_ranking_entries_wrestler ON ranking_entries(wrestler_id);
CREATE INDEX IF NOT EXISTS idx_ranking_entries_faction ON ranking_entries(faction_id);
CREATE INDEX IF NOT EXISTS idx_ranking_entries_name ON ranking_entries(entry_name);

-- ============================================================
-- Views
-- ============================================================

DROP VIEW IF EXISTS v_ranking_history;
CREATE VIEW v_ranking_history AS
SELECT
    w.id              AS wrestler_id,
    w.primary_ring_name,
    p.title           AS periodical,
    pi.publication_date,
    pi.period_date,
    pi.issue_number,
    rl.list_label,
    rl.list_scope,
    re.rank,
    re.previous_rank,
    re.entry_name     AS as_printed
FROM ranking_entries re
JOIN ranking_lists rl ON re.ranking_list_id = rl.id
JOIN periodical_issues pi ON rl.issue_id = pi.id
JOIN periodicals p ON pi.periodical_id = p.id
LEFT JOIN wrestlers w ON re.wrestler_id = w.id;

DROP VIEW IF EXISTS v_issue_browser;
CREATE VIEW v_issue_browser AS
SELECT
    pi.id,
    p.title           AS periodical,
    pi.publication_date,
    pi.period_date,
    pi.issue_number,
    pi.cover_image_url,
    pi.cover_description,
    pi.drive_pdf_path,
    (SELECT COUNT(*) FROM ranking_lists WHERE issue_id = pi.id) AS list_count,
    (SELECT GROUP_CONCAT(COALESCE(w.primary_ring_name, ics.subject_name), ', ')
       FROM issue_cover_subjects ics
       LEFT JOIN wrestlers w ON ics.wrestler_id = w.id
      WHERE ics.issue_id = pi.id) AS cover_subjects
FROM periodical_issues pi
JOIN periodicals p ON pi.periodical_id = p.id;
"""

def main():
    if not DB_PATH.exists():
        raise SystemExit(f"DB not found at {DB_PATH}")
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA foreign_keys = ON")
    cur = conn.cursor()
    cur.executescript(DDL)
    conn.commit()

    print("Migration applied.")
    print("\nTables in DB:")
    for (n,) in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ):
        print(f"  {n}")
    print("\nViews in DB:")
    for (n,) in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='view' ORDER BY name"
    ):
        print(f"  {n}")
    conn.close()

if __name__ == "__main__":
    main()
