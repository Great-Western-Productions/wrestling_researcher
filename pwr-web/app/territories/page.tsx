import Link from "next/link";
import { db } from "@/lib/db/client";
import { ifnull } from "@/lib/format";
import { listTerritories, type TerritoryFilters } from "@/lib/queries/territories";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function pickStr(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) return undefined;
  const t = s.trim();
  return t || undefined;
}

export default async function TerritoriesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const nwaRaw = pickStr(params.nwa);
  const filters: TerritoryFilters = {
    region: pickStr(params.region),
    nwa: nwaRaw === "1" || nwaRaw === "0" ? nwaRaw : undefined,
    q: pickStr(params.q),
  };

  const result = await listTerritories(db, filters);

  // Group by region (keep insertion order from query)
  const grouped = new Map<string, typeof result.rows>();
  for (const row of result.rows) {
    const key = row.region ?? "Other";
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }

  return (
    <>
      <h1>Territories</h1>
      <p className="subtitle">
        Promotions and territorial circuits — NWA members, independent operators, and major national
        companies.
      </p>

      <form className="filters" action="/territories" method="get">
        <input
          type="text"
          name="q"
          defaultValue={filters.q ?? ""}
          placeholder="Search by name, short name, or city"
        />
        <select name="region" defaultValue={filters.region ?? ""}>
          <option value="">All regions</option>
          {result.regions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select name="nwa" defaultValue={filters.nwa ?? ""}>
          <option value="">All affiliations</option>
          <option value="1">NWA member</option>
          <option value="0">Non-NWA</option>
        </select>
        <button type="submit">Filter</button>
        <a className="clear" href="/territories">
          Clear
        </a>
      </form>

      <p className="result-count">
        {result.total} territor{result.total !== 1 ? "ies" : "y"}
      </p>

      {[...grouped.entries()].map(([region, items]) => (
        <section key={region}>
          <h2>{region}</h2>
          <table className="books territories-table">
            <thead>
              <tr>
                <th>Promotion</th>
                <th>Short</th>
                <th>HQ</th>
                <th>Years</th>
                <th>NWA</th>
                <th>Wrestler runs</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <td className="title">
                    <Link href={`/territory/${t.id}`}>{t.name}</Link>
                    {t.promoter_lineage && <div className="dim small">{t.promoter_lineage}</div>}
                  </td>
                  <td>{ifnull(t.short_name)}</td>
                  <td>
                    {ifnull(t.headquarters_city)}
                    {t.headquarters_state && `, ${t.headquarters_state}`}
                  </td>
                  <td>
                    {t.year_founded ? `${t.year_founded}–${t.year_closed ?? "present"}` : "—"}
                  </td>
                  <td>
                    {t.nwa_member ? (
                      <span className="tag archive">NWA</span>
                    ) : (
                      <span className="dim">—</span>
                    )}
                  </td>
                  <td>{t.run_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}
