/**
 * Writes for the Substack ingest. Every function is idempotent: re-running the
 * ingest over a publication updates the rows it already has rather than
 * duplicating them, so the script can be run on a schedule.
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import type { NormalizedPost } from "@/lib/ingest/substack/normalize";
import type { ExtractedLink } from "@/lib/ingest/substack/parse";

type Db = PostgresJsDatabase<typeof schema>;

export type PublicationInput = {
  name: string;
  host: string;
  url: string;
  author?: string | null;
  description?: string | null;
  language?: string | null;
  focus?: string | null;
  notes?: string | null;
};

export type UpsertPublicationResult = { id: number; created: boolean };

/**
 * Insert or refresh a publication, keyed on host.
 *
 * Curated columns win over fetched ones: `focus` and `notes` are yours to
 * write, and a re-fetch never clears them. The name and description do get
 * refreshed, since those track what the author currently publishes.
 */
export async function upsertPublication(
  db: Db,
  input: PublicationInput,
): Promise<UpsertPublicationResult> {
  const rows = await db.execute<{ id: number; created: boolean }>(sql`
    INSERT INTO substack_publications (name, host, url, author, description, language, focus, notes)
    VALUES (
      ${input.name}, ${input.host}, ${input.url}, ${input.author ?? null},
      ${input.description ?? null}, ${input.language ?? "English"},
      ${input.focus ?? null}, ${input.notes ?? null}
    )
    ON CONFLICT (host) DO UPDATE SET
      name        = EXCLUDED.name,
      url         = EXCLUDED.url,
      author      = COALESCE(EXCLUDED.author, substack_publications.author),
      description = COALESCE(EXCLUDED.description, substack_publications.description),
      language    = COALESCE(EXCLUDED.language, substack_publications.language),
      focus       = COALESCE(substack_publications.focus, EXCLUDED.focus),
      notes       = COALESCE(substack_publications.notes, EXCLUDED.notes),
      updated_at  = CURRENT_TIMESTAMP
    RETURNING id, (xmax = 0) AS created
  `);
  const row = rows[0];
  if (!row) throw new Error(`Failed to upsert publication ${input.host}`);
  return { id: row.id, created: row.created };
}

/** Roll the fetch-tracking columns forward from the posts now stored. */
export async function refreshPublicationStats(db: Db, publicationId: number): Promise<void> {
  await db.execute(sql`
    UPDATE substack_publications p
       SET first_post_at   = agg.first_post_at,
           last_post_at    = agg.last_post_at,
           last_fetched_at = CURRENT_TIMESTAMP,
           updated_at      = CURRENT_TIMESTAMP
      FROM (
        SELECT MIN(published_at) AS first_post_at, MAX(published_at) AS last_post_at
          FROM substack_posts WHERE publication_id = ${publicationId}
      ) agg
     WHERE p.id = ${publicationId}
  `);
}

export type UpsertPostResult = { id: number; created: boolean };

/**
 * Insert or refresh one post, keyed on (publication_id, slug).
 *
 * A stored full body is never replaced by a truncated one. Re-running the
 * ingest after a paywall drops picks up the full text; re-running it while
 * signed out of a publication you once had access to does not lose it.
 */
