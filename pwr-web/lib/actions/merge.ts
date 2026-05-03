"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSessionOrThrow } from "@/lib/auth/require-session";
import { db } from "@/lib/db/client";
import {
  mergeBooks,
  mergePendingIntoWrestler,
  unmergePendingFromWrestler,
} from "@/lib/db-ops/merge";
import { getInt } from "./_helpers";

export async function mergeBookAction(targetBookId: number, formData: FormData) {
  await requireSessionOrThrow();
  const duplicateId = getInt(formData, "duplicate_book_id");
  const next = (formData.get("next") as string | null) ?? "/books";
  if (!duplicateId) redirect(next);
  await mergeBooks(db, targetBookId, duplicateId);
  revalidatePath("/books");
  revalidatePath(`/book/${targetBookId}`);
  redirect(next);
}

export async function pendingMergeAction(pendingId: number, formData: FormData) {
  await requireSessionOrThrow();
  const wid = getInt(formData, "wrestler_id") ?? getInt(formData, "wrestler_id_manual");
  if (!wid) redirect(`/pending/${pendingId}`);
  await mergePendingIntoWrestler(db, pendingId, wid);
  revalidatePath("/pending");
  revalidatePath(`/pending/${pendingId}`);
  revalidatePath(`/wrestler/${wid}`);
  redirect("/pending");
}

export async function pendingUnmergeAction(pendingId: number, _formData: FormData) {
  await requireSessionOrThrow();
  await unmergePendingFromWrestler(db, pendingId);
  revalidatePath("/pending");
  revalidatePath(`/pending/${pendingId}`);
  redirect(`/pending/${pendingId}`);
}
