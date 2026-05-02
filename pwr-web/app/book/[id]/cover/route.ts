import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { getBookById } from "@/lib/queries/books";
import { resolveCoverUrl } from "@/lib/covers";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const bookId = Number.parseInt(id, 10);
  const placeholder = new URL("/cover-placeholder.svg", req.url);
  if (!Number.isFinite(bookId)) return NextResponse.redirect(placeholder, 302);

  const book = await getBookById(db, bookId);
  if (!book) return NextResponse.redirect(placeholder, 302);

  for (const isbn of [book.isbn13, book.isbn10]) {
    if (!isbn) continue;
    const url = await resolveCoverUrl(isbn);
    if (url) return NextResponse.redirect(url, 302);
  }
  return NextResponse.redirect(placeholder, 302);
}
