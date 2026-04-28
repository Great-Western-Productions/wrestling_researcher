#!/usr/bin/env python3
"""
Pro Wrestling Researcher — local Flask app.

USAGE
    python3 app/app.py              # http://127.0.0.1:5050
    python3 app/app.py --port 8080
    PWBIB_DEBUG=1 python3 app/app.py

Configuration lives in `app/config.py` (reads `.env` at the project root).
Reads from PostgreSQL at $DATABASE_URL (or PWBIB_PG_HOST/PG_DB/PG_USER/PG_PORT).
Local-only — has simple add forms but no auth, so don't expose it.
"""
from __future__ import annotations

import argparse
import os
import sys

import psycopg
import requests
from flask import Flask, abort, flash, redirect, render_template, request, url_for

# Allow `python3 app/app.py` from the repo root and `python3 app.py` from inside.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import CONFIG  # noqa: E402
from db import close_db, commit, execute, get_db, query, query_one  # noqa: E402

app = Flask(__name__, static_folder="public", static_url_path="/static")
app.secret_key = CONFIG.secret
app.teardown_appcontext(close_db)

# isbn -> resolved cover URL (or None for known-misses)
_COVER_CACHE: dict = {}

CATEGORIES = [
    ("about_wrestling", "About wrestling"),
    ("about_wrestler", "About wrestlers"),
    ("by_wrestler", "By wrestlers"),
    ("fiction", "Fiction"),
]

PER_PAGE = 30
PENDING_PER_PAGE = 50


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def authors_for(book_id: int) -> list[dict]:
    return query(
        """SELECT a.id, a.name, a.is_wrestler, ba.role
             FROM book_authors ba
             JOIN authors a ON a.id = ba.author_id
            WHERE ba.book_id = %s
            ORDER BY ba.role, a.name""",
        (book_id,),
    )


def _opt(s):
    s = (s or "").strip()
    return s or None


def _opt_int(s):
    s = (s or "").strip()
    if not s:
        return None
    try:
        return int(s)
    except ValueError:
        return None


def _distinct_values(table: str, column: str, where: str = "") -> list[str]:
    sql = f"SELECT DISTINCT {column} AS v FROM {table} WHERE {column} IS NOT NULL"
    if where:
        sql += f" AND {where}"
    sql += f" ORDER BY {column}"
    return [r["v"] for r in query(sql)]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    counts = {r["category_code"]: r["n"] for r in query(
        "SELECT category_code, COUNT(*) AS n FROM books GROUP BY category_code")}
    confidence = {r["confidence"]: r["n"] for r in query(
        "SELECT confidence, COUNT(*) AS n FROM books GROUP BY confidence")}
    n_books = query_one("SELECT COUNT(*) AS n FROM books")["n"]
    n_per = query_one("SELECT COUNT(*) AS n FROM periodicals")["n"]
    n_auth = query_one("SELECT COUNT(*) AS n FROM authors")["n"]
    n_wr_authors = query_one(
        "SELECT COUNT(*) AS n FROM authors WHERE is_wrestler = 1")["n"]
    n_terr = query_one("SELECT COUNT(*) AS n FROM territories")["n"]
    n_wrest = query_one("SELECT COUNT(*) AS n FROM wrestlers")["n"]

    top_authors = query("""
        SELECT a.id, a.name, a.is_wrestler, COUNT(*) AS n
          FROM authors a
          JOIN book_authors ba ON ba.author_id = a.id
         GROUP BY a.id, a.name, a.is_wrestler
         ORDER BY n DESC, a.name
         LIMIT 25
    """)

    by_decade = query("""
        SELECT (year_published / 10) * 10 AS decade, COUNT(*) AS n
          FROM books
         WHERE year_published IS NOT NULL
         GROUP BY decade
         ORDER BY decade
    """)

    featured_terr = query("""
        SELECT t.id, t.name, t.short_name, t.region, t.year_founded, t.year_closed,
               COUNT(r.id) AS run_count
          FROM territories t
          LEFT JOIN wrestler_territory_runs r ON r.territory_id = t.id
         GROUP BY t.id
         ORDER BY run_count DESC, t.name
         LIMIT 8
    """)

    return render_template(
        "index.html",
        categories=CATEGORIES, counts=counts, confidence=confidence,
        n_books=n_books, n_per=n_per, n_auth=n_auth,
        n_wr=n_wr_authors, n_terr=n_terr, n_wrest=n_wrest,
        top_authors=top_authors, by_decade=by_decade,
        featured_terr=featured_terr,
    )


