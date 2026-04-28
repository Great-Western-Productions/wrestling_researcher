#!/usr/bin/env python3
"""Initial ingest: load Slam Wrestling 513 titles, Crowbar Press 65, and comics list into the DB."""
import sqlite3, json, re, os

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wrestling_bibliography.db")

def get_or_create_author(cur, name, is_wrestler=0):
    if not name:
        return None
    name = name.strip()
    cur.execute("SELECT id FROM authors WHERE name=?", (name,))
    row = cur.fetchone()
    if row: 
        if is_wrestler:
            cur.execute("UPDATE authors SET is_wrestler=1 WHERE id=?", (row[0],))
        return row[0]
    cur.execute("INSERT INTO authors (name, is_wrestler) VALUES (?, ?)", (name, is_wrestler))
    return cur.lastrowid

def add_book(cur, title, category_code, publisher=None, year=None, subtitle=None,
             subject_wrestler=None, isbn13=None, country=None, language="English",
             era=None, territory=None, synopsis=None, source_url=None,
             confidence="medium", authors=None, author_role="author"):
    """Insert a book; returns book_id (or existing if dup). authors is list of (name, is_wrestler) tuples."""
    # Check for existing by title + year (loose dedup)
    cur.execute("""SELECT id FROM books WHERE LOWER(title)=LOWER(?) 
                   AND (year_published=? OR (year_published IS NULL AND ? IS NULL))""", 
                (title, year, year))
    row = cur.fetchone()
    if row:
        book_id = row[0]
        # If we have new info (e.g. from a different source), update non-null fields
        updates = {}
        if publisher: updates["publisher"] = publisher
        if subject_wrestler: updates["subject_wrestler"] = subject_wrestler
        if synopsis: updates["synopsis"] = synopsis
        if isbn13: updates["isbn13"] = isbn13
        if updates:
            sets = ", ".join([f"{k}=COALESCE({k}, ?)" for k in updates])
            cur.execute(f"UPDATE books SET {sets} WHERE id=?", list(updates.values()) + [book_id])
    else:
        cur.execute("""INSERT INTO books 
            (title, subtitle, category_code, publisher, year_published, isbn13,
             country, language, subject_wrestler, era, territory_or_promotion,
             synopsis, source_url, confidence)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (title, subtitle, category_code, publisher, year, isbn13, country, language,
             subject_wrestler, era, territory, synopsis, source_url, confidence))
        book_id = cur.lastrowid
    
    if authors:
        for author_name, is_wrestler in authors:
            aid = get_or_create_author(cur, author_name, is_wrestler)
            if aid:
                cur.execute("INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, ?)",
                            (book_id, aid, author_role))
    return book_id

def add_periodical(cur, title, year_started=None, year_ended=None, publisher=None, 
                   country="US", frequency=None, ptype=None, parent=None, notes=None,
                   source_url=None, confidence="medium"):
    cur.execute("SELECT id FROM periodicals WHERE LOWER(title)=LOWER(?) AND (year_started=? OR (year_started IS NULL AND ? IS NULL))",
                (title, year_started, year_started))
    if cur.fetchone(): return
    cur.execute("""INSERT INTO periodicals 
        (title, year_started, year_ended, publisher, country, frequency, type, 
         parent_company, notes, source_url, confidence) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (title, year_started, year_ended, publisher, country, frequency, ptype,
         parent, notes, source_url, confidence))

def categorize_slam_title(title):
    """Best-effort categorization based on title keywords. Defaults to about_wrestling."""
    t = title.lower()
    # Memoirs by wrestlers - common patterns
    if re.search(r"\bmy story\b|\bmy life\b|\bautobiograph|memoir\b|: my\b", t): return "by_wrestler"
    if re.search(r"\bcountdown\b|\benc(yclo)?p|\bhistory\b|\b100 (best|greatest)|hall of fame", t): return "about_wrestling"
    return "about_wrestling"  # safe default; will refine via enrichment

