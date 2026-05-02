export const CATEGORIES: Array<[string, string]> = [
  ["about_wrestling", "About wrestling"],
  ["about_wrestler", "About wrestlers"],
  ["by_wrestler", "By wrestlers"],
  ["fiction", "Fiction"],
];

const CATEGORY_LABELS = new Map(CATEGORIES);

export function categoryLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return CATEGORY_LABELS.get(code) ?? code;
}

export function ifnull<T>(value: T | null | undefined, fallback = "—"): string {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

export function buildQueryString(
  params: Record<string, string | number | undefined | null>,
): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    out.set(k, String(v));
  }
  const s = out.toString();
  return s ? `?${s}` : "";
}
