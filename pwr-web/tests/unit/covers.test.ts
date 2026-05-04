import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _clearCoverCache, normalizeIsbn, resolveCoverUrl } from "@/lib/covers";

beforeEach(() => _clearCoverCache());
afterEach(() => vi.restoreAllMocks());

describe("normalizeIsbn", () => {
  it("strips dashes and whitespace", () => {
    expect(normalizeIsbn("  978-0-1234-5678-1 ")).toBe("9780123456781");
    expect(normalizeIsbn(null)).toBe("");
    expect(normalizeIsbn("")).toBe("");
  });
});

describe("resolveCoverUrl", () => {
  it("returns null on empty input without calling fetch", async () => {
    const fetchImpl = vi.fn();
    const result = await resolveCoverUrl(null, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses Google Books when token is provided and chooses the largest cover", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("googleapis.com")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                volumeInfo: {
                  imageLinks: {
                    smallThumbnail: "http://small.jpg&edge=curl",
                    thumbnail: "http://thumb.jpg",
                    large: "http://large.jpg&edge=curl",
                  },
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await resolveCoverUrl("978-0-1234-5678-1", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      googleApiToken: "test-key",
    });
    expect(result).toBe("https://large.jpg");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back to Open Library on Google miss", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("googleapis.com")) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      if (url.includes("openlibrary.org") && init?.method === "HEAD") {
        return new Response(null, { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await resolveCoverUrl("9780000000000", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      googleApiToken: "test-key",
    });
    expect(result).toBe("https://covers.openlibrary.org/b/isbn/9780000000000-L.jpg?default=false");
  });

  it("returns null when both sources miss", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 404 });
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    const result = await resolveCoverUrl("9781111111111", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      googleApiToken: "test-key",
    });
    expect(result).toBeNull();
  });

  it("caches the result", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    await resolveCoverUrl("9782222222222", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await resolveCoverUrl("9782222222222", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    // Both calls hit cache after the first; should fetch only once for OL HEAD.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
