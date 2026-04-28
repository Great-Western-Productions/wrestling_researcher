#!/usr/bin/env python3
"""
ingest_pwi_profightdb.py

Ingest PWI monthly rankings from ProFightDB into the wrestling_bibliography.db.

Source: http://www.profightdb.com/pwi-monthly-index.html
Per ProFightDB ToS, reuse with link-back is allowed; every persisted ranking_lists
row carries source_url with the section anchor for attribution.

Behavior:
  - Discovers all issue URLs from the index.
  - For each issue: parses heading (cover date), period date, and every ranking
    section. Upserts periodical_issues, ranking_lists, ranking_entries.
  - Resolves wrestler names via primary_ring_name + other_ring_names (tokenized),
    falling back to rapidfuzz WRatio >= 92.
  - NEVER creates new wrestler rows. Tag-team factions are auto-created
    (confidence='low') so subsequent issues can resolve to the same FK.
  - Idempotent on rerun.

Usage:
  python3 ingest_pwi_profightdb.py --year 1984          # pilot
  python3 ingest_pwi_profightdb.py                      # all years
  python3 ingest_pwi_profightdb.py --year-from 1979 --year-to 1994
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import shutil
import sqlite3
import sys
import time
import unicodedata
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from rapidfuzz import fuzz, process

# --- Configuration ----------------------------------------------------------

PROFIGHTDB_BASE = "http://www.profightdb.com"
PWI_INDEX_URL = f"{PROFIGHTDB_BASE}/pwi-monthly-index.html"

USER_AGENT = "WFIA-bibliography-bot/1.0 (research; contact joshua.schairbaum@gmail.com)"
HEADERS = {"User-Agent": USER_AGENT}
SLEEP = float(os.environ.get("PWI_SLEEP", "1.5"))
RETRY_DELAY = 5
TIMEOUT = 15

DB_PATH = Path(os.environ.get(
    "PWI_DB_PATH",
    str(Path(__file__).parent / "wrestling_bibliography.db"),
))
QUEUES_DIR = Path(__file__).parent / "queues"
DRIVE_MAGAZINES_ROOT = Path(
    "/Users/jschairb-gwp/Library/CloudStorage/"
    "GoogleDrive-josh@greatwesternproductions.com/My Drive/BACKGROUND_RESEARCH/Magazines"
)
# When invoked under the workspace bash sandbox, paths are remapped.
SANDBOX_MAGAZINES_ROOT = Path("/sessions/great-laughing-babbage/mnt/Magazines")

PWI_PERIODICAL_QUERY = (
    "SELECT id FROM periodicals "
    "WHERE title LIKE 'Pro Wrestling Illustrated%' AND year_started = 1979"
)

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}
# Seasonal issues: mid-month dates so they don't collide with monthly issues
# under the (periodical_id, publication_date) UNIQUE constraint. The original
# 'Spring 1984' etc. label is preserved in periodical_issues.issue_number.
SEASONS = {
    "spring":  ("03", "15"),
    "summer":  ("06", "15"),
    "fall":    ("09", "15"),
    "winter":  ("12", "15"),
    "holiday": ("12", "25"),
}

# Map PWI list label -> (list_scope, territory_id_or_None)
# territory ids are filled at runtime via build_territory_map()
LIST_SCOPE_MAP = {
    # Core ungrouped
    "Top 10": ("singles", None),
    "Tag Teams": ("tag", None),
    "Most Popular": ("most_popular", None),
    "Most Hated": ("most_hated", None),
    "Women": ("women", None),
    "Junior Heavyweights": ("jr_heavyweight", None),
    "Cruiserweight": ("cruiserweight", None),
    "Cruiserweights": ("cruiserweight", None),
    # Promotions (national)
    "WWF": ("promotion", "WWF"),
    "WWWF": ("promotion", "WWF"),
    "WWE": ("promotion", "WWF"),
    "AWA": ("promotion", "AWA"),
    "NWA": ("promotion", None),  # NWA is an alliance; many promotions; leave NULL
    "WCW": ("promotion", "WCW"),
    "ECW": ("promotion", "ECW"),
    "AEW": ("promotion", "AEW"),
    "TNA": ("promotion", "TNA"),
    "Impact": ("promotion", "TNA"),
    "ROH": ("promotion", "ROH"),
    "Ring of Honor": ("promotion", "ROH"),
    # Territories
    "Florida": ("territory", "Florida"),
    "Georgia": ("territory", "Georgia"),
    "Mid-Atlantic": ("territory", "Mid-Atlantic"),
    "Mid-South": ("territory", "Mid-South"),
    "Mid-Southern": ("territory", "Mid-Southern"),
    "Northwest": ("territory", "Northwest"),
    "World Class": ("territory", "World Class"),
    "Southwest": ("territory", "Southwest"),
    "Continental": ("territory", "Continental"),
    "Continental/USA": ("territory", "Continental"),
    "Missouri": ("territory", "Missouri"),
    "Stampede": ("territory", "Stampede"),
    "PNW": ("territory", "Northwest"),
    "California": ("territory", "California"),
    "Smoky Mountain": ("territory", "Smoky Mountain"),
    "Wild West": ("territory", "Wild West"),
    "IWCCW": ("territory", "IWCCW"),
    "ICW": ("territory", "ICW"),
    "Global": ("territory", "Global"),
    "USWA": ("territory", "USWA"),
    "USWA/CWA": ("territory", "USWA"),
    "USA": ("territory", "USA"),
    "NWF": ("territory", "NWF"),
    "CWA": ("territory", "Continental"),
    "WWA": ("territory", "WWA"),
    "UWF": ("territory", "UWF"),
    "Music City": ("territory", "Music City"),
    "ECWA": ("territory", "ECWA"),
    "Puerto Rico": ("territory", "Puerto Rico"),
    "International": ("territory", "International"),
    # International
    "All Japan": ("international", "All Japan"),
    "New Japan": ("international", "New Japan"),
    "EMLL": ("international", "EMLL"),
    "AAA": ("international", "AAA"),
    "Promo Azteca": ("international", "Promo Azteca"),
    "WWC": ("international", "Puerto Rico"),
    "Mexico": ("international", "EMLL"),
    "Japan": ("international", "All Japan"),
}

# Hand-curated mapping from PWI label to a canonical territory in the DB.
# Resolved at runtime against territories.name / short_name / aliases.
TERRITORY_LOOKUP_HINTS = {
    "WWF": ["World Wrestling Federation"],
    "AWA": ["American Wrestling Association"],
    "WCW": ["World Championship Wrestling"],
    "Florida": ["Championship Wrestling from Florida"],
    "Georgia": ["Georgia Championship Wrestling"],
    "Mid-Atlantic": ["Jim Crockett Promotions"],
    "Mid-South": ["Mid-South Wrestling"],
    "Mid-Southern": ["Continental Wrestling Association"],     # Memphis-area territory
    "Northwest": ["Pacific Northwest Wrestling"],
    "World Class": ["World Class Championship Wrestling"],
    "Southwest": ["Southwest Championship Wrestling"],
    "Continental": ["Continental Wrestling Association"],
    "Stampede": ["Stampede Wrestling"],
    "Smoky Mountain": ["Smoky Mountain Wrestling"],
    "USWA": ["United States Wrestling Association"],
    "Puerto Rico": ["World Wrestling Council"],
}

# --- Helpers ----------------------------------------------------------------

def magazines_root() -> Path:
    """Pick whichever Magazines path actually exists in this environment."""
    if DRIVE_MAGAZINES_ROOT.exists():
        return DRIVE_MAGAZINES_ROOT
    if SANDBOX_MAGAZINES_ROOT.exists():
        return SANDBOX_MAGAZINES_ROOT
    return DRIVE_MAGAZINES_ROOT  # default; lookup will simply find nothing

def normalize(name: str) -> str:
    """Lower-case, accent-fold, strip punctuation/whitespace."""
    if not name:
        return ""
    n = unicodedata.normalize("NFKD", name)
    n = "".join(ch for ch in n if not unicodedata.combining(ch))
    n = n.lower().strip()
    n = re.sub(r"[\"'`.,!?]", "", n)
    n = re.sub(r"\s+", " ", n)
    return n

def parse_period_date(text: str, fallback_year: int) -> Optional[str]:
    """Parse 'Mar 9th, 1984' or 'May 3rd, 1984' -> '1984-03-09'."""
    if not text:
        return None
    t = text.strip()
    # Strip ordinal suffixes
    t = re.sub(r"(\d+)(st|nd|rd|th)", r"\1", t, flags=re.I)
    # Try several formats
    fmts = [
        "%b %d, %Y", "%B %d, %Y", "%b %d %Y", "%B %d %Y",
        "%d %b %Y", "%d %B %Y",
    ]
    import datetime as dt
    for f in fmts:
        try:
            return dt.datetime.strptime(t, f).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None

def parse_heading(heading: str) -> tuple[Optional[str], Optional[str]]:
    """
    Pull cover_date as 'YYYY-MM-01' and a season label from a heading like
    'Pro Wrestling Illustrated Monthly Ratings - September 1984'.
    Returns (publication_date, issue_label).
    """
    m = re.search(
        r"(January|February|March|April|May|June|July|August|September|October|November|December|"
        r"Spring|Summer|Fall|Winter|Holiday)\s+(\d{4})",
        heading, re.I,
    )
    if not m:
        return None, None
    word = m.group(1).lower()
    year = int(m.group(2))
    if word in MONTHS:
        return f"{year:04d}-{MONTHS[word]:02d}-01", None
    if word in SEASONS:
        mo, day = SEASONS[word]
        return f"{year:04d}-{mo}-{day}", f"{m.group(1).title()} {year}"
    return None, None

def fetch(url: str) -> Optional[str]:
    """Polite GET with one retry on non-200 / errors."""
    for attempt in (1, 2):
        try:
            r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
            if r.status_code == 200:
                return r.text
            print(f"  [warn] {url} -> {r.status_code} (attempt {attempt})")
        except requests.RequestException as e:
            print(f"  [warn] {url} -> {e} (attempt {attempt})")
        if attempt == 1:
            time.sleep(RETRY_DELAY)
    print(f"  [skip] {url}")
    return None

# --- Resolution -------------------------------------------------------------

class WrestlerResolver:
    def __init__(self, conn: sqlite3.Connection):
        self.lookup: dict[str, int] = {}     # normalized name -> wrestler_id
        self.choices: list[tuple[str, int, int]] = []  # (norm_name, wrestler_id, debut_year_or_0)
        for wid, primary, others, debut in conn.execute(
            "SELECT id, primary_ring_name, other_ring_names, debut_year FROM wrestlers"
        ):
            debut = debut or 0
            names = [primary]
            if others:
                names += [s.strip() for s in others.split(",") if s.strip()]
            for n in names:
                norm = normalize(n)
                if not norm:
                    continue
                if norm not in self.lookup:
                    self.lookup[norm] = wid
                self.choices.append((norm, wid, debut))

    def resolve(self, printed_name: str, issue_year: Optional[int] = None) -> Optional[int]:
        norm = normalize(printed_name)
        if not norm:
            return None
        wid = self.lookup.get(norm)
        if wid:
            return wid
        # Fuzzy
        best = process.extractOne(
            norm, [c[0] for c in self.choices],
            scorer=fuzz.WRatio, score_cutoff=92,
        )
        if not best:
            return None
        # process.extractOne returns (match, score, index)
        idx = best[2]
        return self.choices[idx][1]

def build_territory_map(conn: sqlite3.Connection) -> dict[str, int]:
    """Return label -> territory_id using TERRITORY_LOOKUP_HINTS + name/alias match."""
    tmap: dict[str, int] = {}
    for label, hints in TERRITORY_LOOKUP_HINTS.items():
        for h in hints:
            row = conn.execute(
                "SELECT id FROM territories WHERE name = ? LIMIT 1", (h,)
            ).fetchone()
            if row:
                tmap[label] = row[0]
                break
    return tmap

def upsert_pending_wrestler(conn: sqlite3.Connection,
                             printed_name: str,
                             pfdb_id: Optional[int],
                             pfdb_slug: Optional[str],
                             publication_date: str) -> Optional[int]:
    """
    Upsert a pending wrestler row keyed on profightdb_id (preferred) or
    normalized_name (fallback). Bumps occurrence_count and stretches
    first_seen_date / last_seen_date. Appends new printed-name variants to
    other_printed_names.

    Returns the pending_wrestlers.id, or None if printed_name is empty.
    """
    if not printed_name:
        return None
    norm = normalize(printed_name)
    if not norm:
        return None
    row = None
    if pfdb_id is not None:
        row = conn.execute(
            "SELECT id, printed_name, other_printed_names, first_seen_date, last_seen_date, occurrence_count "
            "FROM pending_wrestlers WHERE profightdb_id=?", (pfdb_id,),
        ).fetchone()
    if row is None:
        row = conn.execute(
            "SELECT id, printed_name, other_printed_names, first_seen_date, last_seen_date, occurrence_count "
            "FROM pending_wrestlers WHERE normalized_name=?", (norm,),
        ).fetchone()
    if row:
        pid, existing_printed, others, first_seen, last_seen, count = row
        new_first = min(first_seen, publication_date) if first_seen else publication_date
        new_last  = max(last_seen,  publication_date) if last_seen  else publication_date
        # Track alternative printed forms
        seen_forms = set()
        if existing_printed:
            seen_forms.add(existing_printed)
        if others:
            seen_forms.update(s.strip() for s in others.split("|") if s.strip())
        seen_forms.add(printed_name)
        # Keep printed_name as-is; aggregate the rest into other_printed_names
        alt = sorted(s for s in seen_forms if s and s != existing_printed)
        new_others = "|".join(alt) if alt else None
        conn.execute(
            """UPDATE pending_wrestlers
                 SET other_printed_names = ?,
                     first_seen_date    = ?,
                     last_seen_date     = ?,
                     occurrence_count   = ?,
                     profightdb_id      = COALESCE(profightdb_id, ?),
                     profightdb_slug    = COALESCE(profightdb_slug, ?)
               WHERE id = ?""",
            (new_others, new_first, new_last, count + 1, pfdb_id, pfdb_slug, pid),
        )
        return pid
    cur = conn.execute(
        """INSERT INTO pending_wrestlers
             (profightdb_id, profightdb_slug, printed_name, normalized_name,
              first_seen_date, last_seen_date, occurrence_count)
           VALUES (?, ?, ?, ?, ?, ?, 1)""",
        (pfdb_id, pfdb_slug, printed_name, norm, publication_date, publication_date),
    )
    return cur.lastrowid


def get_or_create_tag_team(conn: sqlite3.Connection, members: list[str], year: Optional[int]) -> Optional[int]:
    """
    Tag teams listed in PWI rankings show as two member rows. We synthesize a
    name 'A & B' (alphabetical for stability) and look up factions by exact
    name. If absent, create with confidence='low'.
    """
    cleaned = [m.strip() for m in members if m and m.strip()]
    if len(cleaned) < 2:
        return None
    # Alphabetical for stable name
    canon_name = " & ".join(sorted(cleaned, key=lambda s: s.lower()))
    row = conn.execute(
        "SELECT id FROM factions WHERE name = ? AND type='tag_team'", (canon_name,)
    ).fetchone()
    if row:
        return row[0]
    # Insert
    cur = conn.execute(
        """INSERT INTO factions(name, type, formed_year, confidence, source_url, notes)
           VALUES (?, 'tag_team', ?, 'low', NULL, 'auto-created from PWI ranking')""",
        (canon_name, year),
    )
    return cur.lastrowid

# --- Parsing ----------------------------------------------------------------

def discover_issue_urls(year_filter: Optional[set[int]] = None) -> list[tuple[str, str, int]]:
    """
    Returns a list of (issue_label, absolute_url, profightdb_id), de-duplicated,
    optionally filtered by year.
    """
    cache_path = os.environ.get("PWI_INDEX_CACHE")
    body: Optional[str] = None
    if cache_path and Path(cache_path).exists():
        body = Path(cache_path).read_text()
    if body is None:
        body = fetch(PWI_INDEX_URL)
    if not body:
        raise SystemExit("Failed to fetch PWI index page.")
    soup = BeautifulSoup(body, "html.parser")
    seen: dict[str, tuple[str, str, int]] = {}
    for a in soup.select("a[href]"):
        href = a.get("href", "")
        m = re.search(r"/pwi-monthly/([^#]+?)-(\d+)\.html$", href.split("#")[0])
        if not m:
            continue
        slug = m.group(1)
        pid = int(m.group(2))
        # Only keep the bare issue link (no anchor) once
        url = urljoin(PROFIGHTDB_BASE, href.split("#")[0])
        label = a.text.strip()
        if not re.match(r"^(January|February|March|April|May|June|July|August|September|October|November|December|Spring|Summer|Fall|Winter|Holiday)\s+\d{4}$", label, re.I):
            continue
        if year_filter is not None:
            ym = re.search(r"(\d{4})", label)
            if not ym or int(ym.group(1)) not in year_filter:
                continue
        if url not in seen:
            seen[url] = (label, url, pid)
    return list(seen.values())

def parse_issue(html: str, issue_url: str, profightdb_id: int):
    """
    Returns dict:
      {
        'label': 'September 1984',
        'publication_date': '1984-09-01',
        'issue_number': None or 'Summer 1984',
        'period_date': '1984-05-03' or None,
        'sections': [
            {'list_label': 'Top 10', 'entries': [(rank, entry_name, prev_rank), ...]},
            ...
        ]
      }
    """
    out = {"label": None, "publication_date": None, "issue_number": None,
           "period_date": None, "sections": []}
    soup = BeautifulSoup(html, "html.parser")
    # Heading: <h2> ... 'Pro Wrestling Illustrated Monthly Ratings - <Month> <Year>' </h2>
    heading_h2 = None
    for h2 in soup.select("h2"):
        txt = h2.get_text(" ", strip=True)
        if "Pro Wrestling Illustrated Monthly Ratings" in txt:
            heading_h2 = h2
            heading = txt
            break
    if not heading_h2:
        return out
    pub_date, issue_label_seasonal = parse_heading(heading)
    out["label"] = heading.split("-", 1)[-1].strip()
    out["publication_date"] = pub_date
    out["issue_number"] = issue_label_seasonal

    # period_date — text node right after the heading h2: 'for period ending: May 3rd, 1984'
    sib = heading_h2
    period_text = ""
    for _ in range(6):
        sib = sib.next_sibling
        if sib is None:
            break
        s = str(sib)
        if "period ending" in s:
            period_text = s
            break
    if not period_text:
        # fallback: search the whole page
        m = re.search(r"period ending:\s*([^<\n]+)", html, re.I)
        if m:
            period_text = m.group(1)
    if period_text:
        m = re.search(r"period ending:\s*([^<\n]+)", period_text, re.I)
        raw = m.group(1).strip() if m else period_text.strip()
        # strip trailing tags
        raw = re.sub(r"<[^>]+>", "", raw).strip().rstrip("<.")
        year = int(out["publication_date"][:4]) if out["publication_date"] else 0
        out["period_date"] = parse_period_date(raw, year)

    # Sections: every <a name="..."></a> followed by a table
    # Each entry is a dict to carry PFDB link metadata cleanly:
    #   {'rank', 'name', 'prev_rank', 'pfdb_id', 'pfdb_slug',
    #    'members': [ {'name','pfdb_id','pfdb_slug'}, ... ]   # only for tag entries
    #   }
    pfdb_link_re = re.compile(r"/wrestlers/([a-z0-9\-]+?)-(\d+)\.html$", re.I)
    anchors = soup.select('a[name]')
    for a in anchors:
        label = (a.get("name") or "").strip()
        if not label or label.lower() == "top":
            continue
        nxt = a.find_next("table")
        if nxt is None:
            continue
        rows = nxt.select("tr")
        body_rows = [r for r in rows if "head" not in (r.get("class") or [])]
        entries: list[dict] = []
        pending_rank: Optional[int] = None
        pending_first: Optional[dict] = None
        for tr in body_rows:
            tds = tr.find_all("td", recursive=False)
            if not tds:
                continue
            first_td = tds[0]
            rank_text = first_td.get_text(strip=True)
            row_starts_rank = rank_text.isdigit()
            if row_starts_rank:
                rank = int(rank_text)
            else:
                rank = pending_rank if pending_rank is not None else None
            wlink = tr.find("a", href=re.compile(r"/wrestlers/"))
            if wlink is None:
                continue
            name = wlink.get_text(strip=True)
            href = wlink.get("href", "")
            pfdb_id: Optional[int] = None
            pfdb_slug: Optional[str] = None
            mlink = pfdb_link_re.search(href)
            if mlink:
                pfdb_slug = f"{mlink.group(1)}-{mlink.group(2)}"
                pfdb_id = int(mlink.group(2))
            prev_rank: Optional[int] = None
            row_html = str(tr)
            mnum = re.search(r"<!--num=(\d+)-->", row_html)
            if mnum:
                n = int(mnum.group(1))
                if n > 0:
                    prev_rank = n
            if rank is None:
                continue
            if pending_rank == rank and pending_first is not None:
                # Second member of a tag team rank
                combined_name = f"{pending_first['name']} & {name}"
                entries.append({
                    "rank": pending_first["rank"],
                    "name": combined_name,
                    "prev_rank": pending_first["prev_rank"],
                    "pfdb_id": None,
                    "pfdb_slug": None,
                    "members": [
                        {"name": pending_first["name"], "pfdb_id": pending_first["pfdb_id"],
                         "pfdb_slug": pending_first["pfdb_slug"]},
                        {"name": name, "pfdb_id": pfdb_id, "pfdb_slug": pfdb_slug},
                    ],
                })
                pending_rank = None
                pending_first = None
            elif row_starts_rank:
                is_tag = first_td.has_attr("rowspan") and first_td["rowspan"] == "2"
                if is_tag:
                    pending_rank = rank
                    pending_first = {"rank": rank, "name": name, "prev_rank": prev_rank,
                                     "pfdb_id": pfdb_id, "pfdb_slug": pfdb_slug}
                else:
                    entries.append({
                        "rank": rank, "name": name, "prev_rank": prev_rank,
                        "pfdb_id": pfdb_id, "pfdb_slug": pfdb_slug,
                        "members": [],
                    })
        out["sections"].append({"list_label": label, "entries": entries})
    return out

# --- DB ---------------------------------------------------------------------

def get_pwi_periodical_id(conn: sqlite3.Connection) -> int:
    row = conn.execute(PWI_PERIODICAL_QUERY).fetchone()
    if not row:
        raise SystemExit("Could not find Pro Wrestling Illustrated periodical row.")
    return row[0]

def upsert_issue(conn: sqlite3.Connection, periodical_id: int, info: dict, source_url: str) -> int:
    cur = conn.execute(
        "SELECT id FROM periodical_issues WHERE periodical_id=? AND profightdb_id=?",
        (periodical_id, info["profightdb_id"]),
    )
    row = cur.fetchone()
    fields = dict(
        periodical_id=periodical_id,
        publication_date=info["publication_date"],
        period_date=info["period_date"],
        issue_number=info.get("issue_number"),
        profightdb_id=info["profightdb_id"],
        source_url=source_url,
        confidence="medium",
    )
    if row:
        issue_id = row[0]
        # Update mutable fields
        conn.execute(
            """UPDATE periodical_issues
               SET publication_date=:publication_date,
                   period_date=COALESCE(:period_date, period_date),
                   issue_number=COALESCE(:issue_number, issue_number),
                   source_url=:source_url
               WHERE id=:id""",
            {**fields, "id": issue_id},
        )
        return issue_id
    cur = conn.execute(
        """INSERT INTO periodical_issues
           (periodical_id, publication_date, period_date, issue_number, profightdb_id, source_url, confidence)
           VALUES (:periodical_id, :publication_date, :period_date, :issue_number, :profightdb_id, :source_url, :confidence)""",
        fields,
    )
    return cur.lastrowid

def upsert_ranking(conn: sqlite3.Connection, issue_id: int, list_label: str,
                   list_scope: str, territory_id: Optional[int],
                   source_url: str, list_size: int) -> int:
    row = conn.execute(
        "SELECT id FROM ranking_lists WHERE issue_id=? AND list_label=?",
        (issue_id, list_label),
    ).fetchone()
    if row:
        rid = row[0]
        conn.execute(
            """UPDATE ranking_lists
               SET list_scope=?, territory_id=?, source_url=?, list_size=?
               WHERE id=?""",
            (list_scope, territory_id, source_url, list_size, rid),
        )
        # Wipe and re-insert entries to stay idempotent
        conn.execute("DELETE FROM ranking_entries WHERE ranking_list_id=?", (rid,))
        return rid
    cur = conn.execute(
        """INSERT INTO ranking_lists(issue_id, list_label, list_scope, territory_id, source_url, list_size)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (issue_id, list_label, list_scope, territory_id, source_url, list_size),
    )
    return cur.lastrowid

