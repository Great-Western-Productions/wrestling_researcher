#!/usr/bin/env python3
"""
Ingest ECW Press wrestling catalog into wrestling_bibliography.db.

Scrapes https://ecwpress.com/collections/wrestling and extracts:
- Title, subtitle, author(s), year published, ISBN, format, synopsis, subject wrestler
- Handles pagination and per-book detail pages where needed
- Idempotent: matches on LOWER(title) and ISBN; updates existing rows with better data

Usage:
  python3 ingest_ecw_press.py [--dry-run]
"""
import sqlite3
import os
import re
import sys
import json
from urllib.parse import urljoin
from typing import Optional, List, Dict, Tuple

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("ERROR: requests and beautifulsoup4 required")
    print("Install with: pip3 install requests beautifulsoup4")
    sys.exit(1)

# ============================================================================
# CONFIG
# ============================================================================

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wrestling_bibliography.db")

ECW_CATALOG = "https://ecwpress.com/collections/wrestling"
PUBLISHER = "ECW Press"
COUNTRY = "Canada"

# Session for requests
session = requests.Session()
session.headers.update({
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
})

# ============================================================================
# DATABASE HELPERS
# ============================================================================

def get_or_create_author(cur, canonical_name: str, also_known: Optional[List[str]] = None) -> int:
    """Return author id; create if missing."""
    candidates = [canonical_name] + (also_known or [])
    placeholders = ",".join("?" for _ in candidates)
    cur.execute(f"SELECT id, name FROM authors WHERE name IN ({placeholders})", candidates)
    rows = cur.fetchall()
    if not rows:
        cur.execute("INSERT INTO authors (name) VALUES (?)", (canonical_name,))
        return cur.lastrowid
    canonical = next((r for r in rows if r[1] == canonical_name), None)
    if canonical:
        canonical_id = canonical[0]
    else:
        canonical_id = rows[0][0]
        cur.execute("UPDATE authors SET name = ? WHERE id = ?", (canonical_name, canonical_id))
    # Merge other matches
    for aid, aname in rows:
        if aid == canonical_id:
            continue
        cur.execute("UPDATE OR IGNORE book_authors SET author_id = ? WHERE author_id = ?",
                    (canonical_id, aid))
        cur.execute("DELETE FROM book_authors WHERE author_id = ?", (aid,))
        cur.execute("DELETE FROM authors WHERE id = ?", (aid,))
    return canonical_id

def upsert_book(cur, *, title: str, **fields) -> int:
    """Find by title (case-insensitive); update if found, insert if not."""
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

def link_author(cur, book_id: int, author_id: int, role: str = "author"):
    cur.execute("INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, ?)",
                (book_id, author_id, role))

# ============================================================================
# SCRAPING
# ============================================================================

def extract_isbn(text: str) -> Tuple[Optional[str], Optional[str]]:
    """Extract ISBN-13 and ISBN-10 from text."""
    isbn13 = None
    isbn10 = None
    # ISBN-13: 13 digits
    m13 = re.search(r'\b(\d{13})\b', text)
    if m13:
        isbn13 = m13.group(1)
    # ISBN-10: 10 digits (may have hyphens)
    m10 = re.search(r'\b(\d{10})\b', text)
    if m10:
        isbn10 = m10.group(1)
    return isbn13, isbn10

def extract_year(text: str) -> Optional[int]:
    """Extract publication year from text."""
    m = re.search(r'\b(19|20)\d{2}\b', text)
    if m:
        return int(m.group(0))
    return None

