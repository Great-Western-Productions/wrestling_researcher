import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  pgView,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const confidenceLevel = pgEnum("confidence_level", [
  "low",
  "low_searched",
  "medium",
  "medium_search",
  "high",
]);
export type Confidence = (typeof confidenceLevel.enumValues)[number];

export const reign_participants = pgTable(
  "reign_participants",
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity({
      name: "reign_participants_id_seq",
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    reign_id: integer().notNull(),
    wrestler_id: integer().notNull(),
    position: integer().notNull(),
    ring_name_used: text(),
  },
  (table) => [
    index("idx_reign_participants_reign").using("btree", table.reign_id.asc().nullsLast()),
    index("idx_reign_participants_wrestler").using("btree", table.wrestler_id.asc().nullsLast()),
    foreignKey({
      columns: [table.reign_id],
      foreignColumns: [reigns.id],
      name: "reign_participants_reign_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.wrestler_id],
      foreignColumns: [wrestlers.id],
      name: "reign_participants_wrestler_id_fkey",
    }).onDelete("cascade"),
    unique("reign_participants_reign_id_wrestler_id_key").on(table.reign_id, table.wrestler_id),
    unique("reign_participants_reign_id_position_key").on(table.reign_id, table.position),
  ],
);

export const research_sources = pgTable(
  "research_sources",
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity({
      name: "research_sources_id_seq",
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    url: text().notNull(),
    description: text(),
    consulted_at: timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`),
    notes: text(),
  },
  (table) => [uniqueIndex("research_sources_url_key").using("btree", table.url.asc().nullsLast())],
);

export const authors = pgTable(
  "authors",
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity({
      name: "authors_id_seq",
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    name: text().notNull(),
    ring_name: text(),
    is_wrestler: boolean().default(false),
    notes: text(),
  },
  (table) => [uniqueIndex("authors_name_key").using("btree", table.name.asc().nullsLast())],
);

export const books = pgTable(
  "books",
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity({
      name: "books_id_seq",
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    title: text().notNull(),
    subtitle: text(),
    category_code: text().notNull(),
    publisher: text(),
    year_published: integer(),
    isbn10: text(),
    isbn13: text(),
    pages: integer(),
    format: text(),
    language: text().default("English"),
    country: text(),
    subject_wrestler: text(),
    era: text(),
    territory_or_promotion: text(),
    synopsis: text(),
    source_url: text(),
    confidence: confidenceLevel().default("medium"),
    primary_source_value: text(),
    created_at: timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`),
    updated_at: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex("books_title_year_published_isbn13_key").using(
      "btree",
      table.title.asc().nullsLast(),
      table.year_published.asc().nullsLast(),
      table.isbn13.asc().nullsLast(),
    ),
    index("idx_books_category").using("btree", table.category_code.asc().nullsLast()),
    index("idx_books_country").using("btree", table.country.asc().nullsLast()),
    index("idx_books_subject").using("btree", table.subject_wrestler.asc().nullsLast()),
    index("idx_books_year").using("btree", table.year_published.asc().nullsLast()),
    foreignKey({
      columns: [table.category_code],
      foreignColumns: [categories.code],
      name: "books_fk_0",
    }),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity({
      name: "categories_id_seq",
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    code: text().notNull(),
    label: text().notNull(),
    description: text(),
  },
  (table) => [unique("categories_code_key").on(table.code)],
);

export const wrestlers = pgTable(
  "wrestlers",
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity({
      name: "wrestlers_id_seq",
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    legal_name: text(),
    primary_ring_name: text().notNull(),
    other_ring_names: text(),
    born_date: text(),
    died_date: text(),
    living: boolean(),
    debut_year: integer(),
    retired_year: integer(),
    primary_role: text(),
    hometown_billed: text(),
    hometown_real: text(),
    finisher: text(),
    style: text(),
    socials: text(),
    convention_status: text(),
    last_known_appearance: text(),
    footage_notes: text(),
    midcard_files_status: text(),
    midcard_files_priority: integer(),
    why_they_mattered: text(),
    notes: text(),
    height_inches: integer(),
    weight_lbs: integer(),
    bio: text(),
    created_at: timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`),
    updated_at: timestamp({ withTimezone: true }),
    cagematch_id: text(),
    cagematch_url: text().generatedAlwaysAs(sql`
CASE
    WHEN ((cagematch_id IS NOT NULL) AND (cagematch_id <> ''::text)) THEN ('https://www.cagematch.net/?id=2&nr='::text || cagematch_id)
    ELSE NULL::text
END`),
  },
  (table) => [
    index("idx_wrestlers_cm").using("btree", table.cagematch_id.asc().nullsLast()),
    index("idx_wrestlers_living").using("btree", table.living.asc().nullsLast()),
    index("idx_wrestlers_midcard").using("btree", table.midcard_files_status.asc().nullsLast()),
  ],
);

export const faction_members = pgTable(
  "faction_members",
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity({
      name: "faction_members_id_seq",
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    faction_id: integer().notNull(),
    wrestler_id: integer().notNull(),
    role: text(),
    joined_year: integer(),
    left_year: integer(),
    notes: text(),
    created_at: timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`),
    updated_at: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex("faction_members_faction_id_wrestler_id_joined_year_key").using(
      "btree",
      table.faction_id.asc().nullsLast(),
      table.wrestler_id.asc().nullsLast(),
      table.joined_year.asc().nullsLast(),
    ),
    index("idx_faction_members_faction").using("btree", table.faction_id.asc().nullsLast()),
    index("idx_faction_members_wrestler").using("btree", table.wrestler_id.asc().nullsLast()),
    foreignKey({
      columns: [table.wrestler_id],
      foreignColumns: [wrestlers.id],
      name: "faction_members_fk_0",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.faction_id],
      foreignColumns: [factions.id],
      name: "faction_members_fk_1",
    }).onDelete("cascade"),
  ],
);

export const factions = pgTable(
  "factions",
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity({
      name: "factions_id_seq",
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    name: text().notNull(),
    type: text().notNull(),
    formed_year: integer(),
    disbanded_year: integer(),
    primary_territory_id: integer(),
    notes: text(),
    confidence: confidenceLevel().default("medium"),
    source_url: text(),
    created_at: timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`),
    updated_at: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex("factions_name_formed_year_key").using(
      "btree",
      table.name.asc().nullsLast(),
      table.formed_year.asc().nullsLast(),
    ),
    index("idx_factions_name").using("btree", table.name.asc().nullsLast()),
    index("idx_factions_type").using("btree", table.type.asc().nullsLast()),
    foreignKey({
      columns: [table.primary_territory_id],
      foreignColumns: [territories.id],
      name: "factions_fk_0",
    }),
  ],
);

export const territories = pgTable(
  "territories",
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity({
      name: "territories_id_seq",
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    name: text().notNull(),
    short_name: text(),
    region: text(),
    nwa_member: boolean().default(false),
    headquarters_city: text(),
    headquarters_state: text(),
    year_founded: integer(),
    year_closed: integer(),
    promoter_lineage: text(),
    notes: text(),
    created_at: timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`),
    updated_at: timestamp({ withTimezone: true }),
    cagematch_id: text(),
    country: text(),
    aliases: text(),
    cagematch_url: text().generatedAlwaysAs(sql`
CASE
    WHEN ((cagematch_id IS NOT NULL) AND (cagematch_id <> ''::text)) THEN ('https://www.cagematch.net/?id=8&nr='::text || cagematch_id)
    ELSE NULL::text
END`),
  },
  (table) => [
    index("idx_territories_cm").using("btree", table.cagematch_id.asc().nullsLast()),
    index("idx_territories_country").using("btree", table.country.asc().nullsLast()),
    index("idx_territories_region").using("btree", table.region.asc().nullsLast()),
    uniqueIndex("territories_name_key").using("btree", table.name.asc().nullsLast()),
  ],
);

export const issue_cover_subjects = pgTable(
  "issue_cover_subjects",
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity({
      name: "issue_cover_subjects_id_seq",
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    issue_id: integer().notNull(),
    wrestler_id: integer(),
    faction_id: integer(),
    subject_name: text(),
    position: text(),
    notes: text(),
    created_at: timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`),
    updated_at: timestamp({ withTimezone: true }),
  },
  (table) => [
    index("idx_cover_subjects_faction").using("btree", table.faction_id.asc().nullsLast()),
    index("idx_cover_subjects_issue").using("btree", table.issue_id.asc().nullsLast()),
    index("idx_cover_subjects_wrestler").using("btree", table.wrestler_id.asc().nullsLast()),
    foreignKey({
      columns: [table.faction_id],
      foreignColumns: [factions.id],
      name: "issue_cover_subjects_fk_0",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.wrestler_id],
      foreignColumns: [wrestlers.id],
      name: "issue_cover_subjects_fk_1",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.issue_id],
      foreignColumns: [periodical_issues.id],
      name: "issue_cover_subjects_fk_2",
    }).onDelete("cascade"),
  ],
);

export const periodical_issues = pgTable(
  "periodical_issues",
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity({
      name: "periodical_issues_id_seq",
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    periodical_id: integer().notNull(),
    publication_date: date().notNull(),
    period_date: date(),
    issue_number: text(),
    volume: integer(),
    cover_image_url: text(),
    cover_description: text(),
    cover_story: text(),
    profightdb_id: integer(),
    drive_pdf_path: text(),
    in_collection: boolean().default(false),
    source_url: text(),
    confidence: confidenceLevel().default("medium"),
    notes: text(),
    created_at: timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`),
    updated_at: timestamp({ withTimezone: true }),
  },
  (table) => [
    index("idx_issues_periodical_date").using(
      "btree",
      table.periodical_id.asc().nullsLast(),
      table.publication_date.asc().nullsLast(),
    ),
    index("idx_issues_profightdb").using("btree", table.profightdb_id.asc().nullsLast()),
    uniqueIndex("periodical_issues_periodical_id_profightdb_id_key").using(
      "btree",
      table.periodical_id.asc().nullsLast(),
      table.profightdb_id.asc().nullsLast(),
    ),
    uniqueIndex("periodical_issues_periodical_id_publication_date_key").using(
      "btree",
      table.periodical_id.asc().nullsLast(),
      table.publication_date.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.periodical_id],
      foreignColumns: [periodicals.id],
      name: "periodical_issues_fk_0",
    }).onDelete("cascade"),
  ],
);

