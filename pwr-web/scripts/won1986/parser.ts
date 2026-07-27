/**
 * Parser for the WON Who's Who in Pro Wrestling (1986) bio entries.
 *
 * Each entry follows the template:
 *
 *   RING NAME (HEIGHT-INCHES, WEIGHT-LBS)
 *   Real name - <legal name | "Unknown">
 *   Age - <N> [(born M/D/YY)]
 *   Years pro - <N>
 *   Hometown - <city>, <region> [(now lives in <other place>)]
 *   Promotional affiliation - <promotion name | "None">
 *   Other ring names - <comma list | "None">
 *
 *   <free-form biographical narrative>
 *
 * The parser is pure (no I/O) so it can be unit-tested with fixture strings.
 */

export type ParsedEntry = {
  primary_ring_name: string;
  legal_name: string | null;
  age: number | null;
  born_date: string | null; // YYYY-MM-DD when (born M/D/YY) is present
  years_pro: number | null;
  debut_year: number | null;
  hometown_billed: string | null;
  hometown_real: string | null;
  promotional_affiliation: string | null;
  other_ring_names: string | null;
  height_inches: number | null;
  weight_lbs: number | null;
  bio: string | null;
  /** PDF page number this entry was found on. */
  source_page: number;
  /** Anything we noticed but couldn't cleanly parse. */
  warnings: string[];
};

/**
 * Header line: WRESTLER NAME (FT-IN, LBS).
 * The OCR mangles this in many ways — leading smart-quotes that get doubled,
 * missing closing `)`, height-inches that come out as a letter (`j`/`l`/`i`/`o`)
 * because of small ½ glyphs and tight kerning. We accept all of that and let
 * downstream parsers normalize.
 */
