-- Phase 1.5 — replace SQLite-era text/int columns with native Postgres types,
-- and add updated_at columns. Three views depend on the columns being changed,
-- so we drop them, alter, and recreate.
--
-- Backup taken at pwr-web/backups/wrestling_bibliography_20260502_111223.sql

DROP VIEW IF EXISTS "v_issue_browser";--> statement-breakpoint
DROP VIEW IF EXISTS "v_ranking_history";--> statement-breakpoint
DROP VIEW IF EXISTS "v_pending_wrestlers_queue";--> statement-breakpoint

-- Boolean conversions (int 0/1 -> boolean)
ALTER TABLE "authors" ALTER COLUMN "is_wrestler" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "authors" ALTER COLUMN "is_wrestler" SET DATA TYPE boolean USING ("is_wrestler"::int::boolean);--> statement-breakpoint
ALTER TABLE "authors" ALTER COLUMN "is_wrestler" SET DEFAULT false;--> statement-breakpoint

ALTER TABLE "wrestlers" ALTER COLUMN "living" SET DATA TYPE boolean USING ("living"::int::boolean);--> statement-breakpoint

ALTER TABLE "territories" ALTER COLUMN "nwa_member" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "territories" ALTER COLUMN "nwa_member" SET DATA TYPE boolean USING ("nwa_member"::int::boolean);--> statement-breakpoint
ALTER TABLE "territories" ALTER COLUMN "nwa_member" SET DEFAULT false;--> statement-breakpoint

ALTER TABLE "periodicals" ALTER COLUMN "archive_in_collection" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "periodicals" ALTER COLUMN "archive_in_collection" SET DATA TYPE boolean USING ("archive_in_collection"::int::boolean);--> statement-breakpoint
ALTER TABLE "periodicals" ALTER COLUMN "archive_in_collection" SET DEFAULT false;--> statement-breakpoint

ALTER TABLE "periodical_issues" ALTER COLUMN "in_collection" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "periodical_issues" ALTER COLUMN "in_collection" SET DATA TYPE boolean USING ("in_collection"::int::boolean);--> statement-breakpoint
ALTER TABLE "periodical_issues" ALTER COLUMN "in_collection" SET DEFAULT false;--> statement-breakpoint

ALTER TABLE "wrestler_territory_runs" ALTER COLUMN "primary_run" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "wrestler_territory_runs" ALTER COLUMN "primary_run" SET DATA TYPE boolean USING ("primary_run"::int::boolean);--> statement-breakpoint
ALTER TABLE "wrestler_territory_runs" ALTER COLUMN "primary_run" SET DEFAULT false;--> statement-breakpoint

-- Date conversions (text 'YYYY-MM-DD' -> date)
ALTER TABLE "periodical_issues" ALTER COLUMN "publication_date" SET DATA TYPE date USING ("publication_date"::date);--> statement-breakpoint
ALTER TABLE "periodical_issues" ALTER COLUMN "period_date" SET DATA TYPE date USING ("period_date"::date);--> statement-breakpoint
ALTER TABLE "pending_wrestlers" ALTER COLUMN "first_seen_date" SET DATA TYPE date USING ("first_seen_date"::date);--> statement-breakpoint
ALTER TABLE "pending_wrestlers" ALTER COLUMN "last_seen_date" SET DATA TYPE date USING ("last_seen_date"::date);--> statement-breakpoint