export async function upsertPost(
  db: Db,
  publicationId: number,
  post: NormalizedPost,
  raw?: unknown,
): Promise<UpsertPostResult> {
  // Bound as ISO text: the driver rejects a Date in a raw `sql` template, where
  // it has no column type to infer the encoding from.
  const publishedAt = post.published_at?.toISOString() ?? null;
  const rows = await db.execute<{ id: number; created: boolean }>(sql`
    INSERT INTO substack_posts (
      publication_id, substack_post_id, slug, title, subtitle, author, published_at,
      canonical_url, post_type, audience, body_truncated, description, cover_image_url,
      podcast_url, body_html, body_text, word_count, fetched_at, raw
    ) VALUES (
      ${publicationId}, ${post.substack_post_id}, ${post.slug}, ${post.title}, ${post.subtitle},
      ${post.author}, ${publishedAt}::timestamptz, ${post.canonical_url}, ${post.post_type},
      ${post.audience}, ${post.body_truncated}, ${post.description}, ${post.cover_image_url},
      ${post.podcast_url}, ${post.body_html}, ${post.body_text}, ${post.word_count},
      CURRENT_TIMESTAMP, ${raw === undefined ? null : JSON.stringify(raw)}::jsonb
    )
    ON CONFLICT (publication_id, slug) DO UPDATE SET
      substack_post_id = COALESCE(EXCLUDED.substack_post_id, substack_posts.substack_post_id),
      title            = EXCLUDED.title,
      subtitle         = EXCLUDED.subtitle,
      author           = COALESCE(EXCLUDED.author, substack_posts.author),
      published_at     = COALESCE(EXCLUDED.published_at, substack_posts.published_at),
      canonical_url    = EXCLUDED.canonical_url,
      post_type        = COALESCE(EXCLUDED.post_type, substack_posts.post_type),
      audience         = COALESCE(EXCLUDED.audience, substack_posts.audience),
      description      = COALESCE(EXCLUDED.description, substack_posts.description),
      cover_image_url  = COALESCE(EXCLUDED.cover_image_url, substack_posts.cover_image_url),
      podcast_url      = COALESCE(EXCLUDED.podcast_url, substack_posts.podcast_url),
      body_html        = CASE WHEN ${post.body_truncated} AND NOT substack_posts.body_truncated
                              THEN substack_posts.body_html ELSE EXCLUDED.body_html END,
      body_text        = CASE WHEN ${post.body_truncated} AND NOT substack_posts.body_truncated
                              THEN substack_posts.body_text ELSE EXCLUDED.body_text END,
      word_count       = CASE WHEN ${post.body_truncated} AND NOT substack_posts.body_truncated
                              THEN substack_posts.word_count ELSE EXCLUDED.word_count END,
      body_truncated   = substack_posts.body_truncated AND EXCLUDED.body_truncated,
      raw              = COALESCE(EXCLUDED.raw, substack_posts.raw),
      fetched_at       = CURRENT_TIMESTAMP,
      updated_at       = CURRENT_TIMESTAMP
    RETURNING id, (xmax = 0) AS created
  `);
  const row = rows[0];
  if (!row) throw new Error(`Failed to upsert post ${post.slug}`);
  return { id: row.id, created: row.created };
}

export type LinkSourcesResult = { linked: number; newSources: number };

/**
 * Record a post's cited links.
 *
 * Each URL becomes a `research_sources` row — the same table that carries
 * hand-curated citations — so a URL a blogger cited and one you added yourself
 * are one row, cross-referenced. A curated description is never overwritten by
 * an anchor text; the ingest only fills a blank one.
 *
 * `kinds` narrows what counts as a citation. The default keeps external links
 * and drops the publication's links to its own back catalogue.
 */
