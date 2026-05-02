"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { insertBook, parseBookInput, updateBook } from "@/lib/db-ops/books";

export async function createBookAction(formData: FormData) {
  const input = parseBookInput(formData);
  const id = await insertBook(db, input);
  revalidatePath("/books");
  revalidatePath(`/book/${id}`);
  redirect(`/book/${id}`);
}

export async function updateBookAction(bookId: number, formData: FormData) {
  const input = parseBookInput(formData);
  await updateBook(db, bookId, input);
  revalidatePath("/books");
  revalidatePath(`/book/${bookId}`);
  redirect(`/book/${bookId}`);
}
