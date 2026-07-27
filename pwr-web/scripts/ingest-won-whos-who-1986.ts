#!/usr/bin/env tsx

/**
 * Ingest *The Wrestling Observer's Who's Who in Pro Wrestling* (Dave Meltzer, 1986)
 * into the local Wrestling Researcher app via its HTTP API.
 *
 * Usage:
 *   pnpm ingest:won-1986 --dry-run                     # parse only, write JSONL
 *   pnpm ingest:won-1986 --limit 10                    # ingest first 10 entries
 *   pnpm ingest:won-1986 --skip-runs                   # citations only
 *   pnpm ingest:won-1986                               # full ingest
 *
 * Flags:
 *   --pdf <path>       Path to the PDF (default: ~/Downloads/...)
 *   --base-url <url>   API base (default: http://wrestling-researcher.local:5150)
 *   --first-page <n>   First PDF page to scan (default: 13)
 *   --last-page  <n>   Last PDF page to scan  (default: 146)
 *   --refresh-ocr      Force re-OCR even if cache exists
 *   --limit <n>        Process only first N entries
 *   --dry-run          Parse + validate only; write JSONL, no HTTP calls
 *   --skip-runs        Don't insert 1986 territory_run rows
 *   --concurrency <n>  Parallel HTTP requests (default: 4)
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { wrestlerCreateSchema } from "@/lib/api/schemas";
import { ocrPdf } from "./won1986/ocr";
import { type ParsedEntry, parseCorpus } from "./won1986/parser";
import { resolvePromotion } from "./won1986/promo-map";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    pdf: { type: "string" },
    "base-url": { type: "string" },
    "first-page": { type: "string" },
    "last-page": { type: "string" },
    "refresh-ocr": { type: "boolean" },
    limit: { type: "string" },
    "dry-run": { type: "boolean" },
    "skip-runs": { type: "boolean" },
    concurrency: { type: "string" },
  },
  strict: true,
});

const PDF_PATH =
  values.pdf ?? path.join(os.homedir(), "Downloads/WON Who_s Who In Pro Wrestling (1986).pdf");
const BASE_URL = (values["base-url"] ?? "http://wrestling-researcher.local:5150").replace(
  /\/$/,
  "",
);
const FIRST_PAGE = Number.parseInt(values["first-page"] ?? "13", 10);
const LAST_PAGE = Number.parseInt(values["last-page"] ?? "146", 10);
const LIMIT = values.limit ? Number.parseInt(values.limit, 10) : Number.POSITIVE_INFINITY;
const DRY_RUN = !!values["dry-run"];
const SKIP_RUNS = !!values["skip-runs"];
const CONCURRENCY = values.concurrency ? Number.parseInt(values.concurrency, 10) : 4;
const REFRESH_OCR = !!values["refresh-ocr"];

const OUT_DIR = path.dirname(PDF_PATH);
const PARSED_JSONL = path.join(OUT_DIR, "won_1986_parsed.jsonl");
const WARN_LOG = path.join(OUT_DIR, "won_1986_warnings.log");

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

type Json = Record<string, unknown> | unknown[] | null;

type IdBody = { id: number };

async function http<T = unknown>(
  method: string,
  url: string,
  body?: Json,
): Promise<{ status: number; data: T | null }> {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: T | null = null;
  try {
    data = (await res.json()) as T;
  } catch {
    /* empty body is fine for some 4xx */
  }
  return { status: res.status, data };
}

/** Every endpoint used here answers a success with `{ id }`. Anything else is a bug, so stop. */
function requireId(res: { status: number; data: IdBody | null }, what: string): number {
  if (!res.data) throw new Error(`${what} returned ${res.status} with no JSON body`);
  return res.data.id;
}

