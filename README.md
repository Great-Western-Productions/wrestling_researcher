# Wrestling Researcher

A personal pro-wrestling research archive — bibliography, periodicals,
territories, wrestler/territory runs, ranking lists, plus a local web UI
for browsing and curating it all. Local-only, no auth, no production
deploy story. Source of truth is a local PostgreSQL database.

## Layout

```
pwr-web/                Next.js + Drizzle web app (Postgres-backed)
bibliography/           Ingest pipeline + source data; Postgres migration script
calendar/               Content calendar builder
catalog/                Magazine catalog builder + dedupe
covers/                 Cover-image describer (LLM-based)
magazine_downloader/    Bulk magazine downloader
research/               Loose research notes and surveys
scripts/                Standalone helper scripts (e.g. titles migration)
.env                    Local secrets (gitignored)
.env.example            Template
```

The original Flask app at `app/` was retired on 2026-05-02 once the
Next.js rewrite reached parity. See git history if you need it back.

## Setup

```bash
# 1. Postgres (one-time)
brew install postgresql@17
brew services start postgresql@17
createdb wrestling_bibliography

# 2. Python deps (for the ingest/enrichment scripts)
python3 -m venv .venv
source .venv/bin/activate
pip install "psycopg[binary]" requests pytest

# 3. Env
cp .env.example .env
# edit .env — at minimum set GOOGLE_API_TOKEN if you want cover lookups

# 4. Seed the database from the SQLite export
python3 bibliography/migrate_to_postgres.py --apply
```

## Run the app

```bash
cd pwr-web
pnpm install
pnpm dev          # → http://localhost:3000/
```

The app binds to localhost only — don't expose it; the `/add/*` and
merge routes are unauthenticated.

See [pwr-web/README.md](pwr-web/README.md) for the full Next.js/Drizzle/Vitest
stack notes, including how to run the test suite (Testcontainers + real
Postgres).

## Substack ingest

Archives pro-wrestling-history newsletters and the URLs their posts cite.
Citations land in `research_sources`, the same table that carries hand-curated
sources, so a link a blogger used and one added by hand are one row.

```bash
cd pwr-web
pnpm ingest:substack --publication somebody.substack.com --dry-run   # parse only
pnpm ingest:substack --publication somebody.substack.com --limit 25
pnpm ingest:substack --all                                           # refresh all
pnpm ingest:substack --search "Jerry Jarrett booking"
pnpm ingest:substack --sources --limit 30                            # most-cited URLs
```

Substack publishes no supported API for post content, so this reads the
undocumented JSON its own web app calls (`/api/v1/archive`,
`/api/v1/posts/{slug}`), with RSS as the fallback. Expect it to break at some
point without notice. Paywalled posts return only their free teaser; those
rows are kept and flagged `body_truncated`, and a re-run replaces a stored
teaser with the full text if the post later opens up. `--dry-run` fetches and
parses without touching the database, which is the way to check a publication
before its first ingest.

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
# Python ingest/enrichment tests
python3 -m pytest bibliography/tests/

# Next.js app tests (Vitest + Testcontainers, requires Docker)
cd pwr-web && pnpm test
```

## Security

- `.env` is gitignored. Use `.env.example` as the template.
- ⚠️ **Rotate the credentials currently in `.env`** (Google, Exa,
  Cagematch). They were visible in the planning conversation that produced
  this layout, so they should be considered exposed.
- The web app has no auth — keep it on `127.0.0.1` and don't put it behind
  a public reverse proxy.

## Legacy SQLite

`bibliography/wrestling_bibliography.db` is still on disk as a legacy
source for older ingest/enrichment utilities. Do not delete the SQLite file yet.
Several legacy ingest/enrichment scripts still read it directly, even though
the web app and calendar now use Postgres.

When those scripts have been migrated or explicitly retired, remove the
SQLite files and keep re-seeding Postgres through:
`python3 bibliography/migrate_to_postgres.py --apply`.
