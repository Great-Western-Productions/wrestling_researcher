/**
 * String similarity primitives ported from `bibliography/ingest_pwi_profightdb.py`.
 *
 * `normalizeName` mirrors the Python helper's NFKD-fold + punctuation-strip rules
 * so the TS dedup queue produces the same blocking key as the Python ingest.
 * `fuzzy` is an Indel-ratio-based WRatio approximation (RapidFuzz uses Indel by
 * default); it composes ratio / partial / token-sort / token-set scores and
 * returns the max.
 */

const STRIP_PUNCT = /["'`.,!?]/g;
const COMBINING_MARKS = /\p{Mn}+/gu;
const WHITESPACE_RUN = /\s+/g;

export function normalizeName(s: string): string {
  const folded = s.normalize("NFKD").replace(COMBINING_MARKS, "");
  let n = folded.toLowerCase().trim();
  n = n.replace(STRIP_PUNCT, "");
  n = n.replace(WHITESPACE_RUN, " ");
  return n;
}

function lcsLength(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;
  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      if (ca === b.charCodeAt(j - 1)) curr[j] = prev[j - 1] + 1;
      else curr[j] = prev[j] > curr[j - 1] ? prev[j] : curr[j - 1];
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
    curr.fill(0);
  }
  return prev[n];
}

function indelRatio(a: string, b: string): number {
  const total = a.length + b.length;
  if (total === 0) return 100;
  return Math.round(((2 * lcsLength(a, b)) / total) * 100);
}

function partialRatio(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length === longer.length) return indelRatio(shorter, longer);
  let best = 0;
  const span = shorter.length;
  for (let i = 0; i + span <= longer.length; i++) {
    const r = indelRatio(shorter, longer.slice(i, i + span));
    if (r > best) best = r;
    if (best === 100) break;
  }
  return best;
}

function tokens(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

function tokenSortRatio(a: string, b: string): number {
  const sa = tokens(a).sort().join(" ");
  const sb = tokens(b).sort().join(" ");
  return indelRatio(sa, sb);
}

function tokenSetRatio(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  const inter: string[] = [];
  const onlyA: string[] = [];
  const onlyB: string[] = [];
  for (const t of ta) (tb.has(t) ? inter : onlyA).push(t);
  for (const t of tb) if (!ta.has(t)) onlyB.push(t);
  inter.sort();
  onlyA.sort();
  onlyB.sort();
  const t1 = inter.join(" ");
  const t2 = [...inter, ...onlyA].join(" ").trim();
  const t3 = [...inter, ...onlyB].join(" ").trim();
  return Math.max(indelRatio(t1, t2), indelRatio(t1, t3), indelRatio(t2, t3));
}

export function fuzzy(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 100;
  return Math.max(
    indelRatio(na, nb),
    partialRatio(na, nb),
    tokenSortRatio(na, nb),
    tokenSetRatio(na, nb),
  );
}
