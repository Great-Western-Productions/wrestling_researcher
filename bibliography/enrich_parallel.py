#!/usr/bin/env python3
"""Parallel enrichment via Open Library — uses ThreadPoolExecutor for concurrent lookups."""
import sqlite3, json, time, urllib.request, urllib.parse, re, os
from concurrent.futures import ThreadPoolExecutor, as_completed

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wrestling_bibliography.db")

def search_ol(title):
    q = urllib.parse.urlencode({"title": title, "limit": 5})
    url = f"https://openlibrary.org/search.json?{q}"
    try:
        with urllib.request.urlopen(url, timeout=6) as r:
            return title, json.loads(r.read().decode("utf-8")).get("docs", [])
    except Exception as e:
        return title, None

def is_wrestling(doc):
    subjects = " ".join(doc.get("subject", []) or []).lower()
    if any(k in subjects for k in ("wrestl", "lucha", "puroresu", "wwe", "wwf", "wcw")):
        return True
    t = (doc.get("title") or "").lower()
    return any(w in t for w in ("wrestling", "wrestler", "wwe", "wwf", "wcw", "lucha"))

def best_match(docs, target):
    if not docs: return None
    target_l = target.lower().strip()
    for d in docs:
        if (d.get("title") or "").lower().strip() == target_l and is_wrestling(d):
            return d
    for d in docs:
        if is_wrestling(d): return d
    for d in docs:
        if (d.get("title") or "").lower().strip() == target_l: return d
    return None

def main():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    cur.execute("SELECT id, title FROM books WHERE confidence='low' AND year_published IS NULL ORDER BY id")
    todo = cur.fetchall()
    print(f"To enrich: {len(todo)}", flush=True)
    
    # Map title -> book_id (titles are unique enough at this stage)
    title_to_id = {t: bid for bid, t in todo}
    
    enriched = 0
    failed = 0
    with ThreadPoolExecutor(max_workers=20) as ex:
        futures = {ex.submit(search_ol, t): t for _, t in todo}
        for i, fut in enumerate(as_completed(futures)):
            title, docs = fut.result()
            book_id = title_to_id.get(title)
            if not book_id: continue
            
            if i % 30 == 0:
                conn.commit()
                print(f"  [{i}/{len(todo)}] enriched={enriched} failed={failed}", flush=True)
            
            match = best_match(docs, title) if docs else None
            if not match:
                failed += 1
                continue
            
            year = match.get("first_publish_year")
            publisher = (match.get("publisher") or [None])[0]
            isbn_list = match.get("isbn") or []
            isbn13 = next((i for i in isbn_list if len(i) == 13), None)
            isbn10 = next((i for i in isbn_list if len(i) == 10), None)
            authors = match.get("author_name", []) or []
            
            # categorize
            tl = title.lower()
            cat = "about_wrestling"
            if re.search(r"\bmy story\b|\bmy life\b|: my\b|autobiograph|memoir", tl):
                cat = "by_wrestler"
            else:
                # if any author name is in the title, likely a memoir
                for an in authors:
                    if an and an.lower() in tl:
                        cat = "by_wrestler"
                        break
            
            cur.execute("""UPDATE books SET 
                year_published=COALESCE(year_published,?), 
                publisher=COALESCE(publisher,?),
                isbn13=COALESCE(isbn13,?), isbn10=COALESCE(isbn10,?),
                category_code=?, confidence='medium' WHERE id=?""",
                (year, publisher, isbn13, isbn10, cat, book_id))
            
            for an in authors[:3]:
                an = an.strip()
                cur.execute("SELECT id FROM authors WHERE name=?", (an,))
                row = cur.fetchone()
                if row: aid = row[0]
                else:
                    is_wr = 1 if an.lower() in tl else 0
                    cur.execute("INSERT INTO authors (name, is_wrestler) VALUES (?, ?)", (an, is_wr))
                    aid = cur.lastrowid
                cur.execute("INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')",
                            (book_id, aid))
            
            enriched += 1
    
    conn.commit()
    print(f"\nDone. enriched={enriched} failed={failed}", flush=True)
    
    # Final stats
    print(f"Books with year: {cur.execute('SELECT COUNT(*) FROM books WHERE year_published IS NOT NULL').fetchone()[0]}")
    print(f"Books with author: {cur.execute('SELECT COUNT(DISTINCT book_id) FROM book_authors').fetchone()[0]}")
    for r in cur.execute("SELECT category_code, COUNT(*) FROM books GROUP BY category_code"):
        print(f"  {r[0]}: {r[1]}")
    conn.close()

if __name__ == "__main__":
    main()