@app.route("/books")
def books():
    cat = request.args.get("cat", "").strip() or None
    q = request.args.get("q", "").strip() or None
    country = request.args.get("country", "").strip() or None
    era = request.args.get("era", "").strip() or None
    confidence = request.args.get("confidence", "").strip() or None
    year_from = request.args.get("from", "").strip()
    year_to = request.args.get("to", "").strip()
    sort = request.args.get("sort", "year_desc")
    page = max(1, int(request.args.get("page", 1)))

    where = []
    params: list = []
    if cat:
        where.append("b.category_code = %s")
        params.append(cat)
    if q:
        where.append("""(b.title ILIKE %s OR EXISTS(
            SELECT 1 FROM book_authors ba JOIN authors a ON a.id = ba.author_id
            WHERE ba.book_id = b.id AND a.name ILIKE %s))""")
        params.extend([f"%{q}%", f"%{q}%"])
    if country:
        where.append("b.country = %s")
        params.append(country)
    if era:
        where.append("b.era = %s")
        params.append(era)
    if confidence:
        where.append("b.confidence = %s")
        params.append(confidence)
    if year_from.isdigit():
        where.append("b.year_published >= %s")
        params.append(int(year_from))
    if year_to.isdigit():
        where.append("b.year_published <= %s")
        params.append(int(year_to))

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    sort_map = {
        "year_desc": "b.year_published DESC NULLS LAST, b.title",
        "year_asc": "b.year_published ASC NULLS LAST, b.title",
        "title": "LOWER(b.title)",
        "category": "b.category_code, b.year_published DESC NULLS LAST",
    }
    order_sql = sort_map.get(sort, sort_map["year_desc"])

    total = query_one(
        f"SELECT COUNT(*) AS n FROM books b {where_sql}", params)["n"]
    offset = (page - 1) * PER_PAGE
    rows = query(
        f"""SELECT b.* FROM books b {where_sql}
            ORDER BY {order_sql}
            LIMIT %s OFFSET %s""",
        params + [PER_PAGE, offset],
    )

    items = [{"book": r, "authors": authors_for(r["id"])} for r in rows]

    countries = _distinct_values("books", "country")
    eras = _distinct_values("books", "era")

    return render_template(
        "books.html",
        items=items, total=total, page=page, per_page=PER_PAGE,
        pages=(total + PER_PAGE - 1) // PER_PAGE,
        categories=CATEGORIES, countries=countries, eras=eras,
        filters={"cat": cat or "", "q": q or "",
                 "country": country or "", "era": era or "",
                 "confidence": confidence or "",
                 "from": year_from, "to": year_to,
                 "sort": sort},
    )


@app.route("/book/<int:book_id>")
def book_detail(book_id):
    row = query_one("SELECT * FROM books WHERE id = %s", (book_id,))
    if not row:
        abort(404)
    return render_template("book.html", b=row, authors=authors_for(book_id))


def _resolve_cover_url(isbn: str) -> str | None:
    """Resolve a cover image URL for the given ISBN. Tries Google Books first
    (when GOOGLE_API_TOKEN is set), falls back to Open Library. Returns None
    if no cover can be found. Cached in-process."""
    isbn = (isbn or "").replace("-", "").strip()
    if not isbn:
        return None
    if isbn in _COVER_CACHE:
        return _COVER_CACHE[isbn]

    url: str | None = None

    if CONFIG.google_api_token:
        try:
            r = requests.get(
                "https://www.googleapis.com/books/v1/volumes",
                params={"q": f"isbn:{isbn}", "key": CONFIG.google_api_token},
                timeout=4,
            )
            if r.ok:
                items = r.json().get("items") or []
                if items:
                    links = items[0].get("volumeInfo", {}).get("imageLinks") or {}
                    for k in ("extraLarge", "large", "medium",
                              "small", "thumbnail", "smallThumbnail"):
                        if links.get(k):
                            url = links[k].replace("http://", "https://")
                            url = url.replace("&edge=curl", "")
                            break
        except requests.RequestException:
            pass

    if not url:
        try:
            ol = f"https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg?default=false"
            r = requests.head(ol, timeout=4, allow_redirects=True)
            if r.status_code == 200:
                url = ol
        except requests.RequestException:
            pass

    _COVER_CACHE[isbn] = url
    return url


