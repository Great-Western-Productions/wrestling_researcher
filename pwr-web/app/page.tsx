import Link from "next/link";
import { db } from "@/lib/db/client";
import {
  getBooksByDecade,
  getDashboardCounts,
  getFeaturedTerritories,
  getTopAuthors,
} from "@/lib/queries/dashboard";

export const dynamic = "force-dynamic";

const CATEGORIES: Array<[string, string]> = [
  ["about_wrestling", "About wrestling"],
  ["about_wrestler", "About wrestlers"],
  ["by_wrestler", "By wrestlers"],
  ["fiction", "Fiction"],
];

export default async function Home() {
  const [counts, topAuthors, byDecade, featured] = await Promise.all([
    getDashboardCounts(db),
    getTopAuthors(db, 25),
    getBooksByDecade(db),
    getFeaturedTerritories(db, 8),
  ]);

  const maxDecadeN = byDecade.reduce((m, r) => Math.max(m, r.count), 0) || 1;

  return (
    <>
      <section className="hero">
        <h1>Pro Wrestling Researcher</h1>
        <p className="subtitle">
          Books, periodicals, territories, and the workers who filled them — across eras and
          continents.
        </p>
      </section>

      <section className="cards">
        <Link className="card" href="/books">
          <div className="card-count">{counts.books}</div>
          <div className="card-label">Books</div>
        </Link>
        <Link className="card" href="/periodicals">
          <div className="card-count">{counts.periodicals}</div>
          <div className="card-label">Periodicals</div>
        </Link>
        <Link className="card" href="/territories">
          <div className="card-count">{counts.territories}</div>
          <div className="card-label">Territories</div>
        </Link>
        <Link className="card" href="/wrestlers">
          <div className="card-count">{counts.wrestlers}</div>
          <div className="card-label">Wrestlers</div>
        </Link>
      </section>

      <section>
        <h2>Browse books by category</h2>
        <div className="cards subcards">
          {CATEGORIES.map(([code, label]) => (
            <Link key={code} className="card mini" href={`/books?cat=${code}`}>
              <div className="card-count small">{counts.byCategory[code] ?? 0}</div>
              <div className="card-label">{label}</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="row">
        <div className="col">
          <h2>Featured territories</h2>
          {featured.length > 0 ? (
            <>
              <ul className="terr-list">
                {featured.map((t) => (
                  <li key={t.id}>
                    <Link href={`/territory/${t.id}`}>{t.name}</Link>
                    {t.shortName && <span className="dim small"> — {t.shortName}</span>}
                    <div className="dim small">
                      {t.region ?? "—"}
                      {t.yearFounded && (
                        <>
                          {" · "}
                          {t.yearFounded}
                          {t.yearClosed ? `–${t.yearClosed}` : "–present"}
                        </>
                      )}
                      {" · "}
                      {t.runCount} run{t.runCount !== 1 ? "s" : ""}
                    </div>
                  </li>
                ))}
              </ul>
              <p>
                <Link href="/territories">All territories &raquo;</Link>
              </p>
            </>
          ) : (
            <p className="dim">No territories yet.</p>
          )}
        </div>
        <div className="col">
          <h2>By decade (books)</h2>
          {byDecade.length > 0 && (
            <div className="bars">
              {byDecade.map((row) => (
                <div className="bar-row" key={row.decade}>
                  <span className="bar-label">{row.decade}s</span>
                  <span className="bar">
                    <span
                      className="bar-fill"
                      style={{ width: `${((row.count / maxDecadeN) * 100).toFixed(1)}%` }}
                    />
                  </span>
                  <span className="bar-n">{row.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="row">
        <div className="col">
          <h2>Confidence breakdown</h2>
          <table className="mini">
            <tbody>
              <tr>
                <th>Level</th>
                <th>Count</th>
                <th>What it means</th>
              </tr>
              <tr>
                <td>
                  <span className="conf high">high</span>
                </td>
                <td>{counts.byConfidence.high ?? 0}</td>
                <td>Hand-curated; verified author/year/publisher.</td>
              </tr>
              <tr>
                <td>
                  <span className="conf medium">medium</span>
                </td>
                <td>{counts.byConfidence.medium ?? 0}</td>
                <td>API-sourced (Open Library / Google Books).</td>
              </tr>
              <tr>
                <td>
                  <span className="conf low">low</span>
                </td>
                <td>{counts.byConfidence.low ?? 0}</td>
                <td>Title-only; needs enrichment.</td>
              </tr>
              <tr>
                <td>
                  <span className="conf low_searched">low_searched</span>
                </td>
                <td>{counts.byConfidence.low_searched ?? 0}</td>
                <td>API matched nothing wrestling-related.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="col">
          <h2>Top authors by book count</h2>
          <ul className="author-list compact">
            {topAuthors.slice(0, 12).map((a) => (
              <li key={a.id}>
                <Link href={`/author/${a.id}`}>{a.name}</Link>
                {a.isWrestler && <span className="tag wr">wrestler</span>}
                <span className="dim"> — {a.bookCount}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <p className="meta">
        {counts.authors} authors ({counts.wrestlerAuthors} wrestlers) · {counts.territories}{" "}
        territories · {counts.wrestlers} wrestler dossiers
      </p>
    </>
  );
}
