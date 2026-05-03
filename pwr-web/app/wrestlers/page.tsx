import Link from "next/link";
import { db } from "@/lib/db/client";
import { ifnull } from "@/lib/format";
import { listWrestlers, type WrestlerFilters } from "@/lib/queries/wrestlers";

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

function statusConf(status: string | null): string {
  if (status === "queued") return "medium";
  if (status === "published") return "high";
  return "low";
}

const SORTS: Array<[NonNullable<WrestlerFilters["sort"]>, string]> = [
  ["name", "Name A-Z"],
  ["debut", "Debut year"],
  ["born", "Born date"],
  ["priority", "Files priority"],
];

export default async function WrestlersPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const livingRaw = pickStr(params.living);
  const filters: WrestlerFilters = {
    q: pickStr(params.q),
    role: pickStr(params.role),
    living: livingRaw === "1" || livingRaw === "0" ? livingRaw : undefined,
    territoryId: pickInt(params.territory),
    status: pickStr(params.status),
    sort: (pickStr(params.sort) as WrestlerFilters["sort"]) ?? "name",
  };

  const result = await listWrestlers(db, filters);

  return (
    <>
      <h1>Wrestlers</h1>
      <p className="subtitle">
        Dossiers from the Midcard Files — workers across territories, eras, and styles.
      </p>

      <form className="filters" action="/wrestlers" method="get">
        <input
          type="text"
          name="q"
          defaultValue={filters.q ?? ""}
          placeholder="Search by ring name, legal name, or alias"
        />

        <select name="role" defaultValue={filters.role ?? ""}>
          <option value="">All roles</option>
          {result.roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <select name="territory" defaultValue={filters.territoryId?.toString() ?? ""}>
          <option value="">All territories</option>
          {result.territories.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.short_name ? ` (${t.short_name})` : ""}
            </option>
          ))}
        </select>

        <select name="living" defaultValue={filters.living ?? ""}>
          <option value="">Any</option>
          <option value="1">Living</option>
          <option value="0">Deceased</option>
        </select>

        <select name="status" defaultValue={filters.status ?? ""}>
          <option value="">Any status</option>
          {result.statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select name="sort" defaultValue={filters.sort ?? "name"}>
          {SORTS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>

        <button type="submit">Filter</button>
        <a className="clear" href="/wrestlers">
          Clear
        </a>
      </form>

      <p className="result-count">
        {result.total} wrestler{result.total !== 1 ? "s" : ""}
      </p>

      <table className="books">
        <thead>
          <tr>
            <th>Ring name</th>
            <th>Legal name</th>
            <th>Born</th>
            <th>Active</th>
            <th>Role</th>
            <th>Files</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((w) => (
            <tr key={w.id}>
              <td className="title">
                <Link href={`/wrestler/${w.id}`}>{w.primary_ring_name}</Link>
                {w.other_ring_names && <div className="dim small">aka {w.other_ring_names}</div>}
              </td>
              <td>{ifnull(w.legal_name)}</td>
              <td>
                {ifnull(w.born_date)}
                {w.died_date && <div className="dim small">d. {w.died_date}</div>}
              </td>
              <td>
                {w.debut_year
                  ? `${w.debut_year}${w.retired_year ? `–${w.retired_year}` : ""}`
                  : "—"}
              </td>
              <td>{ifnull(w.primary_role)}</td>
              <td>
                {w.midcard_files_status ? (
                  <span className={`conf ${statusConf(w.midcard_files_status)}`}>
                    {w.midcard_files_status}
                  </span>
                ) : (
                  <span className="dim">—</span>
                )}
                {w.midcard_files_priority && (
                  <span className="dim small"> P{w.midcard_files_priority}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
