import { db } from "@/lib/db/client";
import { listPeriodicals, type PeriodicalFilters } from "@/lib/queries/periodicals";
import { ifnull } from "@/lib/format";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function pickStr(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) return undefined;
  const t = s.trim();
  return t || undefined;
}

export default async function PeriodicalsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const filters: PeriodicalFilters = {
    country: pickStr(params.country),
    type: pickStr(params.type),
    inArchive: pickStr(params.in_archive) === "1",
  };

  const result = await listPeriodicals(db, filters);

  const grouped = new Map<string, typeof result.rows>();
  for (const row of result.rows) {
    const key = row.country ?? "Other";
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }

  return (
    <>
      <h1>Periodicals</h1>
      <p className="dim">Magazines, newsletters, dirt sheets, and promotion programs.</p>

      <form className="filters" action="/periodicals" method="get">
        <select name="country" defaultValue={filters.country ?? ""}>
          <option value="">All countries</option>
          {result.countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select name="type" defaultValue={filters.type ?? ""}>
          <option value="">All types</option>
          {result.types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className="check">
          <input
            type="checkbox"
            name="in_archive"
            value="1"
            defaultChecked={filters.inArchive}
          />{" "}
          In your archive only
        </label>
        <button type="submit">Filter</button>
        <a className="clear" href="/periodicals">
          Clear
        </a>
      </form>

      <p className="result-count">
        {result.total} periodical{result.total !== 1 ? "s" : ""}
      </p>

      {[...grouped.entries()].map(([country, items]) => (
        <section key={country}>
          <h2>{country}</h2>
          <table className="periodicals">
            <thead>
              <tr>
                <th>Title</th>
                <th>Years</th>
                <th>Frequency</th>
                <th>Type</th>
                <th>Publisher</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.title}</strong>
                    {p.notes && <div className="dim small">{p.notes}</div>}
                  </td>
                  <td>
                    {p.year_started
                      ? `${p.year_started}–${p.year_ended ?? "present"}`
                      : "—"}
                  </td>
                  <td>{ifnull(p.frequency)}</td>
                  <td>{ifnull(p.type)}</td>
                  <td>{ifnull(p.publisher)}</td>
                  <td>
                    {p.archive_in_collection ? (
                      <span className="tag archive">in archive</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}
