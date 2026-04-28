# Wrestling Magazine Backfill

A driver script (`run_backfill.sh`) wraps three Python helpers and walks
through the whole backfill end-to-end with safety prompts. Run it on
**your Mac** — the sandbox can't reach archive.org, and your local
network is much faster than streaming bytes through the MCP.

## What's missing

I scanned your Drive against the full IA collection
`wrestlingmagazinesmisc` (1,607 items). For 1960–1989 big-name canon you
have **154 keyed files** and IA has **~782 in-scope items** — leaving:

- **577** missing month-specific issues
- **86** seasonal/annual issues (Spring/Summer/Fall/Winter/Annual)

Top gaps by magazine: Inside Wrestling 122, The Wrestler 103, Sports
Review Wrestling 79, Wrestling's Main Event 53, Wrestling Revue 37,
Wrestling Monthly 28, Pro Wrestling Illustrated 19, Wrestling Eye 18.

## Run it

```bash
cd ~/Documents/Claude/Projects/ProWrestling\ Researcher
./run_backfill.sh
```

The script:
1. Verifies python3, the `requests` library (auto-installs to
   `--user` if missing), Drive sync, and archive.org reachability.
2. Runs a dry run and shows the plan.
3. Asks before downloading. Logs every file to `download_log.csv`.
4. Asks before deleting duplicate `(1).pdf` copies (size-checked).
5. Rebuilds `catalog_full.csv` from the final Drive contents.

Re-runnable: every step skips work that's already done, so if you Ctrl-C
mid-run and restart, you pick up where you left off.

## Useful invocations

```bash
# Trial run — one magazine, capped
./run_backfill.sh --mag "Pro Wrestling Illustrated" --limit 5

# Just one year
./run_backfill.sh --year 1980

# Include seasonal/annual issues (off by default)
./run_backfill.sh --seasonal

# Skip cleanup and catalog rebuild
./run_backfill.sh --skip-cleanup --skip-catalog

# Unattended mode (skips confirmations)
./run_backfill.sh -y
```

## Importing the catalog into the Sheet

After `catalog_full.csv` exists:

1. Open the *Periodical Catalog* sheet.
2. Add a tab — name it `Catalog (Full)`.
3. File → Import → Upload `catalog_full.csv` →
   "Replace data at selected cell" with the new tab selected.

Columns match your existing Catalog sheet.

## Files in this folder

- `run_backfill.sh` — orchestrator (the only one you usually run)
- `download_wrestling_magazines.py` — fetches missing PDFs from IA
- `cleanup_duplicates.py` — removes `(1).pdf` duplicates safely
- `build_catalog.py` — emits `catalog_full.csv` from Drive contents
- `describe_covers.py` — fills in the "What's on the Cover" column

## Describing covers

`describe_covers.py` renders the first page of each magazine PDF and
asks Claude (Haiku, cheap + fast) to identify the wrestler(s) on the
cover. Output is `cover_descriptions.csv` with two columns —
`Filename` and `What's on the Cover` — that you can VLOOKUP into the
catalog tab, or paste-merge.

Setup:

```bash
brew install poppler                     # for pdf2image
pip3 install --user anthropic pdf2image
export ANTHROPIC_API_KEY="sk-ant-..."    # your key
```

Run:

```bash
# trial — first 5 PDFs only
python3 describe_covers.py --limit 5

# scoped runs
python3 describe_covers.py --year 1980
python3 describe_covers.py --mag "Pro Wrestling Illustrated"

# full run (~15-30 minutes for ~700 PDFs at Haiku rates)
python3 describe_covers.py
```

The script is resumable — rows already in `cover_descriptions.csv` are
skipped on re-run. Cost is ~$0.01–0.02 per cover with Haiku, so a full
backfill is roughly $10.

Once `cover_descriptions.csv` is full, in your sheet:
1. Add a tab named `Covers` and paste/import the CSV.
2. In your `Catalog (Full)` tab, set the *What's on the Cover* column to
   `=VLOOKUP(A2, Covers!A:B, 2, FALSE)` (assuming Filename is column A).

## Why this isn't running through Cowork directly

archive.org isn't on the sandbox egress allowlist, and Chrome MCP's
per-domain approval flow wasn't surfacing prompts I could act on for
new domains. Running locally is cleaner and dramatically faster
(direct connection vs. ~20 GB through the MCP transport).

Your existing n8n watcher keeps catching new IA additions going
forward — this is the historical backfill it never ran.
