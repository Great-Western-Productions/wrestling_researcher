#!/usr/bin/env python3
"""Generate browsable markdown exports of the bibliography."""
import sqlite3, os, datetime

# Auto-detect DB path so the script runs both in-sandbox and on the local mac
_HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wrestling_bibliography.db")
# Output goes alongside the DB in a `markdown/` sibling directory
OUT = os.path.join(os.path.dirname(DB), "markdown")
os.makedirs(OUT, exist_ok=True)

conn = sqlite3.connect(DB)
cur = conn.cursor()

def authors_for(book_id):
    cur2 = conn.cursor()
    cur2.execute("""SELECT a.name, a.is_wrestler, ba.role 
                   FROM book_authors ba JOIN authors a ON a.id=ba.author_id
                   WHERE ba.book_id=? ORDER BY ba.role, a.name""", (book_id,))
    return cur2.fetchall()

def render_book(row):
    bid, title, subtitle, cat, pub, year, isbn13, isbn10, country, subject, era, syn, src, conf = row
    parts = [f"### {title}"]
    if subtitle: parts.append(f"*{subtitle}*")
    
    # Author line
    auths = authors_for(bid)
    if auths:
        author_strs = []
        for name, is_wr, role in auths:
            wr_marker = " (wrestler)" if is_wr else ""
            role_marker = "" if role == "author" else f" — {role}"
            author_strs.append(f"{name}{wr_marker}{role_marker}")
        parts.append(f"**By:** {', '.join(author_strs)}")
    
    meta = []
    if year: meta.append(f"**Year:** {year}")
    if pub: meta.append(f"**Publisher:** {pub}")
    if isbn13: meta.append(f"**ISBN:** {isbn13}")
    elif isbn10: meta.append(f"**ISBN-10:** {isbn10}")
    if country: meta.append(f"**Country:** {country}")
    if era: meta.append(f"**Era:** {era}")
    if subject and not any(subject == a[0] for a in auths): 
        meta.append(f"**Subject:** {subject}")
    if conf and conf != "high": meta.append(f"*confidence: {conf}*")
    if meta: parts.append("  ·  ".join(meta))
    
    if syn: parts.append(f"\n{syn}")
    if src: parts.append(f"\n[Source]({src})")
    parts.append("")  # spacer
    return "\n".join(parts)

# ---- Per-category files ----
CAT_LABELS = {
    "about_wrestling": "01_books_about_pro_wrestling.md",
    "about_wrestler":  "02_books_about_pro_wrestlers.md",
    "by_wrestler":     "03_books_by_pro_wrestlers.md",
    "fiction":         "04_fiction_with_pro_wrestling.md",
}
CAT_HEADERS = {
    "about_wrestling": "# Books About Pro Wrestling\n\nHistories, analyses, business and cultural studies, encyclopedias, photo books, and reference works on professional wrestling.\n",
    "about_wrestler":  "# Books About Pro Wrestlers\n\nThird-party biographies, retrospectives, and posthumous tributes to specific wrestlers.\n",
    "by_wrestler":     "# Books By Pro Wrestlers\n\nAutobiographies, memoirs, instructionals, and books written or co-written by wrestlers themselves.\n",
    "fiction":         "# Fiction Featuring Pro Wrestling\n\nNovels, short stories, comic books, graphic novels, manga, and children's books with wrestling as a central theme.\n",
}

