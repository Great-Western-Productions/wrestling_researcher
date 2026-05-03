import type { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { bookCreateSchema } from "@/lib/api/schemas";
import { jsonCreated, jsonError, jsonOk, parseJsonBody } from "@/lib/api/route-helpers";
import { findBookByTitleYear, insertBook } from "@/lib/db-ops/books";

export async function GET(req: NextRequest) {
  const title = req.nextUrl.searchParams.get("title");
  const yearRaw = req.nextUrl.searchParams.get("year");
  if (!title) return jsonError(400, "title query param required");
  const year = yearRaw ? Number.parseInt(yearRaw, 10) : null;
  const found = await findBookByTitleYear(db, title, Number.isFinite(year) ? year : null);
  if (!found) return jsonError(404, "Not found");
  return jsonOk(found);
}

export async function POST(req: Request) {
  const parsed = await parseJsonBody(req, bookCreateSchema);
  if (!parsed.ok) return parsed.response;

  const existing = await findBookByTitleYear(db, parsed.data.title, parsed.data.year_published);
  if (existing) return jsonError(409, "Book already exists", { id: existing.id });

  const id = await insertBook(db, {
    title: parsed.data.title,
    subtitle: parsed.data.subtitle,
    category_code: parsed.data.category_code,
    publisher: parsed.data.publisher,
    year_published: parsed.data.year_published,
    isbn10: parsed.data.isbn10,
    isbn13: parsed.data.isbn13,
    pages: parsed.data.pages,
    format: parsed.data.format,
    language: parsed.data.language ?? "English",
    country: parsed.data.country,
    subject_wrestler: parsed.data.subject_wrestler,
    era: parsed.data.era,
    territory_or_promotion: parsed.data.territory_or_promotion,
    synopsis: parsed.data.synopsis,
    source_url: parsed.data.source_url,
    confidence: "high",
    authorNames: [],
    authorsAreWrestlers: false,
  });
  return jsonCreated({ id });
}