export async function linkPostSources(
  db: Db,
  postId: number,
  links: ExtractedLink[],
  opts: { kinds?: ExtractedLink["kind"][] } = {},
): Promise<LinkSourcesResult> {
  const kinds = opts.kinds ?? ["external", "substack"];
  const wanted = links.filter((link) => kinds.includes(link.kind));
  if (wanted.length === 0) return { linked: 0, newSources: 0 };

  let newSources = 0;
  let linked = 0;

  for (const link of wanted) {
    const description = link.anchorText ? link.anchorText.slice(0, 200) : null;
    const sourceRows = await db.execute<{ id: number; created: boolean }>(sql`
      INSERT INTO research_sources (url, description)
      VALUES (${link.url}, ${description})
      ON CONFLICT (url) DO UPDATE SET
        description = COALESCE(research_sources.description, EXCLUDED.description)
      RETURNING id, (xmax = 0) AS created
    `);
    const source = sourceRows[0];
    if (!source) continue;
    if (source.created) newSources += 1;

    await db.execute(sql`
      INSERT INTO substack_post_sources (
        post_id, source_id, anchor_text, context, link_kind, first_position, occurrence_count
      ) VALUES (
        ${postId}, ${source.id}, ${link.anchorText}, ${link.context}, ${link.kind},
        ${link.position}, ${link.occurrences}
      )
      ON CONFLICT (post_id, source_id) DO UPDATE SET
        anchor_text      = COALESCE(EXCLUDED.anchor_text, substack_post_sources.anchor_text),
        context          = COALESCE(EXCLUDED.context, substack_post_sources.context),
        link_kind        = EXCLUDED.link_kind,
        first_position   = EXCLUDED.first_position,
        occurrence_count = EXCLUDED.occurrence_count
    `);
    linked += 1;
  }

  return { linked, newSources };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type StoredPostBody = {
  id: number;
  slug: string;
  canonical_url: string;
  body_html: string | null;
};

/**
 * Stored posts with their HTML, for re-extracting links after a parser change.
 * The bodies are already on disk, so a fix ships without re-fetching the
 * publication.
 */
export async function postsWithBodies(db: Db, publicationId: number): Promise<StoredPostBody[]> {
  return db.execute<StoredPostBody>(sql`
    SELECT id, slug, canonical_url, body_html
      FROM substack_posts
     WHERE publication_id = ${publicationId} AND body_html IS NOT NULL
     ORDER BY id
  `);
}

/**
 * Replace a post's citations with a freshly extracted set.
 *
 * Clearing first is what lets a parser fix retract a link it should never have
 * recorded; `linkPostSources` alone only ever adds. The `research_sources` rows
 * themselves are left alone — another table may reference one, and a URL that
 * stops being cited is still a URL that was consulted.
 */
export async function relinkPost(
  db: Db,
  postId: number,
  links: ExtractedLink[],
  opts: { kinds?: ExtractedLink["kind"][] } = {},
): Promise<LinkSourcesResult & { removed: number; removedUrls: string[] }> {
  return db.transaction(async (tx) => {
    const before = await tx.execute<{ id: number; url: string }>(sql`
      SELECT rs.id, rs.url FROM substack_post_sources ps
        JOIN research_sources rs ON rs.id = ps.source_id
       WHERE ps.post_id = ${postId}
    `);
    await tx.execute(sql`DELETE FROM substack_post_sources WHERE post_id = ${postId}`);
    const result = await linkPostSources(tx, postId, links, opts);

    const kept = new Set(links.map((link) => link.url));
    const removedUrls = before.filter((row) => !kept.has(row.url)).map((row) => row.url);
    return { ...result, removed: removedUrls.length, removedUrls };
  });
}

/**
 * Of the given URLs, the ones no `substack_posts` row cites any more and no
 * other table references either.
 *
 * Scoped to a caller-supplied list on purpose. An unscoped version returns every
 * unreferenced `research_sources` row, which includes the hand-curated ones that
 * were never meant to be attached to anything — reading that list as deletable
 * would throw away curated research.
 */
export async function uncitedSources(
  db: Db,
  urls: string[],
): Promise<{ id: number; url: string }[]> {
  if (urls.length === 0) return [];
  return db.execute<{ id: number; url: string }>(sql`
    SELECT rs.id, rs.url
      FROM research_sources rs
     WHERE rs.url = ANY(${sql.param(urls)}::text[])
       AND NOT EXISTS (SELECT 1 FROM substack_post_sources ps WHERE ps.source_id = rs.id)
       AND NOT EXISTS (SELECT 1 FROM territory_eras te WHERE te.source_id = rs.id)
       AND NOT EXISTS (SELECT 1 FROM territory_market_runs tr WHERE tr.source_id = rs.id)
     ORDER BY rs.id
  `);
}

/**
 * Slug → what's already stored, so an incremental run can skip re-fetching a
 * post whose body it already holds in full.
 */
export async function existingPostIndex(
  db: Db,
  publicationId: number,
): Promise<Map<string, { id: number; truncated: boolean }>> {
  const rows = await db.execute<{ id: number; slug: string; body_truncated: boolean }>(sql`
    SELECT id, slug, body_truncated FROM substack_posts WHERE publication_id = ${publicationId}
  `);
  return new Map(rows.map((row) => [row.slug, { id: row.id, truncated: row.body_truncated }]));
}

export type PublicationRow = {
  id: number;
  name: string;
  host: string;
  url: string;
  author: string | null;
  active: boolean;
  post_count: number;
  // Timestamps come back as ISO strings, not Dates: a raw `execute` bypasses
  // the driver's type parsers, which only run for column-typed queries.
  first_post_at: string | null;
  last_post_at: string | null;
  last_fetched_at: string | null;
};

export async function listPublications(
  db: Db,
  opts: { activeOnly?: boolean } = {},
): Promise<PublicationRow[]> {
  const where = opts.activeOnly ? sql`WHERE p.active` : sql``;
  return db.execute<PublicationRow>(sql`
    SELECT p.id, p.name, p.host, p.url, p.author, p.active,
           COUNT(sp.id)::int AS post_count,
           p.first_post_at, p.last_post_at, p.last_fetched_at
      FROM substack_publications p
      LEFT JOIN substack_posts sp ON sp.publication_id = p.id
      ${where}
     GROUP BY p.id
     ORDER BY p.name
  `);
}

export type PostSearchRow = {
  id: number;
  title: string;
  slug: string;
  canonical_url: string;
  published_at: string | null;
  publication: string;
  body_truncated: boolean;
  snippet: string;
};

/**
 * Full-text search over the corpus, served by the GIN index on
 * title + subtitle + body_text that migration 0010 created.
 */
export async function searchPosts(
  db: Db,
  query: string,
  opts: { limit?: number; publicationId?: number } = {},
): Promise<PostSearchRow[]> {
  const limit = opts.limit ?? 20;
  const pubFilter = opts.publicationId ? sql`AND sp.publication_id = ${opts.publicationId}` : sql``;
  return db.execute<PostSearchRow>(sql`
    WITH q AS (SELECT websearch_to_tsquery('english', ${query}) AS tsq)
    SELECT sp.id, sp.title, sp.slug, sp.canonical_url, sp.published_at,
           p.name AS publication, sp.body_truncated,
           ts_headline(
             'english',
             coalesce(sp.body_text, sp.subtitle, ''),
             q.tsq,
             'MaxFragments=2, MaxWords=28, MinWords=8, StartSel=«, StopSel=»'
           ) AS snippet
      FROM substack_posts sp
      JOIN substack_publications p ON p.id = sp.publication_id
      CROSS JOIN q
     WHERE to_tsvector(
             'english',
             coalesce(sp.title, '') || ' ' || coalesce(sp.subtitle, '') || ' ' ||
             coalesce(sp.body_text, '')
           ) @@ q.tsq
       ${pubFilter}
     ORDER BY ts_rank(
                to_tsvector(
                  'english',
                  coalesce(sp.title, '') || ' ' || coalesce(sp.subtitle, '') || ' ' ||
                  coalesce(sp.body_text, '')
                ),
                q.tsq
              ) DESC,
              sp.published_at DESC NULLS LAST
     LIMIT ${limit}
  `);
}

export type CitedSourceRow = {
  source_id: number;
  url: string;
  description: string | null;
  citing_posts: number;
  publications: number;
};

/** The URLs these newsletters lean on, most-cited first. */
export async function listCitedSources(
  db: Db,
  opts: { limit?: number; publicationId?: number } = {},
): Promise<CitedSourceRow[]> {
  const limit = opts.limit ?? 50;
  const pubFilter = opts.publicationId
    ? sql`WHERE sp.publication_id = ${opts.publicationId}`
    : sql``;
  return db.execute<CitedSourceRow>(sql`
    SELECT rs.id AS source_id, rs.url, rs.description,
           COUNT(DISTINCT ps.post_id)::int          AS citing_posts,
           COUNT(DISTINCT sp.publication_id)::int   AS publications
      FROM substack_post_sources ps
      JOIN substack_posts sp ON sp.id = ps.post_id
      JOIN research_sources rs ON rs.id = ps.source_id
      ${pubFilter}
     GROUP BY rs.id, rs.url, rs.description
     ORDER BY citing_posts DESC, rs.url
     LIMIT ${limit}
  `);
}
