/**
 * Substack read client.
 *
 * Substack publishes no documented API for post content. What exists is the
 * JSON its own web app calls — `/api/v1/archive` and `/api/v1/posts/{slug}` —
 * which is unauthenticated for public posts and is what this module uses. It is
 * unsupported and can change without notice, so every payload is parsed
 * leniently: unknown fields pass through, and a shape change surfaces as one
 * failed publication rather than a crashed run. `/feed` (plain RSS, stable) is
 * the fallback and the source of publication-level metadata.
 *
 * Paywalled posts return only their free teaser. Those are kept and flagged
 * `body_truncated`, because the title, date, and teaser links are still real.
 */

import { z } from "zod";

export const USER_AGENT =
  "pwr-researcher/1.0 (personal wrestling-history research archive; +https://github.com/Great-Western-Productions)";

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;

export class SubstackError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SubstackError";
  }
}

// ---------------------------------------------------------------------------
// Payload shapes (only the fields the ingest reads; the rest is kept in `raw`)
// ---------------------------------------------------------------------------

const bylineSchema = z.looseObject({ name: z.string().nullish() });

export const archivePostSchema = z.looseObject({
  id: z.number().int().nullish(),
  slug: z.string(),
  title: z.string().nullish(),
  subtitle: z.string().nullish(),
  description: z.string().nullish(),
  post_date: z.string().nullish(),
  canonical_url: z.string().nullish(),
  type: z.string().nullish(),
  audience: z.string().nullish(),
  cover_image: z.string().nullish(),
  podcast_url: z.string().nullish(),
  wordcount: z.number().int().nullish(),
  body_html: z.string().nullish(),
  truncated_body_text: z.string().nullish(),
  publishedBylines: z.array(bylineSchema).nullish(),
});

export type ArchivePost = z.infer<typeof archivePostSchema>;

export type PublicationMeta = {
  host: string;
  url: string;
  name: string;
  description: string | null;
  author: string | null;
  language: string | null;
};

// ---------------------------------------------------------------------------
// Fetch plumbing
// ---------------------------------------------------------------------------

export type FetchOptions = {
  /** Milliseconds to wait between requests. Substack tolerates ~1/s. */
  sleepMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onRetry?: (info: { url: string; attempt: number; reason: string; waitMs: number }) => void;
};

export const sleep = (ms: number) =>
  ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

/**
 * GET with retry on 429 and 5xx. A 4xx other than 429 is a fact about the
 * resource, not a transient failure, so it throws immediately.
 */
async function getWithRetry(url: string, opts: FetchOptions = {}): Promise<Response> {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastReason = "unknown";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
        redirect: "follow",
        signal: controller.signal,
      });
      if (response.ok) return response;
      if (response.status !== 429 && response.status < 500) {
        throw new SubstackError(`GET ${url} failed: HTTP ${response.status}`, response.status);
      }
      lastReason = `HTTP ${response.status}`;
    } catch (err) {
      if (err instanceof SubstackError) throw err;
      lastReason = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }

    if (attempt < MAX_ATTEMPTS) {
      const waitMs = 2000 * 2 ** (attempt - 1);
      opts.onRetry?.({ url, attempt, reason: lastReason, waitMs });
      await sleep(waitMs);
    }
  }
  throw new SubstackError(`GET ${url} failed after ${MAX_ATTEMPTS} attempts: ${lastReason}`);
}

async function getJson(url: string, opts: FetchOptions = {}): Promise<unknown> {
  const response = await getWithRetry(url, opts);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new SubstackError(`GET ${url} returned non-JSON (${text.slice(0, 120)}…)`);
  }
}

// ---------------------------------------------------------------------------
// Publication resolution
// ---------------------------------------------------------------------------

/**
 * Normalize whatever the user typed into an origin: a bare handle, a
 * `foo.substack.com`, or a custom domain with or without scheme and path.
 */
export function toOrigin(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) throw new SubstackError("Empty publication identifier");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(trimmed.includes(".") ? withScheme : `https://${trimmed}.substack.com`).origin;
  } catch {
    throw new SubstackError(`Could not read "${input}" as a publication URL`);
  }
}

const tagText = (xml: string, tag: string): string | null => {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match) return null;
  const inner = (match[1] ?? "").replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim();
  return inner || null;
};

/**
 * Publication metadata from the RSS feed, plus the host the request actually
 * landed on. Substack 301s `name.substack.com` to a custom domain once the
 * author sets one, and the effective host is the identity worth storing —
 * canonical URLs on the posts will use it.
 */
