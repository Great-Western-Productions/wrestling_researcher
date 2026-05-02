import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { getCheckbox, getInt, getStr } from "@/lib/actions/_helpers";
import { ValidationError } from "./books";

type Db = PostgresJsDatabase<typeof schema>;

export type PeriodicalInput = {
  title: string;
  publisher: string | null;
  country: string | null;
  language: string;
  year_started: number | null;
  year_ended: number | null;
  frequency: string | null;
  type: string | null;
  parent_company: string | null;
  notes: string | null;
  issue_count_known: number | null;
  archive_in_collection: boolean;
  source_url: string | null;
  confidence: string;
};

export function parsePeriodicalInput(form: FormData): PeriodicalInput {
  const title = getStr(form, "title");
  if (!title) throw new ValidationError("Title is required.");
  return {
    title,
    publisher: getStr(form, "publisher"),
    country: getStr(form, "country"),
    language: getStr(form, "language") ?? "English",
    year_started: getInt(form, "year_started"),
    year_ended: getInt(form, "year_ended"),
    frequency: getStr(form, "frequency"),
    type: getStr(form, "type"),
    parent_company: getStr(form, "parent_company"),
    notes: getStr(form, "notes"),
    issue_count_known: getInt(form, "issue_count_known"),
    archive_in_collection: getCheckbox(form, "archive_in_collection"),
    source_url: getStr(form, "source_url"),
    confidence: getStr(form, "confidence") ?? "medium",
  };
}

export async function insertPeriodical(db: Db, input: PeriodicalInput): Promise<number> {
  const rows = await db.execute<{ id: number }>(sql`
    INSERT INTO periodicals (title, publisher, country, language, year_started, year_ended,
                             frequency, type, parent_company, notes, issue_count_known,
                             archive_in_collection, source_url, confidence)
    VALUES (${input.title}, ${input.publisher}, ${input.country}, ${input.language},
            ${input.year_started}, ${input.year_ended}, ${input.frequency}, ${input.type},
            ${input.parent_company}, ${input.notes}, ${input.issue_count_known},
            ${input.archive_in_collection}, ${input.source_url}, ${input.confidence})
    RETURNING id
  `);
  return rows[0]!.id;
}
