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
