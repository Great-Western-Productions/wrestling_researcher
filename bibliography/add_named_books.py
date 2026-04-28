#!/usr/bin/env python3
"""
Add / correct three sets of book entries surfaced by Josh:
  1. Ballyhoo by Jon Langmead — exists in DB with no metadata; backfill it.
  2. Verne: Inside & Outside the Ropes by Brian Ferguson — missing.
  3. Brian R. Solomon's wrestling output:
       - WWE Legends (2006) — already in DB; normalize author.
       - Pro Wrestling FAQ (2015) — WRONG attribution in DB; correct it.
       - Blood and Fire: The Original Sheik (2022) — missing.
       - Irresistible Force: Gorilla Monsoon (2024) — missing.

Idempotent. Sources verified by web search 2026-04-27.
"""
import sqlite3
import os
DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wrestling_bibliography.db")

def get_or_create_author(cur, canonical_name, also_known=None):
    """Return author id; create if missing. If `also_known` is supplied, find
    any existing row matching either spelling and merge to canonical."""
    candidates = [canonical_name] + (also_known or [])
    placeholders = ",".join("?" for _ in candidates)
    cur.execute(f"SELECT id, name FROM authors WHERE name IN ({placeholders})", candidates)
    rows = cur.fetchall()
    if not rows:
        cur.execute("INSERT INTO authors (name) VALUES (?)", (canonical_name,))
        return cur.lastrowid
    # Pick canonical row if present, else the first match
    canonical = next((r for r in rows if r[1] == canonical_name), None)
    if canonical:
        canonical_id = canonical[0]
    else:
        canonical_id = rows[0][0]
        cur.execute("UPDATE authors SET name = ? WHERE id = ?", (canonical_name, canonical_id))
    # Merge all other matches into canonical
    for aid, aname in rows:
        if aid == canonical_id:
            continue
        cur.execute("UPDATE OR IGNORE book_authors SET author_id = ? WHERE author_id = ?",
                    (canonical_id, aid))
        cur.execute("DELETE FROM book_authors WHERE author_id = ?", (aid,))
        cur.execute("DELETE FROM authors WHERE id = ?", (aid,))
    return canonical_id

def upsert_book(cur, *, title, **fields):
    """Find by title (case-insensitive); update if found, insert if not.
    Returns book_id."""
    cur.execute("SELECT id FROM books WHERE LOWER(title) = LOWER(?)", (title,))
    row = cur.fetchone()
    if row:
        bid = row[0]
        sets = ", ".join(f"{k} = ?" for k in fields.keys())
        cur.execute(f"UPDATE books SET {sets} WHERE id = ?", (*fields.values(), bid))
        return bid
    cols = ["title"] + list(fields.keys())
    placeholders = ", ".join("?" for _ in cols)
    cur.execute(f"INSERT INTO books ({', '.join(cols)}) VALUES ({placeholders})",
                (title, *fields.values()))
    return cur.lastrowid

def link_author(cur, book_id, author_id, role="author"):
    cur.execute("INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, ?)",
                (book_id, author_id, role))

