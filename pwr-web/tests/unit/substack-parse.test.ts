import { describe, expect, it } from "vitest";
import { normalizePost } from "@/lib/ingest/substack/normalize";
import {
  classifyLink,
  countWords,
  decodeEntities,
  extractLinks,
  htmlToText,
  normalizeUrl,
} from "@/lib/ingest/substack/parse";

describe("decodeEntities", () => {
  it("decodes named, decimal, and hex entities", () => {
    expect(decodeEntities("Bruiser &amp; Crusher")).toBe("Bruiser & Crusher");
    expect(decodeEntities("Jarrett&#8217;s office")).toBe("Jarrett’s office");
    expect(decodeEntities("&#x2014; Meltzer")).toBe("— Meltzer");
  });

  it("leaves unknown entities untouched rather than mangling them", () => {
    expect(decodeEntities("&notanentity; &#xZZ;")).toBe("&notanentity; &#xZZ;");
  });
});

describe("htmlToText", () => {
  it("separates paragraphs and drops inline markup without adding spaces", () => {
    const html = "<p>Memphis, <em>1977</em>.</p><p>Jarrett booked it.</p>";
    expect(htmlToText(html)).toBe("Memphis, 1977.\n\nJarrett booked it.");
  });

  it("treats line wrapping inside a paragraph as a space, not a break", () => {
    const html = "<p>Per the lineage,\n     the belt changed hands\n  in Louisville.</p>";
    expect(htmlToText(html)).toBe("Per the lineage, the belt changed hands in Louisville.");
  });

  it("drops script and style content entirely", () => {
    expect(htmlToText("<p>Kept</p><script>var gone = 1;</script><style>.x{}</style>")).toBe("Kept");
  });

  it("collapses runs of blank lines", () => {
    expect(htmlToText("<p>a</p><div></div><div></div><p>b</p>")).toBe("a\n\nb");
  });

  it("returns empty string for null bodies", () => {
    expect(htmlToText(null)).toBe("");
    expect(countWords(htmlToText(undefined))).toBe(0);
  });
});

describe("normalizeUrl", () => {
  it("resolves relative hrefs against the post URL", () => {
    expect(normalizeUrl("/p/other-post", "https://blog.example.com/p/this-post")).toBe(
      "https://blog.example.com/p/other-post",
    );
  });

  it("strips tracking parameters and fragments but keeps real query data", () => {
    expect(
      normalizeUrl("https://www.cagematch.net/?id=5&nr=70&utm_source=substack&r=abc#lineage"),
    ).toBe("https://www.cagematch.net/?id=5&nr=70");
  });

  it("unwraps Substack redirect links when they carry the destination", () => {
    const wrapped =
      "https://substack.com/redirect/abc-123?u=https%3A%2F%2Fwrestlingclassics.com%2Fthread%2F41";
    expect(normalizeUrl(wrapped)).toBe("https://wrestlingclassics.com/thread/41");
  });

  it("rejects fragments, mailto, and Substack's own image assets", () => {
    expect(normalizeUrl("#footnote-1")).toBeNull();
    expect(normalizeUrl("mailto:someone@example.com")).toBeNull();
    expect(normalizeUrl("https://substackcdn.com/image/fetch/whatever.png")).toBeNull();
    expect(normalizeUrl("not a url at all")).toBeNull();
  });

  it("drops a trailing slash so one page is one row", () => {
    expect(normalizeUrl("https://example.com/archive/")).toBe("https://example.com/archive");
  });
});

describe("classifyLink", () => {
  it("separates the publication's own posts from other Substacks and the open web", () => {
    expect(classifyLink("https://memphis.substack.com/p/x", "memphis.substack.com")).toBe("self");
    expect(classifyLink("https://www.memphis.substack.com/p/x", "memphis.substack.com")).toBe(
      "self",
    );
    expect(classifyLink("https://other.substack.com/p/x", "memphis.substack.com")).toBe("substack");
    expect(classifyLink("https://www.cagematch.net/?id=2", "memphis.substack.com")).toBe(
      "external",
    );
  });
});

