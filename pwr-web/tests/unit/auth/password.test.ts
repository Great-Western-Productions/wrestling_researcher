import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("hashPassword", () => {
  it("returns a bcrypt hash that round-trips through verifyPassword", async () => {
    const hash = await hashPassword("hunter2");
    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(await verifyPassword("hunter2", hash)).toBe(true);
  });

  it("rejects an empty password explicitly (no silent zero-length hash)", async () => {
    await expect(hashPassword("")).rejects.toThrow(/empty/i);
  });

  it("produces a different hash on each call (random salt)", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });
});

describe("verifyPassword", () => {
  it("returns false on wrong password", async () => {
    const hash = await hashPassword("right");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("returns false on garbage hash without throwing", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
  });

  it("returns false when given empty inputs", async () => {
    const hash = await hashPassword("real");
    expect(await verifyPassword("", hash)).toBe(false);
    expect(await verifyPassword("real", "")).toBe(false);
  });
});
