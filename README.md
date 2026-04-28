# Wrestling Researcher

A personal pro-wrestling research archive — bibliography, periodicals,
territories, wrestler/territory runs, ranking lists, plus a local Flask UI
for browsing and curating it all. Local-only, no auth, no production
deploy story. Source of truth is a local PostgreSQL database.

## Layout

```
app/                    Flask web app (Postgres-backed)
bibliography/           Ingest pipeline + source data; Postgres migration script
calendar/               Content calendar builder
catalog/                Magazine catalog builder + dedupe
covers/                 Cover-image describer (LLM-based)
magazine_downloader/    Bulk magazine downloader
research/               Loose research notes and surveys
.env                    Local secrets (gitignored)
.env.example            Template
```

## Setup

```bash
# 1. Postgres (one-time)
brew install postgresql@17
brew services start postgresql@17
createdb wrestling_bibliography

# 2. Python deps
python3 -m venv .venv
source .venv/bin/activate
pip install flask "psycopg[binary]" requests pytest

# 3. Env
cp .env.example .env
# edit .env — at minimum set GOOGLE_API_TOKEN if you want cover lookups

# 4. Seed the database from the SQLite export
python3 bibliography/migrate_to_postgres.py --apply
```

## Run the app

```bash
python3 app/app.py
# → http://127.0.0.1:5150/

python3 app/app.py --port 8080
PWBIB_DEBUG=1 python3 app/app.py        # auto-reload
```

The app binds to localhost only — don't expose it; the `/add/*` and
`/pending/*/merge` routes are unauthenticated.

## Other tools

Each subfolder has its own README with usage notes:

- **[bibliography/](bibliography/)** — ingest scripts (`ingest_*.py`,
  `seed_*.py`, `enrich_*.py`), the SQLite → Postgres migrator
  (`migrate_to_postgres.py`), and the backfill driver (`run_backfill.sh`).
- **[calendar/](calendar/)** — `build_calendar.py` produces an XLSX
  content calendar.
- **[catalog/](catalog/)** — `build_catalog.py` and `cleanup_duplicates.py`
  produce/dedupe a magazine catalog CSV.
- **[covers/](covers/)** — `describe_covers.py` runs LLM cover descriptions.
- **[magazine_downloader/](magazine_downloader/)** — bulk magazine puller.

## Tests

```bash
python3 -m pytest bibliography/tests/
```

## Security

- `.env` is gitignored. Use `.env.example` as the template.
- ⚠️ **Rotate the credentials currently in `.env`** (Google, Exa,
  Cagematch). They were visible in the planning conversation that produced
  this layout, so they should be considered exposed.
- The Flask app has no auth — bind it to `127.0.0.1` (the default) and
  don't put it behind a public reverse proxy.

## Future

A Node.js / Rails rewrite was considered and parked. The current Flask app
is ~1k lines and works; a rewrite would be the same scale of work for the
same UX. Revisit if the project grows past what one Python file can comfortably
hold or if there's a reason to want the Node ecosystem (e.g. a SPA frontend).

## Legacy SQLite

`bibliography/wrestling_bibliography.db` is still on disk as a legacy
source for older ingest/enrichment utilities. Do not delete the SQLite file yet.
Several legacy ingest/enrichment scripts still read it directly, even though
the Flask app and calendar now use Postgres.

When those scripts have been migrated or explicitly retired, remove the
SQLite files and keep re-seeding Postgres through:
`python3 bibliography/migrate_to_postgres.py --apply`.
