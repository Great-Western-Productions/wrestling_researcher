/**
 * HTML handling for the Substack ingest.
 *
 * Substack's `body_html` is generated markup from its own editor, not arbitrary
 * web HTML, so a focused tokenizer covers it without pulling in a DOM parser.
 * The two jobs are flattening a post to searchable text and pulling out the
 * links a post cites.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  eacute: "é",
  egrave: "è",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  ntilde: "ñ",
  copy: "©",
  reg: "®",
  deg: "°",
  frac12: "½",
};

/** Tags after which flattened text needs a line break rather than a space. */
const BLOCK_TAGS = new Set([
  "p",
  "div",
  "br",
  "li",
  "ul",
  "ol",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "tr",
  "table",
  "section",
  "figure",
  "figcaption",
  "hr",
]);

/** Hosts that serve Substack's own assets. Links to these cite nothing. */
const ASSET_HOSTS = new Set([
  "substackcdn.com",
  "substack-post-media.s3.amazonaws.com",
  "bucketeer-e05bbc84-baa3-437e-9518-adb32be77984.s3.amazonaws.com",
]);

/**
 * Substack's own interface, which the editor injects into post bodies: the
 * "Get the app" button, subscribe and sign-in prompts, comment and share
 * widgets. These are chrome, not anything the author cited.
 */
const SUBSTACK_UI_PATHS = [
  /^\/app\//i,
  /^\/sign-in/i,
  /^\/subscribe/i,
  /^\/account/i,
  /^\/settings/i,
  /^\/refer/i,
  /^\/leaderboard/i,
];

/** Query parameters that identify a referral, not a document. */
const TRACKING_PARAMS = [
  /^utm_/i,
  /^ref$/i,
  /^referrer$/i,
  /^source$/i,
  /^r$/i,
  /^s$/i,
  /^triedRedirect$/i,
  /^showWelcome$/i,
  /^publication_id$/i,
  /^post_id$/i,
  /^isFreemail$/i,
  /^fbclid$/i,
  /^gclid$/i,
];

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

/**
 * Stands in for a break contributed by a block tag, so it survives the
 * whitespace collapse that flattens the line wrapping in the source markup. A
 * paragraph split over three source lines is one line of text; a `</p>` is a
 * real break. A sentinel rather than "\n" keeps the two distinguishable.
 */
const BREAK = "\u0000";

/**
 * Flatten post HTML to plain text: script/style dropped, block tags become
 * newlines, inline tags contribute nothing (HTML gives them no whitespace of
 * their own), entities decoded, runs of blank lines collapsed.
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  const withoutHiddenBlocks = html
    .replaceAll(BREAK, "")
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const withBreaks = withoutHiddenBlocks.replace(
    /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi,
    (_whole, tag: string) => (BLOCK_TAGS.has(tag.toLowerCase()) ? BREAK : ""),
  );
  return decodeEntities(withBreaks)
    .replace(/\s+/g, " ")
    .replace(new RegExp(`\\s*${BREAK}\\s*`, "g"), BREAK)
    .replace(new RegExp(`${BREAK}{3,}`, "g"), BREAK.repeat(2))
    .replaceAll(BREAK, "\n")
    .trim();
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export type LinkKind = "self" | "substack" | "external";

export type ExtractedLink = {
  url: string;
  anchorText: string | null;
  context: string | null;
  kind: LinkKind;
  position: number;
  occurrences: number;
};

/**
 * Absolute, de-tracked form of `href`, or null when it points at nothing worth
 * recording (a fragment, a mailto:, a Substack image asset, an unparseable URL).
 *
 * Substack sometimes wraps outbound links in `substack.com/redirect/<id>?...`;
 * where the wrapper carries the destination in a query parameter we unwrap it,
 * and otherwise the wrapper itself is kept — it still resolves.
 */
