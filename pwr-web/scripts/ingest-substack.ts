#!/usr/bin/env tsx
/**
 * Ingest pro-wrestling-history Substack newsletters into the research archive.
 *
 * Stores each post (title, date, author, body, canonical URL) and every URL the
 * post cites, with citations landing in `research_sources` alongside the ones
 * curated by hand.
 *
 * Fetch:
 *   pnpm ingest:substack --publication somebody.substack.com --dry-run
 *   pnpm ingest:substack --publication somebody.substack.com --limit 25
 *   pnpm ingest:substack --publication somebody.substack.com \
 *     --focus "Memphis territory, 1977-1989"
 *   pnpm ingest:substack --all                       # refresh every active publication
 *   pnpm ingest:substack --all --since 2026-01-01    # only posts published since
 *
 * Read:
 *   pnpm ingest:substack --list
 *   pnpm ingest:substack --search "Jerry Jarrett booking"
 *   pnpm ingest:substack --sources --limit 30
 *
 * Flags:
 *   --publication <host>  Publication to ingest; repeatable. Accepts a handle,
 *                         a *.substack.com host, or a custom domain.
 *   --all                 Every publication already stored and marked active.
 *   --limit <n>           Cap posts per publication (newest first). Also caps
 *                         --search and --sources output.
 *   --since <date>        Skip posts published before this ISO date.
 *   --refresh             Re-fetch bodies for posts already stored.
 *   --feed-only           Use the RSS feed instead of the JSON archive. Fewer
 *                         posts (Substack caps the feed), no per-post request.
 *   --self-links          Also record links to the publication's own back
 *                         catalogue, which are skipped by default.
 *   --sleep <ms>          Delay between requests (default 1200).
 *   --focus <text>        Curated note on what a publication covers. Set on
 *                         first ingest; never overwritten by a later run.
 *   --notes <text>        Free-text note on the publication, same rules.
 *   --dry-run             Fetch and parse only. No database access at all;
 *                         writes JSONL to tmp/ and prints what would be stored.
 *   --list                List stored publications and exit.
 *   --search <query>      Full-text search the stored corpus and exit.
 *   --sources             List the most-cited URLs and exit.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import {
  existingPostIndex,
  linkPostSources,
  listCitedSources,
  listPublications,
  refreshPublicationStats,
  searchPosts,
  upsertPost,
  upsertPublication,
} from "@/lib/db-ops/substack";
import {
  type ArchivePost,
  type FetchOptions,
  fetchArchive,
  fetchFeedPosts,
  fetchPost,
  resolvePublication,
  SubstackError,
  sleep,
} from "@/lib/ingest/substack/client";
import { normalizePost } from "@/lib/ingest/substack/normalize";
import type { ExtractedLink } from "@/lib/ingest/substack/parse";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    publication: { type: "string", multiple: true },
    all: { type: "boolean" },
    limit: { type: "string" },
    since: { type: "string" },
    refresh: { type: "boolean" },
    "feed-only": { type: "boolean" },
    "self-links": { type: "boolean" },
    sleep: { type: "string" },
    focus: { type: "string" },
    notes: { type: "string" },
    "dry-run": { type: "boolean" },
    list: { type: "boolean" },
    search: { type: "string" },
    sources: { type: "boolean" },
  },
  strict: true,
});

const LIMIT = values.limit ? Number.parseInt(values.limit, 10) : undefined;
const SLEEP_MS = values.sleep ? Number.parseInt(values.sleep, 10) : 1200;
const SINCE = values.since ? new Date(values.since) : undefined;
const LINK_KINDS: ExtractedLink["kind"][] = values["self-links"]
  ? ["external", "substack", "self"]
  : ["external", "substack"];

if (SINCE && Number.isNaN(SINCE.valueOf())) {
  console.error(`--since "${values.since}" is not a date I can read (try 1986-04-01).`);
  process.exit(1);
}
if (LIMIT !== undefined && (!Number.isFinite(LIMIT) || LIMIT < 1)) {
  console.error("--limit must be a positive integer.");
  process.exit(1);
}

const fetchOptions: FetchOptions = {
  sleepMs: SLEEP_MS,
  onRetry: ({ url, attempt, reason, waitMs }) =>
    console.warn(`  retry ${attempt}/2 in ${waitMs}ms — ${reason} (${url})`),
};

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

function databaseUrl(): string {
  if (!process.env.DATABASE_URL) {
    try {
      process.loadEnvFile(path.join(process.cwd(), ".env"));
    } catch {
      /* no .env; fall through to the pieces below */
    }
  }
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const host = process.env.PWBIB_PG_HOST ?? "localhost";
  const port = process.env.PWBIB_PG_PORT ?? "5432";
  const name = process.env.PWBIB_PG_DB ?? "wrestling_bibliography";
  const user = process.env.PWBIB_PG_USER;
  return `postgresql://${user ? `${user}@` : ""}${host}:${port}/${name}`;
}

