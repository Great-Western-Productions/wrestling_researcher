import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createUser, findUserByEmail, verifyUserPassword } from "@/lib/auth/users";
import { closeTestDb, withTx } from "../../helpers/db";

afterAll(closeTestDb);

describe("createUser", () => {
  it("inserts a row with a non-null password_hash and returns the user", async () => {
    await withTx(async (tx) => {
      const user = await createUser(tx, {
        email: "test@local.dev",
        password: "hunter2",
        name: "Test",
      });
      expect(user.email).toBe("test@local.dev");
      expect(user.id).toMatch(/.{8}-.{4}-.{4}-.{4}-.{12}/); // uuid

      const rows = await tx.execute<{ password_hash: string | null }>(
        sql`SELECT password_hash FROM auth_user WHERE id = ${user.id}`,
      );
      expect(rows[0]!.password_hash).toMatch(/^\$2[aby]\$/);
    });
  });

  it("rejects a duplicate email", async () => {
    await withTx(async (tx) => {
      await createUser(tx, { email: "dupe@local.dev", password: "x" });
      await expect(createUser(tx, { email: "dupe@local.dev", password: "y" })).rejects.toThrow(
        /already exists|unique|duplicate/i,
      );
    });
  });

  it("normalizes email to lowercase", async () => {
    await withTx(async (tx) => {
      const user = await createUser(tx, {
        email: "Mixed.Case@Local.dev",
        password: "x",
      });
      expect(user.email).toBe("mixed.case@local.dev");
    });
  });
});

describe("findUserByEmail", () => {
  it("returns the user (case-insensitively)", async () => {
    await withTx(async (tx) => {
      const created = await createUser(tx, {
        email: "lookup@local.dev",
        password: "x",
      });
      const found = await findUserByEmail(tx, "LOOKUP@LOCAL.DEV");
      expect(found?.id).toBe(created.id);
    });
  });

  it("returns null for unknown emails", async () => {
    await withTx(async (tx) => {
      const found = await findUserByEmail(tx, "nobody@local.dev");
      expect(found).toBeNull();
    });
  });
});

describe("verifyUserPassword", () => {
  it("returns the user on correct password", async () => {
    await withTx(async (tx) => {
      const created = await createUser(tx, {
        email: "auth@local.dev",
        password: "right-password",
      });
      const result = await verifyUserPassword(tx, "auth@local.dev", "right-password");
      expect(result?.id).toBe(created.id);
    });
  });

  it("returns null on wrong password", async () => {
    await withTx(async (tx) => {
      await createUser(tx, { email: "auth2@local.dev", password: "right" });
      const result = await verifyUserPassword(tx, "auth2@local.dev", "wrong");
      expect(result).toBeNull();
    });
  });

  it("returns null on unknown email", async () => {
    await withTx(async (tx) => {
      const result = await verifyUserPassword(tx, "nobody@local.dev", "any");
      expect(result).toBeNull();
    });
  });

  it("returns null when the user has no password_hash (OAuth-only user)", async () => {
    await withTx(async (tx) => {
      await tx.execute(sql`
        INSERT INTO auth_user (id, email, password_hash)
        VALUES ('oauth-only-user-id', 'oauth@local.dev', NULL)
      `);
      const result = await verifyUserPassword(tx, "oauth@local.dev", "anything");
      expect(result).toBeNull();
    });
  });
});
