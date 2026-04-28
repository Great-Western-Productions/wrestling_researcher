#!/usr/bin/env python3
"""
enrich_metadata.py — Enrich low-confidence books in wrestling_bibliography.db
                     using Open Library + Google Books + Internet Archive +
                     Library of Congress + (optional) Exa neural search.

USAGE
    python3 enrich_metadata.py                       # process all 'low' confidence books
    python3 enrich_metadata.py --limit 50            # only first 50
    python3 enrich_metadata.py --dry-run             # show what would happen
    python3 enrich_metadata.py --workers 16          # parallelism (default 8)
    python3 enrich_metadata.py --book-id 123         # single book by ID
    python3 enrich_metadata.py --reset-failed        # retry rows previously marked low_searched
    python3 enrich_metadata.py --no-archive          # skip Internet Archive
    python3 enrich_metadata.py --no-loc              # skip Library of Congress
    python3 enrich_metadata.py --no-exa              # skip Exa neural search
    python3 enrich_metadata.py --db /path/to/db      # alternate DB path

CREDENTIALS
    The script auto-loads ./.env, ../.env, and ../../.env (parent dirs of this
    file). It reads:

        GOOGLE_API_TOKEN          # Google Books API key (preferred name)
        GOOGLE_BOOKS_API_KEY      # legacy fallback name
        EXA_API_KEY               # Exa neural search API key (or EXA_KEY)

    Open Library, Internet Archive, and Library of Congress are keyless.

LOOKUP CHAIN
    For each book with confidence='low' AND year_published IS NULL the script
    walks five sources in order, stopping at the first acceptable match:

      1. Open Library     — keyless, broadest structured metadata, fastest.
      2. Google Books     — uses GOOGLE_API_TOKEN; best for recent / mainstream.
      3. Internet Archive — keyless; great for indie, fan-published, OOP titles.
      4. Library of Congress — keyless; authoritative for US-published books.
      5. Exa              — neural web search; restricted to trusted book domains
                            (Goodreads / Wikipedia / archive.org / ECW Press /
                            Crowbar Press / WorldCat / AbeBooks). Used only when
                            the four structured sources all miss. Confidence
                            tagged 'medium_search' since metadata is scraped
                            from page text rather than structured records.

    Each candidate is scored for wrestling-relevance (publisher, subject tags,
    title keywords, known wrestler authors). Results below threshold are
    rejected and the book is marked 'low_searched' so we don't requery
    endlessly.

RESUMABLE
    Re-running picks up where the last run left off. Already-enriched rows are
    not re-queried unless --reset-failed is passed (which resets 'low_searched'
    rows back to 'low').
"""
import argparse
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Optional

# ---------------------------------------------------------------------------
# .env loader (no dependency)
# ---------------------------------------------------------------------------

def load_env_files():
    """Read KEY=value lines from ./.env, ../.env, and ../../.env relative to
    this script. Handles `export KEY=value` lines too. Existing env vars
    take precedence over .env values."""
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(here, ".env"),
        os.path.join(here, "..", ".env"),
        os.path.join(here, "..", "..", ".env"),
    ]
    for path in candidates:
        path = os.path.normpath(path)
        if not os.path.exists(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if line.startswith("export "):
                        line = line[len("export "):]
                    if "=" not in line:
                        continue
                    key, _, val = line.partition("=")
                    key = key.strip()
                    val = val.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = val
        except Exception:
            pass

load_env_files()

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DEFAULT_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "wrestling_bibliography.db")

WRESTLING_PUBLISHERS = {
    "ecw press", "ecw", "insomniac press",
    "crowbar press",
    "sports publishing", "sports publishing llc", "triumph books",
    "pegasus books", "citadel press", "regan books", "regangbooks", "regan",
    "wwe books", "pocket books", "simon & schuster",
    "headline", "robson press", "john blake publishing",
    "grand central publishing", "harpercollins", "harper", "knopf",
    "thomas dunne books", "st. martin's press", "gotham books",
    "ammo books", "duke university press",
    "first second", "graphic universe",
    "shueisha", "shogakukan",
}

