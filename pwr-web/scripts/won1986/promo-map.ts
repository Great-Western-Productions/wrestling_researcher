/**
 * Hand-curated map: WON Who's Who 1986 "Promotional affiliation" string →
 * the canonical territory name we'll look up via the API.
 *
 * Where the OCR'd text is fuzzy or has multiple variants, list them all under
 * the same canonical key. The lookup key is normalized (lowercase, collapsed
 * whitespace) before matching.
 *
 * Unknown affiliations are intentionally left out — the script logs a warning
 * and skips the run insert rather than auto-creating a territory from
 * potentially-wrong OCR.
 */
export const PROMO_TO_TERRITORY: Record<string, string> = {
  "titan sports": "World Wrestling Federation",
  wwf: "World Wrestling Federation",
  "world wrestling federation": "World Wrestling Federation",
  "jim crockett promotions": "Jim Crockett Promotions",
  jcp: "Jim Crockett Promotions",
  "mid south sports": "Mid-South Wrestling",
  "mid south sports, inc.": "Mid-South Wrestling",
  "mid-south sports": "Mid-South Wrestling",
  "universal wrestling federation": "Universal Wrestling Federation",
  uwf: "Universal Wrestling Federation",
  "world class championship": "World Class Championship Wrestling",
  "world class championship wrestling": "World Class Championship Wrestling",
  wccw: "World Class Championship Wrestling",
  "southwest sports, inc.": "World Class Championship Wrestling",
  "american wrestling association": "American Wrestling Association",
  awa: "American Wrestling Association",
  "stampede wrestling": "Stampede Wrestling",
  "foothills athletic club": "Stampede Wrestling",
  "championship wrestling from florida": "Championship Wrestling from Florida",
  cwf: "Championship Wrestling from Florida",
  "continental championship wrestling": "Continental Championship Wrestling",
  ccw: "Continental Championship Wrestling",
  "international wrestling": "Lutte Internationale",
  "lutte internationale": "Lutte Internationale",
  "championship wrestling association": "Continental Wrestling Association",
  "warrior sports": "Continental Wrestling Association",
  cwa: "Continental Wrestling Association",
  "all japan pro wrestling": "All Japan Pro Wrestling",
  "all japan": "All Japan Pro Wrestling",
  ajpw: "All Japan Pro Wrestling",
  "new japan pro wrestling": "New Japan Pro Wrestling",
  "new japan": "New Japan Pro Wrestling",
  njpw: "New Japan Pro Wrestling",
  "capitol sports": "World Wrestling Council",
  wwc: "World Wrestling Council",
  "universal wrestling association": "Universal Wrestling Association",
  uwa: "Universal Wrestling Association",
  "central states wrestling": "Central States Wrestling",
  "heart of america": "Central States Wrestling",
  "big time wrestling": "Pacific Northwest Wrestling",
  "don owen promotions": "Pacific Northwest Wrestling",
  "texas all-star wrestling": "Texas All-Star Wrestling",
};

export function resolvePromotion(raw: string | null): string | null {
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
  if (PROMO_TO_TERRITORY[key]) return PROMO_TO_TERRITORY[key];

  // Loose contains-match fallback for cases like "World Class" suffixed with "Championship"
  for (const [k, v] of Object.entries(PROMO_TO_TERRITORY)) {
    if (key.includes(k)) return v;
  }
  return null;
}
