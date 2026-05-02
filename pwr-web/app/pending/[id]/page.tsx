import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { getPendingDetail } from "@/lib/queries/pending";
import { pendingMergeAction, pendingUnmergeAction } from "@/lib/actions/merge";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function PendingDetailPage({ params }: Props) {
  const { id } = await params;
  const pid = Number.parseInt(id, 10);
  if (!Number.isFinite(pid)) notFound();

  const p = await getPendingDetail(db, pid);
  if (!p) notFound();

  return (
    <>
      <p className="breadcrumbs">
        <Link href="/pending">&laquo; Pending wrestlers</Link>
      </p>

      <h1>{p.printed_name}</h1>
      <p className="subtitle">
        {p.merged ? (
          <>
            <span className="conf high">merged</span> into{" "}
            <Link href={`/wrestler/${p.resolved_wrestler_id}`}>{p.resolved_name}</Link>
          </>
        ) : (
          <>
            <span className="conf low">open</span> · {p.occurrence_count} ranking entries
            reference this name
          </>
        )}
      </p>

      <dl className="kv">
        {p.profightdb_id && (
          <>
            <dt>ProFightDB</dt>
            <dd>
              <a
                href={`http://www.profightdb.com/wrestlers/${p.profightdb_slug}.html`}
                target="_blank"
                rel="noopener"
              >
                {p.profightdb_slug}
              </a>{" "}
              (id {p.profightdb_id})
            </dd>
          </>
        )}
        {p.other_printed_names && (
          <>
            <dt>Alternate spellings</dt>
            <dd>{p.other_printed_names.replaceAll("|", " · ")}</dd>
          </>
        )}
        <dt>First seen</dt>
        <dd>{p.first_seen_date}</dd>
        <dt>Last seen</dt>
        <dd>{p.last_seen_date}</dd>
        <dt>Occurrences</dt>
        <dd>{p.occurrence_count}</dd>
      </dl>

      {!p.merged && (
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", margin: "1.5rem 0" }}
        >
          <section style={{ border: "1px solid var(--border)", padding: "1rem", background: "var(--paper-soft)" }}>
            <h2 style={{ marginTop: 0 }}>Merge into existing wrestler</h2>
            <form method="post" action={pendingMergeAction.bind(null, p.id)}>
              {p.suggestions.length > 0 ? (
                <>
                  <p className="dim small">Suggestions (name-similar):</p>
                  <label>
                    Wrestler
                    <select name="wrestler_id" defaultValue="">
                      <option value="">— pick from suggestions —</option>
                      {p.suggestions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.primary_ring_name}
                          {s.debut_year ? ` (${s.debut_year})` : ""}
                          {s.other_ring_names ? ` — aka ${s.other_ring_names}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : (
                <p className="dim small">
                  No name-similar wrestlers in the curated table.
                </p>
              )}
              <p className="dim small">Or pick from the full list:</p>
              <label>
                <select name="wrestler_id_manual" defaultValue="" style={{ width: "100%" }}>
                  <option value="">— select wrestler —</option>
                  {p.allWrestlers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.primary_ring_name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-actions" style={{ marginTop: "1rem" }}>
                <button type="submit">Merge</button>
              </div>
            </form>
          </section>

          <section style={{ border: "1px solid var(--border)", padding: "1rem", background: "var(--paper-soft)" }}>
            <h2 style={{ marginTop: 0 }}>Promote to new wrestler</h2>
            <p className="dim">
              Open the Add Wrestler form pre-filled with this name. On save, all{" "}
              {p.occurrence_count} ranking entries will be linked to the new record.
            </p>
            <p>
              <Link className="btn-pill" href={`/add/wrestler?from_pending=${p.id}`}>
                Open Add Wrestler →
              </Link>
            </p>
          </section>
        </div>
      )}

      {p.merged ? (
        <form
          method="post"
          action={pendingUnmergeAction.bind(null, p.id)}
          style={{ margin: "1rem 0" }}
        >
          <button type="submit" className="btn-pill">
            Undo merge
          </button>
        </form>
      ) : null}

      <h2>Ranking appearances ({p.occurrence_count})</h2>
      <table className="books">
        <thead>
          <tr>
            <th>Issue</th>
            <th>List</th>
            <th>Rank</th>
            <th>As printed</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {p.samples.map((s, i) => (
            <tr key={i}>
              <td>
                {s.publication_date}
                {s.issue_number && (
                  <span className="dim small"> ({s.issue_number})</span>
                )}
              </td>
              <td>
                {s.list_label} <span className="dim small">{s.list_scope}</span>
              </td>
              <td>{s.rank}</td>
              <td>{s.entry_name}</td>
              <td>
                {s.source_url && (
                  <a href={s.source_url} target="_blank" rel="noopener" className="small">
                    PFDB
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {p.occurrence_count > p.samples.length && (
        <p className="dim small">
          Showing latest {p.samples.length} of {p.occurrence_count}.
        </p>
      )}
    </>
  );
}