export const pending_wrestlers = pgTable(
  "pending_wrestlers",
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity({
      name: "pending_wrestlers_id_seq",
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    profightdb_id: integer(),
    profightdb_slug: text(),
    printed_name: text().notNull(),
    normalized_name: text().notNull(),
    other_printed_names: text(),
    first_seen_date: date(),
    last_seen_date: date(),
    occurrence_count: integer().default(1).notNull(),
    resolved_wrestler_id: integer(),
    notes: text(),
    created_at: timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`),
    updated_at: timestamp({ withTimezone: true }),
  },
  (table) => [
    index("idx_pending_wrestlers_count").using("btree", table.occurrence_count.asc().nullsLast()),
    index("idx_pending_wrestlers_pfdb").using("btree", table.profightdb_id.asc().nullsLast()),
    index("idx_pending_wrestlers_resolved").using(
      "btree",
      table.resolved_wrestler_id.asc().nullsLast(),
    ),
    uniqueIndex("pending_wrestlers_normalized_name_key").using(
      "btree",
      table.normalized_name.asc().nullsLast(),
    ),
    uniqueIndex("pending_wrestlers_profightdb_id_key").using(
      "btree",
      table.profightdb_id.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.resolved_wrestler_id],
      foreignColumns: [wrestlers.id],
      name: "pending_wrestlers_fk_0",
    }).onDelete("set null"),
  ],
);

export const periodicals = pgTable(
  "periodicals",
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity({
      name: "periodicals_id_seq",
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    title: text().notNull(),
    publisher: text(),
    country: text(),
    language: text().default("English"),
    year_started: integer(),
    year_ended: integer(),
    frequency: text(),
    type: text(),
    parent_company: text(),
    notes: text(),
    issue_count_known: integer(),
    archive_in_collection: boolean().default(false),
    source_url: text(),
    confidence: confidenceLevel().default("medium"),
    created_at: timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`),
    updated_at: timestamp({ withTimezone: true }),
  },
  (table) => [
    index("idx_periodicals_country").using("btree", table.country.asc().nullsLast()),
    uniqueIndex("periodicals_title_year_started_key").using(
      "btree",
      table.title.asc().nullsLast(),
      table.year_started.asc().nullsLast(),
    ),
  ],
);

