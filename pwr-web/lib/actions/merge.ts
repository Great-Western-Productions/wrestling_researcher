"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { getInt } from "./_helpers";
import {
  mergeBooks,
  mergePendingIntoWrestler,
  unmergePendingFromWrestler,
} from "@/lib/db-ops/merge";

export async function mergeBookAction(targetBookId: number, formData: FormData) {
  const duplicateId = getInt(formData, "duplicate_book_id");
  const next = (formData.get("next") as string | null) ?? "/books";
  if (!duplicateId) redirect(next);
  await mergeBooks(db, targetBookId, duplicateId);
  revalidatePath("/books");
  revalidatePath(`/book/${targetBookId}`);
  redirect(next);
}

export async function pendingMergeAction(pendingId: number, formData: FormData) {
  const wid =
    getInt(formData, "wrestler_id") ?? getInt(formData, "wrestler_id_manual");
  if (!wid) redirect(`/pending/${pendingId}`);
  await mergePendingIntoWrestler(db, pendingId, wid);
  revalidatePath("/pending");
  revalidatePath(`/pending/${pendingId}`);
  revalidatePath(`/wrestler/${wid}`);
  redirect("/pending");
}

export async function pendingUnmergeAction(pendingId: number, _formData: FormData) {
  await unmergePendingFromWrestler(db, pendingId);
  revalidatePath("/pending");
  revalidatePath(`/pending/${pendingId}`);
  redirect(`/pending/${pendingId}`);
}