@app.route("/book/<int:book_id>/cover")
def book_cover(book_id):
    row = query_one(
        "SELECT isbn13, isbn10 FROM books WHERE id = %s", (book_id,))
    if not row:
        abort(404)
    for isbn in (row["isbn13"], row["isbn10"]):
        url = _resolve_cover_url(isbn) if isbn else None
        if url:
            return redirect(url, code=302)
    return redirect(url_for("static", filename="images/cover-placeholder.svg"), code=302)


@app.route("/author/<int:author_id>")
def author_detail(author_id):
    a = query_one("SELECT * FROM authors WHERE id = %s", (author_id,))
    if not a:
        abort(404)
    books = query("""
        SELECT b.*, ba.role
          FROM books b
          JOIN book_authors ba ON ba.book_id = b.id
         WHERE ba.author_id = %s
         ORDER BY b.year_published NULLS LAST, b.title
    """, (author_id,))
    return render_template("author.html", a=a, books=books)


@app.route("/periodicals")
def periodicals():
    country = request.args.get("country", "").strip() or None
    ptype = request.args.get("type", "").strip() or None
    in_archive = request.args.get("in_archive") == "1"

    where, params = [], []
    if country:
        where.append("country = %s")
        params.append(country)
    if ptype:
        where.append("type = %s")
        params.append(ptype)
    if in_archive:
        where.append("archive_in_collection = 1")
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    rows = query(
        f"""SELECT * FROM periodicals {where_sql}
            ORDER BY country, year_started, title""", params)

    countries = _distinct_values("periodicals", "country")
    types = _distinct_values("periodicals", "type")

    grouped: dict = {}
    for r in rows:
        grouped.setdefault(r["country"] or "Other", []).append(r)

    return render_template(
        "periodicals.html", grouped=grouped, total=len(rows),
        countries=countries, types=types,
        filters={"country": country or "", "type": ptype or "",
                 "in_archive": "1" if in_archive else ""},
    )


@app.route("/territories")
def territories():
    region = request.args.get("region", "").strip() or None
    nwa = request.args.get("nwa", "").strip()
    q = request.args.get("q", "").strip() or None

    where, params = [], []
    if region:
        where.append("t.region = %s")
        params.append(region)
    if nwa == "1":
        where.append("t.nwa_member = 1")
    elif nwa == "0":
        where.append("t.nwa_member = 0")
    if q:
        where.append("(t.name ILIKE %s OR t.short_name ILIKE %s OR t.headquarters_city ILIKE %s)")
        params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    rows = query(f"""
        SELECT t.*,
               (SELECT COUNT(*) FROM wrestler_territory_runs r WHERE r.territory_id = t.id) AS run_count
          FROM territories t
        {where_sql}
        ORDER BY t.region, t.year_founded, t.name
    """, params)

    regions = _distinct_values("territories", "region")

    grouped: dict = {}
    for r in rows:
        grouped.setdefault(r["region"] or "Other", []).append(r)

    return render_template(
        "territories.html", grouped=grouped, total=len(rows),
        regions=regions,
        filters={"region": region or "", "nwa": nwa, "q": q or ""},
    )


@app.route("/territory/<int:territory_id>")
def territory_detail(territory_id):
    t = query_one("SELECT * FROM territories WHERE id = %s", (territory_id,))
    if not t:
        abort(404)
    runs = query("""
        SELECT r.*, w.id AS wid, w.primary_ring_name, w.legal_name,
               w.primary_role, w.midcard_files_status, w.midcard_files_priority
          FROM wrestler_territory_runs r
          JOIN wrestlers w ON w.id = r.wrestler_id
         WHERE r.territory_id = %s
         ORDER BY r.start_year NULLS LAST, w.primary_ring_name
    """, (territory_id,))
    name_like = f"%{t['name']}%"
    short_like = f"%{(t['short_name'] or t['name'])}%"
    related_books = query("""
        SELECT * FROM books
         WHERE territory_or_promotion ILIKE %s OR territory_or_promotion ILIKE %s
         ORDER BY year_published DESC NULLS LAST
         LIMIT 50
    """, (name_like, short_like))
    return render_template("territory.html", t=t, runs=runs, related_books=related_books)


