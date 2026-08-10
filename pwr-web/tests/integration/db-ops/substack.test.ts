import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  existingPostIndex,
  linkPostSources,
  listCitedSources,
  listPublications,
  postsWithBodies,
  refreshPublicationStats,
  relinkPost,
  searchPosts,
  uncitedSources,
  upsertPost,
  upsertPublication,
} from "@/lib/db-ops/substack";
import { normalizePost } from "@/lib/ingest/substack/normalize";
import { closeTestDb, withTx } from "../../helpers/db";

afterAll(closeTestDb);

type Tx = Parameters<Parameters<typeof withTx>[0]>[0];

const HOST = "memphis-history.substack.com";
const ORIGIN = `https://${HOST}`;

const publication = {
  name: "Memphis Wrestling History",
  host: HOST,
  url: ORIGIN,
  author: "A Historian",
  description: "The Jarrett years, week by week.",
};

const post = (overrides: Record<string, unknown> = {}) => ({
  id: 1001,
  slug: "the-1977-territory",
  title: "The 1977 Territory",
  subtitle: "Booking the Coliseum",
  post_date: "1977-04-01T12:00:00.000Z",
  canonical_url: `${ORIGIN}/p/the-1977-territory`,
  type: "newsletter",
  audience: "everyone",
  publishedBylines: [{ name: "A Historian" }],
  body_html:
    "<p>Jerry Jarrett booked the Mid-South Coliseum that spring, per " +
    '<a href="https://www.cagematch.net/?id=5&amp;nr=70">the lineage</a> and ' +
    '<a href="https://wrestlingclassics.com/thread/41">a board thread</a>. ' +
    'The <a href="https://www.cagematch.net/?id=5&amp;nr=70">same page</a> lists the vacancy.</p>' +
    '<p>See also <a href="/p/an-earlier-post">an earlier post</a>.</p>',
  ...overrides,
});

const normalize = (overrides?: Record<string, unknown>) =>
  normalizePost(post(overrides), { origin: ORIGIN, host: HOST });

async function seed(tx: Tx, overrides?: Record<string, unknown>) {
  const pub = await upsertPublication(tx, publication);
  const normalized = normalize(overrides);
  const stored = await upsertPost(tx, pub.id, normalized, post(overrides));
  const links = await linkPostSources(tx, stored.id, normalized.links);
  return { pub, stored, links, normalized };
}

describe("upsertPublication", () => {
  it("creates on first call and updates on the second", async () => {
    await withTx(async (tx) => {
      const first = await upsertPublication(tx, publication);
      expect(first.created).toBe(true);

      const second = await upsertPublication(tx, { ...publication, name: "Renamed" });
      expect(second.created).toBe(false);
      expect(second.id).toBe(first.id);

      const rows = await tx.execute<{ name: string }>(
        sql`SELECT name FROM substack_publications WHERE id = ${first.id}`,
      );
      expect(rows[0]?.name).toBe("Renamed");
    });
  });

  it("keeps curated focus and notes when a later fetch omits them", async () => {
    await withTx(async (tx) => {
      const first = await upsertPublication(tx, {
        ...publication,
        focus: "Memphis, 1977-1989",
        notes: "Primary sources cited throughout.",
      });
      await upsertPublication(tx, publication);

      const rows = await tx.execute<{ focus: string | null; notes: string | null }>(
        sql`SELECT focus, notes FROM substack_publications WHERE id = ${first.id}`,
      );
      expect(rows[0]?.focus).toBe("Memphis, 1977-1989");
      expect(rows[0]?.notes).toBe("Primary sources cited throughout.");
    });
  });
});

