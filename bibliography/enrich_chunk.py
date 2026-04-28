#!/usr/bin/env python3
"""Process up to LIMIT books per invocation, then exit.

Usage:
  python3 enrich_chunk.py [LIMIT] [--retry-failed]
    LIMIT          max rows to process (default 100)
    --retry-failed also retry rows previously marked 'low_searched'
"""
import sqlite3, json, urllib.request, urllib.parse, re, sys, os
from concurrent.futures import ThreadPoolExecutor, as_completed

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wrestling_bibliography.db")

args = [a for a in sys.argv[1:]]
RETRY_FAILED = "--retry-failed" in args
args = [a for a in args if a != "--retry-failed"]
LIMIT = int(args[0]) if args else 100

def search_ol(title):
    q = urllib.parse.urlencode({"title": title, "limit": 5})
    url = f"https://openlibrary.org/search.json?{q}"
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            return title, json.loads(r.read().decode("utf-8")).get("docs", [])
    except Exception:
        return title, None

def is_wrestling(doc):
    subjects = " ".join(doc.get("subject", []) or []).lower()
    if any(k in subjects for k in ("wrestl", "lucha", "puroresu", "wwe", "wwf", "wcw")): return True
    t = (doc.get("title") or "").lower()
    return any(w in t for w in ("wrestling", "wrestler", "wwe", "wwf", "wcw", "lucha"))

def best_match(docs, target):
    if not docs: return None
    target_l = target.lower().strip()
    for d in docs:
        if (d.get("title") or "").lower().strip() == target_l and is_wrestling(d): return d
    for d in docs:
        if is_wrestling(d): return d
    for d in docs:
        if (d.get("title") or "").lower().strip() == target_l: return d
    return None

print(f"Using DB: {DB}", flush=True)
conn = sqlite3.connect(DB)
cur = conn.cursor()
where = "confidence='low' AND year_published IS NULL"
if RETRY_FAILED:
    where = "confidence IN ('low', 'low_searched') AND year_published IS NULL"
cur.execute(f"SELECT id, title FROM books WHERE {where} ORDER BY id LIMIT {LIMIT}")
todo = cur.fetchall()
print(f"Processing {len(todo)} this chunk (retry_failed={RETRY_FAILED})...", flush=True)
if not todo:
    cur.execute("SELECT confidence, COUNT(*) FROM books GROUP BY confidence ORDER BY 2 DESC")
    print("Nothing to process. Confidence breakdown:", flush=True)
    for c, n in cur.fetchall():
        print(f"  {c}: {n}", flush=True)
    print("Hint: pass --retry-failed to re-attempt entries previously marked low_searched", flush=True)
    conn.close()
    sys.exit(0)
title_to_id = {t: bid for bid, t in todo}

enriched, failed = 0, 0
with ThreadPoolExecutor(max_workers=20) as ex:
    futures = {ex.submit(search_ol, t): t for _, t in todo}
    for fut in as_completed(futures):
        title, docs = fut.result()
        bid = title_to_id.get(title)
        if not bid: continue
        match = best_match(docs, title) if docs else None
        if not match:
            # Mark as 'searched_no_match' so we don't retry endlessly
            cur.execute("UPDATE books SET confidence='low_searched' WHERE id=?", (bid,))
            failed += 1
            continue
        year = match.get("first_publish_year")
        publisher = (match.get("publisher") or [None])[0]
        isbns = match.get("isbn") or []
        isbn13 = next((i for i in isbns if len(i) == 13), None)
        isbn10 = next((i for i in isbns if len(i) == 10), None)
        authors = match.get("author_name", []) or []
        tl = title.lower()
        cat = "about_wrestling"
        if re.search(r"\bmy story\b|\bmy life\b|: my\b|autobiograph|memoir|by [a-z]+ [a-z]+ with", tl):
            cat = "by_wrestler"
        else:
            for an in authors:
                if an and an.lower() in tl:
                    cat = "by_wrestler"; break
        cur.execute("""UPDATE books SET 
            year_published=COALESCE(year_published,?), publisher=COALESCE(publisher,?),
            isbn13=COALESCE(isbn13,?), isbn10=COALESCE(isbn10,?),
            category_code=?, confidence='medium' WHERE id=?""",
            (year, publisher, isbn13, isbn10, cat, bid))
        for an in authors[:3]:
            an = an.strip()
            cur.execute("SELECT id FROM authors WHERE name=?", (an,))
            row = cur.fetchone()
            if row: aid = row[0]
            else:
                is_wr = 1 if an.lower() in tl else 0
                cur.execute("INSERT INTO authors (name, is_wrestler) VALUES (?, ?)", (an, is_wr))
                aid = cur.lastrowid
            cur.execute("INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')", (bid, aid))
        enriched += 1

conn.commit()
print(f"Chunk done: enriched={enriched} failed={failed}", flush=True)
conn.close()
