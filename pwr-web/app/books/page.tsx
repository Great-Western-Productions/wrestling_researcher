import Link from "next/link";
import { db } from "@/lib/db/client";
import { listBooks, type BookFilters } from "@/lib/queries/books";
import { CATEGORIES, categoryLabel, ifnull, buildQueryString } from "@/lib/format";
import { mergeBookAction } from "@/lib/actions/merge";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function pickStr(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) return undefined;
  const t = s.trim();
  return t || undefined;
}
function pickInt(v: string | string[] | undefined): number | undefined {
  const s = pickStr(v);
  if (!s) return undefined;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

const SORT_OPTIONS: Array<[NonNullable<BookFilters["sort"]>, string]> = [
  ["author", "Author A-Z"],
  ["year_desc", "Newest first"],
  ["year_asc", "Oldest first"],
  ["title", "Title A-Z"],
  ["category", "By category"],
];

export default async function BooksPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const filters: BookFilters = {
    cat: pickStr(params.cat),
    q: pickStr(params.q),
    country: pickStr(params.country),
    era: pickStr(params.era),
    confidence: pickStr(params.confidence),
    yearFrom: pickInt(params.from),
    yearTo: pickInt(params.to),
    sort: (pickStr(params.sort) as BookFilters["sort"]) ?? "author",
    page: pickInt(params.page) ?? 1,
  };

  const result = await listBooks(db, filters);

  const baseQuery = {
    cat: filters.cat,
    q: filters.q,
    country: filters.country,
    era: filters.era,
    confidence: filters.confidence,
    from: filters.yearFrom,
    to: filters.yearTo,
    sort: filters.sort,
  };
  const prevHref = `/books${buildQueryString({ ...baseQuery, page: result.page - 1 })}`;
  const nextHref = `/books${buildQueryString({ ...baseQuery, page: result.page + 1 })}`;

  return (
    <>
      <h1>Books</h1>

      <form className="filters" action="/books" method="get">
        <input type="text" name="q" defaultValue={filters.q ?? ""} placeholder="Search title or author" />

        <select name="cat" defaultValue={filters.cat ?? ""}>
          <option value="">All categories</option>
          {CATEGORIES.map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>

        <select name="country" defaultValue={filters.country ?? ""}>
          <option value="">All countries</option>
          {result.countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select name="era" defaultValue={filters.era ?? ""}>
          <option value="">All eras</option>
          {result.eras.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>

        <select name="confidence" defaultValue={filters.confidence ?? ""}>
          <option value="">Any confidence</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="low_searched">Low (searched)</option>
        </select>

        <input
          type="number"
          name="from"
          placeholder="From year"
          min="1900"
          max="2030"
          defaultValue={filters.yearFrom ?? ""}
        />
        <input
          type="number"
          name="to"
          placeholder="To year"
          min="1900"
          max="2030"
          defaultValue={filters.yearTo ?? ""}
        />

        <select name="sort" defaultValue={filters.sort ?? "author"}>
          {SORT_OPTIONS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>

        <button type="submit">Filter</button>
        <a className="clear" href="/books">
          Clear
        </a>
      </form>

      <p className="result-count">
        {result.total} match{result.total !== 1 ? "es" : ""}
        {result.pages > 1 && ` — page ${result.page} of ${result.pages}`}
      </p>

      <table className="books">
        <thead>
          <tr>
            <th>Title</th>
            <th>Author(s)</th>
            <th>Year</th>
            <th>Category</th>
            <th>Country</th>
            <th>Status</th>
            {result.items.length > 1 && <th>Merge</th>}
          </tr>
        </thead>
        <tbody>
          {result.items.map(({ book: b, authors }) => (
            <tr key={b.id}>
              <td className="title">
                <Link href={`/book/${b.id}`}>{b.title}</Link>
                {b.subtitle && <div className="dim small">{b.subtitle}</div>}
              </td>
              <td>
                {authors.length === 0 ? (
                  <span className="dim">—</span>
                ) : (
                  authors.map((a, i) => (
                    <span key={a.id}>
                      <Link href={`/author/${a.id}`}>{a.name}</Link>
                      {i < authors.length - 1 ? ", " : ""}
                    </span>
                  ))
                )}
              </td>
              <td>{ifnull(b.year_published)}</td>
              <td>
                <span className={`cat-tag ${b.category_code}`}>
                  {categoryLabel(b.category_code)}
                </span>
              </td>
              <td>{ifnull(b.country)}</td>
              <td>
                <span className={`conf ${b.confidence ?? ""}`}>
                  {b.confidence ?? "—"}
                </span>
              </td>
              {result.items.length > 1 && (
                <td className="merge-cell">
                  <form
                    className="inline-merge"
                    action={mergeBookAction.bind(null, b.id)}
                  >
                    <input type="hidden" name="next" value="/books" />
                    <select name="duplicate_book_id" aria-label={`Duplicate book to merge into ${b.title}`}>
                      <option value="">Merge duplicate...</option>
                      {result.items
                        .filter((c) => c.book.id !== b.id)
                        .map((c) => (
                          <option key={c.book.id} value={c.book.id}>
                            {c.book.title}
                            {c.book.year_published ? ` (${c.book.year_published})` : ""}
                          </option>
                        ))}
                    </select>
                    <button type="submit">Merge</button>
                  </form>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {result.pages > 1 && (
        <nav className="pagination">
          {result.page > 1 ? (
            <Link href={prevHref}>&laquo; prev</Link>
          ) : (
            <span className="disabled">&laquo; prev</span>
          )}
          <span>
            page {result.page} / {result.pages}
          </span>
          {result.page < result.pages ? (
            <Link href={nextHref}>next &raquo;</Link>
          ) : (
            <span className="disabled">next &raquo;</span>
          )}
        </nav>
      )}
    </>
  );
}