async function findOrCreateBook(): Promise<number> {
  const params = new URLSearchParams({
    title: "The Wrestling Observer's Who's Who in Pro Wrestling",
    year: "1986",
  });
  const found = await http<IdBody>("GET", `${BASE_URL}/api/books?${params}`);
  if (found.status === 200) return requireId(found, "GET /api/books");
  const created = await http<IdBody>("POST", `${BASE_URL}/api/books`, {
    title: "The Wrestling Observer's Who's Who in Pro Wrestling",
    category_code: "reference",
    publisher: "Wrestling Observer Newsletter",
    year_published: 1986,
    country: "USA",
    language: "English",
    synopsis: "Annual reference book by Dave Meltzer profiling active pro wrestlers as of 11/1/86.",
    source_url: null,
  });
  if (created.status >= 400) {
    throw new Error(
      `Failed to create WON 1986 book: ${created.status} ${JSON.stringify(created.data)}`,
    );
  }
  return requireId(created, "POST /api/books");
}

const territoryCache = new Map<string, number | null>();
async function lookupTerritory(name: string): Promise<number | null> {
  if (territoryCache.has(name)) return territoryCache.get(name) ?? null;
  const res = await http<IdBody>(
    "GET",
    `${BASE_URL}/api/territories?name=${encodeURIComponent(name)}`,
  );
  const id = res.status === 200 ? (res.data?.id ?? null) : null;
  territoryCache.set(name, id);
  return id;
}

async function findOrCreateWrestler(payload: Record<string, unknown>): Promise<{
  id: number;
  created: boolean;
}> {
  const ringName = payload.primary_ring_name as string;
  const found = await http<IdBody>(
    "GET",
    `${BASE_URL}/api/wrestlers?ring_name=${encodeURIComponent(ringName)}`,
  );
  if (found.status === 200) {
    const id = requireId(found, `GET /api/wrestlers?ring_name=${ringName}`);
    const patchBody = { ...payload };
    delete (patchBody as Record<string, unknown>).primary_ring_name;
    delete (patchBody as Record<string, unknown>).midcard_files_status;
    await http("PATCH", `${BASE_URL}/api/wrestlers/${id}`, patchBody);
    return { id, created: false };
  }
  const created = await http<IdBody>("POST", `${BASE_URL}/api/wrestlers`, payload);
  if (created.status >= 400) {
    throw new Error(
      `Failed to create wrestler ${ringName}: ${created.status} ${JSON.stringify(created.data)}`,
    );
  }
  return { id: requireId(created, "POST /api/wrestlers"), created: true };
}

// ---------------------------------------------------------------------------
// Build the create-payload from a parsed entry. Validate with the same zod
// schema the API uses.
// ---------------------------------------------------------------------------

