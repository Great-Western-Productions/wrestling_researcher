#!/usr/bin/env python3
"""
Build the wrestling bibliography SQLite database.
Idempotent: safe to re-run; uses CREATE IF NOT EXISTS and INSERT OR IGNORE.
"""
import sqlite3
import os
import sys

DB_PATH = "/tmp/pwbib/wrestling_bibliography.db"

SCHEMA = """
-- Categories the user defined
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    description TEXT
);

-- Authors (separate table to handle multi-author works and author-as-subject)
CREATE TABLE IF NOT EXISTS authors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    ring_name TEXT,            -- if author is/was a wrestler
    is_wrestler INTEGER DEFAULT 0,
    notes TEXT
);

-- Books table
CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    subtitle TEXT,
    category_code TEXT NOT NULL,        -- about_wrestling | about_wrestler | by_wrestler | fiction
    publisher TEXT,
    year_published INTEGER,
    isbn10 TEXT,
    isbn13 TEXT,
    pages INTEGER,
    format TEXT,                         -- hardcover | paperback | ebook | etc.
    language TEXT DEFAULT 'English',
    country TEXT,                        -- US | UK | Canada | Mexico | Japan | etc.
    subject_wrestler TEXT,               -- if biography/memoir, the wrestler it's about
    era TEXT,                            -- territorial | golden_age | rock_n_wrestling | attitude | modern | puroresu_classic | etc.
    territory_or_promotion TEXT,
    synopsis TEXT,
    source_url TEXT,                     -- where we found bibliographic info
    confidence TEXT DEFAULT 'medium',    -- high | medium | low
    primary_source_value TEXT,           -- notes on whether it's a primary source
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(title, year_published, isbn13)
    FOREIGN KEY (category_code) REFERENCES categories(code)
);

-- Many-to-many for authors
CREATE TABLE IF NOT EXISTS book_authors (
    book_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    role TEXT DEFAULT 'author',          -- author | co-author | as told to | editor | foreword
    PRIMARY KEY (book_id, author_id, role),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE
);

-- Periodicals (magazines, newsletters, programs)
CREATE TABLE IF NOT EXISTS periodicals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    publisher TEXT,
    country TEXT,
    language TEXT DEFAULT 'English',
    year_started INTEGER,
    year_ended INTEGER,                  -- NULL if active
    frequency TEXT,                      -- monthly | weekly | quarterly | irregular | newsletter
    type TEXT,                           -- newsstand | newsletter | program | dirt_sheet | apter_mag | territory_program
    parent_company TEXT,                 -- e.g., 'Stanley Weston / G.C. London Publishing' for Apter mags
    notes TEXT,
    issue_count_known INTEGER,           -- if we know approx total issues
    archive_in_collection INTEGER DEFAULT 0,  -- if user has issues in their archive
    source_url TEXT,
    confidence TEXT DEFAULT 'medium',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(title, year_started)
);

-- Track research sources we've consulted
CREATE TABLE IF NOT EXISTS research_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE NOT NULL,
    description TEXT,
    consulted_at TEXT DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_books_category ON books(category_code);
CREATE INDEX IF NOT EXISTS idx_books_year ON books(year_published);
CREATE INDEX IF NOT EXISTS idx_books_subject ON books(subject_wrestler);
CREATE INDEX IF NOT EXISTS idx_books_country ON books(country);
CREATE INDEX IF NOT EXISTS idx_periodicals_country ON periodicals(country);
"""

CATEGORIES = [
    ("about_wrestling", "Books about pro wrestling", "Histories, analyses, business/cultural studies, encyclopedias, photo books, picture books"),
    ("about_wrestler", "Books about pro wrestlers", "Biographies, profiles, retrospectives written by third parties about specific wrestlers"),
    ("by_wrestler", "Books by pro wrestlers", "Autobiographies, memoirs, instructionals, philosophy/lifestyle books authored or co-authored by wrestlers"),
    ("fiction", "Fiction featuring pro wrestling", "Novels, short story collections, comic books/graphic novels, children's books with wrestling as central theme"),
]

def main():
    new_db = not os.path.exists(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.executescript(SCHEMA)
    
    for code, label, desc in CATEGORIES:
        conn.execute(
            "INSERT OR IGNORE INTO categories (code, label, description) VALUES (?, ?, ?)",
            (code, label, desc)
        )
    
    conn.commit()
    
    # Print summary
    cur = conn.cursor()
    print(f"Database: {DB_PATH}")
    print(f"  New: {new_db}")
    print(f"  Tables:")
    for row in cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
        print(f"    - {row[0]}")
    print(f"  Categories ({cur.execute('SELECT COUNT(*) FROM categories').fetchone()[0]}):")
    for row in cur.execute("SELECT code, label FROM categories"):
        print(f"    - {row[0]}: {row[1]}")
    print(f"  Books: {cur.execute('SELECT COUNT(*) FROM books').fetchone()[0]}")
    print(f"  Authors: {cur.execute('SELECT COUNT(*) FROM authors').fetchone()[0]}")
    print(f"  Periodicals: {cur.execute('SELECT COUNT(*) FROM periodicals').fetchone()[0]}")
    
    conn.close()

if __name__ == "__main__":
    main()
