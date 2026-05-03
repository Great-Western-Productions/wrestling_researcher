import type { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { wrestlerCreateSchema } from "@/lib/api/schemas";
import { jsonCreated, jsonError, jsonOk, parseJsonBody } from "@/lib/api/route-helpers";
import { findWrestlerByRingName, insertWrestler } from "@/lib/db-ops/wrestlers";

export async function GET(req: NextRequest) {
  const ringName = req.nextUrl.searchParams.get("ring_name");
  if (!ringName) return jsonError(400, "ring_name query param required");
  const found = await findWrestlerByRingName(db, ringName);
  if (!found) return jsonError(404, "Not found");
  return jsonOk(found);
}

export async function POST(req: Request) {
  const parsed = await parseJsonBody(req, wrestlerCreateSchema);
  if (!parsed.ok) return parsed.response;

  const existing = await findWrestlerByRingName(db, parsed.data.primary_ring_name);
  if (existing) return jsonError(409, "Wrestler already exists", { id: existing.id });

  const result = await insertWrestler(db, {
    legal_name: parsed.data.legal_name,
    primary_ring_name: parsed.data.primary_ring_name,
    other_ring_names: parsed.data.other_ring_names,
    born_date: parsed.data.born_date,
    died_date: parsed.data.died_date,
    living: parsed.data.living,
    debut_year: parsed.data.debut_year,
    retired_year: parsed.data.retired_year,
    primary_role: parsed.data.primary_role,
    hometown_billed: parsed.data.hometown_billed,
    hometown_real: parsed.data.hometown_real,
    finisher: parsed.data.finisher,
    style: parsed.data.style,
    socials: parsed.data.socials,
    convention_status: parsed.data.convention_status,
    last_known_appearance: parsed.data.last_known_appearance,
    footage_notes: parsed.data.footage_notes,
    midcard_files_status: parsed.data.midcard_files_status,
    midcard_files_priority: parsed.data.midcard_files_priority,
    why_they_mattered: parsed.data.why_they_mattered,
    notes: parsed.data.notes,
    height_inches: parsed.data.height_inches,
    weight_lbs: parsed.data.weight_lbs,
    bio: parsed.data.bio,
    fromPending: null,
  });
  return jsonCreated({ id: result.id });
}