def scrape_book_detail(book_url: str) -> Dict:
    """Scrape detail page for a single book."""
    try:
        resp = session.get(book_url, timeout=10)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.content, 'html.parser')

        data = {
            'isbn13': None,
            'isbn10': None,
            'format': None,
            'year_published': None,
            'synopsis': None,
            'pages': None,
            'author': None,
        }

        # Extract author - look for author name in meta tags or structured data
        author_candidates = []

        # Try schema.org author
        schema = soup.find('script', type='application/ld+json')
        if schema:
            try:
                schema_data = json.loads(schema.string)
                if isinstance(schema_data, dict):
                    if 'author' in schema_data:
                        author_val = schema_data['author']
                        if isinstance(author_val, dict) and 'name' in author_val:
                            author_candidates.append(author_val['name'])
                        elif isinstance(author_val, str):
                            author_candidates.append(author_val)
            except:
                pass

        # Try author meta tags
        author_meta = soup.find('meta', {'name': re.compile('author', re.I)})
        if author_meta:
            author_candidates.append(author_meta.get('content', ''))

        if author_candidates:
            data['author'] = author_candidates[0].strip() if author_candidates[0] else None

        # Extract synopsis from various possible locations
        for selector in [
            'div[class*="description"]',
            'div[class*="product-description"]',
            'div[class*="book-summary"]',
            'p[class*="synopsis"]',
        ]:
            synopsis_elem = soup.select_one(selector)
            if synopsis_elem:
                synopsis_text = synopsis_elem.get_text(strip=True)
                if synopsis_text and len(synopsis_text) > 20:
                    data['synopsis'] = synopsis_text[:500]
                    break

        # Fallback: look for any paragraph with substantial text
        if not data['synopsis']:
            for p in soup.find_all('p'):
                text = p.get_text(strip=True)
                if len(text) > 100 and len(text) < 1000:
                    data['synopsis'] = text[:500]
                    break

        # Extract ISBN and format from product details
        all_text = soup.get_text()

        # Look for ISBN-13 and ISBN-10
        isbn13_match = re.search(r'(?:ISBN-?13|ISBN)[:\s]?\(?(\d{13})\)?', all_text)
        if isbn13_match:
            data['isbn13'] = isbn13_match.group(1)
        else:
            m = re.search(r'\b(\d{13})\b', all_text)
            if m:
                data['isbn13'] = m.group(1)

        isbn10_match = re.search(r'(?:ISBN-?10|ISBN)[:\s]?\(?(\d{10})\)?', all_text)
        if isbn10_match:
            data['isbn10'] = isbn10_match.group(1)

        # Extract format (look specifically for binding/format info)
        if re.search(r'\bpaperback\b|\bsoftcover\b', all_text, re.I):
            data['format'] = 'paperback'
        elif re.search(r'\bhardcover\b|\bhard.?cover\b', all_text, re.I):
            data['format'] = 'hardcover'
        elif re.search(r'\bebook\b|e-book', all_text, re.I):
            data['format'] = 'ebook'

        # Extract pages
        pages_match = re.search(r'(\d+)\s*(?:pages|pp\.)', all_text, re.I)
        if pages_match:
            data['pages'] = int(pages_match.group(1))

        # Extract publication year - look for context clues like "Published" or "Release"
        # Avoid matching years that are in URLs or company founding dates
        pub_year_match = re.search(r'(?:Published|Release|Publication Date)[:\s]+(?:in\s+)?(\d{4})', all_text, re.I)
        if pub_year_match:
            year = int(pub_year_match.group(1))
            if 1900 <= year <= 2099:
                data['year_published'] = year

        return data
    except Exception as e:
        print(f"  [ERROR] Failed to fetch {book_url}: {e}")
        return {}

def scrape_catalog() -> List[Dict]:
    """Scrape ECW Press wrestling catalog."""
    print(f"Fetching {ECW_CATALOG}...")
    try:
        resp = session.get(ECW_CATALOG, timeout=15)
        resp.raise_for_status()
    except Exception as e:
        print(f"FATAL: {e}")
        return []

    soup = BeautifulSoup(resp.content, 'html.parser')

    # Extract unique products by URL
    links = soup.select('a[href*="/products/"]')
    unique_books = {}

    for link in links:
        href = link.get('href')
        if not href:
            continue

        # Get title
        title = link.get_text(strip=True)
        if not title:
            parent_p = link.find_parent('p')
            if parent_p:
                title = parent_p.get_text(strip=True)

        # Clean title of price info
        title = title.replace('From$', '|').split('|')[0].strip()

        if title and href not in unique_books:
            product_url = urljoin(ECW_CATALOG, href)
            unique_books[href] = {
                'title': title,
                'author': None,
                'url': product_url,
            }

    books = list(unique_books.values())
    print(f"Found {len(books)} unique books on catalog page")
    return books

# ============================================================================
# CATEGORIZATION HELPERS
# ============================================================================