def find_drive_pdf(label: str) -> Optional[Path]:
    """Try to find a local PDF for the given issue label like 'September 1984'."""
    m = re.match(r"^(January|February|March|April|May|June|July|August|September|October|November|December|Spring|Summer|Fall|Winter|Holiday)\s+(\d{4})$", label, re.I)
    if not m:
        return None
    month_word = m.group(1).title()
    year = m.group(2)
    decade = f"{year[:3]}0s"
    root = magazines_root()
    candidates = [
        root / decade / year / "Pro Wrestling Illustrated" /
        f"Pro Wrestling Illustrated - {year} - {month_word}.pdf",
        # Abbreviated form: 'YYYY-MM, PWI/'
    ]
    if month_word.lower() in MONTHS:
        mm = MONTHS[month_word.lower()]
        candidates.append(root / decade / f"{year}-{mm:02d}, PWI" / f"PWI - {year} - {month_word}.pdf")
    for c in candidates:
        if c.exists():
            return c
    # As a last resort, glob the year folder
    yearly = root / decade / year
    if yearly.exists():
        for p in yearly.rglob("*.pdf"):
            if "Pro Wrestling Illustrated" in p.name and month_word in p.name and year in p.name:
                return p
    return None

# --- Main run loop ----------------------------------------------------------

