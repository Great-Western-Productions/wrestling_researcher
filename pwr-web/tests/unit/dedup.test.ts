import { describe, expect, it } from "vitest";
import { fuzzy, normalizeName } from "@/lib/dedup";

describe("normalizeName", () => {
  it("lowercases and trims surrounding whitespace", () => {
    expect(normalizeName("  Bret Hart  ")).toBe("bret hart");
  });

  it("strips diacritics via NFKD fold", () => {
    expect(normalizeName("André")).toBe("andre");
    expect(normalizeName("Naïveté")).toBe("naivete");
  });

  it("strips the punctuation set \" ' ` . , ! ?", () => {
    expect(normalizeName('Bret "The Hitman" Hart!')).toBe("bret the hitman hart");
    expect(normalizeName("St. Patrick's Day, 1986?")).toBe("st patricks day 1986");
  });

  it("does not strip hyphens or parentheses", () => {
    expect(normalizeName("Stone-Cold (Texas)")).toBe("stone-cold (texas)");
  });

  it("collapses internal whitespace runs to a single space", () => {
    expect(normalizeName("Andre   the\tGiant")).toBe("andre the giant");
  });

  it("is idempotent", () => {
    const once = normalizeName("Macho Man Randy Savage!");
    expect(normalizeName(once)).toBe(once);
  });
});

describe("fuzzy", () => {
  it("returns 100 for identical strings (after normalization)", () => {
    expect(fuzzy("Ric Flair", "ric flair")).toBe(100);
    expect(fuzzy("Bret Hart", "Bret Hart")).toBe(100);
  });

  it("returns a high score (>= 85) for close misspellings", () => {
    expect(fuzzy("Ric Flair", "Rick Flare")).toBeGreaterThanOrEqual(85);
    expect(fuzzy("Hulk Hogan", "Hulk Hogen")).toBeGreaterThanOrEqual(90);
  });

  it("returns a high score (>= 85) when one is a contiguous substring of the other", () => {
    expect(fuzzy("The Macho Man", "Macho Man")).toBeGreaterThanOrEqual(85);
  });

  it("returns a high score (>= 85) for token-reordered names", () => {
    expect(fuzzy("Randy Macho Man Savage", "Macho Man Randy Savage")).toBeGreaterThanOrEqual(85);
  });

  it("returns a low score (< 50) for unrelated names", () => {
    expect(fuzzy("Ric Flair", "Hulk Hogan")).toBeLessThan(50);
  });

  it("clamps to integer values in [0, 100]", () => {
    const s = fuzzy("Andre the Giant", "Big Show");
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });
});