describe("upsertPost", () => {
  it("stores the post and is idempotent on re-ingest", async () => {
    await withTx(async (tx) => {
      const { pub, stored, normalized } = await seed(tx);
      expect(stored.created).toBe(true);
      expect(normalized.word_count).toBeGreaterThan(0);

      const again = await upsertPost(tx, pub.id, normalize(), post());
      expect(again.created).toBe(false);
      expect(again.id).toBe(stored.id);

      const count = await tx.execute<{ n: number }>(
        sql`SELECT COUNT(*)::int AS n FROM substack_posts WHERE publication_id = ${pub.id}`,
      );
      expect(count[0]?.n).toBe(1);
    });
  });

  it("does not let a later teaser overwrite a full body already stored", async () => {
    await withTx(async (tx) => {
      const { pub, stored } = await seed(tx);

      await upsertPost(
        tx,
        pub.id,
        normalize({ audience: "only_paid", body_html: "<p>Subscribe to read on.</p>" }),
        post(),
      );

      const rows = await tx.execute<{ body_text: string; body_truncated: boolean }>(
        sql`SELECT body_text, body_truncated FROM substack_posts WHERE id = ${stored.id}`,
      );
      expect(rows[0]?.body_text).toContain("Mid-South Coliseum");
      expect(rows[0]?.body_truncated).toBe(false);
    });
  });

  it("upgrades a stored teaser once the full body becomes available", async () => {
    await withTx(async (tx) => {
      const pub = await upsertPublication(tx, publication);
      const teaser = normalize({ audience: "only_paid", body_html: "<p>Subscribe to read.</p>" });
      const first = await upsertPost(tx, pub.id, teaser, post());
      expect(teaser.body_truncated).toBe(true);

      await upsertPost(tx, pub.id, normalize(), post());
      const rows = await tx.execute<{ body_text: string; body_truncated: boolean }>(
        sql`SELECT body_text, body_truncated FROM substack_posts WHERE id = ${first.id}`,
      );
      expect(rows[0]?.body_truncated).toBe(false);
      expect(rows[0]?.body_text).toContain("Mid-South Coliseum");
    });
  });

  it("keeps two publications' identically-slugged posts apart", async () => {
    await withTx(async (tx) => {
      const a = await upsertPublication(tx, publication);
      const b = await upsertPublication(tx, {
        ...publication,
        host: "other.substack.com",
        name: "Other",
      });
      const first = await upsertPost(tx, a.id, normalize(), post());
      const second = await upsertPost(tx, b.id, normalize(), post());
      expect(second.created).toBe(true);
      expect(second.id).not.toBe(first.id);
    });
  });
});