type Db = PostgresJsDatabase<typeof schema>;

function connect(): { db: Db; close: () => Promise<void> } {
  const client = postgres(databaseUrl(), { max: 4 });
  return { db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

type PublicationSummary = {
  publication: string;
  posts: number;
  created: number;
  updated: number;
  skipped: number;
  truncated: number;
  citations: number;
  newSources: number;
  failures: number;
};

/**
 * The archive listing has everything but the body, so a post whose full body is
 * already stored needs no second request. `--refresh` overrides that, and a
 * post held only as a paywalled teaser is always retried in case it opened up.
 */
function needsBody(
  slug: string,
  stored: Map<string, { id: number; truncated: boolean }>,
  refresh: boolean,
): boolean {
  if (refresh) return true;
  const existing = stored.get(slug);
  return !existing || existing.truncated;
}

async function ingestPublication(
  db: Db,
  input: string,
  opts: { focus?: string; notes?: string },
): Promise<PublicationSummary> {
  const meta = await resolvePublication(input, fetchOptions);
  const origin = `https://${meta.host}`;
  console.log(`\n${meta.name} <${meta.host}>`);

  const { id: publicationId, created } = await upsertPublication(db, {
    name: meta.name,
    host: meta.host,
    url: meta.url,
    author: meta.author,
    description: meta.description,
    language: meta.language,
    focus: opts.focus ?? null,
    notes: opts.notes ?? null,
  });
  console.log(`  publication #${publicationId} ${created ? "added" : "already known"}`);

  const listing = values["feed-only"]
    ? await fetchFeedPosts(origin, fetchOptions)
    : await fetchArchive(origin, { ...fetchOptions, limit: LIMIT, since: SINCE });
  const posts = values["feed-only"] && LIMIT ? listing.slice(0, LIMIT) : listing;
  console.log(`  ${posts.length} post(s) in the archive listing`);

  const stored = await existingPostIndex(db, publicationId);
  const summary: PublicationSummary = {
    publication: meta.name,
    posts: posts.length,
    created: 0,
    updated: 0,
    skipped: 0,
    truncated: 0,
    citations: 0,
    newSources: 0,
    failures: 0,
  };

  for (const [index, listed] of posts.entries()) {
    const label = `[${index + 1}/${posts.length}] ${listed.slug}`;
    try {
      let payload: ArchivePost = listed;
      if (!listed.body_html && needsBody(listed.slug, stored, Boolean(values.refresh))) {
        payload = await fetchPost(origin, listed.slug, fetchOptions);
        await sleep(SLEEP_MS);
      } else if (!listed.body_html) {
        summary.skipped += 1;
        continue;
      }

      const normalized = normalizePost(payload, { origin, host: meta.host });
      const result = await upsertPost(db, publicationId, normalized, payload);
      if (result.created) summary.created += 1;
      else summary.updated += 1;
      if (normalized.body_truncated) summary.truncated += 1;

      const links = await linkPostSources(db, result.id, normalized.links, { kinds: LINK_KINDS });
      summary.citations += links.linked;
      summary.newSources += links.newSources;

      console.log(
        `  ${label} — ${normalized.word_count} words, ${links.linked} citation(s)` +
          `${normalized.body_truncated ? " [teaser only]" : ""}`,
      );
    } catch (err) {
      summary.failures += 1;
      console.error(`  ${label} — FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await refreshPublicationStats(db, publicationId);
  return summary;
}

/**
 * Fetch and parse without touching the database, so a new publication can be
 * checked before anything is stored. Writes the parsed posts to tmp/ as JSONL.
 */
async function dryRun(input: string): Promise<void> {
  const meta = await resolvePublication(input, fetchOptions);
  const origin = `https://${meta.host}`;
  console.log(`\n${meta.name} <${meta.host}>`);
  console.log(`  author: ${meta.author ?? "—"}`);
  console.log(`  ${meta.description ?? "(no description)"}`);

  const listing = values["feed-only"]
    ? await fetchFeedPosts(origin, fetchOptions)
    : await fetchArchive(origin, { ...fetchOptions, limit: LIMIT ?? 5, since: SINCE });
  const posts = LIMIT ? listing.slice(0, LIMIT) : listing.slice(0, 5);

  const outDir = path.join(process.cwd(), "tmp");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `substack-${meta.host.replace(/[^a-z0-9]+/gi, "-")}.jsonl`);
  const lines: string[] = [];

  for (const listed of posts) {
    const payload = listed.body_html ? listed : await fetchPost(origin, listed.slug, fetchOptions);
    const normalized = normalizePost(payload, { origin, host: meta.host });
    const cited = normalized.links.filter((link) => LINK_KINDS.includes(link.kind));
    console.log(
      `\n  ${normalized.published_at?.toISOString().slice(0, 10) ?? "????-??-??"}  ` +
        `${normalized.title}${normalized.body_truncated ? "  [teaser only]" : ""}`,
    );
    console.log(`    ${normalized.word_count} words, ${cited.length} cited link(s)`);
    for (const link of cited.slice(0, 8)) {
      console.log(`      → ${link.url}${link.anchorText ? `  (“${link.anchorText}”)` : ""}`);
    }
    if (cited.length > 8) console.log(`      … and ${cited.length - 8} more`);
    lines.push(JSON.stringify({ ...normalized, body_html: undefined }));
    if (!listed.body_html) await sleep(SLEEP_MS);
  }

  await fs.writeFile(outPath, `${lines.join("\n")}\n`, "utf8");
  console.log(`\n  Parsed ${posts.length} post(s) → ${path.relative(process.cwd(), outPath)}`);
  console.log("  Nothing was written to the database (--dry-run).");
}

// ---------------------------------------------------------------------------
// Read-only modes
// ---------------------------------------------------------------------------

async function runList(db: Db): Promise<void> {
  const rows = await listPublications(db);
  if (rows.length === 0) {
    console.log("No publications stored yet. Add one with --publication <host>.");
    return;
  }
  for (const row of rows) {
    const span = [row.first_post_at, row.last_post_at]
      .map((iso) => iso?.slice(0, 10) ?? "?")
      .join(" → ");
    console.log(
      `#${row.id}  ${row.name} <${row.host}>\n` +
        `      ${row.post_count} post(s), ${span}` +
        `${row.active ? "" : "  [inactive]"}`,
    );
  }
}

async function runSearch(db: Db, query: string): Promise<void> {
  const rows = await searchPosts(db, query, { limit: LIMIT ?? 20 });
  if (rows.length === 0) {
    console.log(`No posts match "${query}".`);
    return;
  }
  for (const row of rows) {
    console.log(
      `\n${row.published_at?.slice(0, 10) ?? "????-??-??"}  ${row.title}` +
        `${row.body_truncated ? "  [teaser only]" : ""}`,
    );
    console.log(`  ${row.publication} — ${row.canonical_url}`);
    console.log(`  ${row.snippet.replace(/\s+/g, " ")}`);
  }
}

async function runSources(db: Db): Promise<void> {
  const rows = await listCitedSources(db, { limit: LIMIT ?? 50 });
  if (rows.length === 0) {
    console.log("No citations stored yet.");
    return;
  }
  for (const row of rows) {
    console.log(
      `${String(row.citing_posts).padStart(4)}  ${row.url}` +
        `${row.description ? `\n      ${row.description}` : ""}`,
    );
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const inputs = values.publication ?? [];

  if (values["dry-run"]) {
    if (inputs.length === 0) {
      console.error("--dry-run needs at least one --publication.");
      process.exit(1);
    }
    for (const input of inputs) await dryRun(input);
    return;
  }

  const { db, close } = connect();
  try {
    if (values.list) return await runList(db);
    if (values.search) return await runSearch(db, values.search);
    if (values.sources) return await runSources(db);

    let targets = inputs;
    if (values.all) {
      const stored = await listPublications(db, { activeOnly: true });
      targets = [...targets, ...stored.map((row) => row.host)];
    }
    if (targets.length === 0) {
      console.error(
        "Nothing to do. Pass --publication <host>, --all, --list, --search, or --sources.",
      );
      process.exit(1);
    }

    const summaries: PublicationSummary[] = [];
    for (const input of [...new Set(targets)]) {
      try {
        summaries.push(
          await ingestPublication(db, input, { focus: values.focus, notes: values.notes }),
        );
      } catch (err) {
        const reason = err instanceof SubstackError ? err.message : String(err);
        console.error(`\n${input} — FAILED: ${reason}`);
      }
    }

    console.log("\n─── summary ───");
    for (const s of summaries) {
      console.log(
        `${s.publication}: ${s.created} new, ${s.updated} updated, ${s.skipped} skipped, ` +
          `${s.citations} citation(s) (${s.newSources} new source rows)` +
          `${s.truncated ? `, ${s.truncated} teaser-only` : ""}` +
          `${s.failures ? `, ${s.failures} failed` : ""}`,
      );
    }
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
