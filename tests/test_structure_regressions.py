from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_calendar_uses_postgres_and_writes_inside_calendar_folder():
    source = (ROOT / "calendar" / "build_calendar.py").read_text()

    assert "import sqlite3" not in source
    assert "psycopg" in source
    assert "calendar/content_calendar.xlsx" in source
    assert "OUT = CALENDAR_DIR / \"content_calendar.xlsx\"" in source


def test_readme_keeps_legacy_sqlite_until_scripts_are_migrated():
    readme = (ROOT / "README.md").read_text()

    assert "Do not delete the SQLite file yet" in readme
    assert "Several legacy ingest/enrichment scripts still read it directly" in readme


def test_app_copy_describes_postgres_archive():
    about = (ROOT / "app" / "templates" / "about.html").read_text()
    base = (ROOT / "app" / "templates" / "base.html").read_text()

    assert "Postgres-backed archive" in about
    assert "Local Postgres Archive" in base
    assert "SQLite-backed archive" not in about
    assert "Local SQLite Archive" not in base


def test_local_dev_port_defaults_to_5150():
    config = (ROOT / "app" / "config.py").read_text()
    app_source = (ROOT / "app" / "app.py").read_text()
    readme = (ROOT / "README.md").read_text()

    assert 'PWBIB_PORT", "5150"' in config
    assert "http://127.0.0.1:5150" in app_source
    assert "http://127.0.0.1:5150" in readme
    assert "http://127.0.0.1:5050" not in readme


def test_books_index_defaults_to_author_then_title_sort():
    app_source = (ROOT / "app" / "app.py").read_text()
    books_template = (ROOT / "app" / "templates" / "books.html").read_text()

    assert 'request.args.get("sort", "author")' in app_source
    assert '"author": "primary_author NULLS LAST, LOWER(b.title)"' in app_source
    assert 'MIN(LOWER(a.name))' in app_source
    assert 'AS primary_author' in app_source
    assert 'value="author"' in books_template


def test_author_detail_sorts_books_by_publication_year_then_title():
    app_source = (ROOT / "app" / "app.py").read_text()

    assert "ORDER BY b.year_published ASC NULLS LAST, LOWER(b.title)" in app_source


def test_homepage_top_metric_cards_use_uniform_card_style():
    index = (ROOT / "app" / "templates" / "index.html").read_text()

    assert 'class="card alt"' not in index
    assert 'class="card terr"' not in index
    assert 'class="card wr"' not in index


def test_header_brand_only_shows_pwr_initials():
    base = (ROOT / "app" / "templates" / "base.html").read_text()

    assert '<span class="brand-mark">PWR</span>' in base
    assert '<span class="brand-sub">Pro Wrestling Data Archive</span>' in base
    assert 'Pro Wrestling Researcher · Data Archive' not in base
