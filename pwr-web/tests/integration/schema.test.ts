import { afterAll, describe, expect, it } from "vitest";
import { books, categories, territories, wrestlers } from "@/lib/db/schema";
import { closeTestDb, withTx } from "../helpers/db";

afterAll(closeTestDb);

describe("introspected schema applies and is queryable", () => {
  it("books FKs into categories.code (constraint is enforced)", async () => {
    const rows = await withTx(async (tx) => {
      await tx.insert(categories).values({ code: "about_wrestling", label: "About Wrestling" });
      const inserted = await tx
        .insert(books)
        .values({ title: "Test Title", category_code: "about_wrestling" })
        .returning();
      return inserted;
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("Test Title");
    expect(rows[0]?.confidence).toBe("medium"); // schema default
  });

  it("wrestlers table accepts the minimum required fields", async () => {
    const rows = await withTx(async (tx) => {
      const inserted = await tx
        .insert(wrestlers)
        .values({ legal_name: "Some Wrestler", primary_ring_name: "The Wrestler" })
        .returning();
      return inserted;
    });

    expect(rows[0]?.primary_ring_name).toBe("The Wrestler");
  });

  it("territories table accepts the minimum required fields", async () => {
    const rows = await withTx(async (tx) => {
      const inserted = await tx.insert(territories).values({ name: "Test Promotion" }).returning();
      return inserted;
    });

    expect(rows[0]?.name).toBe("Test Promotion");
  });
});