def main():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    # ---- Author normalization ------------------------------------------
    solomon_id = get_or_create_author(cur, "Brian R. Solomon",
                                       also_known=["Solomon, Brian", "Brian Solomon"])
    ferguson_id = get_or_create_author(cur, "Brian Ferguson")
    langmead_id = get_or_create_author(cur, "Jon Langmead")
    rvd_id = get_or_create_author(cur, "Rob Van Dam")  # foreword on Blood and Fire

    # ---- 1. Ballyhoo ---------------------------------------------------
    bid = upsert_book(cur,
        title="Ballyhoo!: The Roughhousers, Con Artists, And Wildmen Who Invented Professional Wrestling",
        category_code="about_wrestling",
        publisher="University of Missouri Press",
        year_published=2023,
        isbn13="9780826222992",
        format="hardcover",
        country="US",
        era="formative",
        synopsis="History of pro wrestling's formative U.S. period, c. 1874-1941, traced through the career of promoter Jack Curley. Choice Outstanding Academic Title 2024.",
        source_url="https://www.amazon.com/Ballyhoo-Roughhousers-Invented-Professional-Wrestling/dp/0826222994",
        confidence="high",
        primary_source_value="Secondary source; well-researched academic press; useful for pre-territorial era citations.",
    )
    link_author(cur, bid, langmead_id)

    # ---- 2. Verne: Inside & Outside the Ropes (Brian Ferguson) ---------
    bid = upsert_book(cur,
        title="VERNE: Inside & Outside the Ropes",
        category_code="about_wrestler",
        publisher="Independent (Brian Ferguson)",
        year_published=2024,
        isbn13="9798344352480",
        format="paperback",
        country="US",
        subject_wrestler="Verne Gagne",
        era="territorial",
        territory_or_promotion="American Wrestling Association",
        synopsis="Biography of Verne Gagne by WFIA contributor Brian Ferguson. Covers his French-Canadian roots, University of Minnesota athletic career, WWII Marine Corps service, NFL draft, and pro wrestling career as AWA founder.",
        source_url="https://slamwrestling.net/index.php/2024/12/16/book-excerpt-verne-inside-outside-the-ropes/",
        confidence="high",
        primary_source_value="WFIA-affiliated author; close to subject. Useful primary-adjacent for AWA history.",
    )
    link_author(cur, bid, ferguson_id)

    # ---- 3. Brian R. Solomon catalog -----------------------------------
    # WWE Legends (already exists at id 459) — normalize author link
    cur.execute("SELECT id FROM books WHERE LOWER(title) = LOWER(?)", ("WWE Legends",))
    wwe_legends_id = cur.fetchone()
    if wwe_legends_id:
        bid = wwe_legends_id[0]
        cur.execute("UPDATE books SET publisher = ?, format = ?, country = ?, confidence = ? WHERE id = ?",
                    ("Pocket Books / WWE Books", "paperback", "US", "high", bid))
        # Drop any stale author link, relink to canonical
        cur.execute("DELETE FROM book_authors WHERE book_id = ?", (bid,))
        link_author(cur, bid, solomon_id)

    # Pro Wrestling FAQ — fix existing wrongly-attributed entry
    cur.execute("SELECT id FROM books WHERE LOWER(title) LIKE 'pro wrestling faq%'")
    faq_row = cur.fetchone()
    if faq_row:
        bid = faq_row[0]
        cur.execute("""
            UPDATE books SET
                publisher = ?, year_published = ?, isbn13 = ?, format = ?,
                country = ?, era = ?, synopsis = ?, source_url = ?, confidence = ?
            WHERE id = ?
        """, (
            "Backbeat Books",
            2015,
            "9781617135996",
            "paperback",
            "US",
            "modern",
            "Comprehensive Q&A reference covering pro wrestling history, characters, and behind-the-scenes business. Part of the FAQ Pop Culture series.",
            "https://www.amazon.com/Pro-Wrestling-FAQ-Entertaining-Spectacle/dp/1617135992",
            "high",
            bid,
        ))
        cur.execute("DELETE FROM book_authors WHERE book_id = ?", (bid,))
        link_author(cur, bid, solomon_id)

    # Blood and Fire: The Original Sheik
    bid = upsert_book(cur,
        title="Blood and Fire: The Unbelievable Real-Life Story of Wrestling's Original Sheik",
        category_code="about_wrestler",
        publisher="ECW Press",
        year_published=2022,
        isbn13="9781770415805",
        format="paperback",
        country="Canada",
        subject_wrestler="The Sheik (Ed Farhat)",
        era="territorial",
        territory_or_promotion="Big Time Wrestling (Detroit)",
        synopsis="Biography of Ed Farhat, the original Sheik. Won the 2022 Wrestling Observer Newsletter Award for Best Pro Wrestling Book and 2022 Michigan Notable Book Award.",
        source_url="https://ecwpress.com/products/blood-and-fire",
        confidence="high",
        primary_source_value="Award-winning biography; based on family/estate access. High primary-source value for Detroit territorial history.",
    )
    link_author(cur, bid, solomon_id)
    link_author(cur, bid, rvd_id, role="foreword")

    # Irresistible Force: Gorilla Monsoon
    bid = upsert_book(cur,
        title="Irresistible Force: The Life and Times of Gorilla Monsoon",
        category_code="about_wrestler",
        publisher="ECW Press",
        year_published=2024,
        isbn13="9781770417687",
        format="paperback",
        country="Canada",
        subject_wrestler="Gorilla Monsoon (Robert Marella)",
        era="territorial",
        territory_or_promotion="World Wrestling Federation",
        synopsis="Biography of Robert Marella covering his amateur wrestling career, ring career as Gorilla Monsoon, behind-the-scenes role at WWF, and broadcasting work. Won 2025 Wrestling Observer Newsletter Award for Best Pro Wrestling Book.",
        source_url="https://www.simonandschuster.com/books/Irresistible-Force/Brian-R-Solomon/9781770417687",
        confidence="high",
        primary_source_value="Award-winning biography; useful for WWWF/WWF transition era.",
    )
    link_author(cur, bid, solomon_id)

    conn.commit()

    # ---- Verify --------------------------------------------------------
    print("=== After updates ===")
    cur.execute("""
        SELECT b.title, b.year_published, b.publisher, b.confidence,
               GROUP_CONCAT(a.name, '; ')
        FROM books b
        LEFT JOIN book_authors ba ON ba.book_id = b.id
        LEFT JOIN authors a ON a.id = ba.author_id
        WHERE b.title LIKE '%ballyhoo%'
           OR b.title LIKE '%pro wrestling faq%'
           OR b.title LIKE '%blood and fire%'
           OR b.title LIKE '%irresistible%'
           OR b.title LIKE '%wwe legends%'
           OR b.title LIKE 'verne:%'
        GROUP BY b.id
        ORDER BY b.year_published
    """)
    for row in cur.fetchall():
        print(f"  ({row[1]}) {row[0][:80]}")
        print(f"      pub: {row[2]} | conf: {row[3]} | authors: {row[4]}")

    conn.close()
if __name__ == "__main__":
    main()
