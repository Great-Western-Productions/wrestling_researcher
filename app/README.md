# Wrestling Researcher — local browser

A lo-fi Flask web app for browsing the bibliography, periodicals,
territories, and wrestler data. Single-file server, vanilla HTML/CSS,
no build step, no JS framework, reads from local PostgreSQL.

## Run

From the project root:

```bash
python3 app/app.py                       # http://127.0.0.1:5150
python3 app/app.py --port 8080           # custom port
PWBIB_DEBUG=1 python3 app/app.py         # auto-reload
```

Configuration comes from `.env` at the project root via `app/config.py`.
Connection target is `$DATABASE_URL`, falling back to
`postgresql://$USER@localhost:5432/wrestling_bibliography`.

## What's in the app

- **Home** — counts by category, decade histogram, top 25 authors,
  featured territories.
- **Books** — paginated list with filters (category, country, era,
  confidence, year range) and full-text search across title and author.
  Sortable.
- **Book detail** — all metadata, synopsis, and quick links to WorldCat /
  AbeBooks / Amazon / Internet Archive when an ISBN is known.
- **Author detail** — every book by that author, with role.
- **Periodicals** — grouped by country, filterable by type and "in
  archive only".
- **Territories** — grouped by region, filterable by NWA membership.
- **Wrestlers** — searchable, sortable by name, debut year, born date,
  or midcard-files priority.
- **Pending** — review queue for ranking-entry names that didn't
  resolve during ProFightDB ingest. Merge into a curated wrestler row
  to backfill `ranking_entries`.
- **Add forms** — for books, periodicals, territories, wrestlers, and
  wrestler-territory runs.
- **About** — counts, confidence levels, schema notes.

## Files

```
app/
├── app.py              # routes (~700 lines)
├── config.py           # env loader + Config dataclass
├── db.py               # psycopg connection helper (per-request via flask.g)
├── README.md
├── public/
│   ├── css/style.css
│   └── images/cover-placeholder.svg
└── templates/          # one Jinja template per route family
```

## Dock / menu-bar shortcut

```bash
#!/bin/bash
cd "/Users/jschairb-gwp/src/ProWrestling Researcher"
python3 app/app.py --port 5150 --debug &
sleep 1
open "http://wrestling-researcher.local:5150/"
```

## Background dev service

The repo includes a macOS `launchd` user-agent plist at
`launchd/com.gwp.wrestling-researcher.plist`. It runs
`scripts/run_dev_server.sh`, which starts the Flask app on
`127.0.0.1:5150` with debug reload enabled.

Once installed in `~/Library/LaunchAgents`, the app is available at
`http://wrestling-researcher.local:5150/`.