export async function resolvePublication(
  input: string,
  opts: FetchOptions = {},
): Promise<PublicationMeta> {
  const origin = toOrigin(input);
  const response = await getWithRetry(`${origin}/feed`, opts);
  const xml = await response.text();

  if (!/<generator>\s*Substack\s*<\/generator>/i.test(xml) && !/substack/i.test(response.url)) {
    throw new SubstackError(`${origin} does not look like a Substack publication`);
  }

  const channel = xml.split("<item>")[0] ?? xml;
  const effective = new URL(response.url);
  const link = tagText(channel, "link");
  let host = effective.hostname;
  if (link) {
    try {
      host = new URL(link).hostname;
    } catch {
      /* keep the effective host */
    }
  }

  return {
    host,
    url: `https://${host}`,
    name: tagText(channel, "title") ?? host,
    description: tagText(channel, "description"),
    author: tagText(channel, "copyright") ?? tagText(channel, "itunes:author"),
    language: tagText(channel, "language"),
  };
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

const ARCHIVE_PAGE = 50;
/** Offsets past this stop the walk, so a misbehaving archive cannot loop forever. */
const MAX_ARCHIVE_OFFSET = 10_000;

/**
 * Walk `/api/v1/archive` newest-first until the archive runs out, `limit` is
 * reached, or a post older than `since` appears (the listing is date-sorted, so
 * the first one older than the cutoff ends the walk).
 *
 * Paging is by index, and a short page does NOT mean the end: Substack returns
 * fewer rows than asked for at arbitrary offsets — the first page of a
 * ~700-post publication came back with 23 — so the walk advances by a fixed
 * stride and stops only on an empty page. Overlapping offsets are possible, so
 * posts are de-duplicated by slug on the way through.
 */
export async function fetchArchive(
  origin: string,
  opts: FetchOptions & { limit?: number; since?: Date } = {},
): Promise<ArchivePost[]> {
  const limit = opts.limit ?? Number.POSITIVE_INFINITY;
  const collected: ArchivePost[] = [];
  const seen = new Set<string>();
  let offset = 0;

  while (collected.length < limit && offset < MAX_ARCHIVE_OFFSET) {
    const url = `${origin}/api/v1/archive?sort=new&search=&offset=${offset}&limit=${ARCHIVE_PAGE}`;
    const payload = await getJson(url, opts);
    if (!Array.isArray(payload)) {
      throw new SubstackError(`Archive at ${url} was not a list`);
    }
    if (payload.length === 0) break;

    let reachedCutoff = false;
    for (const entry of payload) {
      const parsed = archivePostSchema.safeParse(entry);
      if (!parsed.success) continue;
      const post = parsed.data;
      if (opts.since && post.post_date && new Date(post.post_date) < opts.since) {
        reachedCutoff = true;
        break;
      }
      if (seen.has(post.slug)) continue;
      seen.add(post.slug);
      collected.push(post);
      if (collected.length >= limit) break;
    }
    if (reachedCutoff) break;

    offset += ARCHIVE_PAGE;
    await sleep(opts.sleepMs ?? 1200);
  }

  return collected;
}

/** One post with its body. The archive listing omits `body_html`. */
export async function fetchPost(
  origin: string,
  slug: string,
  opts: FetchOptions = {},
): Promise<ArchivePost> {
  const payload = await getJson(`${origin}/api/v1/posts/${encodeURIComponent(slug)}`, opts);
  const parsed = archivePostSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SubstackError(`Post ${slug} did not parse: ${parsed.error.issues[0]?.message}`);
  }
  return parsed.data;
}

/**
 * Fallback listing built from RSS, for publications whose `/api/v1/archive` is
 * blocked. The feed carries the most recent posts only (Substack caps it around
 * 20) and its `content:encoded` is the full body, so no per-post fetch follows.
 */
export async function fetchFeedPosts(
  origin: string,
  opts: FetchOptions = {},
): Promise<ArchivePost[]> {
  const response = await getWithRetry(`${origin}/feed`, opts);
  const xml = await response.text();
  const items = xml.split(/<item>/i).slice(1);

  return items.flatMap((chunk) => {
    const item = chunk.split(/<\/item>/i)[0] ?? "";
    const link = tagText(item, "link");
    if (!link) return [];
    let slug: string;
    try {
      slug = new URL(link).pathname.split("/").filter(Boolean).pop() ?? "";
    } catch {
      return [];
    }
    if (!slug) return [];
    const pubDate = tagText(item, "pubDate");
    return [
      {
        slug,
        title: tagText(item, "title"),
        subtitle: tagText(item, "description"),
        description: tagText(item, "description"),
        post_date: pubDate ? new Date(pubDate).toISOString() : null,
        canonical_url: link,
        body_html: tagText(item, "content:encoded"),
        publishedBylines: [{ name: tagText(item, "dc:creator") }],
      } satisfies ArchivePost,
    ];
  });
}