WRESTLING_KEYWORDS = {
    "wrestling", "wrestler", "wrestlers", "wwe", "wwf", "wcw", "ecw", "nwa",
    "lucha libre", "luchador", "puroresu", "professional wrestling",
    "sports entertainment", "kayfabe", "squared circle",
}

CATEGORY_RX = {
    "by_wrestler": re.compile(
        r"\bmy story\b|\bmy life\b|: my\b|: an autobiograph|memoir\b|"
        r"the autobiograph|: a wrestling memoir|told my story",
        re.IGNORECASE,
    ),
    "about_wrestler": re.compile(
        r"\bthe (true |real )?story of\b|\bthe life (and|of)\b|"
        r"\bbiograph|tribute|: a tribute|the legend of\b",
        re.IGNORECASE,
    ),
}

ACCEPT_SCORE = 3
EXACT_TITLE_BONUS = 5
WRESTLING_KEYWORD_HIT = 3
PUBLISHER_HIT = 4
KNOWN_AUTHOR_HIT = 5
SUBJECT_TAG_HIT = 2

# Title-similarity gate — independent of score. Must pass even for high-scoring
# matches, because some sources (esp. LoC) return loose word-OR results where a
# wrestling-keyword bonus alone can clear the score threshold for a totally
# unrelated book.
MIN_TITLE_OVERLAP = 0.5
TITLE_STOPWORDS = {
    "the", "a", "an", "of", "and", "or", "in", "to", "for", "on", "with",
    "at", "by", "is", "be", "my", "i", "as", "from", "this", "that", "but",
    "vs", "vs.", "&",
}

USER_AGENT = ("ProWrestlingResearcher/1.0 "
              "(contact: joshua.schairbaum@gmail.com)")

# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

@dataclass
class Match:
    title: str = ""
    authors: list = field(default_factory=list)
    year: Optional[int] = None
    publisher: Optional[str] = None
    isbn10: Optional[str] = None
    isbn13: Optional[str] = None
    pages: Optional[int] = None
    subjects: list = field(default_factory=list)
    source_api: str = ""        # "openlibrary" | "googlebooks" | "archive" | "loc"
    source_url: Optional[str] = None
    raw: dict = field(default_factory=dict)
    score: int = 0

# ---------------------------------------------------------------------------
# HTTP helper
# ---------------------------------------------------------------------------

def _http_get(url: str, timeout: int = 10) -> Optional[dict]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 429:
            time.sleep(2)
        return None
    except Exception:
        return None

