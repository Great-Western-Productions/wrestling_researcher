#!/usr/bin/env python3
"""
Clean up three bad entries surfaced by Josh's by-decade chart anomaly:

  id=503  Wrestling with the Truth (year 1680)  →  fix year to 2008, add ISBN
  id=417  The Wrestler (Fannie E. Newberry, 1896)  →  DELETE (Roman-era novel,
          not pro wrestling — full title is 'The Wrestler of Philippi')
  id= 25  Animal (George Orwell, 1945)  →  DELETE (Animal Farm, not wrestling)

Also clean orphaned author rows after deletion.

Idempotent — safe to re-run.
"""
import sqlite3, os, shutil, tempfile

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wrestling_bibliography.db")

def main():
    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA foreign_keys = ON")
    cur = conn.cursor()

    # 1. Fix Wrestling with the Truth (id=503)
    cur.execute("""
        SELECT id, year_published FROM books
        WHERE LOWER(title) = 'wrestling with the truth'
          AND publisher = 'Crowbar Press'
    """)
    row = cur.fetchone()
    if row and row[1] == 1680:
        cur.execute("""
            UPDATE books SET
                year_published = 2008,
                isbn13 = '9780974554570',
                category_code = 'about_wrestler',
                subject_wrestler = 'Bruno Lauer (Downtown Bruno)',
                era = 'modern',
                country = 'US',
                synopsis = 'Memoir of pro wrestling manager Bruno Lauer (Downtown Bruno) co-written with Crowbar Press publisher Scott Teal. Covers Lauer''s Memphis territory career, USWA, ECW, and WCW.',
                source_url = 'https://www.crowbarpress.com/cbp-books/06-db.html',
                confidence = 'high'
            WHERE id = ?
        """, (row[0],))
        print(f"Fixed id={row[0]} 'Wrestling with the Truth' (1680 -> 2008)")
    elif row:
        print(f"id={row[0]} already updated (year={row[1]}); skipping")
    else:
        print("Wrestling with the Truth not found at expected location; skipping")

    # 2. Delete The Wrestler of Philippi (id=417)
    cur.execute("""
        DELETE FROM books
        WHERE LOWER(title) IN ('the wrestler', 'the wrestler of philippi')
          AND year_published = 1896
    """)
    deleted_417 = cur.rowcount
    print(f"Deleted {deleted_417} row for 'The Wrestler' (Newberry, 1896)")

    # 3. Delete Animal (Orwell, 1945)
    cur.execute("""
        DELETE FROM books
        WHERE LOWER(title) = 'animal'
          AND year_published = 1945
    """)
    deleted_25 = cur.rowcount
    print(f"Deleted {deleted_25} row for 'Animal' (Orwell, 1945)")

    # 4. Clean orphaned authors (no book_authors link remaining)
    cur.execute("""
        DELETE FROM authors
        WHERE id NOT IN (SELECT DISTINCT author_id FROM book_authors)
          AND name IN ('Fannie E. Newberry', 'George Orwell')
    """)
    orphans_deleted = cur.rowcount
    print(f"Deleted {orphans_deleted} orphan author rows (Newberry, Orwell)")

    conn.commit()

    # Verify
    print()
    print("=== Books with year < 1900 after cleanup ===")
    cur.execute("SELECT id, title, year_published FROM books WHERE year_published < 1900 ORDER BY year_published")
    rows = cur.fetchall()
    if rows:
        for r in rows:
            print(f"  id={r[0]}  year={r[2]}  {r[1]}")
    else:
        print("  (none — clean)")

    print()
    print("=== Updated 'Wrestling with the Truth' ===")
    cur.execute("""
        SELECT b.id, b.title, b.year_published, b.publisher, b.isbn13, b.category_code, b.subject_wrestler, b.confidence,
               GROUP_CONCAT(a.name, '; ')
        FROM books b
        LEFT JOIN book_authors ba ON ba.book_id = b.id
        LEFT JOIN authors a ON a.id = ba.author_id
        WHERE LOWER(b.title) = 'wrestling with the truth'
        GROUP BY b.id
    """)
    for r in cur.fetchall():
        print(f"  id={r[0]}  year={r[2]}  conf={r[7]}")
        print(f"    title:    {r[1]}")
        print(f"    pub:      {r[3]}  isbn:{r[4]}")
        print(f"    cat:      {r[5]}  subject: {r[6]}")
        print(f"    authors:  {r[8]}")

    cur.execute("SELECT COUNT(*) FROM books")
    print(f"\nTotal books now: {cur.fetchone()[0]}")
    cur.execute("SELECT COUNT(*) FROM authors")
    print(f"Total authors now: {cur.fetchone()[0]}")

    conn.close()
if __name__ == "__main__":
    main()
