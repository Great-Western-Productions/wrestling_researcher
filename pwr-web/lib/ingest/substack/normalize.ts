/**
 * Turn a Substack API payload into the row the database stores, plus the list
 * of links the post cites. Pure — no network, no database.
 */

import type { ArchivePost } from "./client";
import { countWords, type ExtractedLink, extractLinks, htmlToText } from "./parse";

export type NormalizedPost = {
  substack_post_id: number | null;
  slug: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  published_at: Date | null;
  canonical_url: string;
  post_type: string | null;
  audience: string | null;
  body_truncated: boolean;
  description: string | null;
  cover_image_url: string | null;
  podcast_url: string | null;
  body_html: string | null;
  body_text: string | null;
  word_count: number;
  links: ExtractedLink[];
};

const clean = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * A post is treated as truncated when the body held is not the whole article.
 * Two signals: the post is gated to paying subscribers, or Substack's own word
 * count is well above what came back in the HTML — which is what the free
 * teaser of a paid post looks like even when `audience` says otherwise.
 *
 * `truncated_body_text` is NOT one of the signals, despite the name. Substack
 * populates it on fully public posts as a listing excerpt, so reading it as a
 * paywall marker flags an entire publication as teaser-only.
 */
function isTruncated(post: ArchivePost, extractedWords: number): boolean {
  if (!post.body_html) return true;
  const audience = clean(post.audience);
  if (audience && audience !== "everyone") return true;
  const claimed = post.wordcount ?? 0;
  return claimed > 0 && extractedWords < claimed * 0.6;
}

export function normalizePost(
  post: ArchivePost,
  opts: { origin: string; host: string },
): NormalizedPost {
  const bodyText = htmlToText(post.body_html);
  const words = countWords(bodyText);
  const canonical = clean(post.canonical_url) ?? `${opts.origin}/p/${post.slug}`;
  const published = clean(post.post_date);
  const parsedDate = published ? new Date(published) : null;
  const authors = (post.publishedBylines ?? [])
    .map((byline) => clean(byline?.name))
    .filter((name): name is string => name !== null);

  return {
    substack_post_id: post.id ?? null,
    slug: post.slug,
    title: clean(post.title) ?? post.slug,
    subtitle: clean(post.subtitle),
    author: authors.length > 0 ? authors.join(", ") : null,
    published_at: parsedDate && !Number.isNaN(parsedDate.valueOf()) ? parsedDate : null,
    canonical_url: canonical,
    post_type: clean(post.type),
    audience: clean(post.audience),
    body_truncated: isTruncated(post, words),
    description: clean(post.description),
    cover_image_url: clean(post.cover_image),
    podcast_url: clean(post.podcast_url),
    body_html: post.body_html ?? null,
    // Reflects the text actually stored, which for a gated post is the teaser.
    // Substack's own `wordcount` stays in `raw` for comparison.
    body_text: bodyText || null,
    word_count: words,
    links: extractLinks(post.body_html, { baseUrl: canonical, publicationHost: opts.host }),
  };
}