def main():
    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA foreign_keys = ON")
    cur = conn.cursor()
    
    # 1. Slam Wrestling titles
    slam = json.load(open("/sessions/epic-sleepy-archimedes/mnt/outputs/slam_wrestling_books_archive.json"))
    n_slam = 0
    for entry in slam:
        title = entry["title"].strip().strip('"')
        # Skip obvious non-wrestling false positives we can identify
        if title.lower() in ("63 documents the government doesn't want you to read",):
            # Jesse Ventura wrote it - keep but tag
            add_book(cur, title, "by_wrestler", year=2011,
                     authors=[("Jesse Ventura", 1)], confidence="high",
                     synopsis="Wrestler-turned-Minnesota-governor Jesse Ventura's investigation of suppressed government documents.",
                     source_url="https://slamwrestling.net/archives/books/")
            n_slam += 1
            continue
        cat = categorize_slam_title(title)
        add_book(cur, title, cat, source_url="https://slamwrestling.net/archives/books/", confidence="low")
        n_slam += 1
    print(f"Slam Wrestling titles ingested: {n_slam}")
    
    # 2. Crowbar Press
    cb = json.load(open("/tmp/pwbib/crowbar_books.json"))
    n_cb = 0
    for e in cb:
        title = e["title"].strip().strip('"')
        author_field = e.get("author_subject")
        url = f"https://www.crowbarpress.com/{e['url_path']}"
        # Author field on Crowbar is the wrestler/subject. Most Crowbar books are co-authored
        # memoirs ("as told to" Scott Teal) or biographies.
        if author_field:
            # If title looks like a memoir/autobio (e.g., HOOKER | Lou Thesz), it's by_wrestler
            cat = "by_wrestler"
            add_book(cur, title, cat, publisher="Crowbar Press", country="US",
                     era="territorial", subject_wrestler=author_field, source_url=url,
                     authors=[(author_field, 1), ("Scott Teal", 0)], confidence="high")
        else:
            # No subject named in title — likely an oral history compilation
            add_book(cur, title, "about_wrestling", publisher="Crowbar Press", country="US",
                     era="territorial", source_url=url,
                     authors=[("Scott Teal", 0)], confidence="high")
        n_cb += 1
    print(f"Crowbar Press books ingested: {n_cb}")
    
    # 3. Comics (fiction category)
    comics = json.load(open("/tmp/pwbib/wrestling_comics.json"))
    n_comics = 0
    for c in comics:
        year = int(c["year"]) if c.get("year") and str(c["year"]).isdigit() else None
        country = "Mexico" if c.get("publisher", "") and "Mexic" in str(c.get("publisher","")) else None
        if not country and c.get("publisher") in ("Shueisha", "Shogakukan", "Akita Shoten"): country = "Japan"
        if not country and "UK comic" in str(c.get("publisher","")): country = "UK"
        if not country: country = "US"
        authors = []
        for who in (c.get("writer"), c.get("artist")):
            if who and who not in [a[0] for a in authors]:
                # split multi-author strings
                for name in re.split(r"\s+and\s+|,\s*", who):
                    name = name.strip()
                    if name and name not in [a[0] for a in authors]:
                        authors.append((name, 0))
        add_book(cur, c["title"], "fiction", publisher=c.get("publisher"),
                 year=year, country=country, subject_wrestler=c.get("subject"),
                 synopsis=c.get("description"),
                 source_url="https://en.wikipedia.org/wiki/List_of_wrestling-based_comic_books",
                 authors=authors, confidence="medium")
        n_comics += 1
    print(f"Comics ingested: {n_comics}")
    
    conn.commit()
    
    # Summary
    print(f"\n=== After initial ingest ===")
    print(f"Total books: {cur.execute('SELECT COUNT(*) FROM books').fetchone()[0]}")
    print(f"  by category:")
    for row in cur.execute("SELECT category_code, COUNT(*) FROM books GROUP BY category_code"):
        print(f"    {row[0]}: {row[1]}")
    print(f"  by confidence:")
    for row in cur.execute("SELECT confidence, COUNT(*) FROM books GROUP BY confidence"):
        print(f"    {row[0]}: {row[1]}")
    print(f"Total authors: {cur.execute('SELECT COUNT(*) FROM authors').fetchone()[0]}")
    
    conn.close()

if __name__ == "__main__":
    main()
