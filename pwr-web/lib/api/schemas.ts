import { z } from "zod";

const trimToNull = (v: unknown) => {
  if (typeof v !== "string") return v ?? null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

const optStr = z.preprocess(trimToNull, z.string().nullable());
const optInt = z.preprocess((v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number.parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : null;
}, z.number().int().nullable());

const livingEnum = z.preprocess((v) => {
  if (v === true || v === "1" || v === "true") return true;
  if (v === false || v === "0" || v === "false") return false;
  return null;
}, z.boolean().nullable());

export const wrestlerCreateSchema = z.object({
  primary_ring_name: z
    .string()
    .min(1, "primary_ring_name required")
    .transform((s) => s.trim()),
  legal_name: optStr,
  other_ring_names: optStr,
  born_date: optStr,
  died_date: optStr,
  living: livingEnum,
  debut_year: optInt,
  retired_year: optInt,
  primary_role: optStr,
  hometown_billed: optStr,
  hometown_real: optStr,
  finisher: optStr,
  style: optStr,
  socials: optStr,
  convention_status: optStr,
  last_known_appearance: optStr,
  footage_notes: optStr,
  midcard_files_status: optStr.transform((v) => v ?? "queued"),
  midcard_files_priority: optInt,
  why_they_mattered: optStr,
  notes: optStr,
  height_inches: optInt,
  weight_lbs: optInt,
  bio: optStr,
});
export type WrestlerCreateInput = z.infer<typeof wrestlerCreateSchema>;

export const wrestlerPatchSchema = wrestlerCreateSchema.partial();
export type WrestlerPatchInput = z.infer<typeof wrestlerPatchSchema>;

export const runCreateSchema = z.object({
  territory_id: z.number().int(),
  start_year: optInt,
  start_month: optInt,
  end_year: optInt,
  end_month: optInt,
  role_during_run: optStr,
  ring_name_during_run: optStr,
  primary_run: z.boolean().default(false),
  notes: optStr,
});
export type RunCreateInput = z.infer<typeof runCreateSchema>;

export const citationCreateSchema = z.object({
  book_id: z.number().int(),
  page: optStr,
  excerpt: optStr,
});
export type CitationCreateInput = z.infer<typeof citationCreateSchema>;

export const bookCreateSchema = z.object({
  title: z
    .string()
    .min(1)
    .transform((s) => s.trim()),
  subtitle: optStr,
  category_code: z.string().min(1),
  publisher: optStr,
  year_published: optInt,
  isbn10: optStr,
  isbn13: optStr,
  pages: optInt,
  format: optStr,
  language: optStr,
  country: optStr,
  subject_wrestler: optStr,
  era: optStr,
  territory_or_promotion: optStr,
  synopsis: optStr,
  source_url: optStr,
});
export type BookCreateInput = z.infer<typeof bookCreateSchema>;