const HEADER_RE =
  /^([\s"'“”]*[A-Z][A-Z0-9 ".'“”\-/&)]+?)\s*\(\s*(\d+)\s*[-–]\s*([\dljiIoOSjJ½]+(?:1\/2)?)\s*,\s*(\d+)?\s*\)?\s*$/;

/**
 * Managers and Valets (page ≥ 140) have no `(h, w)` header — just an all-caps
 * name line followed by prose. We capture them with this looser regex but
 * only on the late pages, to avoid grabbing photo captions or section titles
 * earlier in the book.
 */
const MANAGER_HEADER_RE = /^[\s"'“”]*([A-Z][A-Z0-9 ".'“”\-/&]{2,})\s*$/;

/**
 * Parse the height piece: "6", "10½", "10 1/2", "103" (OCR-mangled "10½"),
 * or "j" (OCR letter-for-digit). Returns inches in [0, 11] plus whether a
 * fraction marker was present.
 *
 * The 1986 print uses a tiny ½ glyph that tesseract reliably misreads as `3`
 * (sometimes `2`/`4`). So an inches value of 12-99 almost always means the
 * trailing digit is an OCR-mangled fraction; we strip it and warn.
 *
 * Common letter-for-digit substitutions in this PDF: l/I/i → 1, o/O → 0,
 * S → 5, j → 2, Z → 2, B → 8.
 */
function parseInchesPart(raw: string): { inches: number; fractional: boolean } {
  const fractional = /½|1\/2/.test(raw);
  const cleaned = raw
    .replace(/½|1\/2/, "")
    .replace(/[lIi]/g, "1")
    .replace(/[oO]/g, "0")
    .replace(/[sS]/g, "5")
    .replace(/[jJ]/g, "2")
    .replace(/Z/g, "2")
    .replace(/B/g, "8")
    .trim();
  let intPart = Number.parseInt(cleaned, 10);
  if (!Number.isFinite(intPart)) return { inches: 0, fractional };
  let normalized = false;
  if (intPart > 11) {
    // 103 → 10 (10½ mangled); 23 → 2 (2½ mangled); 113 → 11.
    const s = String(intPart);
    intPart = Number.parseInt(s.length === 3 ? s.slice(0, 2) : s.slice(0, 1), 10);
    normalized = true;
  }
  return { inches: intPart, fractional: fractional || normalized };
}

/**
 * Parse `(born M/D/YY)` into ISO YYYY-MM-DD.
 * 1986 anchor: YY ≥ 30 → 19YY (anyone wrestling in '86 was born well before 2030).
 */
export function parseBornDate(raw: string): string | null {
  const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const month = Number.parseInt(m[1], 10);
  const day = Number.parseInt(m[2], 10);
  let year = Number.parseInt(m[3], 10);
  if (year < 100) year = year >= 30 ? 1900 + year : 2000 + year;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parse "Hometown - City, State (now lives in Elsewhere)" — returns billed + real. */
export function parseHometown(value: string): { billed: string | null; real: string | null } {
  const m = value.match(/^(.+?)(?:\s*\(\s*now lives in\s+(.+?)\s*\))?$/i);
  if (!m) return { billed: value.trim() || null, real: null };
  return {
    billed: m[1].trim() || null,
    real: m[2]?.trim() ?? null,
  };
}

/**
 * Pull a labelled value from the field block. Returns null if not present.
 * `label` is the bare label like "Real name" — we match `^Label\s*[-:]\s*VALUE`.
 */
/** Canonical label order — used by `extractLabels` to know when one label ends and the next begins. */
const LABELS = [
  "Real name",
  "Age",
  "Years pro",
  "Hometown",
  "Promotional affiliation",
  "Other ring names",
] as const;
type LabelName = (typeof LABELS)[number];

const LABEL_LINE_RE = new RegExp(
  `^(${LABELS.map((l) => l.replace(/ /g, "\\s+")).join("|")})[ \\t]*[-:](.*)$`,
  "i",
);

/**
 * Heuristic test: does this line look like the start of bio prose?
 *  - 3+ lowercase tokens (any internal lowercase 2+ char word) → prose
 *  - WON ellipsis " . . . " → prose
 *  - Multi-word line ≥ 30 chars that doesn't start with a list-continuation
 *    char (`,` `"` `&` `(`) → prose
 */
function looksLikeBio(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (LABEL_LINE_RE.test(t)) return false;
  if (/^[,"&(]/.test(t)) return false; // list continuation, not bio
  const lowerWords = (t.match(/\b[a-z]{2,}\b/g) ?? []).length;
  if (lowerWords >= 3) return true;
  if (/\.\s+\.\s+\./.test(t)) return true;
  if (t.length >= 30 && /\s/.test(t)) return true;
  return false;
}

/**
 * Walk the lines after a header.
 *
 * The crucial subtlety: when an entry's header is mangled by OCR and the
 * regex fails to match it, this entry's slice extends into the *next* entry.
 * To avoid clobbering, we scan label-by-label and STOP the first time we see
 * a duplicate of an early label (Real name / Age / Years pro / Hometown) —
 * that's a strong signal that a new entry has started even though we didn't
 * match its header.
 */
function extractLabels(lines: string[]): { values: Record<string, string>; bioStartLine: number } {
  // Pass 1: find a "soft cap" — the first line that looks like the start of
  // a NEW entry whose header we missed (a duplicate Real name / Age / etc.).
  const seen = new Set<LabelName>();
  let softCap = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const m = ln.match(LABEL_LINE_RE);
    if (!m) continue;
    const canonical =
      LABELS.find((l) => l.toLowerCase() === m[1].replace(/\s+/g, " ").toLowerCase()) ?? null;
    if (!canonical) continue;
    if (seen.has(canonical) && (canonical === "Real name" || canonical === "Age")) {
      softCap = i;
      break;
    }
    seen.add(canonical);
  }

  // Pass 2: among the in-range label lines, find the LAST one and require
  // bio to come strictly after it.
  const labelLineIdxs: number[] = [];
  for (let i = 0; i < softCap; i++) {
    if (LABEL_LINE_RE.test(lines[i])) labelLineIdxs.push(i);
  }
  const lastLabelLineIdx = labelLineIdxs.length ? labelLineIdxs[labelLineIdxs.length - 1] : -1;

  let bioStart = softCap;
  for (let i = lastLabelLineIdx + 1; i < softCap; i++) {
    if (looksLikeBio(lines[i])) {
      bioStart = i;
      break;
    }
  }

  // Pass 3: collect each label's value within [0, bioStart). FIRST-OCCURRENCE
  // wins so a stray duplicate later in the slice doesn't overwrite.
  const values: Record<string, string> = {};
  let current: LabelName | null = null;
  for (let i = 0; i < bioStart; i++) {
    const ln = lines[i];
    const m = ln.match(LABEL_LINE_RE);
    if (m) {
      const matched = m[1].replace(/\s+/g, " ");
      const canonical = LABELS.find((l) => l.toLowerCase() === matched.toLowerCase()) ?? null;
      if (canonical) {
        current = canonical;
        if (!(canonical in values)) values[canonical] = m[2].trim();
        continue;
      }
    }
    if (current && ln.trim()) {
      values[current] = `${values[current]} ${ln.trim()}`.trim();
    }
  }

  return { values, bioStartLine: bioStart };
}

function valueOrNull(v: string | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!t || /^(none|unknown|n\/a)$/i.test(t)) return null;
  return t;
}

function pullInt(values: Record<string, string>, label: LabelName): number | null {
  const v = valueOrNull(values[label]);
  if (!v) return null;
  const m = v.match(/\d+/);
  if (!m) return null;
  const n = Number.parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
}

function pullAgeBorn(values: Record<string, string>): { age: number | null; born: string | null } {
  const v = values.Age ?? "";
  const ageMatch = v.match(/(\d+)/);
  const bornMatch = v.match(/born\s+([0-9]{1,2}[/\\][0-9]{1,2}[/\\][0-9]{2,4})/i);
  return {
    age: ageMatch ? Number.parseInt(ageMatch[1], 10) : null,
    born: bornMatch ? parseBornDate(bornMatch[1].replace(/\\/g, "/")) : null,
  };
}

/**
 * Find the start of the next entry by scanning lines for a header pattern.
 * Returns line indices where new entries begin, plus the parsed header fields.
 *
 * Two header shapes:
 *   1. Wrestler headers (most of the book) — `NAME (FT-IN, LBS)` plus a
 *      following label block. We require a label line to validate so we don't
 *      mistake all-caps photo captions for headers.
 *   2. Manager/valet headers (page ≥ 140) — just `NAME` on its own line, with
 *      no parenthetical and no label block. The bio is everything until the
 *      next manager header.
 */
function findEntryStarts(
  lines: string[],
  pageOfLine: number[],
): Array<{ lineIdx: number; m: RegExpMatchArray; kind: "wrestler" | "manager" }> {
  const starts: Array<{ lineIdx: number; m: RegExpMatchArray; kind: "wrestler" | "manager" }> = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const w = ln.match(HEADER_RE);
    if (w) {
      const peek = lines.slice(i + 1, i + 6).join("\n");
      if (/^(Real name|Age|Years pro|Hometown|Promotional)\b/im.test(peek)) {
        starts.push({ lineIdx: i, m: w, kind: "wrestler" });
        continue;
      }
    }
    if ((pageOfLine[i] ?? 0) >= 140) {
      const m = ln.match(MANAGER_HEADER_RE);
      if (!m) continue;
      const name = m[1].trim();
      // Reject ALL-CAPS prose fragments / photo captions: name should be 2-5
      // tokens, no fully-capitalized common words like "AND" or "WITH".
      const tokens = name.split(/\s+/);
      if (tokens.length < 1 || tokens.length > 6) continue;
      if (/\b(AND|WITH|VS|WHO|FROM|THE\b\s+\w+\s+\w+\s+\w+)\b/.test(` ${name} `)) continue;
      // The next non-blank line should be prose (i.e. lowercase letters
      // present), not another all-caps line.
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      if (j >= lines.length) continue;
      const next = lines[j];
      if (!/[a-z]/.test(next)) continue; // probably a photo caption header
      starts.push({ lineIdx: i, m, kind: "manager" });
    }
  }
  return starts;
}

/**
 * The OCR'd text uses form-feed characters (\f) between pages, with the page
 * number we tagged. This produces a list of `{ page, text }` pairs.
 */
export function splitByPage(ocrText: string): Array<{ page: number; text: string }> {
  // Convention: page markers look like "\f<<<PAGE 13>>>\n"
  const out: Array<{ page: number; text: string }> = [];
  const re = /<<<PAGE\s+(\d+)>>>/g;
  const indices: Array<{ page: number; idx: number }> = [];
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration
  while ((m = re.exec(ocrText)) !== null) {
    indices.push({ page: Number.parseInt(m[1], 10), idx: m.index });
  }
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i].idx;
    const end = i + 1 < indices.length ? indices[i + 1].idx : ocrText.length;
    out.push({ page: indices[i].page, text: ocrText.slice(start, end) });
  }
  return out;
}

/**
 * Parse the full OCR'd corpus by streaming across all page boundaries — this
 * matters because WON bios routinely span pages (e.g. Siva Afi's header is on
 * one page and the narrative continues on the next).
 *
 * The `<<<PAGE N>>>` markers are stripped from the lines a header is found on
 * but used to determine the source_page of each entry (the page where the
 * HEADER lives).
 */
export function parseCorpus(ocrText: string): ParsedEntry[] {
  const cleaned = preCleanOcr(ocrText);
  const rawLines = cleaned.split("\n");

  // Map each line to the page it belongs to (the most recent <<<PAGE N>>>
  // marker we've seen). The marker line itself is replaced with an empty
  // string so it can't accidentally match anything, but we keep the array
  // length stable so line indices line up with entry headers.
  const lines: string[] = [];
  const pageOfLine: number[] = [];
  let curPage = 0;
  for (const ln of rawLines) {
    const m = ln.match(/<<<PAGE\s+(\d+)>>>/);
    if (m) {
      curPage = Number.parseInt(m[1], 10);
      lines.push("");
      pageOfLine.push(curPage);
    } else {
      lines.push(ln);
      pageOfLine.push(curPage);
    }
  }

  const starts = findEntryStarts(lines, pageOfLine);
  const entries: ParsedEntry[] = [];
  for (let i = 0; i < starts.length; i++) {
    const startLine = starts[i].lineIdx;
    const endLine = i + 1 < starts.length ? starts[i + 1].lineIdx : lines.length;
    const slice = lines.slice(startLine, endLine).join("\n");
    const headerPage = pageOfLine[startLine] || 0;
    const entry =
      starts[i].kind === "manager"
        ? parseManagerEntry(slice, starts[i].m, headerPage)
        : parseEntryBlock(slice, starts[i].m, headerPage);
    if (entry) entries.push(entry);
  }
  return entries;
}

/** Parse a Managers/Valets-section entry: name + free-form bio, no labels. */
export function parseManagerEntry(
  block: string,
  headerMatch: RegExpMatchArray,
  pageNum: number,
): ParsedEntry | null {
  const ringName = headerMatch[1]
    .replace(/^\s*[\s"'“”]*[\s"'“”]\s*/, (m) => (/["'“”]/.test(m) ? '"' : ""))
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  const lines = block.split("\n").slice(1);
  const bio = lines.join("\n").trim() || null;
  return {
    primary_ring_name: ringName,
    legal_name: null,
    age: null,
    born_date: null,
    years_pro: null,
    debut_year: null,
    hometown_billed: null,
    hometown_real: null,
    promotional_affiliation: null,
    other_ring_names: null,
    height_inches: null,
    weight_lbs: null,
    bio,
    source_page: pageNum,
    warnings: ["manager_or_valet_no_labels"],
  };
}