WRESTLER_BIOGRAPHIES = {
    'bret hart': ('Bret Hart', 'about_wrestler'),
    'hitman': ('Bret Hart', 'about_wrestler'),
    'dynamite kid': ('Dynamite Kid', 'about_wrestler'),
    'the sheik': ('The Sheik (Ed Farhat)', 'about_wrestler'),
    'original sheik': ('The Sheik (Ed Farhat)', 'about_wrestler'),
    'ed farhat': ('The Sheik (Ed Farhat)', 'about_wrestler'),
    'gorilla monsoon': ('Gorilla Monsoon (Robert Marella)', 'about_wrestler'),
    'robert marella': ('Gorilla Monsoon (Robert Marella)', 'about_wrestler'),
    'verne gagne': ('Verne Gagne', 'about_wrestler'),
    'bobby heenan': ('Bobby Heenan', 'about_wrestler'),
    'the brain': ('Bobby Heenan', 'about_wrestler'),
    'greg oliver': ('Greg Oliver', 'by_wrestler'),  # Some books by Greg as author
    'foley': ('Mick Foley', 'about_wrestler'),
    'terry funk': ('Terry Funk', 'about_wrestler'),
    'johnny valentine': ('Johnny Valentine', 'about_wrestler'),
}

def categorize_book(title: str, author: Optional[str] = None) -> Tuple[str, Optional[str]]:
    """Determine category_code and subject_wrestler."""
    title_lower = title.lower()
    author_lower = (author or "").lower()

    # Check for biography indicators
    for keyword, (wrestler, cat) in WRESTLER_BIOGRAPHIES.items():
        if keyword in title_lower:
            return cat, wrestler

    # Default
    if 'fiction' in title_lower or 'novel' in title_lower:
        return 'fiction', None
    elif 'anthology' in title_lower or 'collection' in title_lower:
        return 'about_wrestling', None
    else:
        return 'about_wrestling', None

# ============================================================================
# MAIN
# ============================================================================

def main():
    dry_run = '--dry-run' in sys.argv

    # Copy DB to work directory
    print(f"Using DB: {DB}")
    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    # Scrape catalog
    catalog_books = scrape_catalog()
    if not catalog_books:
        print("ERROR: No books scraped from catalog. Aborting.")
        return

    print(f"\nFound {len(catalog_books)} books on listing page")

    # Enrich each book with detail-page data
    enriched = []
    for i, book in enumerate(catalog_books, 1):
        print(f"  [{i}/{len(catalog_books)}] {book['title'][:60]}")
        detail_data = scrape_book_detail(book['url'])
        book.update(detail_data)
        enriched.append(book)

    # Insert into DB
    inserted = 0
    updated = 0
    skipped = 0

    for book in enriched:
        title = book.get('title', '').strip()
        if not title:
            continue

        author = book.get('author')
        category_code, subject_wrestler = categorize_book(title, author)

        # Build insert data
        fields = {
            'category_code': category_code,
            'publisher': PUBLISHER,
            'country': COUNTRY,
            'format': book.get('format', 'unknown'),
            'confidence': 'high',
            'source_url': book.get('url', ''),
            'synopsis': book.get('synopsis'),
            'subject_wrestler': subject_wrestler,
        }

        if book.get('year_published'):
            fields['year_published'] = book['year_published']
        if book.get('isbn13'):
            fields['isbn13'] = book['isbn13']
        if book.get('isbn10'):
            fields['isbn10'] = book['isbn10']
        if book.get('pages'):
            fields['pages'] = book['pages']

        # Check if book already exists
        cur.execute("SELECT id FROM books WHERE LOWER(title) = LOWER(?)", (title,))
        existing = cur.fetchone()

        if existing:
            # Update existing
            bid = existing[0]
            if not dry_run:
                bid = upsert_book(cur, title=title, **fields)
            updated += 1
        else:
            # Insert new
            if not dry_run:
                bid = upsert_book(cur, title=title, **fields)
            inserted += 1

        # Link author if present
        if author and not dry_run:
            author_id = get_or_create_author(cur, author)
            link_author(cur, bid, author_id)

    if not dry_run:
        conn.commit()

    conn.close()

    # Copy back
    if not dry_run:
        print(f"\nDB updated at: {DB}")
    else:
        print("\n[DRY RUN - no changes made]")

    print(f"\n=== RESULTS ===")
    print(f"  Total books found: {len(enriched)}")
    print(f"  Inserted: {inserted}")
    print(f"  Updated: {updated}")
    print(f"  Skipped: {skipped}")

if __name__ == "__main__":
    main()