export function normalizeUrl(href: string, baseUrl?: string): string | null {
  const raw = href.trim();
  if (!raw || raw.startsWith("#")) return null;
  if (/^(mailto|javascript|tel|data):/i.test(raw)) return null;

  let url: URL;
  try {
    url = new URL(raw, baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.replace(/^www\./, "");
  if (ASSET_HOSTS.has(host)) return null;

  const isSubstackHost = host === "substack.com" || host.endsWith(".substack.com");
  if (isSubstackHost && url.pathname.startsWith("/redirect/")) {
    const target = url.searchParams.get("u") ?? url.searchParams.get("url");
    if (target) {
      const unwrapped = normalizeUrl(target);
      if (unwrapped) return unwrapped;
    }
  }
  if (isSubstackHost && SUBSTACK_UI_PATHS.some((pattern) => pattern.test(url.pathname))) {
    return null;
  }

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.some((pattern) => pattern.test(key))) url.searchParams.delete(key);
  }
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.toString();
}

/**
 * A publication also reaches its own posts through Substack's reader domains —
 * `open.substack.com/pub/<handle>/p/<slug>` is the same article as
 * `<handle>.substack.com/p/<slug>`. Matching only on host would file those as
 * citations of another Substack, so the handle is checked too.
 *
 * Only derivable for a `*.substack.com` publication. One on a custom domain
 * has no handle in its host, so a reader-domain link to its own post is filed
 * as `substack` rather than `self`: over-captured, never lost.
 */
export function classifyLink(url: string, publicationHost: string): LinkKind {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "external";
  }
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const pub = publicationHost.replace(/^www\./, "").toLowerCase();
  if (host === pub) return "self";

  if (host === "substack.com" || host.endsWith(".substack.com")) {
    const handle = pub.endsWith(".substack.com") ? pub.slice(0, -".substack.com".length) : null;
    if (handle && parsed.pathname.toLowerCase().startsWith(`/pub/${handle}/`)) return "self";
    return "substack";
  }
  return "external";
}

/**
 * Every distinct URL a post cites, in document order.
 *
 * Repeats collapse into one entry carrying `occurrences` and the first mention's
 * anchor text — the first mention is where an author names the source
 * ("per Meltzer's 1987 issue"); later ones are usually bare "here" links.
 */
export function extractLinks(
  html: string | null | undefined,
  opts: { baseUrl?: string; publicationHost: string },
): ExtractedLink[] {
  if (!html) return [];
  const byUrl = new Map<string, ExtractedLink>();
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  const plainText = htmlToText(html);
  let position = 0;

  for (const match of html.matchAll(anchorPattern)) {
    const attrs = match[1] ?? "";
    const inner = match[2] ?? "";
    const hrefMatch = attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!hrefMatch) continue;
    // Attribute values arrive HTML-escaped: a query string reads `?id=5&amp;nr=70`
    // in the markup, and decoding has to happen before the URL is parsed or the
    // entity becomes part of the parameter name.
    const href = decodeEntities(hrefMatch[2] ?? hrefMatch[3] ?? hrefMatch[4] ?? "");
    const url = normalizeUrl(href, opts.baseUrl);
    if (!url) continue;

    const anchorText = htmlToText(inner).replace(/\s+/g, " ").trim();

    const existing = byUrl.get(url);
    if (existing) {
      existing.occurrences += 1;
      if (!existing.anchorText && anchorText) existing.anchorText = anchorText;
      continue;
    }

    byUrl.set(url, {
      url,
      anchorText: anchorText || null,
      context: anchorText ? sentenceAround(plainText, anchorText) : null,
      kind: classifyLink(url, opts.publicationHost),
      position,
      occurrences: 1,
    });
    position += 1;
  }

  return [...byUrl.values()];
}

/**
 * The sentence containing `needle` in the flattened post, capped so a citation
 * row stays readable. Returns null when the anchor text can't be located —
 * markup inside the anchor can flatten differently than it did in isolation.
 */
export function sentenceAround(text: string, needle: string, maxLength = 400): string | null {
  const at = text.indexOf(needle);
  if (at === -1) return null;
  const before = text.lastIndexOf("\n", at);
  const start = Math.max(before + 1, at - maxLength);
  const afterBreak = text.indexOf("\n", at + needle.length);
  const end = Math.min(
    afterBreak === -1 ? text.length : afterBreak,
    at + needle.length + maxLength,
  );
  const slice = text.slice(start, end).trim();
  return slice || null;
}