def _http_post_json(url: str, body: dict, headers: dict = None,
                    timeout: int = 15) -> Optional[dict]:
    data = json.dumps(body).encode("utf-8")
    h = {"User-Agent": USER_AGENT, "Content-Type": "application/json"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 429:
            time.sleep(2)
        return None
    except Exception:
        return None

def _coerce_year(s) -> Optional[int]:
    """Extract a 4-digit year (1900–2099) from any string, list, or int."""
    if s is None:
        return None
    if isinstance(s, int):
        return s if 1900 <= s <= 2099 else None
    if isinstance(s, list):
        for item in s:
            y = _coerce_year(item)
            if y:
                return y
        return None
    m = re.search(r"\b(19\d{2}|20\d{2})\b", str(s))
    return int(m.group(1)) if m else None

def _query_title(title: str) -> str:
    """Reduce a stored title to a search-friendly form for the APIs.

    The title field often holds a long compound title like
        'Business Is About to Pick Up!: 50 Years of Wrestling in 50 Unforgettable Calls'
    Catalogs index the main title 'Business Is About to Pick Up' and reject the
    full string. Strip the subtitle, trailing punctuation, and cap the length.
    """
    if not title:
        return title
    # Split on the first subtitle delimiter. Common patterns: ': ', '!: ', '?: ', ' — ', ' – '
    parts = re.split(r"[!?]?:\s+|\s+[—–-]\s+", title, maxsplit=1)
    main = parts[0]
    # Trim trailing punctuation and quotes
    main = main.strip().strip("\"'.,;")
    return main[:80]

def _split_isbns(value) -> tuple:
    """Return (isbn10, isbn13) from a string or list of ISBN-ish values."""
    isbns = []
    if isinstance(value, list):
        isbns = value
    elif isinstance(value, str):
        isbns = re.findall(r"\d{9}[\dX]|\d{13}", value)
    isbns = [re.sub(r"[^\dX]", "", str(i)) for i in isbns if i]
    isbn10 = next((i for i in isbns if len(i) == 10), None)
    isbn13 = next((i for i in isbns if len(i) == 13), None)
    return isbn10, isbn13

# ---------------------------------------------------------------------------
# API clients
# ---------------------------------------------------------------------------

def search_openlibrary(title: str) -> list:
    q = urllib.parse.urlencode({"title": _query_title(title), "limit": 5})
    data = _http_get(f"https://openlibrary.org/search.json?{q}", timeout=8)
    if not data:
        return []
    matches = []
    for d in data.get("docs", [])[:5]:
        isbns = d.get("isbn") or []
        ol_key = d.get("key", "")
        m = Match(
            title=d.get("title") or "",
            authors=d.get("author_name") or [],
            year=d.get("first_publish_year"),
            publisher=(d.get("publisher") or [None])[0],
            isbn10=next((i for i in isbns if len(i) == 10), None),
            isbn13=next((i for i in isbns if len(i) == 13), None),
            pages=d.get("number_of_pages_median"),
            subjects=d.get("subject", []) or [],
            source_api="openlibrary",
            source_url=f"https://openlibrary.org{ol_key}" if ol_key else None,
            raw=d,
        )
        matches.append(m)
    return matches

def search_googlebooks(title: str, api_key: Optional[str] = None) -> list:
    params = {"q": f'intitle:"{_query_title(title)}"', "maxResults": "5"}
    if api_key:
        params["key"] = api_key
    q = urllib.parse.urlencode(params)
    data = _http_get(f"https://www.googleapis.com/books/v1/volumes?{q}", timeout=10)
    if not data:
        return []
    matches = []
    for it in data.get("items", [])[:5]:
        v = it.get("volumeInfo", {})
        ids = v.get("industryIdentifiers", []) or []
        isbn10 = next((i["identifier"] for i in ids if i.get("type") == "ISBN_10"), None)
        isbn13 = next((i["identifier"] for i in ids if i.get("type") == "ISBN_13"), None)
        m = Match(
            title=v.get("title") or "",
            authors=v.get("authors") or [],
            year=_coerce_year(v.get("publishedDate")),
            publisher=v.get("publisher"),
            isbn10=isbn10,
            isbn13=isbn13,
            pages=v.get("pageCount"),
            subjects=v.get("categories", []) or [],
            source_api="googlebooks",
            source_url=v.get("infoLink") or v.get("canonicalVolumeLink"),
            raw=v,
        )
        matches.append(m)
    return matches

def search_archive_org(title: str) -> list:
    """Internet Archive advancedsearch — restrict to mediatype:texts (books)."""
    # Wrap (cleaned) title in quotes for phrase match; restrict to texts.
    q = f'title:"{_query_title(title)}" AND mediatype:texts'
    fields = ["identifier", "title", "creator", "date", "publisher",
              "subject", "isbn", "language"]
    params = [("q", q), ("output", "json"), ("rows", "5")]
    for f in fields:
        params.append(("fl[]", f))
    url = f"https://archive.org/advancedsearch.php?{urllib.parse.urlencode(params)}"
    data = _http_get(url, timeout=10)
    if not data:
        return []
    docs = (data.get("response") or {}).get("docs", []) or []
    matches = []
    for d in docs[:5]:
        creators = d.get("creator")
        if isinstance(creators, str):
            creators = [creators]
        elif not creators:
            creators = []
        publisher = d.get("publisher")
        if isinstance(publisher, list):
            publisher = publisher[0] if publisher else None
        subjects = d.get("subject")
        if isinstance(subjects, str):
            subjects = [subjects]
        elif not subjects:
            subjects = []
        isbn10, isbn13 = _split_isbns(d.get("isbn"))
        identifier = d.get("identifier") or ""
        m = Match(
            title=d.get("title") or "",
            authors=creators,
            year=_coerce_year(d.get("date")),
            publisher=publisher,
            isbn10=isbn10,
            isbn13=isbn13,
            subjects=subjects,
            source_api="archive",
            source_url=f"https://archive.org/details/{identifier}" if identifier else None,
            raw=d,
        )
        matches.append(m)
    return matches

def search_loc(title: str) -> list:
    """Library of Congress — JSON API on the books collection.

    LoC search OR-matches words in `q` by default, so we phrase-quote the title
    AND require 'wrestling' to filter out the long tail of unrelated books that
    happen to share a word with our title.
    """
    # The LOC search API supports fo=json on /books/ endpoint.
    # Limit to original-format:book to filter out periodicals.
    quoted = f'"{_query_title(title)}" wrestling'
    params = {
        "q": quoted,
        "fo": "json",
        "c": "5",
        "fa": "original-format:book",
    }
    url = f"https://www.loc.gov/books/?{urllib.parse.urlencode(params)}"
    data = _http_get(url, timeout=12)
    if not data or "results" not in data:
        return []
    matches = []
    for r in (data.get("results") or [])[:5]:
        # Authors come back in "contributor" or "contributors", and are
        # often "Lastname, Firstname" format.
        contribs = r.get("contributor") or r.get("contributors") or []
        if isinstance(contribs, str):
            contribs = [contribs]
        # Try to flip "Last, First" to "First Last" for better matching.
        authors = []
        for c in contribs:
            c = (c or "").strip()
            if "," in c:
                last, first = c.split(",", 1)
                c = f"{first.strip()} {last.strip()}"
            if c:
                authors.append(c)
        # Dates can be in `date`, `dates`, or year fields.
        year = (_coerce_year(r.get("date"))
                or _coerce_year(r.get("dates"))
                or _coerce_year(r.get("title")))
        # ISBN sometimes lives at `item.number_isbn` or `number_isbn`.
        isbn_field = (r.get("number_isbn")
                      or (r.get("item") or {}).get("number_isbn")
                      or [])
        isbn10, isbn13 = _split_isbns(isbn_field)
        # Subjects.
        subjects = r.get("subject") or r.get("subjects") or []
        if isinstance(subjects, str):
            subjects = [subjects]
        # Publisher.
        publisher = None
        item = r.get("item") or {}
        if isinstance(item, dict):
            cs = item.get("created_published") or item.get("publication") or None
            if isinstance(cs, list) and cs:
                publisher = str(cs[0])
            elif isinstance(cs, str):
                publisher = cs
        m = Match(
            title=(r.get("title") or "").strip(),
            authors=authors,
            year=year,
            publisher=publisher,
            isbn10=isbn10,
            isbn13=isbn13,
            subjects=subjects,
            source_api="loc",
            source_url=r.get("id") or r.get("url"),
            raw=r,
        )
        matches.append(m)
    return matches

EXA_TRUSTED_DOMAINS = [
    "goodreads.com",
    "en.wikipedia.org",
    "archive.org",
    "openlibrary.org",
    "ecwpress.com",
    "crowbarpress.com",
    "worldcat.org",
    "abebooks.com",
    "loc.gov",
    "books.google.com",
]

def _scrape_metadata_from_text(text: str, fallback_year: Optional[int] = None) -> dict:
    """Best-effort extract of {year, isbn10, isbn13, publisher, authors} from
    arbitrary page text returned by Exa. We only return what we can find
    confidently; missing fields are left out."""
    out = {}
    if not text:
        return out
    # ISBN-13 (978/979 + 10 digits, possibly with dashes/spaces stripped)
    isbn13_m = re.search(r"\b(?:ISBN(?:-13)?:?\s*)?(97[89][\d\s\-]{10,16})\b", text)
    if isbn13_m:
        cand = re.sub(r"[^\d]", "", isbn13_m.group(1))
        if len(cand) == 13:
            out["isbn13"] = cand
    # ISBN-10
    isbn10_m = re.search(r"\bISBN(?:-10)?:?\s*([\d\-\s]{10,14}[\dX])\b", text, re.IGNORECASE)
    if isbn10_m:
        cand = re.sub(r"[^\dX]", "", isbn10_m.group(1).upper())
        if len(cand) == 10:
            out["isbn10"] = cand
    # Year — prefer 'Published <Month> <Year>' or 'First published in <Year>'.
    year_m = (re.search(r"[Ff]irst published[^\d]{0,30}(\b(?:19|20)\d{2}\b)", text)
              or re.search(r"[Pp]ublished[^\d]{0,30}(\b(?:19|20)\d{2}\b)", text)
              or re.search(r"\b(?:Copyright|©)\s*(\b(?:19|20)\d{2}\b)", text)
              or re.search(r"\b(19[5-9]\d|20[0-3]\d)\b", text))
    if year_m:
        try:
            out["year"] = int(year_m.group(1))
        except (ValueError, IndexError):
            pass
    elif fallback_year:
        out["year"] = fallback_year
    # Publisher — look for 'Publisher: X' or 'Published by X'
    pub_m = (re.search(r"[Pp]ublisher:\s*([A-Z][^\n,;]{2,80})", text)
             or re.search(r"[Pp]ublished by\s+([A-Z][^\n,;]{2,80})", text))
    if pub_m:
        publisher = pub_m.group(1).strip().rstrip(".,;")
        # Trim trailing parenthetical or extra clauses
        publisher = re.split(r"\s+(?:on|in)\s+", publisher)[0]
        if 2 < len(publisher) < 100:
            out["publisher"] = publisher
    # Authors — look for 'by <Name>' near the start, or "Author(s): X"
    auth_m = (re.search(r"(?:^|\n)\s*by\s+([A-Z][A-Za-z'.\-]+(?:\s+[A-Z][A-Za-z'.\-]+){0,3})", text)
              or re.search(r"[Aa]uthors?:?\s+([A-Z][A-Za-z'.\-]+(?:\s+[A-Z][A-Za-z'.\-]+){0,3})", text))
    if auth_m:
        out["authors"] = [auth_m.group(1).strip()]
    return out

def search_exa(title: str, api_key: str) -> list:
    """Exa neural search restricted to trusted book domains.

    Uses the searchAndContents-style endpoint to get page text alongside
    each result, then scrapes ISBN/year/publisher/author out of that text.
    """
    body = {
        "query": f'"{_query_title(title)}" wrestling book',
        "numResults": 5,
        "type": "auto",
        "category": "book",
        "includeDomains": EXA_TRUSTED_DOMAINS,
        "contents": {
            "text": {"maxCharacters": 4000, "includeHtmlTags": False},
        },
    }
    data = _http_post_json(
        "https://api.exa.ai/search",
        body,
        headers={"x-api-key": api_key, "Authorization": f"Bearer {api_key}"},
    )
    if not data:
        return []
    matches = []
    for r in (data.get("results") or [])[:5]:
        url = r.get("url") or ""
        page_title = r.get("title") or ""
        page_text = ""
        # Exa returns text either as r["text"] (string) or r["text"]["text"]
        if isinstance(r.get("text"), str):
            page_text = r["text"]
        elif isinstance(r.get("text"), dict):
            page_text = r["text"].get("text") or ""
        # Year fallback from publishedDate
        fallback_year = None
        if r.get("publishedDate"):
            fallback_year = _coerce_year(r["publishedDate"])
        scraped = _scrape_metadata_from_text(page_text, fallback_year=fallback_year)
        m = Match(
            title=page_title.split(" - ")[0].strip() or page_title or title,
            authors=scraped.get("authors", []),
            year=scraped.get("year"),
            publisher=scraped.get("publisher"),
            isbn10=scraped.get("isbn10"),
            isbn13=scraped.get("isbn13"),
            subjects=[],
            source_api="exa",
            source_url=url,
            raw=r,
        )
        matches.append(m)
    return matches

# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def score_match(m: Match, target_title: str, known_wrestler_authors: set) -> int:
    score = 0
    target_l = target_title.lower().strip()
    cand_l = (m.title or "").lower().strip()

    if cand_l == target_l:
        score += EXACT_TITLE_BONUS
    else:
        if cand_l and (cand_l in target_l or target_l in cand_l):
            score += 2
        target_toks = set(re.findall(r"\w+", target_l))
        cand_toks = set(re.findall(r"\w+", cand_l))
        if target_toks and cand_toks:
            overlap = len(target_toks & cand_toks) / len(target_toks | cand_toks)
            if overlap >= 0.7:
                score += 2
            elif overlap >= 0.4:
                score += 1

    haystack = " ".join([m.title or ""] + (m.subjects or [])).lower()
    for kw in WRESTLING_KEYWORDS:
        if kw in haystack:
            score += WRESTLING_KEYWORD_HIT
            break

    if any("biography" in (s or "").lower() for s in m.subjects):
        score += SUBJECT_TAG_HIT

    pub_l = (m.publisher or "").lower()
    if any(p in pub_l for p in WRESTLING_PUBLISHERS):
        score += PUBLISHER_HIT

    for a in m.authors or []:
        if a.lower() in known_wrestler_authors:
            score += KNOWN_AUTHOR_HIT
            break

    return score

def title_similarity_ok(target: str, candidate: str) -> bool:
    """Independent gate: candidate title must share enough tokens with target.

    Pass if any of:
      - target appears as a word-bounded substring of candidate (or vice versa)
      - meaningful-token overlap >= MIN_TITLE_OVERLAP

    'Meaningful' = words minus TITLE_STOPWORDS. The word-bounded substring check
    (rather than raw `in`) is what stops e.g. 'hitman' matching 'whitman'.
    """
    target_l = (target or "").lower().strip()
    cand_l = (candidate or "").lower().strip()
    if not target_l or not cand_l:
        return False
    # Normalize: replace non-word chars with single spaces, pad with spaces,
    # then check for ' phrase ' substring -- this enforces word boundaries.
    def _norm(s):
        return " " + re.sub(r"\W+", " ", s).strip() + " "
    target_n = _norm(target_l)
    cand_n = _norm(cand_l)
    if target_n.strip() and (target_n in cand_n or cand_n in target_n):
        return True
    target_toks = set(re.findall(r"\w+", target_l)) - TITLE_STOPWORDS
    cand_toks = set(re.findall(r"\w+", cand_l)) - TITLE_STOPWORDS
    if not target_toks:
        return False
    return (len(target_toks & cand_toks) / len(target_toks)) >= MIN_TITLE_OVERLAP

def best_match(candidates: list, target_title: str,
               known_wrestler_authors: set) -> Optional[Match]:
    if not candidates:
        return None
    for m in candidates:
        m.score = score_match(m, target_title, known_wrestler_authors)
    # Drop candidates whose title doesn't even match the query.
    candidates = [m for m in candidates
                  if title_similarity_ok(target_title, m.title)]
    if not candidates:
        return None
    candidates.sort(key=lambda m: m.score, reverse=True)
    top = candidates[0]
    return top if top.score >= ACCEPT_SCORE else None

# ---------------------------------------------------------------------------
# DB ops
# ---------------------------------------------------------------------------

def get_known_wrestler_authors(cur) -> set:
    cur.execute("SELECT name FROM authors WHERE is_wrestler = 1")
    return {row[0].lower() for row in cur.fetchall()}

def categorize(title: str, match: Match) -> str:
    t = title.lower()
    if CATEGORY_RX["by_wrestler"].search(t):
        return "by_wrestler"
    for a in match.authors or []:
        if a and a.lower() in t:
            return "by_wrestler"
    if any("biography" in (s or "").lower() for s in match.subjects or []):
        return "about_wrestler"
    if CATEGORY_RX["about_wrestler"].search(t):
        return "about_wrestler"
    return "about_wrestling"

def apply_match(conn, book_id: int, title: str, match: Match) -> None:
    cur = conn.cursor()
    cat = categorize(title, match)
    # Web-scraped hits (Exa) get a softer confidence because metadata is
    # extracted from page text rather than structured catalog records.
    confidence = "medium_search" if match.source_api == "exa" else "medium"
    cur.execute(
        """UPDATE books SET
            year_published = COALESCE(year_published, ?),
            publisher      = COALESCE(publisher, ?),
            isbn13         = COALESCE(isbn13, ?),
            isbn10         = COALESCE(isbn10, ?),
            pages          = COALESCE(pages, ?),
            category_code  = ?,
            confidence     = ?,
            source_url     = COALESCE(source_url, ?)
           WHERE id = ?""",
        (match.year, match.publisher, match.isbn13, match.isbn10, match.pages,
         cat, confidence, match.source_url, book_id),
    )
    title_l = title.lower()
    for a in (match.authors or [])[:4]:
        a = a.strip()
        if not a:
            continue
        cur.execute("SELECT id FROM authors WHERE name = ?", (a,))
        row = cur.fetchone()
        if row:
            aid = row[0]
        else:
            is_wr = 1 if a.lower() in title_l or cat == "by_wrestler" else 0
            cur.execute("INSERT INTO authors (name, is_wrestler) VALUES (?, ?)", (a, is_wr))
            aid = cur.lastrowid
        cur.execute(
            "INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')",
            (book_id, aid),
        )

def mark_no_match(conn, book_id: int) -> None:
    conn.execute("UPDATE books SET confidence = 'low_searched' WHERE id = ?", (book_id,))

# ---------------------------------------------------------------------------
# Lookup chain
# ---------------------------------------------------------------------------

def lookup(title: str, google_key: Optional[str], known_wrestlers: set,
           use_archive: bool, use_loc: bool,
           exa_key: Optional[str] = None) -> tuple:
    """Returns (Match | None, source_attempted_str)."""
    # 1. Open Library
    candidates = search_openlibrary(title)
    match = best_match(candidates, title, known_wrestlers)
    if match:
        return match, "openlibrary"

    # 2. Google Books
    if google_key:
        candidates = search_googlebooks(title, api_key=google_key)
        match = best_match(candidates, title, known_wrestlers)
        if match:
            return match, "googlebooks"

    # 3. Internet Archive
    if use_archive:
        candidates = search_archive_org(title)
        match = best_match(candidates, title, known_wrestlers)
        if match:
            return match, "archive"

    # 4. Library of Congress
    if use_loc:
        candidates = search_loc(title)
        match = best_match(candidates, title, known_wrestlers)
        if match:
            return match, "loc"

    # 5. Exa (neural web search, restricted to trusted book domains)
    if exa_key:
        candidates = search_exa(title, exa_key)
        match = best_match(candidates, title, known_wrestlers)
        if match:
            return match, "exa"

    return None, "all"

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(
        description="Enrich wrestling bibliography from Open Library, Google Books, "
                    "Internet Archive, and Library of Congress",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--db", default=DEFAULT_DB, help="Path to wrestling_bibliography.db")
    p.add_argument("--limit", type=int, default=None, help="Process at most N books this run")
    p.add_argument("--workers", type=int, default=8, help="Concurrent API requests (default 8)")
    p.add_argument("--google-key", default=None,
                   help="Google Books API key (else $GOOGLE_API_TOKEN or $GOOGLE_BOOKS_API_KEY)")
    p.add_argument("--exa-key", default=None,
                   help="Exa neural search API key (else $EXA_API_KEY or $EXA_KEY)")
    p.add_argument("--no-archive", action="store_true", help="Skip Internet Archive fallback")
    p.add_argument("--no-loc", action="store_true", help="Skip Library of Congress fallback")
    p.add_argument("--no-exa", action="store_true", help="Skip Exa neural search fallback")
    p.add_argument("--book-id", type=int, default=None, help="Process a single book by ID")
    p.add_argument("--reset-failed", action="store_true",
                   help="Reset 'low_searched' rows back to 'low' before running")
    p.add_argument("--dry-run", action="store_true", help="Show matches but don't write to DB")
    p.add_argument("--verbose", "-v", action="store_true", help="Print every match decision")
    p.add_argument("--commit-every", type=int, default=20,
                   help="Commit DB after every N enriched books (default 20)")
    args = p.parse_args()

    google_key = (args.google_key
                  or os.environ.get("GOOGLE_API_TOKEN")
                  or os.environ.get("GOOGLE_BOOKS_API_KEY"))
    exa_key = (args.exa_key
               or os.environ.get("EXA_API_KEY")
               or os.environ.get("EXA_KEY"))
    use_archive = not args.no_archive
    use_loc = not args.no_loc
    use_exa = (not args.no_exa) and bool(exa_key)

    print(f"DB              : {args.db}")
    print(f"Open Library    : yes (keyless)")
    print(f"Google Books    : {'yes' if google_key else 'NO  -- set GOOGLE_API_TOKEN to enable'}")
    print(f"Internet Archive: {'yes' if use_archive else 'no (--no-archive)'}")
    print(f"LoC             : {'yes' if use_loc else 'no (--no-loc)'}")
    print(f"Exa             : {'yes' if use_exa else ('no (--no-exa)' if args.no_exa else 'NO  -- set EXA_API_KEY to enable')}")
    print()

    if not os.path.exists(args.db):
        print(f"DB not found: {args.db}", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(args.db, check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON")

    if args.reset_failed:
        n = conn.execute("UPDATE books SET confidence='low' WHERE confidence='low_searched'").rowcount
        conn.commit()
        print(f"Reset {n} previously-failed rows back to 'low'")

    cur = conn.cursor()
    known_wrestlers = get_known_wrestler_authors(cur)
    print(f"Known wrestler-authors in DB: {len(known_wrestlers)}")

    if args.book_id:
        cur.execute("SELECT id, title FROM books WHERE id = ?", (args.book_id,))
    else:
        sql = ("SELECT id, title FROM books "
               "WHERE confidence = 'low' AND year_published IS NULL "
               "ORDER BY id")
        if args.limit:
            sql += f" LIMIT {int(args.limit)}"
        cur.execute(sql)
    todo = cur.fetchall()
    print(f"Books to process: {len(todo)}")

    if args.dry_run:
        print("(dry-run — DB will not be modified)")

    enriched = 0
    rejected = 0
    failed_api = 0
    counts_by_source = {"openlibrary": 0, "googlebooks": 0, "archive": 0,
                        "loc": 0, "exa": 0}
    t_start = time.time()

    def work(item):
        bid, title = item
        match, source = lookup(title, google_key, known_wrestlers,
                               use_archive, use_loc,
                               exa_key if use_exa else None)
        time.sleep(0.15)
        return bid, title, match, source

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(work, item): item for item in todo}
        for i, fut in enumerate(as_completed(futures)):
            try:
                bid, title, match, source = fut.result()
            except Exception:
                failed_api += 1
                continue

            if not match:
                rejected += 1
                if args.verbose:
                    print(f"  [skip] {title[:60]:60} (no match scored >= {ACCEPT_SCORE})")
                if not args.dry_run:
                    mark_no_match(conn, bid)
                continue

            counts_by_source[match.source_api] = counts_by_source.get(match.source_api, 0) + 1

            if args.verbose:
                print(f"  [hit:{match.source_api[:3]} score={match.score}] {title[:48]:48}"
                      f" -> {match.title[:36]} ({match.year}) {match.authors[:1]}")
            if not args.dry_run:
                apply_match(conn, bid, title, match)
            enriched += 1

            if enriched and enriched % args.commit_every == 0 and not args.dry_run:
                conn.commit()
                rate = (enriched + rejected) / max(time.time() - t_start, 0.1)
                print(f"  ... {i+1}/{len(todo)} processed | enriched={enriched} "
                      f"rejected={rejected} | {rate:.1f} req/s")

    if not args.dry_run:
        conn.commit()

    elapsed = time.time() - t_start
    print()
    print(f"Done in {elapsed:.0f}s")
    print(f"  enriched      : {enriched}")
    for k, v in counts_by_source.items():
        if v:
            print(f"    via {k:<13}: {v}")
    print(f"  rejected      : {rejected} (no good match -- marked low_searched)")
    print(f"  api failures  : {failed_api}")
    print()
    if not args.dry_run:
        cur.execute("SELECT confidence, COUNT(*) FROM books GROUP BY confidence ORDER BY 2 DESC")
        for r in cur.fetchall():
            print(f"  {r[0]}: {r[1]}")
    conn.close()

if __name__ == "__main__":
    main()