generated = datetime.date.today().isoformat()
for cat, fname in CAT_LABELS.items():
    cur.execute("""SELECT id, title, subtitle, category_code, publisher, year_published,
                          isbn13, isbn10, country, subject_wrestler, era, synopsis, source_url, confidence
                   FROM books WHERE category_code=?
                   ORDER BY 
                     CASE WHEN year_published IS NULL THEN 1 ELSE 0 END,
                     year_published, title""", (cat,))
    books = cur.fetchall()
    
    with open(os.path.join(OUT, fname), "w") as f:
        f.write(CAT_HEADERS[cat])
        f.write(f"\n_Generated: {generated} • {len(books)} entries_\n\n")
        f.write("---\n\n")
        # Group by decade where year is known
        grouped = {}
        no_year = []
        for b in books:
            year = b[5]
            if year:
                decade = (year // 10) * 10
                grouped.setdefault(decade, []).append(b)
            else:
                no_year.append(b)
        for decade in sorted(grouped):
            f.write(f"## {decade}s\n\n")
            for b in grouped[decade]:
                f.write(render_book(b) + "\n")
        if no_year:
            f.write(f"## Year Unknown\n\n_{len(no_year)} entries pending enrichment from Open Library / Google Books._\n\n")
            for b in no_year:
                f.write(render_book(b) + "\n")

# ---- Periodicals file ----
cur.execute("""SELECT id, title, publisher, country, year_started, year_ended, frequency, type, 
                      parent_company, notes, archive_in_collection, source_url, confidence
               FROM periodicals 
               ORDER BY country, year_started, title""")
pers = cur.fetchall()
with open(os.path.join(OUT, "05_pro_wrestling_periodicals.md"), "w") as f:
    f.write("# Pro Wrestling Periodicals\n\n")
    f.write("Magazines, newsletters, dirt sheets, and promotion programs covering pro wrestling.\n\n")
    f.write(f"_Generated: {generated} • {len(pers)} entries_\n\n")
    f.write("Items marked with **[in archive]** are present in the user's existing magazine collection at `/BACKGROUND_RESEARCH/Magazines/`.\n\n---\n\n")
    
    grouped = {}
    for p in pers:
        country = p[3] or "Unknown"
        grouped.setdefault(country, []).append(p)
    
    for country in ("US", "Canada", "UK", "Mexico", "Japan", "Unknown"):
        if country not in grouped: continue
        f.write(f"## {country}\n\n")
        for p in grouped[country]:
            pid, title, pub, ctry, ys, ye, freq, ptype, parent, notes, in_arch, src, conf = p
            year_str = f"{ys}–{ye}" if ye else (f"{ys}–present" if ys else "")
            archive_marker = " **[in archive]**" if in_arch else ""
            f.write(f"### {title}{archive_marker}\n")
            meta = []
            if year_str: meta.append(f"**{year_str}**")
            if freq: meta.append(freq)
            if ptype: meta.append(ptype.replace("_", " "))
            if pub: meta.append(f"published by {pub}")
            if meta: f.write(" · ".join(meta) + "\n")
            if notes: f.write(f"\n{notes}\n")
            f.write("\n")

# ---- Master README ----
total = cur.execute("SELECT COUNT(*) FROM books").fetchone()[0]
total_per = cur.execute("SELECT COUNT(*) FROM periodicals").fetchone()[0]
total_auth = cur.execute("SELECT COUNT(*) FROM authors").fetchone()[0]
high_conf = cur.execute("SELECT COUNT(*) FROM books WHERE confidence='high'").fetchone()[0]
medium_conf = cur.execute("SELECT COUNT(*) FROM books WHERE confidence='medium'").fetchone()[0]
low_conf = cur.execute("SELECT COUNT(*) FROM books WHERE confidence='low'").fetchone()[0]

readme = f"""# Pro Wrestling Bibliography

A SQLite-backed bibliography of pro wrestling books and periodicals.

_Last updated: {generated}_

## Counts

- **{total}** books
- **{total_per}** periodicals
- **{total_auth}** authors

By category:
- Books about pro wrestling: **{cur.execute("SELECT COUNT(*) FROM books WHERE category_code='about_wrestling'").fetchone()[0]}**
- Books about pro wrestlers (biographies): **{cur.execute("SELECT COUNT(*) FROM books WHERE category_code='about_wrestler'").fetchone()[0]}**
- Books by pro wrestlers (memoirs/autobios): **{cur.execute("SELECT COUNT(*) FROM books WHERE category_code='by_wrestler'").fetchone()[0]}**
- Fiction featuring pro wrestling: **{cur.execute("SELECT COUNT(*) FROM books WHERE category_code='fiction'").fetchone()[0]}**

## Confidence levels

- **High** ({high_conf}): hand-curated entries with verified author, year, publisher, and synopsis. Includes the full Crowbar Press catalog, ECW Press wrestling line samples, and ~85 canonical books from training knowledge.
- **Medium** ({medium_conf}): single-source attribution (typically Open Library or Wikipedia) — author and year present but synopsis may be auto-generated.
- **Low** ({low_conf}): title-only entries pulled from Slam Wrestling's master review archive. These are real books, but author/year/ISBN need enrichment. Run `enrich_chunk.py` against Open Library when API access is available.

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
"""
with open(os.path.join(OUT, "README.md"), "w") as f:
    f.write(readme)

# CSV export of all books for spreadsheet users
import csv
with open(os.path.join(OUT, "all_books.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["id","title","category","year","publisher","authors","country","era","subject","isbn13","synopsis","source_url","confidence"])
    for row in cur.execute("""SELECT id, title, category_code, year_published, publisher, country, era, 
                                     subject_wrestler, isbn13, synopsis, source_url, confidence 
                              FROM books ORDER BY category_code, year_published, title"""):
        bid = row[0]
        auths = "; ".join(a[0] for a in authors_for(bid))
        w.writerow([bid, row[1], row[2], row[3], row[4], auths, row[5], row[6], row[7], row[8], row[9], row[10], row[11]])

print(f"Markdown exports written to {OUT}/")
for f in sorted(os.listdir(OUT)):
    size = os.path.getsize(os.path.join(OUT, f))
    print(f"  {f}: {size:,} bytes")
conn.close()
