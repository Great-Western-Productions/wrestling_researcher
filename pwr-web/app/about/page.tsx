import { db } from "@/lib/db/client";
import { ifnull } from "@/lib/format";
import { getAboutCounts } from "@/lib/queries/about";

export const dynamic = "force-dynamic";

export default async function AboutPage() {
  const c = await getAboutCounts(db);
  const dbUrl = process.env.DATABASE_URL ?? "";

  return (
    <>
      <h1>About</h1>

      <p>
        Pro Wrestling Researcher is a local browser over a Postgres-backed archive of pro wrestling
        literature, periodicals, territories, wrestlers, factions, and ranking lists. Records are
        seeded from curated sources, then enriched against public catalogs (Open Library, Google
        Books, Library of Congress, the Internet Archive, and Cagematch).
      </p>

      <h2>Archive contents</h2>
      <table className="meta-table">
        <tbody>
          <tr>
            <th>Books</th>
            <td>{ifnull(c.books)}</td>
          </tr>
          <tr>
            <th>Periodicals</th>
            <td>{ifnull(c.periodicals)}</td>
          </tr>
          <tr>
            <th>Periodical issues</th>
            <td>{ifnull(c.issues)}</td>
          </tr>
          <tr>
            <th>Authors</th>
            <td>{ifnull(c.authors)}</td>
          </tr>
          <tr>
            <th>Territories / promotions</th>
            <td>{ifnull(c.territories)}</td>
          </tr>
          <tr>
            <th>Wrestlers</th>
            <td>{ifnull(c.wrestlers)}</td>
          </tr>
          <tr>
            <th>Wrestler-territory runs</th>
            <td>{ifnull(c.runs)}</td>
          </tr>
          <tr>
            <th>Factions / stables</th>
            <td>{ifnull(c.factions)}</td>
          </tr>
          <tr>
            <th>Ranking lists</th>
            <td>
              {ifnull(c.rankingLists)} ({ifnull(c.rankingEntries)} entries)
            </td>
          </tr>
          <tr>
            <th>Database</th>
            <td>
              <code>{dbUrl}</code>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Book categories</h2>
      <dl>
        <dt>
          <strong>About wrestling</strong>
        </dt>
        <dd>
          Histories, business and cultural studies, encyclopedias, photo books, reference works.
        </dd>
        <dt>
          <strong>About wrestlers</strong>
        </dt>
        <dd>Third-party biographies, retrospectives, posthumous tributes.</dd>
        <dt>
          <strong>By wrestlers</strong>
        </dt>
        <dd>Autobiographies, memoirs, instructionals, books written or co-written by wrestlers.</dd>
        <dt>
          <strong>Fiction</strong>
        </dt>
        <dd>Novels, short stories, comics, manga, children's books with wrestling as theme.</dd>
      </dl>

      <h2>Confidence levels</h2>
      <dl>
        <dt>
          <span className="conf high">high</span> &nbsp; {c.byConfidence.high ?? 0} books
        </dt>
        <dd>Hand-curated; verified author, year, publisher, and synopsis.</dd>
        <dt>
          <span className="conf medium">medium</span> &nbsp; {c.byConfidence.medium ?? 0} books
        </dt>
        <dd>
          Single-source attribution from Open Library or Google Books — generally trustworthy.
        </dd>
        <dt>
          <span className="conf medium_search">medium_search</span> &nbsp;{" "}
          {c.byConfidence.medium_search ?? 0} books
        </dt>
        <dd>
          Resolved through Exa neural search or Internet Archive fallback; the match looked
          plausible but warrants a human glance.
        </dd>
        <dt>
          <span className="conf low">low</span> &nbsp; {c.byConfidence.low ?? 0} books
        </dt>
        <dd>Title-only entries — confirmed real books but author / year / ISBN need enrichment.</dd>
        <dt>
          <span className="conf low_searched">low_searched</span> &nbsp;{" "}
          {c.byConfidence.low_searched ?? 0} books
        </dt>
        <dd>Searched all sources and matched nothing wrestling-related; needs manual review.</dd>
      </dl>

      <h2>Local-only</h2>
      <p>
        This app has add forms but no authentication. Run it on <code>127.0.0.1</code> only — don't
        expose it.
      </p>
    </>
  );
}
