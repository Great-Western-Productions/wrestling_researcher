"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSessionOrThrow } from "@/lib/auth/require-session";
import { db } from "@/lib/db/client";
import { insertPeriodical, parsePeriodicalInput } from "@/lib/db-ops/periodicals";
import { insertRun, parseRunInput } from "@/lib/db-ops/runs";
import { insertTerritory, parseTerritoryInput } from "@/lib/db-ops/territories";
import { insertWrestler, parseWrestlerInput } from "@/lib/db-ops/wrestlers";

export async function createPeriodicalAction(formData: FormData) {
  await requireSessionOrThrow();
  const input = parsePeriodicalInput(formData);
  await insertPeriodical(db, input);
  revalidatePath("/periodicals");
  redirect("/periodicals");
}

export async function createTerritoryAction(formData: FormData) {
  await requireSessionOrThrow();
  const input = parseTerritoryInput(formData);
  const id = await insertTerritory(db, input);
  revalidatePath("/territories");
  revalidatePath(`/territory/${id}`);
  redirect(`/territory/${id}`);
}

export async function createWrestlerAction(formData: FormData) {
  await requireSessionOrThrow();
  const input = parseWrestlerInput(formData);
  const result = await insertWrestler(db, input);
  revalidatePath("/wrestlers");
  revalidatePath(`/wrestler/${result.id}`);
  if (input.fromPending) {
    revalidatePath("/pending");
    revalidatePath(`/pending/${input.fromPending}`);
  }
  redirect(`/wrestler/${result.id}`);
}

export async function createRunAction(formData: FormData) {
  await requireSessionOrThrow();
  const input = parseRunInput(formData);
  await insertRun(db, input);
  revalidatePath(`/wrestler/${input.wrestler_id}`);
  revalidatePath(`/territory/${input.territory_id}`);
  redirect(`/wrestler/${input.wrestler_id}`);
}
