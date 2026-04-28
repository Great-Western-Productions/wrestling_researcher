# Pro Wrestling Bibliography

A SQLite-backed bibliography of pro wrestling books and periodicals.

_Last updated: 2026-04-27_

## Counts

- **653** books
- **62** periodicals
- **135** authors

By category:
- Books about pro wrestling: **513**
- Books about pro wrestlers (biographies): **20**
- Books by pro wrestlers (memoirs/autobios): **83**
- Fiction featuring pro wrestling: **37**

## Confidence levels

- **High** (142): hand-curated entries with verified author, year, publisher, and synopsis. Includes the full Crowbar Press catalog, ECW Press wrestling line samples, and ~85 canonical books from training knowledge.
- **Medium** (44): single-source attribution (typically Open Library or Wikipedia) — author and year present but synopsis may be auto-generated.
- **Low** (467): title-only entries pulled from Slam Wrestling's master review archive. These are real books, but author/year/ISBN need enrichment. Run `enrich_chunk.py` against Open Library when API access is available.

## Files

- `wrestling_bibliography.db` — SQLite source of truth (tables: books, authors, book_authors, periodicals, categories, research_sources)
- `markdown/01_books_about_pro_wrestling.md`
- `markdown/02_books_about_pro_wrestlers.md`
- `markdown/03_books_by_pro_wrestlers.md`
- `markdown/04_fiction_with_pro_wrestling.md`
- `markdown/05_pro_wrestling_periodicals.md`

## Schema

```sql
books(id, title, subtitle, category_code, publisher, year_published, 
      isbn10, isbn13, pages, format, language, country, subject_wrestler,
      era, territory_or_promotion, synopsis, source_url, confidence,
      primary_source_value, created_at)

authors(id, name, ring_name, is_wrestler, notes)

book_authors(book_id, author_id, role)  -- role: author | co-author | as told to | editor | foreword

periodicals(id, title, publisher, country, language, year_started, year_ended,
            frequency, type, parent_company, notes, issue_count_known,
            archive_in_collection, source_url, confidence, created_at)
```

## Sources consulted

- Slam Wrestling book reviews archive: https://slamwrestling.net/archives/books/ (513 titles)
- Crowbar Press catalog: https://www.crowbarpress.com/ (65 titles, mostly territorial-era memoirs)
- Wikipedia "List of wrestling-based comic books" (32 comic series)
- ECW Press wrestling collection: https://ecwpress.com/collections/wrestling
- Tim Hornbaker bibliography
- Hand-curated canonical wrestling literature (Hart, Foley, Flair, Thesz, Hornbaker, etc.)
- User's own magazine archive at `/BACKGROUND_RESEARCH/Magazines/` (cross-referenced for periodicals)

## Next research passes

1. **Enrich the 499 low-confidence Slam Wrestling titles** with author/year/ISBN. The script `enrich_chunk.py` is ready; needs Open Library or Google Books API access (currently rate-limited from sandbox).
2. **ECW Press full catalog** (~150-200 wrestling titles). Crowbar Press done; ECW Press is the other major publisher.
3. **Sports Publishing LLC, Triumph Books, Pegasus Books** wrestling catalogs.
4. **Japan**: comprehensive puroresu book bibliography (Tarzan Yamamoto, Mu Kawano, Inoki/Baba autobios in translation).
5. **Mexico**: lucha libre books in Spanish; wrestler photo books.
6. **UK**: Mick McManus, Jackie Pallo, Big Daddy memoirs; Joint Promotions histories.
7. **Self-published / indie**: Smart Mark Video book line, FYRA / Crowbar Press follow-ons, individual indie wrestler memoirs.

## Querying

```bash
# Books by a specific wrestler
sqlite3 wrestling_bibliography.db "SELECT b.title, b.year_published 
  FROM books b JOIN book_authors ba ON ba.book_id=b.id 
  JOIN authors a ON a.id=ba.author_id 
  WHERE a.name='Mick Foley' ORDER BY b.year_published"

# All territorial-era books
sqlite3 wrestling_bibliography.db "SELECT title, publisher, year_published 
  FROM books WHERE era='territorial' ORDER BY year_published"

# Periodicals you have in archive but might be missing issues for
sqlite3 wrestling_bibliography.db "SELECT title, year_started, year_ended 
  FROM periodicals WHERE archive_in_collection=1 ORDER BY year_started"
```