@app.route("/wrestlers")
def wrestlers():
    q = request.args.get("q", "").strip() or None
    role = request.args.get("role", "").strip() or None
    living = request.args.get("living", "").strip()
    territory = request.args.get("territory", "").strip()
    status = request.args.get("status", "").strip() or None
    sort = request.args.get("sort", "name")

    where, params = [], []
    joins = ""
    if q:
        where.append("""(w.primary_ring_name ILIKE %s OR w.legal_name ILIKE %s
                         OR w.other_ring_names ILIKE %s)""")
        params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])
    if role:
        where.append("w.primary_role = %s")
        params.append(role)
    if living == "1":
        where.append("w.living = 1")
    elif living == "0":
        where.append("w.living = 0")
    if status:
        where.append("w.midcard_files_status = %s")
        params.append(status)
    if territory.isdigit():
        joins = "JOIN wrestler_territory_runs r ON r.wrestler_id = w.id"
        where.append("r.territory_id = %s")
        params.append(int(territory))

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    sort_map = {
        "name": "w.primary_ring_name",
        "debut": "w.debut_year NULLS LAST, w.primary_ring_name",
        "born": "w.born_date NULLS LAST, w.primary_ring_name",
        "priority": "w.midcard_files_priority NULLS LAST, w.primary_ring_name",
    }
    order_sql = sort_map.get(sort, sort_map["name"])

    rows = query(f"""
        SELECT DISTINCT w.* FROM wrestlers w
        {joins}
        {where_sql}
        ORDER BY {order_sql}
    """, params)

    roles = _distinct_values("wrestlers", "primary_role")
    statuses = _distinct_values("wrestlers", "midcard_files_status")
    territories_list = query(
        "SELECT id, name, short_name FROM territories ORDER BY name")

    return render_template(
        "wrestlers.html", rows=rows, total=len(rows),
        roles=roles, statuses=statuses,
        territories_list=territories_list,
        filters={"q": q or "", "role": role or "",
                 "living": living, "territory": territory,
                 "status": status or "", "sort": sort},
    )


@app.route("/wrestler/<int:wrestler_id>")
def wrestler_detail(wrestler_id):
    w = query_one("SELECT * FROM wrestlers WHERE id = %s", (wrestler_id,))
    if not w:
        abort(404)
    runs = query("""
        SELECT r.*, t.id AS tid, t.name AS terr_name, t.short_name AS terr_short,
               t.region AS terr_region
          FROM wrestler_territory_runs r
          JOIN territories t ON t.id = r.territory_id
         WHERE r.wrestler_id = %s
         ORDER BY r.start_year NULLS LAST
    """, (wrestler_id,))

    name = w["primary_ring_name"]
    related_books = query("""
        SELECT DISTINCT b.* FROM books b
          LEFT JOIN book_authors ba ON ba.book_id = b.id
          LEFT JOIN authors a ON a.id = ba.author_id
         WHERE b.subject_wrestler ILIKE %s OR a.name ILIKE %s
         ORDER BY b.year_published DESC NULLS LAST
         LIMIT 50
    """, (f"%{name}%", f"%{name}%"))

    return render_template("wrestler.html", w=w, runs=runs, related_books=related_books)


# ---------------------------------------------------------------------------
# Create forms
# ---------------------------------------------------------------------------

@app.route("/add")
def add_index():
    return render_template("add_index.html")


