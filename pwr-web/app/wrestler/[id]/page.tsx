import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { categoryLabel, ifnull } from "@/lib/format";
import {
  citationsForWrestler,
  getWrestlerById,
  relatedBooksForWrestler,
  runsForWrestler,
} from "@/lib/queries/wrestlers";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

function statusConf(status: string | null): string {
  if (status === "queued") return "medium";
  if (status === "published") return "high";
  return "low";
}

export default async function WrestlerDetail({ params }: Props) {
  const { id } = await params;
  const wid = Number.parseInt(id, 10);
  if (!Number.isFinite(wid)) notFound();

  const w = await getWrestlerById(db, wid);
  if (!w) notFound();

  const [runs, related, citations] = await Promise.all([
    runsForWrestler(db, wid),
    relatedBooksForWrestler(db, w.primary_ring_name),
    citationsForWrestler(db, wid),
  ]);

  const heightDisplay = w.height_inches
    ? `${Math.floor(w.height_inches / 12)}'${w.height_inches % 12}" (${w.height_inches} in)`
    : null;

  return (
    <>
      <p className="breadcrumbs">
        <Link href="/wrestlers">&laquo; All wrestlers</Link>
      </p>

      <article className="book-detail">
        <h1>
          {w.primary_ring_name}
          {w.midcard_files_status && (
            <span className={`conf ${statusConf(w.midcard_files_status)}`}>
              {" "}
              {w.midcard_files_status}
            </span>
          )}
        </h1>

        {w.legal_name && w.legal_name !== w.primary_ring_name && (
          <p className="subtitle">{w.legal_name}</p>
        )}
        {w.other_ring_names && <p className="dim">Also worked as: {w.other_ring_names}</p>}

        {w.why_they_mattered && (
          <div className="lookup">
            <strong>Why they mattered.</strong> {w.why_they_mattered}
          </div>
        )}

        <table className="meta-table">
          <tbody>
            <tr>
              <th>Born</th>
              <td>
                {ifnull(w.born_date)}
                {w.hometown_real && ` · ${w.hometown_real}`}
              </td>
            </tr>
            {w.died_date && (
              <tr>
                <th>Died</th>
                <td>{w.died_date}</td>
              </tr>
            )}
            <tr>
              <th>Living</th>
              <td>{w.living === true ? "Yes" : w.living === false ? "No" : "—"}</td>
            </tr>
            <tr>
              <th>Active</th>
              <td>
                {w.debut_year
                  ? `${w.debut_year}${w.retired_year ? `–${w.retired_year}` : ""}`
                  : "—"}
              </td>
            </tr>
            <tr>
              <th>Primary role</th>
              <td>{ifnull(w.primary_role)}</td>
            </tr>
            <tr>
              <th>Hometown (billed)</th>
              <td>{ifnull(w.hometown_billed)}</td>
            </tr>
            {(heightDisplay || w.weight_lbs) && (
              <tr>
                <th>Billed size</th>
                <td>
                  {heightDisplay ?? "—"}
                  {w.weight_lbs && ` · ${w.weight_lbs} lbs`}
                </td>
              </tr>
            )}
            <tr>
              <th>Style</th>
              <td>{ifnull(w.style)}</td>
            </tr>
            <tr>
              <th>Finisher</th>
              <td>{ifnull(w.finisher)}</td>
            </tr>
            {w.socials && (
              <tr>
                <th>Socials</th>
                <td>{w.socials}</td>
              </tr>
            )}
            {w.convention_status && (
              <tr>
                <th>Convention status</th>
                <td>{w.convention_status}</td>
              </tr>
            )}
            {w.last_known_appearance && (
              <tr>
                <th>Last known appearance</th>
                <td>{w.last_known_appearance}</td>
              </tr>
            )}
            {w.footage_notes && (
              <tr>
                <th>Footage notes</th>
                <td>{w.footage_notes}</td>
              </tr>
            )}
            {w.midcard_files_priority && (
              <tr>
                <th>Files priority</th>
                <td>P{w.midcard_files_priority}</td>
              </tr>
            )}
          </tbody>
        </table>

        {w.bio && (
          <div className="synopsis">
            <h2>Bio</h2>
            {w.bio.split(/\n\n+/).map((para, i) => (
              // Paragraph text is the only other candidate key, and it can repeat.
              // biome-ignore lint/suspicious/noArrayIndexKey: split from one immutable string in a server component, so the list never reorders and the rows hold no state
              <p key={i}>{para}</p>
            ))}
          </div>
        )}

        {w.notes && (
          <div className="synopsis">
            <h2>Notes</h2>
            <p>{w.notes}</p>
          </div>
        )}
      </article>

      <section>
        <h2>
          {runs.length} territory run{runs.length !== 1 ? "s" : ""}
          <Link className="btn-inline" href={`/add/run?wrestler=${w.id}`}>
            + Add run
          </Link>
        </h2>
        {runs.length > 0 ? (
          <table className="books">
            <thead>
              <tr>
                <th>Territory</th>
                <th>Region</th>
                <th>Years</th>
                <th>Role</th>
                <th>Ring name (run)</th>
                <th>Primary?</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="title">
                    <Link href={`/territory/${r.tid}`}>{r.terr_name}</Link>
                    {r.terr_short && <div className="dim small">{r.terr_short}</div>}
                  </td>
                  <td>{ifnull(r.terr_region)}</td>
                  <td>
                    {r.start_year
                      ? `${r.start_year}${r.end_year && r.end_year !== r.start_year ? `–${r.end_year}` : ""}`
                      : "—"}
                  </td>
                  <td>{ifnull(r.role_during_run)}</td>
                  <td>{ifnull(r.ring_name_during_run)}</td>
                  <td>
                    {r.primary_run ? (
                      <span className="tag wr">primary</span>
                    ) : (
                      <span className="dim">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="dim">No territory runs recorded yet.</p>
        )}
      </section>

      {citations.length > 0 && (
        <section>
          <h2>Sources ({citations.length})</h2>
          <ul className="citations">
            {citations.map((c) => (
              <li key={c.id}>
                <Link href={`/book/${c.book_id}`}>{c.book_title}</Link>
                {c.book_year && <span className="dim"> ({c.book_year})</span>}
                {c.page && <span className="dim">, p. {c.page}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {related.length > 0 && (
        <section>
          <h2>Related books</h2>
          <p className="dim small">
            Books that name this wrestler as subject or author (string-matched).
          </p>
          <table className="books">
            <thead>
              <tr>
                <th>Title</th>
                <th>Year</th>
                <th>Category</th>
              </tr>
            </thead>
            <tbody>
              {related.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link href={`/book/${b.id}`}>{b.title}</Link>
                  </td>
                  <td>{ifnull(b.year_published)}</td>
                  <td>
                    <span className={`cat-tag ${b.category_code}`}>
                      {categoryLabel(b.category_code)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
