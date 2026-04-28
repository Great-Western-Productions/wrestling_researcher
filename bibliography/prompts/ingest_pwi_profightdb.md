# Ingest PWI rankings + cover history from ProFightDB

Pasteable Cowork prompt. Self-contained — assumes no prior context.

---

## Goal

Backfill the wrestling bibliography database with every Pro Wrestling Illustrated (PWI) issue ProFightDB has indexed. For each issue, capture:

- The issue itself (cover date, "as of" period date, issue number, cover image URL, cover description, cover story headline, ProFightDB issue ID).
- Every ranking list printed in that issue: PWI Top 10, Tag Teams, Most Popular, Most Hated, plus all promotion-specific (WWF, AWA, NWA, WCW, ECW...) and territory-specific (Florida, Mid-Atlantic, World Class, Mid-South, Mid-Southern, Northwest, Southwest, Continental, Stampede, USWA, CWA, PNW, Smoky Mountain, etc.) and international (All Japan, New Japan, EMLL, AAA, Promo Azteca) lists.
- Every entry in those lists, linked to the wrestler or faction (tag team) record where possible.
- Cover subjects (who's pictured) linked to wrestler/faction records where possible.
- A path to the magazine PDF in Google Drive when one exists locally.

The DB is at `bibliography/wrestling_bibliography.db`. The migration has already been applied — tables `factions`, `faction_members`, `periodical_issues`, `issue_cover_subjects`, `ranking_lists`, `ranking_entries` exist.

## Attribution rule (non-negotiable)

ProFightDB allows reuse with link-back. Every `ranking_lists.source_url` and every `periodical_issues.source_url` must hold the specific ProFightDB page (with anchor for lists). Do not strip or normalize away the anchor. If a piece of WFIA content later cites this data, the published article will need to credit ProFightDB by linking that page.

## Strategy

**Try `requests` + `beautifulsoup4` first.** ProFightDB serves static HTML; no JS required for rankings or cover pages. Only fall back to the Claude-in-Chrome MCP if requests is blocked (Cloudflare, 403, etc.).

```python
import requests, time
from bs4 import BeautifulSoup
HEADERS = {"User-Agent": "WFIA-bibliography-bot/1.0 (research; contact joshua.schairbaum@gmail.com)"}
SLEEP = 1.5  # seconds between requests; be polite
```

If a fetch returns non-200, retry once after 5s, then log and skip.

## Targets

1. **PWI rankings index page** — discover the master listing of all PWI monthly rankings pages. Likely entry points to try:
   - `http://www.profightdb.com/pwi-monthly/`
   - `http://www.profightdb.com/pwi-rankings.html`
   - From the homepage navigation, find the "PWI Monthly" or "Rankings" link.
   - Individual issue pages follow `http://www.profightdb.com/pwi-monthly/{month}-{year}-{id}.html` (e.g., `september-1984-283.html`). The numeric ID at the end is the stable identifier.

2. **PWI cover history page** — separate index. Likely entry points:
   - `http://www.profightdb.com/cover-history/`
   - `http://www.profightdb.com/pwi-covers.html`
   - Navigate from the homepage; look for "Cover History" or "PWI Covers."
   - Individual cover pages may be the same `/pwi-monthly/{slug}-{id}.html` pages with a cover image and cover story heading near the top — verify by visiting one and inspecting the DOM.

If the rankings page and cover page are the same URL, that's fine: parse both passes from one fetch.

## Parsing per issue page

For each issue URL discovered from the index:

- `profightdb_id` = trailing integer in the URL slug.
- `publication_date` = the cover-date heading on the page (e.g., "September 1984") parsed to `YYYY-MM-01`. For seasonal issues like "Summer 1984" / "Fall 1984" / "Holiday 1997", use the convention: Spring=Mar, Summer=Jun, Fall=Sep, Winter=Dec, Holiday=Dec — and store the original label in `issue_number` so we can disambiguate later.
- `period_date` = the "as of" date PWI prints near the top of the rankings (e.g., "Mar 9th, 1984") parsed to `YYYY-MM-DD`. NULL if absent or printed as "No period specified."
- `cover_image_url` = absolute URL to the cover thumbnail image on the page (`<img>` near the top of the page; check the alt or surrounding markup).
- `cover_description` = brief auto-generated description from visible page text — who's on the cover. Free-text, fine if it's a single sentence.
- `cover_story` = the headline of the main cover-feature article if printed.
- `source_url` = the full issue URL.

## Parsing rankings

Each issue page lists multiple ranking sections, each with an anchor (`#Top%2010`, `#Tag%20Teams`, `#Florida`, etc.). Each section is a numbered list of 10 entries (occasionally 5 or 15 — read what's printed; don't hardcode 10).

For each section:

- Insert a `ranking_lists` row:
  - `issue_id` = FK to the issue we just upserted.
  - `list_label` = the printed section header verbatim ("Top 10", "Tag Teams", "Florida", "WWF", "Women", etc.).
  - `list_scope` = mapped per the table below.
  - `territory_id` = FK to `territories` table when scope is `territory` or `promotion` (look up by `name` or `cagematch_id`; leave NULL if no match).
  - `source_url` = full issue URL with the section anchor (e.g., `http://www.profightdb.com/pwi-monthly/september-1984-283.html#Top%2010`).
  - `list_size` = actual count of entries parsed.

- For each row in the section, insert a `ranking_entries` row:
  - `rank` = printed position.
  - `entry_name` = the printed name verbatim (always required).
  - `wrestler_id` = resolved FK if `list_scope` ∈ {singles, women, jr_heavyweight, cruiserweight, most_popular, most_hated, promotion, territory, international}.
  - `faction_id` = resolved FK if `list_scope` = `tag`.
  - `previous_rank` = if printed.

### Label → scope mapping

| Printed label                                                                  | list_scope        |
|--------------------------------------------------------------------------------|-------------------|
| `Top 10`                                                                       | `singles`         |
| `Tag Teams`                                                                    | `tag`             |
| `Most Popular`                                                                 | `most_popular`    |
| `Most Hated`                                                                   | `most_hated`      |
| `Women`                                                                        | `women`           |
| `Junior Heavyweights`                                                          | `jr_heavyweight`  |
| `Cruiserweight`                                                                | `cruiserweight`   |
| `WWF`, `WCW`, `WWE`, `AEW`, `NWA`, `AWA`, `ECW`, `WWWF`, `NWA U.S.`            | `promotion`       |
| `All Japan`, `New Japan`, `EMLL`, `Promo Azteca`, `AAA`, `WWC`                 | `international`   |
| `Florida`, `Georgia`, `Mid-Atlantic`, `Mid-South`, `Mid-Southern`, `World Class`, `Northwest`, `Southwest`, `Continental`, `Continental/USA`, `Missouri`, `Stampede`, `PNW`, `California`, `Smoky Mountain`, `Wild West`, `IWCCW`, `ICW`, `Global`, `USWA`, `USWA/CWA`, `USA`, `NWF`, `CWA`, `WWA`, `UWF`, `Music City`, `ECWA`, `Puerto Rico`, `International` | `territory`       |
| anything else                                                                  | `other`           |

## Wrestler / faction resolution

Build a lookup helper before the run:

```sql
-- in-memory dict from this query
SELECT id, primary_ring_name, other_ring_names FROM wrestlers;
SELECT id, name FROM factions;
```

For each `entry_name`:

1. Exact match against `primary_ring_name` (case-insensitive, normalized).
2. Exact match against any token in `other_ring_names` (comma-split).
3. Fuzzy match via `rapidfuzz.fuzz.WRatio` ≥ 92 against the union of all names; if multiple candidates, pick highest, tiebreak by `debut_year` proximity to the issue year.
4. Below threshold or no candidate → `wrestler_id`/`faction_id` stays NULL, `entry_name` is the only link. Log to a queue file `unresolved_ranking_entries.tsv` for manual review.

Tag team / faction resolution: if a printed name like "The Road Warriors" or "Demolition" doesn't match an existing `factions.name`, optionally create a new row with `type='tag_team'` and `confidence='low'` so the FK resolves on subsequent issues. Don't auto-create stables — those need editorial judgment.

Don't auto-create new wrestler records during this ingestion. The wrestlers table is curated and shouldn't be polluted with fuzzy hits.

## Google Drive PDF lookup

Workspace mount: `/Users/jschairb-gwp/Library/CloudStorage/GoogleDrive-josh@greatwesternproductions.com/My Drive/BACKGROUND_RESEARCH/Magazines`

Files are organized as `{decade}/{year}/Pro Wrestling Illustrated/Pro Wrestling Illustrated - {year} - {Month}.pdf`. Examples: `1980s/1984/Pro Wrestling Illustrated/Pro Wrestling Illustrated - 1984 - September.pdf`. Some folders use the abbreviated `PWI` form like `1980s/1985/1986-03, PWI/`; include both naming patterns in the lookup.

For each issue, after upsert, check if the file exists. If so, set `periodical_issues.drive_pdf_path` to the absolute path and `in_collection = 1`. If not, leave NULL.

## Idempotency

Every insert should be `INSERT OR IGNORE` against the natural keys, then `UPDATE` the row with anything new. The DB has these unique constraints to lean on:

- `periodical_issues(periodical_id, profightdb_id)`
- `periodical_issues(periodical_id, publication_date)`
- `ranking_lists(issue_id, list_label)`
- `ranking_entries(ranking_list_id, rank)`

The PWI periodical row should already exist in `periodicals` — look it up by `title LIKE 'Pro Wrestling Illustrated%'` and `year_started = 1979`. Do not create a new periodical row.

## SQLite write quirk

This DB sits in a Google-Drive-synced folder; SQLite writes can fail with "disk I/O error" when journaling. The reliable pattern is:

```python
import shutil, sqlite3, pathlib
src = pathlib.Path("bibliography/wrestling_bibliography.db")
tmp = pathlib.Path("/tmp/wb.db")
shutil.copy(src, tmp)
conn = sqlite3.connect(str(tmp))
# ... do all the work against tmp ...
conn.commit(); conn.close()
shutil.copy(tmp, src)  # atomic-ish swap back
```

## Run plan

1. Pilot: ingest the 1984 issues only (~12 monthly + a few quarterly). Verify cover URLs, period dates, list scopes, and at least 80% wrestler resolution rate against existing 334 wrestlers.
2. Show me a sample SQL output:
   ```sql
   SELECT * FROM v_issue_browser WHERE periodical = 'Pro Wrestling Illustrated' ORDER BY publication_date LIMIT 20;
   SELECT rank, as_printed, primary_ring_name FROM v_ranking_history
     WHERE periodical = 'Pro Wrestling Illustrated' AND publication_date = '1984-09-01' AND list_label = 'Top 10' ORDER BY rank;
   ```
3. If the pilot looks right, expand to full PWI run from 1979 through whatever ProFightDB has. Otherwise iterate on parsing.
4. At the end, dump `unresolved_ranking_entries.tsv` to `bibliography/queues/` so I can do manual cleanup.

## Out of scope this round

- PWI 500 (annual issue) — different format; defer.
- Auto-creating wrestler rows.
- Auto-creating stables (only tag teams, low confidence).
- Other periodicals — this prompt is PWI only.