function buildPayload(entry: ParsedEntry, role: "wrestler" | "manager" | "valet") {
  const livedSeparate =
    entry.hometown_real && entry.hometown_billed && entry.hometown_real !== entry.hometown_billed;
  const raw = {
    primary_ring_name: entry.primary_ring_name,
    legal_name: entry.legal_name,
    other_ring_names: entry.other_ring_names,
    born_date: entry.born_date,
    debut_year: entry.debut_year,
    primary_role: role,
    hometown_billed: entry.hometown_billed,
    hometown_real: livedSeparate ? entry.hometown_real : null,
    height_inches: entry.height_inches,
    weight_lbs: entry.weight_lbs,
    bio: entry.bio,
  };
  return wrestlerCreateSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// Concurrency-limited map
// ---------------------------------------------------------------------------

async function pMap<T, R>(
  items: T[],
  n: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`[won-1986] PDF: ${PDF_PATH}`);
  console.log(`[won-1986] Pages ${FIRST_PAGE}–${LAST_PAGE}`);
  console.log(`[won-1986] Mode: ${DRY_RUN ? "DRY-RUN (no HTTP)" : `live → ${BASE_URL}`}`);

  // 1. OCR (cached)
  console.log(`[won-1986] OCR…`);
  const ocrText = await ocrPdf({
    pdfPath: PDF_PATH,
    firstPage: FIRST_PAGE,
    lastPage: LAST_PAGE,
    refresh: REFRESH_OCR,
    onProgress: ({ page, total, elapsedMs }) => {
      if (page % 10 === 0 || page === FIRST_PAGE + total - 1) {
        const rate = ((page - FIRST_PAGE + 1) / (elapsedMs / 1000)).toFixed(2);
        process.stdout.write(`  page ${page} (${rate} pages/s)\n`);
      }
    },
  });
  console.log(`[won-1986] OCR text: ${ocrText.length} chars`);

  // 2. Parse
  let entries = parseCorpus(ocrText);
  console.log(`[won-1986] Parsed ${entries.length} entries`);

  if (Number.isFinite(LIMIT)) entries = entries.slice(0, LIMIT);

  // 3. Write JSONL + warnings (always)
  const jsonl = `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;
  await fs.writeFile(PARSED_JSONL, jsonl, "utf8");

  const warnings: string[] = [];
  for (const e of entries) {
    for (const w of e.warnings) {
      warnings.push(`p${e.source_page} ${e.primary_ring_name}: ${w}`);
    }
  }
  await fs.writeFile(WARN_LOG, `${warnings.join("\n")}\n`, "utf8");
  console.log(`[won-1986] Wrote ${PARSED_JSONL}`);
  console.log(`[won-1986] Wrote ${WARN_LOG} (${warnings.length} warnings)`);

  if (DRY_RUN) {
    console.log("[won-1986] dry-run done; no HTTP calls made.");
    return;
  }

  // 4. Find/create the WON 1986 book
  const bookId = await findOrCreateBook();
  console.log(`[won-1986] WON 1986 book id: ${bookId}`);

  // 5. Ingest entries
  const stats = { created: 0, updated: 0, citations: 0, runs: 0, runsSkipped: 0, errors: 0 };

  await pMap(entries, CONCURRENCY, async (entry, i) => {
    try {
      // Heuristic: anything found on page ≥ 140 is a manager/valet.
      const role: "wrestler" | "manager" | "valet" =
        entry.source_page >= 140 ? "manager" : "wrestler";
      const payload = buildPayload(entry, role);
      const { id, created } = await findOrCreateWrestler(
        payload as unknown as Record<string, unknown>,
      );
      if (created) stats.created++;
      else stats.updated++;

      // Citation
      const excerpt = entry.bio ? entry.bio.slice(0, 280) : null;
      await http("POST", `${BASE_URL}/api/wrestlers/${id}/citations`, {
        book_id: bookId,
        page: String(entry.source_page),
        excerpt,
      });
      stats.citations++;

      // 1986 territory run
      if (!SKIP_RUNS && entry.promotional_affiliation) {
        const territoryName = resolvePromotion(entry.promotional_affiliation);
        if (!territoryName) {
          stats.runsSkipped++;
          warnings.push(
            `p${entry.source_page} ${entry.primary_ring_name}: unmapped promo "${entry.promotional_affiliation}"`,
          );
        } else {
          const tid = await lookupTerritory(territoryName);
          if (tid == null) {
            stats.runsSkipped++;
            warnings.push(
              `p${entry.source_page} ${entry.primary_ring_name}: territory "${territoryName}" not found`,
            );
          } else {
            await http("POST", `${BASE_URL}/api/wrestlers/${id}/runs`, {
              territory_id: tid,
              start_year: 1986,
              end_year: null,
              ring_name_during_run: entry.primary_ring_name,
              primary_run: true,
              notes: "Affiliation per WON Who's Who, 11/1/1986",
            });
            stats.runs++;
          }
        }
      }
    } catch (err) {
      stats.errors++;
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`p${entry.source_page} ${entry.primary_ring_name}: ERROR ${msg}`);
    }
    if ((i + 1) % 25 === 0) {
      process.stdout.write(`  ${i + 1}/${entries.length} processed\n`);
    }
  });

  // Re-write warnings (we appended during the run)
  await fs.writeFile(WARN_LOG, `${warnings.join("\n")}\n`, "utf8");

  console.log(`[won-1986] Done.`);
  console.log(
    `  created=${stats.created} updated=${stats.updated} citations=${stats.citations} runs=${stats.runs} runs_skipped=${stats.runsSkipped} errors=${stats.errors}`,
  );
}

main().catch((err) => {
  console.error("[won-1986] FATAL", err);
  process.exit(1);
});