describe("linkPostSources", () => {
  it("writes cited links into research_sources and joins them to the post", async () => {
    await withTx(async (tx) => {
      const { stored, links } = await seed(tx);
      expect(links.linked).toBe(2); // two external URLs; the self-link is skipped
      expect(links.newSources).toBe(2);

      const rows = await tx.execute<{
        url: string;
        anchor_text: string | null;
        occurrence_count: number;
        link_kind: string;
      }>(sql`
        SELECT rs.url, ps.anchor_text, ps.occurrence_count, ps.link_kind
          FROM substack_post_sources ps
          JOIN research_sources rs ON rs.id = ps.source_id
         WHERE ps.post_id = ${stored.id}
         ORDER BY ps.first_position
      `);
      expect(rows.map((r) => r.url)).toEqual([
        "https://www.cagematch.net/?id=5&nr=70",
        "https://wrestlingclassics.com/thread/41",
      ]);
      expect(rows[0]?.anchor_text).toBe("the lineage");
      expect(rows[0]?.occurrence_count).toBe(2);
      expect(rows[0]?.link_kind).toBe("external");
    });
  });

  it("records the publication's own back catalogue when asked", async () => {
    await withTx(async (tx) => {
      const pub = await upsertPublication(tx, publication);
      const normalized = normalize();
      const stored = await upsertPost(tx, pub.id, normalized, post());
      const result = await linkPostSources(tx, stored.id, normalized.links, {
        kinds: ["external", "substack", "self"],
      });
      expect(result.linked).toBe(3);
    });
  });

  it("reuses a research_sources row curated by hand and leaves its description alone", async () => {
    await withTx(async (tx) => {
      await tx.execute(sql`
        INSERT INTO research_sources (url, description)
        VALUES ('https://www.cagematch.net/?id=5&nr=70', 'Curated: NWA world title lineage')
      `);

      const { links } = await seed(tx);
      expect(links.newSources).toBe(1); // the CageMatch row already existed

      const rows = await tx.execute<{ description: string; n: number }>(sql`
        SELECT description, COUNT(*) OVER ()::int AS n
          FROM research_sources WHERE url = 'https://www.cagematch.net/?id=5&nr=70'
      `);
      expect(rows[0]?.n).toBe(1);
      expect(rows[0]?.description).toBe("Curated: NWA world title lineage");
    });
  });

  it("is idempotent — a second pass does not duplicate the join rows", async () => {
    await withTx(async (tx) => {
      const { stored, normalized } = await seed(tx);
      await linkPostSources(tx, stored.id, normalized.links);

      const rows = await tx.execute<{ n: number }>(
        sql`SELECT COUNT(*)::int AS n FROM substack_post_sources WHERE post_id = ${stored.id}`,
      );
      expect(rows[0]?.n).toBe(2);
    });
  });

  it("retracts a citation on relink when the parser stops recognising it", async () => {
    await withTx(async (tx) => {
      const { stored } = await seed(tx);

      // A parser change that no longer treats the board thread as a citation.
      const kept = normalize().links.filter((link) => !link.url.includes("wrestlingclassics"));
      const result = await relinkPost(tx, stored.id, kept);

      expect(result.linked).toBe(1);
      expect(result.removed).toBe(1);

      const rows = await tx.execute<{ url: string }>(sql`
        SELECT rs.url FROM substack_post_sources ps
          JOIN research_sources rs ON rs.id = ps.source_id
         WHERE ps.post_id = ${stored.id}
      `);
      expect(rows.map((r) => r.url)).toEqual(["https://www.cagematch.net/?id=5&nr=70"]);
    });
  });

  it("reports a no-longer-cited source without deleting it", async () => {
    await withTx(async (tx) => {
      const { stored } = await seed(tx);
      const result = await relinkPost(tx, stored.id, []);

      const orphans = await uncitedSources(tx, result.removedUrls);
      expect(orphans.map((o) => o.url)).toContain("https://wrestlingclassics.com/thread/41");

      const still = await tx.execute<{ n: number }>(
        sql`SELECT COUNT(*)::int AS n FROM research_sources WHERE url LIKE '%wrestlingclassics%'`,
      );
      expect(still[0]?.n).toBe(1);
    });
  });

  it("never reports a hand-curated source that was simply never cited", async () => {
    await withTx(async (tx) => {
      await tx.execute(sql`
        INSERT INTO research_sources (url, description)
        VALUES ('https://chroniclingamerica.loc.gov/', 'Curated: newspaper archive')
      `);
      const { stored } = await seed(tx);
      const result = await relinkPost(tx, stored.id, []);

      const orphans = await uncitedSources(tx, result.removedUrls);
      expect(orphans.map((o) => o.url)).not.toContain("https://chroniclingamerica.loc.gov/");
    });
  });

  it("hands back stored bodies so a relink needs no re-fetch", async () => {
    await withTx(async (tx) => {
      const { pub, stored } = await seed(tx);
      const rows = await postsWithBodies(tx, pub.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(stored.id);
      expect(rows[0]?.body_html).toContain("Mid-South Coliseum");
    });
  });

  it("cascades the join rows away when a post is deleted", async () => {
    await withTx(async (tx) => {
      const { stored } = await seed(tx);
      await tx.execute(sql`DELETE FROM substack_posts WHERE id = ${stored.id}`);
      const rows = await tx.execute<{ n: number }>(
        sql`SELECT COUNT(*)::int AS n FROM substack_post_sources WHERE post_id = ${stored.id}`,
      );
      expect(rows[0]?.n).toBe(0);
    });
  });
});

describe("reads", () => {
  it("finds a post by full-text search and highlights the hit", async () => {
    await withTx(async (tx) => {
      await seed(tx);
      const rows = await searchPosts(tx, "Coliseum booked");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.title).toBe("The 1977 Territory");
      expect(rows[0]?.publication).toBe("Memphis Wrestling History");
      expect(rows[0]?.snippet).toContain("«");
    });
  });

  it("returns nothing for a term the corpus does not contain", async () => {
    await withTx(async (tx) => {
      await seed(tx);
      expect(await searchPosts(tx, "Stampede Calgary")).toHaveLength(0);
    });
  });

  it("ranks cited sources by how many posts use them", async () => {
    await withTx(async (tx) => {
      await seed(tx);
      const rows = await listCitedSources(tx);
      expect(rows.map((r) => r.url)).toContain("https://www.cagematch.net/?id=5&nr=70");
      expect(rows[0]?.citing_posts).toBe(1);
    });
  });

  it("reports post counts and the publication's date span", async () => {
    await withTx(async (tx) => {
      const { pub } = await seed(tx);
      await refreshPublicationStats(tx, pub.id);

      const rows = await listPublications(tx);
      expect(rows[0]?.post_count).toBe(1);
      expect(rows[0]?.first_post_at?.slice(0, 10)).toBe("1977-04-01");
      expect(rows[0]?.last_fetched_at).not.toBeNull();
    });
  });

  it("indexes stored posts by slug so a re-run can skip them", async () => {
    await withTx(async (tx) => {
      const { pub, stored } = await seed(tx);
      const index = await existingPostIndex(tx, pub.id);
      expect(index.get("the-1977-territory")).toEqual({ id: stored.id, truncated: false });
      expect(index.has("never-published")).toBe(false);
    });
  });
});