export const ranking_entries = pgTable(
  "ranking_entries",
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity({
      name: "ranking_entries_id_seq",
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    ranking_list_id: integer().notNull(),
    rank: integer().notNull(),
    wrestler_id: integer(),
    faction_id: integer(),
    entry_name: text().notNull(),
    previous_rank: integer(),
    notes: text(),
    created_at: timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`),
    updated_at: timestamp({ withTimezone: true }),
    pending_wrestler_id: integer(),
  },
  (table) => [
    index("idx_ranking_entries_faction").using("btree", table.faction_id.asc().nullsLast()),
    index("idx_ranking_entries_list").using("btree", table.ranking_list_id.asc().nullsLast()),
    index("idx_ranking_entries_name").using("btree", table.entry_name.asc().nullsLast()),
    index("idx_ranking_entries_pending").using(
      "btree",
      table.pending_wrestler_id.asc().nullsLast(),
    ),
    index("idx_ranking_entries_wrestler").using("btree", table.wrestler_id.asc().nullsLast()),
    uniqueIndex("ranking_entries_ranking_list_id_rank_key").using(
      "btree",
      table.ranking_list_id.asc().nullsLast(),
      table.rank.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.pending_wrestler_id],
      foreignColumns: [pending_wrestlers.id],
      name: "ranking_entries_fk_0",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.faction_id],
      foreignColumns: [factions.id],
      name: "ranking_entries_fk_1",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.wrestler_id],
      foreignColumns: [wrestlers.id],
      name: "ranking_entries_fk_2",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.ranking_list_id],
      foreignColumns: [ranking_lists.id],
      name: "ranking_entries_fk_3",
    }).onDelete("cascade"),
  ],
);

export const ranking_lists = pgTable(
  "ranking_lists",
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity({
      name: "ranking_lists_id_seq",
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    issue_id: integer().notNull(),
    list_label: text().notNull(),
    list_scope: text().notNull(),
    territory_id: integer(),
    list_size: integer(),
    source_url: text(),
    notes: text(),
    created_at: timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`),
    updated_at: timestamp({ withTimezone: true }),
  },
  (table) => [
    index("idx_ranking_lists_issue").using("btree", table.issue_id.asc().nullsLast()),
    index("idx_ranking_lists_scope").using("btree", table.list_scope.asc().nullsLast()),
    index("idx_ranking_lists_territory").using("btree", table.territory_id.asc().nullsLast()),
    uniqueIndex("ranking_lists_issue_id_list_label_key").using(
      "btree",
      table.issue_id.asc().nullsLast(),
      table.list_label.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.territory_id],
      foreignColumns: [territories.id],
      name: "ranking_lists_fk_0",
    }),
    foreignKey({
      columns: [table.issue_id],
      foreignColumns: [periodical_issues.id],
      name: "ranking_lists_fk_1",
    }).onDelete("cascade"),
  ],
);

