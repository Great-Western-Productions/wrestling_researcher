import { describe, expect, it } from "vitest";
import { fetchArchive, toOrigin } from "@/lib/ingest/substack/client";

/** A fake archive endpoint returning `pages` in order, keyed by offset. */
function fakeArchive(pages: Record<number, Array<{ slug: string; post_date?: string }>>) {
  const calls: number[] = [];
  const impl = (async (url: string | URL) => {
    const offset = Number(new URL(String(url)).searchParams.get("offset") ?? "0");
    calls.push(offset);
    return {
      ok: true,
      status: 200,
      url: String(url),
      text: async () => JSON.stringify(pages[offset] ?? []),
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const page = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    slug: `post-${from + i}`,
    post_date: `2026-01-01T00:00:00.000Z`,
  }));

describe("toOrigin", () => {
  it("accepts a bare handle, a host, and a full URL with a path", () => {
    expect(toOrigin("tonyrichards4")).toBe("https://tonyrichards4.substack.com");
    expect(toOrigin("tonyrichards4.substack.com")).toBe("https://tonyrichards4.substack.com");
    expect(toOrigin("https://tonyrichards4.substack.com/archive?sort=new")).toBe(
      "https://tonyrichards4.substack.com",
    );
  });
});

describe("fetchArchive", () => {
  it("keeps paging past a short page, which does not mean the end of the archive", async () => {
    // Substack returned 23 rows for the first page of a ~700-post publication.
    const { impl, calls } = fakeArchive({ 0: page(0, 23), 50: page(50, 50), 100: [] });
    const posts = await fetchArchive("https://x.substack.com", { fetchImpl: impl, sleepMs: 0 });

    expect(posts).toHaveLength(73);
    expect(calls).toEqual([0, 50, 100]);
  });

  it("stops on the first empty page", async () => {
    const { impl, calls } = fakeArchive({ 0: page(0, 50), 50: [], 100: page(100, 50) });
    const posts = await fetchArchive("https://x.substack.com", { fetchImpl: impl, sleepMs: 0 });

    expect(posts).toHaveLength(50);
    expect(calls).toEqual([0, 50]);
  });

  it("de-duplicates by slug when pages overlap", async () => {
    const { impl } = fakeArchive({ 0: page(0, 50), 50: page(40, 20), 100: [] });
    const posts = await fetchArchive("https://x.substack.com", { fetchImpl: impl, sleepMs: 0 });

    expect(posts).toHaveLength(60);
    expect(new Set(posts.map((p) => p.slug)).size).toBe(60);
  });

  it("honours limit without over-fetching", async () => {
    const { impl, calls } = fakeArchive({ 0: page(0, 50), 50: page(50, 50) });
    const posts = await fetchArchive("https://x.substack.com", {
      fetchImpl: impl,
      sleepMs: 0,
      limit: 10,
    });

    expect(posts).toHaveLength(10);
    expect(calls).toEqual([0]);
  });

  it("stops at the first post older than --since", async () => {
    const { impl } = fakeArchive({
      0: [
        { slug: "new", post_date: "2026-05-01T00:00:00.000Z" },
        { slug: "old", post_date: "2020-01-01T00:00:00.000Z" },
        { slug: "newer-but-after-the-cutoff", post_date: "2026-06-01T00:00:00.000Z" },
      ],
    });
    const posts = await fetchArchive("https://x.substack.com", {
      fetchImpl: impl,
      sleepMs: 0,
      since: new Date("2026-01-01"),
    });

    expect(posts.map((p) => p.slug)).toEqual(["new"]);
  });
});