def run(args):
    if not DB_PATH.exists():
        raise SystemExit(f"DB not found at {DB_PATH}")

    QUEUES_DIR.mkdir(exist_ok=True)
    unresolved_path = QUEUES_DIR / f"unresolved_ranking_entries_{int(time.time())}.tsv"
    unresolved_rows: list[tuple] = []

    # Drive sync I/O dodge: copy DB to /tmp, work there, copy back.
    tmp_db = Path(os.environ.get("PWI_TMPDB",
                                 "/sessions/great-laughing-babbage/tmp/wb.db"))
    tmp_db.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(DB_PATH, tmp_db)
    print(f"[setup] working DB at {tmp_db} ({tmp_db.stat().st_size:,} bytes)")

    conn = sqlite3.connect(str(tmp_db))
    conn.execute("PRAGMA foreign_keys = ON")

    pwi_id = get_pwi_periodical_id(conn)
    territory_map = build_territory_map(conn)
    resolver = WrestlerResolver(conn)
    print(f"[setup] PWI periodical_id={pwi_id} | wrestlers indexed={len(resolver.lookup):,}"
          f" | territories mapped={len(territory_map)}")

    # Discover issues
    year_set = None
    if args.year is not None:
        year_set = {args.year}
    elif args.year_from or args.year_to:
        lo = args.year_from or 1979
        hi = args.year_to or 2025
        year_set = set(range(lo, hi + 1))
    issues = discover_issue_urls(year_set)
    print(f"[discover] {len(issues)} issue URLs (filter={year_set})")
    if args.skip_existing:
        existing = {row[0] for row in conn.execute(
            "SELECT profightdb_id FROM periodical_issues WHERE periodical_id=?", (pwi_id,)
        )}
        before = len(issues)
        issues = [t for t in issues if t[2] not in existing]
        print(f"[skip-existing] {before - len(issues)} already ingested; {len(issues)} remain")
    for label, url, pid in issues:
        print(f"   {pid:5d}  {label:>14s}  {url}")

    stats = {"issues": 0, "lists": 0, "entries": 0,
             "wrestler_resolved": 0, "wrestler_pending": 0,
             "tag_resolved": 0, "tag_created": 0,
             "pending_inserted": 0, "pending_updated": 0}

    for label, url, pid in issues:
        time.sleep(SLEEP)
        html = fetch(url)
        if not html:
            continue
        info = parse_issue(html, url, pid)
        info["profightdb_id"] = pid
        if not info["publication_date"]:
            print(f"  [skip:no-date] {label} {url}")
            continue
        issue_id = upsert_issue(conn, pwi_id, info, url)
        stats["issues"] += 1

        # Drive PDF lookup
        pdf = find_drive_pdf(label)
        if pdf:
            conn.execute(
                "UPDATE periodical_issues SET drive_pdf_path=?, in_collection=1 WHERE id=?",
                (str(pdf), issue_id),
            )

        pub_date = info["publication_date"]
        year = int(pub_date[:4])
        for sec in info["sections"]:
            list_label = sec["list_label"]
            entries = sec["entries"]
            if not entries:
                continue
            scope, terr_label = LIST_SCOPE_MAP.get(list_label, ("other", None))
            terr_id = territory_map.get(terr_label) if terr_label else None
            anchor = list_label.replace(" ", "%20")
            section_url = f"{url}#{anchor}"
            list_id = upsert_ranking(conn, issue_id, list_label, scope, terr_id, section_url, len(entries))
            stats["lists"] += 1
            for entry in entries:
                rank = entry["rank"]
                name = entry["name"]
                prev_rank = entry["prev_rank"]
                wid: Optional[int] = None
                fid: Optional[int] = None
                pending_id: Optional[int] = None

                if scope == "tag":
                    members = entry.get("members", [])
                    member_names = [m["name"] for m in members]
                    canon = " & ".join(sorted(member_names, key=lambda s: s.lower()))
                    fid_existing = conn.execute(
                        "SELECT id FROM factions WHERE name=? AND type='tag_team'",
                        (canon,),
                    ).fetchone()
                    if fid_existing:
                        fid = fid_existing[0]
                        stats["tag_resolved"] += 1
                    else:
                        fid = get_or_create_tag_team(conn, member_names, year)
                        stats["tag_created"] += 1
                    # Even though the rank is owned by the team, individual
                    # members are still wrestlers worth tracking. Upsert each
                    # member into pending_wrestlers if not in curated table.
                    for m in members:
                        m_wid = resolver.resolve(m["name"], year)
                        if m_wid is None:
                            upsert_pending_wrestler(
                                conn, m["name"], m.get("pfdb_id"), m.get("pfdb_slug"), pub_date,
                            )
                else:
                    wid = resolver.resolve(name, year)
                    if wid:
                        stats["wrestler_resolved"] += 1
                    else:
                        stats["wrestler_pending"] += 1
                        pending_id = upsert_pending_wrestler(
                            conn, name, entry.get("pfdb_id"), entry.get("pfdb_slug"), pub_date,
                        )
                        unresolved_rows.append(
                            (pub_date, list_label, scope, rank, name,
                             entry.get("pfdb_id") or "", url)
                        )
                conn.execute(
                    """INSERT INTO ranking_entries
                         (ranking_list_id, rank, wrestler_id, faction_id, entry_name, previous_rank, pending_wrestler_id)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (list_id, rank, wid, fid, name, prev_rank, pending_id),
                )
                stats["entries"] += 1

        conn.commit()
        print(f"  [done] {label}: lists={len(info['sections'])} entries+={sum(len(s['entries']) for s in info['sections'])}")

    conn.commit()
    conn.close()

    # Swap back
    shutil.copy(tmp_db, DB_PATH)
    print(f"[swap] copied tmp DB back to {DB_PATH}")

    # Write unresolved queue
    if unresolved_rows:
        with unresolved_path.open("w", newline="") as f:
            w = csv.writer(f, dialect="excel-tab")
            w.writerow(["publication_date", "list_label", "scope", "rank", "entry_name", "pfdb_id", "issue_url"])
            w.writerows(unresolved_rows)
        print(f"[queue] {len(unresolved_rows)} unresolved -> {unresolved_path}")

    print("\n=== STATS ===")
    for k, v in stats.items():
        print(f"  {k}: {v}")
    total_singles = stats["wrestler_resolved"] + stats["wrestler_pending"]
    if total_singles:
        rate = stats["wrestler_resolved"] / total_singles
        print(f"  resolution_rate (singles+others): {rate*100:.1f}%")

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--year", type=int, help="Single year to ingest (pilot)")
    p.add_argument("--year-from", type=int, help="Start year (inclusive)")
    p.add_argument("--year-to", type=int, help="End year (inclusive)")
    p.add_argument("--skip-existing", action="store_true",
                   help="Skip issues already in periodical_issues for PWI")
    args = p.parse_args()
    run(args)

if __name__ == "__main__":
    main()