@app.route("/add/book", methods=["GET", "POST"])
def add_book():
    if request.method == "POST":
        f = request.form
        title = _opt(f.get("title"))
        category_code = _opt(f.get("category_code"))
        if not title or not category_code:
            flash("Title and category are required.", "error")
            return redirect(url_for("add_book"))
        cur = execute("""
            INSERT INTO books (title, subtitle, category_code, publisher,
                               year_published, isbn10, isbn13, pages, format,
                               language, country, subject_wrestler, era,
                               territory_or_promotion, synopsis, source_url,
                               confidence)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (title, _opt(f.get("subtitle")), category_code,
              _opt(f.get("publisher")), _opt_int(f.get("year_published")),
              _opt(f.get("isbn10")), _opt(f.get("isbn13")),
              _opt_int(f.get("pages")), _opt(f.get("format")),
              _opt(f.get("language")) or "English", _opt(f.get("country")),
              _opt(f.get("subject_wrestler")), _opt(f.get("era")),
              _opt(f.get("territory_or_promotion")), _opt(f.get("synopsis")),
              _opt(f.get("source_url")), _opt(f.get("confidence")) or "medium"))
        book_id = cur.fetchone()["id"]

        author_names = [n.strip() for n in (f.get("authors") or "").split(",") if n.strip()]
        is_wrestler = 1 if f.get("authors_are_wrestlers") else 0
        for name in author_names:
            row = query_one("SELECT id FROM authors WHERE name = %s", (name,))
            if row:
                aid = row["id"]
            else:
                aid = execute(
                    "INSERT INTO authors (name, is_wrestler) VALUES (%s, %s) RETURNING id",
                    (name, is_wrestler)).fetchone()["id"]
            execute(
                "INSERT INTO book_authors (book_id, author_id, role) VALUES (%s, %s, 'author') "
                "ON CONFLICT DO NOTHING",
                (book_id, aid))
        commit()
        flash(f"Added: {title}", "success")
        return redirect(url_for("book_detail", book_id=book_id))

    countries = _distinct_values("books", "country")
    eras = _distinct_values("books", "era")
    return render_template("add_book.html", categories=CATEGORIES,
                           countries=countries, eras=eras)


@app.route("/add/periodical", methods=["GET", "POST"])
def add_periodical():
    if request.method == "POST":
        f = request.form
        title = _opt(f.get("title"))
        if not title:
            flash("Title is required.", "error")
            return redirect(url_for("add_periodical"))
        execute("""
            INSERT INTO periodicals (title, publisher, country, language,
                                     year_started, year_ended, frequency, type,
                                     parent_company, notes, issue_count_known,
                                     archive_in_collection, source_url, confidence)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (title, _opt(f.get("publisher")), _opt(f.get("country")),
              _opt(f.get("language")) or "English",
              _opt_int(f.get("year_started")), _opt_int(f.get("year_ended")),
              _opt(f.get("frequency")), _opt(f.get("type")),
              _opt(f.get("parent_company")), _opt(f.get("notes")),
              _opt_int(f.get("issue_count_known")),
              1 if f.get("archive_in_collection") else 0,
              _opt(f.get("source_url")),
              _opt(f.get("confidence")) or "medium"))
        commit()
        flash(f"Added periodical: {title}", "success")
        return redirect(url_for("periodicals"))
    countries = _distinct_values("periodicals", "country")
    types = _distinct_values("periodicals", "type")
    return render_template("add_periodical.html", countries=countries, types=types)