-- Timestamp conversions (text -> timestamp with time zone)
ALTER TABLE "books" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING ("created_at"::timestamp with time zone);--> statement-breakpoint
ALTER TABLE "books" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "faction_members" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING ("created_at"::timestamp with time zone);--> statement-breakpoint
ALTER TABLE "faction_members" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "factions" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING ("created_at"::timestamp with time zone);--> statement-breakpoint
ALTER TABLE "factions" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "issue_cover_subjects" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING ("created_at"::timestamp with time zone);--> statement-breakpoint
ALTER TABLE "issue_cover_subjects" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "pending_wrestlers" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING ("created_at"::timestamp with time zone);--> statement-breakpoint
ALTER TABLE "pending_wrestlers" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "periodical_issues" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING ("created_at"::timestamp with time zone);--> statement-breakpoint
ALTER TABLE "periodical_issues" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "periodicals" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING ("created_at"::timestamp with time zone);--> statement-breakpoint
ALTER TABLE "periodicals" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "ranking_entries" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING ("created_at"::timestamp with time zone);--> statement-breakpoint
ALTER TABLE "ranking_entries" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "ranking_lists" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING ("created_at"::timestamp with time zone);--> statement-breakpoint
ALTER TABLE "ranking_lists" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "reigns" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING ("created_at"::timestamp with time zone);--> statement-breakpoint
ALTER TABLE "reigns" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "research_sources" ALTER COLUMN "consulted_at" SET DATA TYPE timestamp with time zone USING ("consulted_at"::timestamp with time zone);--> statement-breakpoint
ALTER TABLE "research_sources" ALTER COLUMN "consulted_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "territories" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING ("created_at"::timestamp with time zone);--> statement-breakpoint
ALTER TABLE "territories" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "title_aliases" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING ("created_at"::timestamp with time zone);--> statement-breakpoint
ALTER TABLE "title_aliases" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "titles" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING ("created_at"::timestamp with time zone);--> statement-breakpoint
ALTER TABLE "titles" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE "wrestlers" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING ("created_at"::timestamp with time zone);--> statement-breakpoint
ALTER TABLE "wrestlers" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;--> statement-breakpoint

-- Add updated_at columns (nullable; populated by writers as needed)
ALTER TABLE "books" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "faction_members" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "factions" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issue_cover_subjects" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pending_wrestlers" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "periodical_issues" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "periodicals" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ranking_entries" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ranking_lists" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reigns" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "territories" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "title_aliases" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "titles" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wrestlers" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint

-- Recreate views (now projecting native date columns instead of text)
CREATE VIEW "v_issue_browser" AS
  SELECT pi.id,
         p.title AS periodical,
         pi.publication_date,
         pi.period_date,
         pi.issue_number,
         pi.cover_image_url,
         pi.cover_description,
         pi.drive_pdf_path,
         (SELECT count(*) FROM ranking_lists WHERE ranking_lists.issue_id = pi.id) AS list_count,
         (SELECT string_agg(COALESCE(w.primary_ring_name, ics.subject_name), ', '::text)
            FROM issue_cover_subjects ics
            LEFT JOIN wrestlers w ON ics.wrestler_id = w.id
           WHERE ics.issue_id = pi.id) AS cover_subjects
    FROM periodical_issues pi
    JOIN periodicals p ON pi.periodical_id = p.id;
--> statement-breakpoint

CREATE VIEW "v_ranking_history" AS
  SELECT w.id AS wrestler_id,
         w.primary_ring_name,
         p.title AS periodical,
         pi.publication_date,
         pi.period_date,
         pi.issue_number,
         rl.list_label,
         rl.list_scope,
         re.rank,
         re.previous_rank,
         re.entry_name AS as_printed
    FROM ranking_entries re
    JOIN ranking_lists rl ON re.ranking_list_id = rl.id
    JOIN periodical_issues pi ON rl.issue_id = pi.id
    JOIN periodicals p ON pi.periodical_id = p.id
    LEFT JOIN wrestlers w ON re.wrestler_id = w.id;
--> statement-breakpoint

CREATE VIEW "v_pending_wrestlers_queue" AS
  SELECT pw.id,
         pw.profightdb_id,
         pw.profightdb_slug,
         pw.printed_name,
         pw.other_printed_names,
         pw.occurrence_count,
         pw.first_seen_date,
         pw.last_seen_date,
         pw.resolved_wrestler_id,
         w.primary_ring_name AS resolved_name,
         CASE WHEN pw.resolved_wrestler_id IS NOT NULL THEN true ELSE false END AS merged
    FROM pending_wrestlers pw
    LEFT JOIN wrestlers w ON pw.resolved_wrestler_id = w.id;