/** @deprecated kept for backward-compat with older test helpers; prefer parseCorpus */
export function parsePage(pageText: string, pageNum: number): ParsedEntry[] {
  return parseCorpus(`<<<PAGE ${pageNum}>>>\n${pageText}`);
}

/**
 * Common OCR fixes that don't change semantic meaning:
 *  - Smart quotes → straight quotes
 *  - Normalize ` -` / ` —` etc. around field labels
 *  - Strip trailing column-sidebar dots
 */
function preCleanOcr(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[—–]/g, "-")
    .replace(/Hometown'/g, "Hometown")
    .replace(/Real Name/g, "Real name");
}

/** Parse a single entry's field block + bio. Returns null if header doesn't validate. */
export function parseEntryBlock(
  block: string,
  headerMatch: RegExpMatchArray,
  pageNum: number,
): ParsedEntry | null {
  const warnings: string[] = [];
  // Collapse OCR'd duplicate leading quotes (e.g. `“"  JUMPING"` → `"JUMPING"`)
  // but preserve a single leading quote on names like `"GENTLEMAN" CHRIS ADAMS`.
  const ringName = headerMatch[1]
    .replace(/^\s*[\s"'“”]*[\s"'“”]\s*/, (m) => (/["'“”]/.test(m) ? '"' : ""))
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  const heightFt = Number.parseInt(headerMatch[2], 10);
  const heightInPart = parseInchesPart(headerMatch[3]);
  if (heightInPart.fractional) warnings.push("fractional_height_truncated");
  const weight = headerMatch[4] ? Number.parseInt(headerMatch[4], 10) : NaN;

  // Drop the header line; everything after is labels + bio.
  const lines = block.split("\n").slice(1);
  const { values, bioStartLine } = extractLabels(lines);
  const bioLines = lines.slice(bioStartLine).join("\n").trim();

  const realName = valueOrNull(values["Real name"]);
  const { age, born } = pullAgeBorn(values);
  const yearsPro = pullInt(values, "Years pro");
  const hometownRaw = valueOrNull(values.Hometown);
  const promo = valueOrNull(values["Promotional affiliation"]);
  const otherRingNames = valueOrNull(values["Other ring names"]);

  const { billed, real } = hometownRaw ? parseHometown(hometownRaw) : { billed: null, real: null };

  // Cross-check born vs. age: if both present, age should be ≈ 1986 - bornYear.
  if (born && age) {
    const bornYear = Number.parseInt(born.slice(0, 4), 10);
    const expectedAge = 1986 - bornYear;
    if (Math.abs(expectedAge - age) > 1) {
      warnings.push(`age_born_mismatch:age=${age},born=${born}`);
    }
  }

  // Sanity ranges
  if (heightFt < 3 || heightFt > 8) warnings.push(`unusual_height_ft:${heightFt}`);
  if (heightInPart.inches < 0 || heightInPart.inches > 11)
    warnings.push(`unusual_height_in:${heightInPart.inches}`);
  if (weight < 80 || weight > 800) warnings.push(`unusual_weight:${weight}`);

  return {
    primary_ring_name: ringName,
    legal_name: realName,
    age,
    born_date: born,
    years_pro: yearsPro,
    debut_year: yearsPro != null ? 1986 - yearsPro : null,
    hometown_billed: billed,
    hometown_real: real,
    promotional_affiliation: promo,
    other_ring_names: otherRingNames,
    height_inches: heightFt * 12 + heightInPart.inches,
    weight_lbs: Number.isFinite(weight) ? weight : null,
    bio: bioLines || null,
    source_page: pageNum,
    warnings,
  };
}
