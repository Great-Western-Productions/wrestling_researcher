import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { ifnull } from "@/lib/format";
import {
  getTerritoryById,
  relatedBooksForTerritory,
  runsForTerritory,
} from "@/lib/queries/territories";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function TerritoryDetail({ params }: Props) {
  const { id } = await params;
  const tid = Number.parseInt(id, 10);
  if (!Number.isFinite(tid)) notFound();

  const t = await getTerritoryById(db, tid);
  if (!t) notFound();

  const [runs, related] = await Promise.all([
    runsForTerritory(db, tid),
    relatedBooksForTerritory(db, { name: t.name, short_name: t.short_name }),
  ]);

  return (
    <>
      <p className="breadcrumbs">
        <Link href="/territories">&laquo; All territories</Link>
      </p>

      <article className="book-detail">
        <h1>
          {t.name}
          {t.nwa_member ? <span className="tag archive"> NWA</span> : null}
        </h1>
        {t.short_name && <p className="subtitle">{t.short_name}</p>}

        <table className="meta-table">
          <tbody>
            <tr>
              <th>Region</th>
              <td>{ifnull(t.region)}</td>
            </tr>
            <tr>
              <th>Headquarters</th>
              <td>
                {ifnull(t.headquarters_city)}
                {t.headquarters_state && `, ${t.headquarters_state}`}
              </td>
            </tr>
            <tr>
              <th>Active</th>
              <td>{t.year_founded ? `${t.year_founded}–${t.year_closed ?? "present"}` : "—"}</td>
            </tr>
            <tr>
              <th>Promoter lineage</th>
              <td>{ifnull(t.promoter_lineage)}</td>
            </tr>
            <tr>
              <th>NWA member</th>
              <td>{t.nwa_member ? "Yes" : "No"}</td>
            </tr>
          </tbody>
        </table>

        {t.notes && (
          <div className="synopsis">
            <h2>Notes</h2>
            <p>{t.notes}</p>
          </div>
        )}
      </article>

      <section>
        <h2>
          {runs.length} wrestler run{runs.length !== 1 ? "s" : ""}
          <Link className="btn-inline" href={`/add/run?territory=${t.id}`}>
            + Add run
          </Link>
        </h2>
        {runs.length > 0 ? (
          <table className="books">
            <thead>
              <tr>
                <th>Wrestler</th>
                <th>Ring name (run)</th>
                <th>Years</th>
                <th>Role</th>
                <th>Primary?</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="title">
                    <Link href={`/wrestler/${r.wid}`}>{r.primary_ring_name}</Link>
                    {r.legal_name && <div className="dim small">{r.legal_name}</div>}
                  </td>
                  <td>{ifnull(r.ring_name_during_run)}</td>
                  <td>
                    {r.start_year
                      ? `${r.start_year}${r.end_year && r.end_year !== r.start_year ? `–${r.end_year}` : ""}`
                      : "—"}
                  </td>
                  <td>{ifnull(r.role_during_run)}</td>
                  <td>
                    {r.primary_run ? (
                      <span className="tag wr">primary</span>
                    ) : (
                      <span className="dim">—</span>
                    )}
                  </td>
                  <td className="dim small">{ifnull(r.notes, "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="dim">No wrestler runs recorded yet.</p>
        )}
      </section>

      {related.length > 0 && (
        <section>
          <h2>Books that mention this territory</h2>
          <table className="books">
            <thead>
              <tr>
                <th>Title</th>
                <th>Year</th>
                <th>Country</th>
              </tr>
            </thead>
            <tbody>
              {related.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link href={`/book/${b.id}`}>{b.title}</Link>
                  </td>
                  <td>{ifnull(b.year_published)}</td>
                  <td>{ifnull(b.country)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
