import Link from "next/link";
import { db } from "@/lib/db/client";
import { listPending, type PendingFilters } from "@/lib/queries/pending";
import { buildQueryString } from "@/lib/format";

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

export default async function PendingPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const showRaw = pickStr(params.show);
  const filters: PendingFilters = {
    q: pickStr(params.q),
    show: showRaw === "merged" || showRaw === "all" ? showRaw : "open",
    page: pickInt(params.page) ?? 1,
  };
  const result = await listPending(db, filters);
  const baseQuery = { q: filters.q, show: filters.show };
  const prevHref = `/pending${buildQueryString({ ...baseQuery, page: result.page - 1 })}`;
  const nextHref = `/pending${buildQueryString({ ...baseQuery, page: result.page + 1 })}`;

  return (
    <>
      <h1>Pending wrestlers</h1>
      <p className="subtitle">
        Names from PWI rankings (and other ingested sources) not yet linked to a curated
        wrestler. Merge into an existing record or promote to a new one.
      </p>

      <div
        className="filters"
        style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}
      >
        <form
          action="/pending"
          method="get"
          style={{ display: "flex", gap: ".5rem", alignItems: "center", flex: 1 }}
        >
          <input
            type="text"
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder="Search printed name…"
            style={{ flex: 1, minWidth: "18rem" }}
          />
          <input type="hidden" name="show" value={filters.show ?? "open"} />
          <button type="submit">Search</button>
          {filters.q && (
            <Link className="clear" href={`/pending${buildQueryString({ show: filters.show })}`}>
              Clear
            </Link>
          )}
        </form>

        <div style={{ display: "flex", gap: ".25rem" }}>
          {(["open", "merged", "all"] as const).map((s) => (
            <Link
              key={s}
              href={`/pending${buildQueryString({ show: s, q: filters.q })}`}
              className={`btn-pill${filters.show === s ? " active" : ""}`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
              {s === "open" && (
                <span className="dim small"> ({result.counts.open})</span>
              )}
              {s === "merged" && (
                <span className="dim small"> ({result.counts.merged})</span>
              )}
            </Link>
          ))}
        </div>
      </div>

      <p className="result-count">
        {result.total} pending wrestler{result.total !== 1 ? "s" : ""}
      </p>

      <table className="books">
        <thead>
          <tr>
            <th>Printed name</th>
            <th>PFDB</th>
            <th>Count</th>
            <th>Range</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r) => (
            <tr key={r.id} className={r.merged ? "dim" : undefined}>
              <td className="title">
                <Link href={`/pending/${r.id}`}>{r.printed_name}</Link>
                {r.other_printed_names && (
                  <div className="dim small">
                    also: {r.other_printed_names.replaceAll("|", " · ")}
                  </div>
                )}
              </td>
              <td>
                {r.profightdb_id ? (
                  <a
                    href={`http://www.profightdb.com/wrestlers/${r.profightdb_slug}.html`}
                    target="_blank"
                    rel="noopener"
                  >
                    {r.profightdb_id}
                  </a>
                ) : (
                  <span className="dim">—</span>
                )}
              </td>
              <td>{r.occurrence_count}</td>
              <td>
                {r.first_seen_date === r.last_seen_date ? (
                  r.first_seen_date
                ) : (
                  <span className="small">
                    {r.first_seen_date} → {r.last_seen_date}
                  </span>
                )}
              </td>
              <td>
                {r.merged ? (
                  <>
                    <span className="conf high">merged</span>
                    <div className="dim small">→ {r.resolved_name}</div>
                  </>
                ) : (
                  <span className="conf low">open</span>
                )}
              </td>
              <td>
                {r.merged ? (
                  <Link className="btn-pill" href={`/wrestler/${r.resolved_wrestler_id}`}>
                    view
                  </Link>
                ) : (
                  <Link className="btn-pill" href={`/pending/${r.id}`}>
                    review
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {result.pages > 1 && (
        <div className="pagination">
          {result.page > 1 && <Link href={prevHref}>&laquo; prev</Link>}
          <span className="dim small">
            {" "}
            page {result.page} of {result.pages}{" "}
          </span>
          {result.page < result.pages && <Link href={nextHref}>next &raquo;</Link>}
        </div>
      )}
    </>
  );
}
