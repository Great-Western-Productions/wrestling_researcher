// In-process cache. Same lifetime as the Node process.
const CACHE = new Map<string, string | null>();

const COVER_KEYS = [
  "extraLarge",
  "large",
  "medium",
  "small",
  "thumbnail",
  "smallThumbnail",
] as const;

type Fetch = typeof fetch;

export type CoverDeps = {
  fetchImpl?: Fetch;
  googleApiToken?: string | null;
};

/** Strip dashes/whitespace from an ISBN. Returns "" for nullish input. */
export function normalizeIsbn(isbn: string | null | undefined): string {
  if (!isbn) return "";
  return isbn.replace(/-/g, "").trim();
}

/** Resolve a cover image URL for the given ISBN. Tries Google Books first
 *  (when GOOGLE_API_TOKEN is set), falls back to Open Library. Returns null
 *  if no cover can be found. Cached in-process. */
export async function resolveCoverUrl(
  rawIsbn: string | null | undefined,
  deps: CoverDeps = {},
): Promise<string | null> {
  const isbn = normalizeIsbn(rawIsbn);
  if (!isbn) return null;
  if (CACHE.has(isbn)) return CACHE.get(isbn) ?? null;

  const fetchImpl = deps.fetchImpl ?? fetch;
  const token = deps.googleApiToken ?? process.env.GOOGLE_API_TOKEN ?? null;

  let url: string | null = null;

  if (token) {
    try {
      const r = await fetchImpl(
        `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&key=${encodeURIComponent(token)}`,
        { signal: AbortSignal.timeout(4_000) },
      );
      if (r.ok) {
        const body = (await r.json()) as {
          items?: Array<{ volumeInfo?: { imageLinks?: Record<string, string> } }>;
        };
        const links = body.items?.[0]?.volumeInfo?.imageLinks ?? {};
        for (const key of COVER_KEYS) {
          const v = links[key];
          if (v) {
            url = v.replace("http://", "https://").replace("&edge=curl", "");
            break;
          }
        }
      }
    } catch {
      // network/timeout — fall through to Open Library
    }
  }

  if (!url) {
    const ol = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
    try {
      const r = await fetchImpl(ol, { method: "HEAD", signal: AbortSignal.timeout(4_000) });
      if (r.status === 200) url = ol;
    } catch {
      // ignore
    }
  }

  CACHE.set(isbn, url);
  return url;
}

/** Test-only: clear the in-process cache. */
export function _clearCoverCache(): void {
  CACHE.clear();
}
