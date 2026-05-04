/**
 * pwr-research MCP — Code Mode API surface.
 *
 * Inside `execute_code` your script is wrapped as `(async (pwr, console) => { ... })`.
 * Every method on `pwr` is RPC-marshalled back to the host. The body of your script
 * may use top-level `await`, `return`, and `console.log`. The default return value
 * shape is `{ returnValue, stdout, stderr, rpcCalls, durationMs, rolledBack }`.
 *
 * Pass `dryRun: true` on execute_code to wrap every DB write in a transaction that
 * is rolled back at the end — useful for previewing a merge before committing.
 */

export type WrestlerRow = {
  id: number;
  primary_ring_name: string;
};

export type WrestlerInput = {
  primary_ring_name: string;
  legal_name: string | null;
  other_ring_names: string | null;
  born_date: string | null;
  died_date: string | null;
  living: boolean | null;
  debut_year: number | null;
  retired_year: number | null;
  primary_role: string | null;
  hometown_billed: string | null;
  hometown_real: string | null;
  finisher: string | null;
  style: string | null;
  socials: string | null;
  convention_status: string | null;
  last_known_appearance: string | null;
  footage_notes: string | null;
  midcard_files_status: string;
  midcard_files_priority: number | null;
  why_they_mattered: string | null;
  notes: string | null;
  height_inches: number | null;
  weight_lbs: number | null;
  bio: string | null;
  /** When promoting a pending row, set this to the pending_wrestlers.id; the host
   *  will repoint ranking_entries automatically. */
  fromPending: number | null;
};

export type WrestlerPatch = Partial<Omit<WrestlerInput, "fromPending" | "midcard_files_status">>;

export type MergeWrestlersResult = {
  survivorId: number;
  duplicateId: number;
  fieldsFilled: number;
  repointed: { table: string; rows: number }[];
  duplicateDeleted: boolean;
};

export type DuplicateCandidate = {
  id: number;
  primary_ring_name: string;
  /** Indel-ratio WRatio approximation, 0-100. */
  score: number;
};

export type BookInput = {
  title: string;
  subtitle: string | null;
  category_code: string;
  publisher: string | null;
  year_published: number | null;
  isbn10: string | null;
  isbn13: string | null;
  pages: number | null;
  format: string | null;
  language: string;
  country: string | null;
  subject_wrestler: string | null;
  era: string | null;
  territory_or_promotion: string | null;
  synopsis: string | null;
  source_url: string | null;
  confidence: "low" | "low_searched" | "medium" | "medium_search" | "high";
  authorNames: string[];
  authorsAreWrestlers: boolean;
};

export type MergeBooksResult = {
  targetId: number;
  duplicateId: number;
  authorsCopied: number;
  fieldsFilled: number;
};

export type TerritoryInput = {
  name: string;
  short_name: string | null;
  region: string | null;
  nwa_member: boolean;
  headquarters_city: string | null;
  headquarters_state: string | null;
  year_founded: number | null;
  year_closed: number | null;
  promoter_lineage: string | null;
  notes: string | null;
};

export type TerritoryUpsertInput = {
  cagematch_id: string;
  name: string;
  country: string | null;
  headquarters_city: string | null;
  headquarters_state: string | null;
  year_founded: number | null;
  year_closed: number | null;
  notes: string | null;
};

export type TerritoryUpsertResult = {
  status: "inserted" | "matched" | "skipped";
  id: number;
};

export type PendingWrestlerRow = {
  id: number;
  printed_name: string;
  normalized_name: string;
  profightdb_id: number | null;
  occurrence_count: number;
  resolved_wrestler_id: number | null;
};

export type ResolveResult = {
  pendingId: number;
  wrestlerId: number;
  rankingEntriesBackfilled: number;
};

export interface PwrApi {
  wrestlers: {
    findByRingName(name: string): Promise<WrestlerRow | null>;
    add(input: WrestlerInput): Promise<{ id: number; rankingEntriesBackfilled: number }>;
    patchFillBlanks(id: number, patch: WrestlerPatch): Promise<number>;
    mergeInto(survivorId: number, duplicateId: number): Promise<MergeWrestlersResult>;
    findDuplicateCandidates(
      id: number,
      opts?: { threshold?: number; limit?: number },
    ): Promise<DuplicateCandidate[]>;
  };
  books: {
    add(input: BookInput): Promise<number>;
    findByTitleYear(
      title: string,
      year: number | null,
    ): Promise<{ id: number; title: string; year_published: number | null } | null>;
    merge(targetId: number, duplicateId: number): Promise<MergeBooksResult>;
  };
  territories: {
    add(input: TerritoryInput): Promise<number>;
    upsertByCagematch(input: TerritoryUpsertInput): Promise<TerritoryUpsertResult>;
  };
  pendingWrestlers: {
    list(opts?: { resolved?: boolean; limit?: number }): Promise<PendingWrestlerRow[]>;
    resolveTo(pendingId: number, wrestlerId: number): Promise<ResolveResult>;
    promote(pendingId: number): Promise<{
      pendingId: number;
      wrestlerId: number;
      rankingEntriesBackfilled: number;
    }>;
  };
  dedup: {
    /** NFKD-fold + lowercase + strip ["'`.,!?] + collapse whitespace. */
    normalizeName(s: string): Promise<string>;
    /** Indel-ratio-based WRatio approximation. 100 = identical (after normalization). */
    fuzzy(a: string, b: string): Promise<number>;
  };
  audit: {
    /** Without `table`: returns recent mcp_audit_log rows. With a whitelisted
     *  `table`: returns recent rows from that table. */
    recent(opts?: { table?: string; limit?: number }): Promise<unknown[]>;
  };
}