@app.route("/add/territory", methods=["GET", "POST"])
def add_territory():
    if request.method == "POST":
        f = request.form
        name = _opt(f.get("name"))
        if not name:
            flash("Name is required.", "error")
            return redirect(url_for("add_territory"))
        try:
            cur = execute("""
                INSERT INTO territories (name, short_name, region, nwa_member,
                                         headquarters_city, headquarters_state,
                                         year_founded, year_closed,
                                         promoter_lineage, notes)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (name, _opt(f.get("short_name")), _opt(f.get("region")),
                  1 if f.get("nwa_member") else 0,
                  _opt(f.get("headquarters_city")), _opt(f.get("headquarters_state")),
                  _opt_int(f.get("year_founded")), _opt_int(f.get("year_closed")),
                  _opt(f.get("promoter_lineage")), _opt(f.get("notes"))))
            new_id = cur.fetchone()["id"]
            commit()
            flash(f"Added territory: {name}", "success")
            return redirect(url_for("territory_detail", territory_id=new_id))
        except psycopg.errors.IntegrityError as e:
            get_db().rollback()
            flash(f"Could not add: {e}", "error")
            return redirect(url_for("add_territory"))
    regions = _distinct_values("territories", "region")
    return render_template("add_territory.html", regions=regions)


@app.route("/add/wrestler", methods=["GET", "POST"])
def add_wrestler():
    if request.method == "POST":
        f = request.form
        primary_ring_name = _opt(f.get("primary_ring_name"))
        if not primary_ring_name:
            flash("Primary ring name is required.", "error")
            return redirect(url_for("add_wrestler"))
        living = f.get("living")
        living_val = 1 if living == "1" else (0 if living == "0" else None)
        cur = execute("""
            INSERT INTO wrestlers (legal_name, primary_ring_name, other_ring_names,
                                   born_date, died_date, living, debut_year,
                                   retired_year, primary_role, hometown_billed,
                                   hometown_real, finisher, style, socials,
                                   convention_status, last_known_appearance,
                                   footage_notes, midcard_files_status,
                                   midcard_files_priority, why_they_mattered, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (_opt(f.get("legal_name")), primary_ring_name,
              _opt(f.get("other_ring_names")), _opt(f.get("born_date")),
              _opt(f.get("died_date")), living_val,
              _opt_int(f.get("debut_year")), _opt_int(f.get("retired_year")),
              _opt(f.get("primary_role")), _opt(f.get("hometown_billed")),
              _opt(f.get("hometown_real")), _opt(f.get("finisher")),
              _opt(f.get("style")), _opt(f.get("socials")),
              _opt(f.get("convention_status")), _opt(f.get("last_known_appearance")),
              _opt(f.get("footage_notes")),
              _opt(f.get("midcard_files_status")) or "queued",
              _opt_int(f.get("midcard_files_priority")),
              _opt(f.get("why_they_mattered")), _opt(f.get("notes"))))
        new_wrestler_id = cur.fetchone()["id"]
        from_pending = _opt_int(f.get("from_pending"))
        if from_pending:
            execute(
                "UPDATE pending_wrestlers SET resolved_wrestler_id = %s WHERE id = %s",
                (new_wrestler_id, from_pending),
            )
            n = execute(
                """UPDATE ranking_entries
                      SET wrestler_id = %s, pending_wrestler_id = NULL
                    WHERE pending_wrestler_id = %s""",
                (new_wrestler_id, from_pending),
            ).rowcount
            commit()
            flash(
                f"Added: {primary_ring_name} — merged {n} pending ranking entries.",
                "success",
            )
        else:
            commit()
            flash(f"Added: {primary_ring_name}", "success")
        return redirect(url_for("wrestler_detail", wrestler_id=new_wrestler_id))
    roles = _distinct_values("wrestlers", "primary_role")
    statuses = _distinct_values("wrestlers", "midcard_files_status")
    prefill = {}
    from_pending = _opt_int(request.args.get("from_pending"))
    if from_pending:
        row = query_one(
            "SELECT printed_name FROM pending_wrestlers WHERE id = %s",
            (from_pending,),
        )
        if row:
            prefill["primary_ring_name"] = row["printed_name"]
    return render_template(
        "add_wrestler.html",
        roles=roles, statuses=statuses,
        prefill=prefill, from_pending=from_pending,
    )


@app.route("/add/run", methods=["GET", "POST"])
def add_run():
    """Add a wrestler-territory run. Optional pre-filled wrestler/territory via ?wrestler= / ?territory=."""
    if request.method == "POST":
        f = request.form
        wrestler_id = _opt_int(f.get("wrestler_id"))
        territory_id = _opt_int(f.get("territory_id"))
        if not wrestler_id or not territory_id:
            flash("Wrestler and territory are required.", "error")
            return redirect(url_for("add_run"))
        execute("""
            INSERT INTO wrestler_territory_runs (wrestler_id, territory_id,
                start_year, start_month, end_year, end_month,
                role_during_run, ring_name_during_run, primary_run, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (wrestler_id, territory_id,
              _opt_int(f.get("start_year")), _opt_int(f.get("start_month")),
              _opt_int(f.get("end_year")), _opt_int(f.get("end_month")),
              _opt(f.get("role_during_run")), _opt(f.get("ring_name_during_run")),
              1 if f.get("primary_run") else 0,
              _opt(f.get("notes"))))
        commit()
        flash("Added territory run.", "success")
        return redirect(url_for("wrestler_detail", wrestler_id=wrestler_id))
    wrestlers_list = query(
        "SELECT id, primary_ring_name FROM wrestlers ORDER BY primary_ring_name")
    territories_list = query(
        "SELECT id, name, short_name FROM territories ORDER BY name")
    return render_template("add_run.html",
                           wrestlers_list=wrestlers_list,
                           territories_list=territories_list,
                           preselect_wrestler=_opt_int(request.args.get("wrestler")),
                           preselect_territory=_opt_int(request.args.get("territory")))


# ---------------------------------------------------------------------------
# Pending wrestlers — review queue for ranking-entry names that didn't
# resolve to the curated wrestlers table during ProFightDB ingest.
# ---------------------------------------------------------------------------

@app.route("/pending")
def pending_list():
    """Queue of unresolved ranking-entry names, sorted by frequency."""
    q = (request.args.get("q") or "").strip()
    show = request.args.get("show", "open")  # open | merged | all
    page = max(1, int(request.args.get("page") or 1))

    where = []
    params: list = []
    if q:
        where.append("(printed_name ILIKE %s OR other_printed_names ILIKE %s)")
        params += [f"%{q}%"] * 2
    if show == "open":
        where.append("resolved_wrestler_id IS NULL")
    elif show == "merged":
        where.append("resolved_wrestler_id IS NOT NULL")
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    total = query_one(
        f"SELECT COUNT(*) AS n FROM v_pending_wrestlers_queue {where_sql}", params
    )["n"]
    rows = query(
        f"""SELECT * FROM v_pending_wrestlers_queue {where_sql}
            ORDER BY merged ASC, occurrence_count DESC, printed_name
            LIMIT %s OFFSET %s""",
        params + [PENDING_PER_PAGE, (page - 1) * PENDING_PER_PAGE],
    )

    counts = {
        "open": query_one(
            "SELECT COUNT(*) AS n FROM pending_wrestlers WHERE resolved_wrestler_id IS NULL"
        )["n"],
        "merged": query_one(
            "SELECT COUNT(*) AS n FROM pending_wrestlers WHERE resolved_wrestler_id IS NOT NULL"
        )["n"],
    }
    return render_template(
        "pending_list.html",
        rows=rows, total=total, counts=counts,
        page=page, per_page=PENDING_PER_PAGE,
        show=show, q=q,
    )


@app.route("/pending/<int:pid>")
def pending_detail(pid: int):
    p = query_one(
        "SELECT * FROM v_pending_wrestlers_queue WHERE id = %s", (pid,))
    if not p:
        abort(404)
    raw = query_one("SELECT * FROM pending_wrestlers WHERE id = %s", (pid,))
    samples = query(
        """SELECT pi.publication_date, pi.issue_number, rl.list_label,
                  rl.list_scope, re.rank, re.entry_name, rl.source_url
             FROM ranking_entries re
             JOIN ranking_lists rl ON re.ranking_list_id = rl.id
             JOIN periodical_issues pi ON rl.issue_id = pi.id
            WHERE re.pending_wrestler_id = %s
            ORDER BY pi.publication_date DESC
            LIMIT 25""",
        (pid,),
    )
    name_norm = (raw["normalized_name"] or "").strip()
    suggestions: list = []
    if name_norm:
        suggestions = query(
            """SELECT id, primary_ring_name, other_ring_names, debut_year, primary_role
                 FROM wrestlers
                WHERE LOWER(primary_ring_name) LIKE %s
                   OR LOWER(other_ring_names) LIKE %s
                ORDER BY primary_ring_name
                LIMIT 8""",
            (f"%{name_norm}%", f"%{name_norm}%"),
        )
        if not suggestions:
            tokens = [t for t in name_norm.split() if len(t) > 2]
            if tokens:
                last = tokens[-1]
                suggestions = query(
                    """SELECT id, primary_ring_name, other_ring_names, debut_year, primary_role
                         FROM wrestlers
                        WHERE LOWER(primary_ring_name) LIKE %s
                           OR LOWER(other_ring_names) LIKE %s
                        ORDER BY primary_ring_name
                        LIMIT 8""",
                    (f"%{last}%", f"%{last}%"),
                )
    all_wrestlers = query(
        "SELECT id, primary_ring_name FROM wrestlers ORDER BY primary_ring_name")
    return render_template(
        "pending_detail.html",
        p=p, raw=raw, samples=samples,
        suggestions=suggestions, all_wrestlers=all_wrestlers,
    )


@app.route("/pending/<int:pid>/merge", methods=["POST"])
def pending_merge(pid: int):
    """Link a pending row to an existing wrestler. Backfills ranking_entries."""
    wrestler_id = _opt_int(request.form.get("wrestler_id")) or _opt_int(
        request.form.get("wrestler_id_manual")
    )
    if not wrestler_id:
        flash("Select a wrestler to merge into.", "error")
        return redirect(url_for("pending_detail", pid=pid))
    pending = query_one(
        "SELECT id, printed_name FROM pending_wrestlers WHERE id = %s", (pid,))
    if not pending:
        abort(404)
    target = query_one(
        "SELECT id, primary_ring_name FROM wrestlers WHERE id = %s", (wrestler_id,))
    if not target:
        flash("Target wrestler not found.", "error")
        return redirect(url_for("pending_detail", pid=pid))
    execute(
        "UPDATE pending_wrestlers SET resolved_wrestler_id = %s WHERE id = %s",
        (wrestler_id, pid),
    )
    n = execute(
        """UPDATE ranking_entries
              SET wrestler_id = %s, pending_wrestler_id = NULL
            WHERE pending_wrestler_id = %s""",
        (wrestler_id, pid),
    ).rowcount
    commit()
    flash(
        f"Merged '{pending['printed_name']}' into '{target['primary_ring_name']}' "
        f"({n} ranking entries backfilled).",
        "success",
    )
    return redirect(url_for("pending_list"))


@app.route("/pending/<int:pid>/unmerge", methods=["POST"])
def pending_unmerge(pid: int):
    """Undo a merge — clear resolved_wrestler_id and reset ranking_entries."""
    pending = query_one(
        "SELECT id, resolved_wrestler_id, printed_name FROM pending_wrestlers WHERE id = %s",
        (pid,),
    )
    if not pending or not pending["resolved_wrestler_id"]:
        flash("Nothing to undo.", "error")
        return redirect(url_for("pending_detail", pid=pid))
    wid = pending["resolved_wrestler_id"]
    execute("UPDATE pending_wrestlers SET resolved_wrestler_id = NULL WHERE id = %s", (pid,))
    n = execute(
        """UPDATE ranking_entries
              SET wrestler_id = NULL, pending_wrestler_id = %s
            WHERE wrestler_id = %s
              AND id IN (SELECT re.id FROM ranking_entries re
                          WHERE re.entry_name = %s AND re.wrestler_id = %s)""",
        (pid, wid, pending["printed_name"], wid),
    ).rowcount
    commit()
    flash(f"Unmerged '{pending['printed_name']}' ({n} entries reverted).", "success")
    return redirect(url_for("pending_detail", pid=pid))


@app.route("/about")
def about():
    def count(sql):
        try:
            row = query_one(sql)
            return row["n"] if row else None
        except psycopg.errors.Error:
            get_db().rollback()
            return None
    nb = count("SELECT COUNT(*) AS n FROM books")
    np = count("SELECT COUNT(*) AS n FROM periodicals")
    na = count("SELECT COUNT(*) AS n FROM authors")
    nt = count("SELECT COUNT(*) AS n FROM territories")
    nw = count("SELECT COUNT(*) AS n FROM wrestlers")
    nr = count("SELECT COUNT(*) AS n FROM wrestler_territory_runs")
    nf = count("SELECT COUNT(*) AS n FROM factions")
    ni = count("SELECT COUNT(*) AS n FROM periodical_issues")
    nrk = count("SELECT COUNT(*) AS n FROM ranking_lists")
    nre = count("SELECT COUNT(*) AS n FROM ranking_entries")
    confidence = {r["confidence"]: r["n"] for r in query(
        "SELECT confidence, COUNT(*) AS n FROM books GROUP BY confidence")}
    return render_template(
        "about.html",
        nb=nb, np=np, na=na, nt=nt, nw=nw, nr=nr,
        nf=nf, ni=ni, nrk=nrk, nre=nre,
        confidence=confidence,
        db_path=CONFIG.database_url,
    )


# ---------------------------------------------------------------------------
# Filters
# ---------------------------------------------------------------------------

@app.template_filter("category_label")
def category_label(code):
    return dict(CATEGORIES).get(code, code or "—")


@app.template_filter("ifnull")
def ifnull(value, default="—"):
    return value if value not in (None, "") else default


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=CONFIG.port)
    p.add_argument("--host", default=CONFIG.host)
    p.add_argument("--debug", action="store_true", default=CONFIG.debug)
    args = p.parse_args()
    try:
        with psycopg.connect(CONFIG.database_url) as conn:
            conn.execute("SELECT 1")
    except psycopg.OperationalError as exc:
        print(f"Cannot connect to PostgreSQL at {CONFIG.database_url}: {exc}",
              file=sys.stderr)
        raise SystemExit(1)
    print(f"DB:  {CONFIG.database_url}")
    print(f"URL: http://{args.host}:{args.port}/")
    app.run(host=args.host, port=args.port, debug=args.debug)
