import { z } from "zod";

export const optStr = z
  .string()
  .nullable()
  .optional()
  .transform((v) => {
    if (!v) return null;
    const t = v.trim();
    return t.length > 0 ? t : null;
  });

export const optInt = z.union([z.string(), z.number(), z.null(), z.undefined()]).transform((v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number.parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : null;
});

export const checkbox = z
  .union([z.string(), z.boolean(), z.null(), z.undefined()])
  .transform((v) => {
    if (typeof v === "boolean") return v;
    return v === "1" || v === "on" || v === "true";
  });

export function getStr(form: FormData, name: string): string | null {
  const v = form.get(name);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export function getInt(form: FormData, name: string): number | null {
  const s = getStr(form, name);
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

export function getCheckbox(form: FormData, name: string): boolean {
  const v = form.get(name);
  return v === "1" || v === "on" || v === "true";
}