export const wrestler_book_citations = pgTable(
  "wrestler_book_citations",
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity({
      name: "wrestler_book_citations_id_seq",
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    wrestler_id: integer().notNull(),
    book_id: integer().notNull(),
    page: text(),
    excerpt: text(),
    created_at: timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_wbc_wrestler").using("btree", table.wrestler_id.asc().nullsLast()),
    index("idx_wbc_book").using("btree", table.book_id.asc().nullsLast()),
    uniqueIndex("uq_wbc_wrestler_book_page").using(
      "btree",
      table.wrestler_id.asc().nullsLast(),
      table.book_id.asc().nullsLast(),
      table.page.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.wrestler_id],
      foreignColumns: [wrestlers.id],
      name: "wrestler_book_citations_wrestler_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.book_id],
      foreignColumns: [books.id],
      name: "wrestler_book_citations_book_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const wrestler_territory_runs = pgTable(
  "wrestler_territory_runs",
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity({
      name: "wrestler_territory_runs_id_seq",
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    wrestler_id: integer().notNull(),
    territory_id: integer().notNull(),
    start_year: integer(),
    start_month: integer(),
    end_year: integer(),
    end_month: integer(),
    role_during_run: text(),
    ring_name_during_run: text(),
    primary_run: boolean().default(false),
    notes: text(),
  },
  (table) => [
    index("idx_wt_runs_territory").using("btree", table.territory_id.asc().nullsLast()),
    index("idx_wt_runs_wrestler").using("btree", table.wrestler_id.asc().nullsLast()),
    foreignKey({
      columns: [table.territory_id],
      foreignColumns: [territories.id],
      name: "wrestler_territory_runs_fk_0",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.wrestler_id],
      foreignColumns: [wrestlers.id],
      name: "wrestler_territory_runs_fk_1",
    }).onDelete("cascade"),
  ],
);

export const reigns = pgTable(
  "reigns",
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity({
      name: "reigns_id_seq",
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    title_id: integer().notNull(),
    wrestler_id: integer(),
    is_vacancy: boolean().default(false).notNull(),
    sequence_order: integer().notNull(),
    reign_number: integer(),
    reign_number_for_wrestler: integer(),
    start_date: text(),
    end_date: text(),
    start_date_precision: text(),
    end_date_precision: text(),
    duration_days: integer(),
    won_in_city: text(),
    won_in_state: text(),
    won_in_country: text(),
    source_url: text(),
    notes: text(),
    created_at: timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`),
    updated_at: timestamp({ withTimezone: true }),
    team_name: text(),
  },
  (table) => [
    index("idx_reigns_start").using("btree", table.start_date.asc().nullsLast()),
    index("idx_reigns_title").using("btree", table.title_id.asc().nullsLast()),
    index("idx_reigns_vacancy").using("btree", table.is_vacancy.asc().nullsLast()),
    index("idx_reigns_wrestler").using("btree", table.wrestler_id.asc().nullsLast()),
    foreignKey({
      columns: [table.title_id],
      foreignColumns: [titles.id],
      name: "reigns_title_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.wrestler_id],
      foreignColumns: [wrestlers.id],
      name: "reigns_wrestler_id_fkey",
    }).onDelete("set null"),
    unique("reigns_title_id_sequence_order_key").on(table.title_id, table.sequence_order),
    check("reigns_check", sql`(is_vacancy = false) OR (wrestler_id IS NULL)`),
  ],
);

export const titles = pgTable(
  "titles",
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity({
      name: "titles_id_seq",
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    name: text().notNull(),
    status: text(),
    title_type: text(),
    weight_class: text(),
    territory_id: integer(),
    promotion_name: text(),
    inception_date: text(),
    retired_date: text(),
    cagematch_id: text(),
    cagematch_url: text().generatedAlwaysAs(sql`
CASE
    WHEN ((cagematch_id IS NOT NULL) AND (cagematch_id <> ''::text)) THEN ('https://www.cagematch.net/?id=5&nr='::text || cagematch_id)
    ELSE NULL::text
END`),
    notes: text(),
    created_at: timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`),
    updated_at: timestamp({ withTimezone: true }),
  },
  (table) => [
    index("idx_titles_cm").using("btree", table.cagematch_id.asc().nullsLast()),
    index("idx_titles_status").using("btree", table.status.asc().nullsLast()),
    index("idx_titles_territory").using("btree", table.territory_id.asc().nullsLast()),
    foreignKey({
      columns: [table.territory_id],
      foreignColumns: [territories.id],
      name: "titles_territory_id_fkey",
    }).onDelete("set null"),
    unique("titles_cagematch_id_key").on(table.cagematch_id),
  ],
);

export const title_aliases = pgTable(
  "title_aliases",
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity({
      name: "title_aliases_id_seq",
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    title_id: integer().notNull(),
    name: text().notNull(),
    effective_from: text(),
    effective_to: text(),
    notes: text(),
    created_at: timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`),
    updated_at: timestamp({ withTimezone: true }),
  },
  (table) => [
    index("idx_title_aliases_title").using("btree", table.title_id.asc().nullsLast()),
    foreignKey({
      columns: [table.title_id],
      foreignColumns: [titles.id],
      name: "title_aliases_title_id_fkey",
    }).onDelete("cascade"),
    unique("title_aliases_title_id_name_effective_from_key").on(
      table.title_id,
      table.name,
      table.effective_from,
    ),
  ],
);

export const book_authors = pgTable(
  "book_authors",
  {
    book_id: integer().notNull(),
    author_id: integer().notNull(),
    role: text().default("author").notNull(),
  },
  (table) => [
    uniqueIndex("book_authors_book_id_author_id_role_key").using(
      "btree",
      table.book_id.asc().nullsLast(),
      table.author_id.asc().nullsLast(),
      table.role.asc().nullsLast(),
    ),
    foreignKey({
      columns: [table.author_id],
      foreignColumns: [authors.id],
      name: "book_authors_fk_0",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.book_id],
      foreignColumns: [books.id],
      name: "book_authors_fk_1",
    }).onDelete("cascade"),
    primaryKey({
      columns: [table.book_id, table.author_id, table.role],
      name: "book_authors_pkey",
    }),
  ],
);
export const v_reigns_full = pgView("v_reigns_full", {
  reign_id: integer(),
  title_id: integer(),
  title_name: text(),
  title_cagematch_id: text(),
  wrestler_id: integer(),
  wrestler_name: text(),
  wrestler_cagematch_id: text(),
  team_name: text(),
  holder_display: text(),
  participant_names: text(),
  is_vacancy: boolean(),
  sequence_order: integer(),
  reign_number: integer(),
  reign_number_for_wrestler: integer(),
  start_date: text(),
  end_date: text(),
  start_date_precision: text(),
  end_date_precision: text(),
  duration_days: integer(),
  won_in_city: text(),
  won_in_state: text(),
  won_in_country: text(),
  source_url: text(),
  notes: text(),
}).as(
  sql`SELECT r.id AS reign_id, r.title_id, t.name AS title_name, t.cagematch_id AS title_cagematch_id, r.wrestler_id, w.primary_ring_name AS wrestler_name, w.cagematch_id AS wrestler_cagematch_id, r.team_name, COALESCE( CASE WHEN r.is_vacancy THEN 'VACANT'::text ELSE NULL::text END, r.team_name, ( SELECT string_agg(w2.primary_ring_name, ' & '::text ORDER BY rp."position") AS string_agg FROM reign_participants rp JOIN wrestlers w2 ON w2.id = rp.wrestler_id WHERE rp.reign_id = r.id), w.primary_ring_name) AS holder_display, ( SELECT array_agg(w2.primary_ring_name ORDER BY rp."position") AS array_agg FROM reign_participants rp JOIN wrestlers w2 ON w2.id = rp.wrestler_id WHERE rp.reign_id = r.id) AS participant_names, r.is_vacancy, r.sequence_order, r.reign_number, r.reign_number_for_wrestler, r.start_date, r.end_date, r.start_date_precision, r.end_date_precision, r.duration_days, r.won_in_city, r.won_in_state, r.won_in_country, r.source_url, r.notes FROM reigns r JOIN titles t ON t.id = r.title_id LEFT JOIN wrestlers w ON w.id = r.wrestler_id`,
);

export const v_current_champions = pgView("v_current_champions", {
  title_id: integer(),
  title_name: text(),
  title_status: text(),
  reign_id: integer(),
  wrestler_id: integer(),
  wrestler_name: text(),
  team_name: text(),
  holder_display: text(),
  reign_number: integer(),
  reign_number_for_wrestler: integer(),
  start_date: text(),
  end_date: text(),
  duration_days: integer(),
  won_in_city: text(),
  won_in_state: text(),
  won_in_country: text(),
}).as(
  sql`SELECT DISTINCT ON (r.title_id) t.id AS title_id, t.name AS title_name, t.status AS title_status, r.id AS reign_id, r.wrestler_id, w.primary_ring_name AS wrestler_name, r.team_name, COALESCE(r.team_name, ( SELECT string_agg(w2.primary_ring_name, ' & '::text ORDER BY rp."position") AS string_agg FROM reign_participants rp JOIN wrestlers w2 ON w2.id = rp.wrestler_id WHERE rp.reign_id = r.id), w.primary_ring_name) AS holder_display, r.reign_number, r.reign_number_for_wrestler, r.start_date, r.end_date, r.duration_days, r.won_in_city, r.won_in_state, r.won_in_country FROM titles t LEFT JOIN reigns r ON r.title_id = t.id AND r.is_vacancy = false LEFT JOIN wrestlers w ON w.id = r.wrestler_id ORDER BY r.title_id, r.sequence_order DESC`,
);

export const v_title_lineage = pgView("v_title_lineage", {
  title_id: integer(),
  title_name: text(),
  sequence_order: integer(),
  reign_number: integer(),
  holder: text(),
  team_name: text(),
  reign_number_for_wrestler: integer(),
  start_date: text(),
  end_date: text(),
  duration_days: integer(),
  won_in_city: text(),
  won_in_state: text(),
  won_in_country: text(),
  is_vacancy: boolean(),
}).as(
  sql`SELECT t.id AS title_id, t.name AS title_name, r.sequence_order, r.reign_number, CASE WHEN r.is_vacancy THEN 'VACANT'::text ELSE COALESCE(r.team_name, ( SELECT string_agg(w2.primary_ring_name, ' & '::text ORDER BY rp."position") AS string_agg FROM reign_participants rp JOIN wrestlers w2 ON w2.id = rp.wrestler_id WHERE rp.reign_id = r.id), w.primary_ring_name) END AS holder, r.team_name, r.reign_number_for_wrestler, r.start_date, r.end_date, r.duration_days, r.won_in_city, r.won_in_state, r.won_in_country, r.is_vacancy FROM titles t JOIN reigns r ON r.title_id = t.id LEFT JOIN wrestlers w ON w.id = r.wrestler_id ORDER BY t.id, r.sequence_order`,
);

export const v_longest_reigns = pgView("v_longest_reigns", {
  reign_id: integer(),
  title_name: text(),
  holder_display: text(),
  team_name: text(),
  reign_number: integer(),
  reign_number_for_wrestler: integer(),
  start_date: text(),
  end_date: text(),
  duration_days: integer(),
}).as(
  sql`SELECT r.id AS reign_id, t.name AS title_name, COALESCE(r.team_name, ( SELECT string_agg(w2.primary_ring_name, ' & '::text ORDER BY rp."position") AS string_agg FROM reign_participants rp JOIN wrestlers w2 ON w2.id = rp.wrestler_id WHERE rp.reign_id = r.id), w.primary_ring_name) AS holder_display, r.team_name, r.reign_number, r.reign_number_for_wrestler, r.start_date, r.end_date, r.duration_days FROM reigns r JOIN titles t ON t.id = r.title_id LEFT JOIN wrestlers w ON w.id = r.wrestler_id WHERE r.is_vacancy = false AND r.duration_days IS NOT NULL ORDER BY r.duration_days DESC`,
);

export const v_wrestler_title_history = pgView("v_wrestler_title_history", {
  wrestler_id: integer(),
  wrestler_name: text(),
  title_id: integer(),
  title_name: text(),
  team_name: text(),
  reign_number: integer(),
  reign_number_for_wrestler: integer(),
  start_date: text(),
  end_date: text(),
  duration_days: integer(),
  won_in_city: text(),
  won_in_state: text(),
  won_in_country: text(),
  reign_role: text(),
}).as(
  sql`SELECT w.id AS wrestler_id, w.primary_ring_name AS wrestler_name, t.id AS title_id, t.name AS title_name, r.team_name, r.reign_number, r.reign_number_for_wrestler, r.start_date, r.end_date, r.duration_days, r.won_in_city, r.won_in_state, r.won_in_country, 'singles'::text AS reign_role FROM wrestlers w JOIN reigns r ON r.wrestler_id = w.id AND r.is_vacancy = false JOIN titles t ON t.id = r.title_id UNION ALL SELECT w.id AS wrestler_id, w.primary_ring_name AS wrestler_name, t.id AS title_id, t.name AS title_name, r.team_name, r.reign_number, r.reign_number_for_wrestler, r.start_date, r.end_date, r.duration_days, r.won_in_city, r.won_in_state, r.won_in_country, 'tag-partner-'::text || rp."position" AS reign_role FROM wrestlers w JOIN reign_participants rp ON rp.wrestler_id = w.id JOIN reigns r ON r.id = rp.reign_id AND r.is_vacancy = false JOIN titles t ON t.id = r.title_id`,
);

export const v_issue_browser = pgView("v_issue_browser", {
  id: integer(),
  periodical: text(),
  publication_date: date(),
  period_date: date(),
  issue_number: text(),
  cover_image_url: text(),
  cover_description: text(),
  drive_pdf_path: text(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  list_count: bigint({ mode: "number" }),
  cover_subjects: text(),
}).as(
  sql`SELECT pi.id, p.title AS periodical, pi.publication_date, pi.period_date, pi.issue_number, pi.cover_image_url, pi.cover_description, pi.drive_pdf_path, ( SELECT count(*) AS count FROM ranking_lists WHERE ranking_lists.issue_id = pi.id) AS list_count, ( SELECT string_agg(COALESCE(w.primary_ring_name, ics.subject_name), ', '::text) AS string_agg FROM issue_cover_subjects ics LEFT JOIN wrestlers w ON ics.wrestler_id = w.id WHERE ics.issue_id = pi.id) AS cover_subjects FROM periodical_issues pi JOIN periodicals p ON pi.periodical_id = p.id`,
);

export const v_pending_wrestlers_queue = pgView("v_pending_wrestlers_queue", {
  id: integer(),
  profightdb_id: integer(),
  profightdb_slug: text(),
  printed_name: text(),
  other_printed_names: text(),
  occurrence_count: integer(),
  first_seen_date: date(),
  last_seen_date: date(),
  resolved_wrestler_id: integer(),
  resolved_name: text(),
  merged: boolean(),
}).as(
  sql`SELECT pw.id, pw.profightdb_id, pw.profightdb_slug, pw.printed_name, pw.other_printed_names, pw.occurrence_count, pw.first_seen_date, pw.last_seen_date, pw.resolved_wrestler_id, w.primary_ring_name AS resolved_name, CASE WHEN pw.resolved_wrestler_id IS NOT NULL THEN true ELSE false END AS merged FROM pending_wrestlers pw LEFT JOIN wrestlers w ON pw.resolved_wrestler_id = w.id`,
);

export const v_ranking_history = pgView("v_ranking_history", {
  wrestler_id: integer(),
  primary_ring_name: text(),
  periodical: text(),
  publication_date: date(),
  period_date: date(),
  issue_number: text(),
  list_label: text(),
  list_scope: text(),
  rank: integer(),
  previous_rank: integer(),
  as_printed: text(),
}).as(
  sql`SELECT w.id AS wrestler_id, w.primary_ring_name, p.title AS periodical, pi.publication_date, pi.period_date, pi.issue_number, rl.list_label, rl.list_scope, re.rank, re.previous_rank, re.entry_name AS as_printed FROM ranking_entries re JOIN ranking_lists rl ON re.ranking_list_id = rl.id JOIN periodical_issues pi ON rl.issue_id = pi.id JOIN periodicals p ON pi.periodical_id = p.id LEFT JOIN wrestlers w ON re.wrestler_id = w.id`,
);
export const mcp_audit_log = pgTable(
  "mcp_audit_log",
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity({
      name: "mcp_audit_log_id_seq",
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    created_at: timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    code_hash: text().notNull(),
    code_excerpt: text().notNull(),
    dry_run: boolean().default(false).notNull(),
    duration_ms: integer(),
    result_status: text().notNull(),
    rpc_calls: jsonb().default(sql`'[]'::jsonb`).notNull(),
    error_message: text(),
  },
  (table) => [
    index("idx_mcp_audit_log_created").using("btree", table.created_at.asc().nullsLast()),
  ],
);

// --- Auth.js v5 standard tables (Drizzle adapter) -----------------------------
// Naming: "auth_user", "auth_account", etc. — namespaced to avoid colliding
// with the "user" reserved word and to flag these as auth-only.
// password_hash on auth_user is the local-credentials column; OAuth-only users
// (e.g. Facebook later) leave it NULL.

export const auth_user = pgTable(
  "auth_user",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text(),
    email: text().notNull(),
    emailVerified: timestamp({ withTimezone: true, mode: "date" }),
    image: text(),
    password_hash: text(),
    created_at: timestamp({ withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    updated_at: timestamp({ withTimezone: true }),
  },
  (table) => [uniqueIndex("auth_user_email_key").using("btree", table.email.asc().nullsLast())],
);

export const auth_account = pgTable(
  "auth_account",
  {
    userId: text().notNull(),
    type: text().notNull(),
    provider: text().notNull(),
    providerAccountId: text().notNull(),
    refresh_token: text(),
    access_token: text(),
    expires_at: integer(),
    token_type: text(),
    scope: text(),
    id_token: text(),
    session_state: text(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId], name: "auth_account_pkey" }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [auth_user.id],
      name: "auth_account_user_id_fkey",
    }).onDelete("cascade"),
    index("idx_auth_account_user").using("btree", table.userId.asc().nullsLast()),
  ],
);

export const auth_session = pgTable(
  "auth_session",
  {
    sessionToken: text().primaryKey(),
    userId: text().notNull(),
    expires: timestamp({ withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [auth_user.id],
      name: "auth_session_user_id_fkey",
    }).onDelete("cascade"),
    index("idx_auth_session_user").using("btree", table.userId.asc().nullsLast()),
  ],
);

export const auth_verification_token = pgTable(
  "auth_verification_token",
  {
    identifier: text().notNull(),
    token: text().notNull(),
    expires: timestamp({ withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.identifier, table.token], name: "auth_verification_token_pkey" }),
  ],
);