describe("extractLinks", () => {
  const html = `
    <p>Per <a href="https://www.cagematch.net/?id=5&amp;nr=70">the CageMatch lineage</a>,
       the belt changed hands in Louisville.</p>
    <p>I covered this in <a href="/p/earlier-post">an earlier post</a>, and the
       <a href="https://www.cagematch.net/?id=5&amp;nr=70">same page</a> lists the vacancy.</p>
    <p><a href="https://substackcdn.com/image/fetch/cover.png"><img src="cover.png"></a></p>
  `;

  it("returns one entry per distinct URL with an occurrence count", () => {
    const links = extractLinks(html, {
      baseUrl: "https://memphis.substack.com/p/belt",
      publicationHost: "memphis.substack.com",
    });
    expect(links.map((l) => l.url)).toEqual([
      "https://www.cagematch.net/?id=5&nr=70",
      "https://memphis.substack.com/p/earlier-post",
    ]);
    expect(links[0]?.occurrences).toBe(2);
    expect(links[0]?.anchorText).toBe("the CageMatch lineage");
    expect(links[0]?.kind).toBe("external");
    expect(links[1]?.kind).toBe("self");
  });

  it("keeps the sentence around the first mention as context", () => {
    const links = extractLinks(html, {
      baseUrl: "https://memphis.substack.com/p/belt",
      publicationHost: "memphis.substack.com",
    });
    expect(links[0]?.context).toContain("changed hands in Louisville");
  });

  it("ignores image links and anchors with no href", () => {
    const links = extractLinks('<a>no href</a><a href="#top">top</a>', {
      publicationHost: "memphis.substack.com",
    });
    expect(links).toEqual([]);
  });
});

describe("normalizePost", () => {
  const base = {
    id: 42,
    slug: "the-1977-memphis-territory",
    title: "The 1977 Memphis Territory",
    subtitle: "Jarrett's booking year",
    post_date: "1977-04-01T12:00:00.000Z",
    canonical_url: "https://memphis.substack.com/p/the-1977-memphis-territory",
    type: "newsletter",
    audience: "everyone",
    publishedBylines: [{ name: "A Historian" }],
    body_html: "<p>Two hundred words of <a href='https://example.com/src'>sourcing</a>.</p>",
  };
  const opts = { origin: "https://memphis.substack.com", host: "memphis.substack.com" };

  it("maps the payload onto the stored row", () => {
    const post = normalizePost(base, opts);
    expect(post.substack_post_id).toBe(42);
    expect(post.author).toBe("A Historian");
    expect(post.published_at?.toISOString()).toBe("1977-04-01T12:00:00.000Z");
    expect(post.body_text).toContain("Two hundred words of sourcing");
    expect(post.body_truncated).toBe(false);
    expect(post.links).toHaveLength(1);
  });

  it("falls back to a built canonical URL and the slug as a title", () => {
    const post = normalizePost({ slug: "untitled-draft" }, opts);
    expect(post.canonical_url).toBe("https://memphis.substack.com/p/untitled-draft");
    expect(post.title).toBe("untitled-draft");
    expect(post.body_truncated).toBe(true); // no body came back
  });

  it("flags a paid post as truncated", () => {
    expect(normalizePost({ ...base, audience: "only_paid" }, opts).body_truncated).toBe(true);
  });

  it("flags a teaser whose body falls well short of Substack's word count", () => {
    const post = normalizePost({ ...base, wordcount: 2000 }, opts);
    expect(post.body_truncated).toBe(true);
  });

  it("joins multiple bylines", () => {
    const post = normalizePost(
      { ...base, publishedBylines: [{ name: "One" }, { name: "Two" }] },
      opts,
    );
    expect(post.author).toBe("One, Two");
  });
});
