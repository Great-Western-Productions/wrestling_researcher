import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeTestDb } from "../../helpers/db";

afterAll(closeTestDb);

let currentSession: { user: { id: string; email: string } } | null = null;

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => currentSession),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: { GET: vi.fn(), POST: vi.fn() },
}));

beforeEach(() => {
  currentSession = null;
});

async function postWrestler(body: unknown) {
  const { POST } = await import("@/app/api/wrestlers/route");
  return POST(
    new Request("http://localhost/api/wrestlers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const validWrestlerBody = {
  primary_ring_name: "Auth Gate Test Wrestler",
  legal_name: null,
  other_ring_names: null,
  born_date: null,
  died_date: null,
  living: null,
  debut_year: null,
  retired_year: null,
  primary_role: null,
  hometown_billed: null,
  hometown_real: null,
  finisher: null,
  style: null,
  socials: null,
  convention_status: null,
  last_known_appearance: null,
  footage_notes: null,
  midcard_files_status: "queued",
  midcard_files_priority: null,
  why_they_mattered: null,
  notes: null,
  height_inches: null,
  weight_lbs: null,
  bio: null,
};

describe("POST /api/wrestlers gating", () => {
  it("returns 401 when no session is present", async () => {
    currentSession = null;
    const res = await postWrestler(validWrestlerBody);
    expect(res.status).toBe(401);
  });

  it("returns 201 when a session is present", async () => {
    currentSession = { user: { id: "u1", email: "u1@local.dev" } };
    const res = await postWrestler({
      ...validWrestlerBody,
      primary_ring_name: `Auth Gate ${Date.now()}`,
    });
    expect(res.status).toBe(201);
  });
});
