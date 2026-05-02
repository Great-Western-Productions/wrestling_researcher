CREATE TYPE "public"."confidence_level" AS ENUM('low', 'low_searched', 'medium', 'medium_search', 'high');--> statement-breakpoint
DROP VIEW "public"."v_pending_wrestlers_queue";--> statement-breakpoint
ALTER TABLE "books" ALTER COLUMN "confidence" SET DEFAULT 'medium'::"public"."confidence_level";--> statement-breakpoint
ALTER TABLE "books" ALTER COLUMN "confidence" SET DATA TYPE "public"."confidence_level" USING "confidence"::"public"."confidence_level";--> statement-breakpoint
ALTER TABLE "factions" ALTER COLUMN "confidence" SET DEFAULT 'medium'::"public"."confidence_level";--> statement-breakpoint
ALTER TABLE "factions" ALTER COLUMN "confidence" SET DATA TYPE "public"."confidence_level" USING "confidence"::"public"."confidence_level";--> statement-breakpoint
ALTER TABLE "periodical_issues" ALTER COLUMN "confidence" SET DEFAULT 'medium'::"public"."confidence_level";--> statement-breakpoint
ALTER TABLE "periodical_issues" ALTER COLUMN "confidence" SET DATA TYPE "public"."confidence_level" USING "confidence"::"public"."confidence_level";--> statement-breakpoint
ALTER TABLE "periodicals" ALTER COLUMN "confidence" SET DEFAULT 'medium'::"public"."confidence_level";--> statement-breakpoint
ALTER TABLE "periodicals" ALTER COLUMN "confidence" SET DATA TYPE "public"."confidence_level" USING "confidence"::"public"."confidence_level";--> statement-breakpoint
CREATE VIEW "public"."v_pending_wrestlers_queue" AS (SELECT pw.id, pw.profightdb_id, pw.profightdb_slug, pw.printed_name, pw.other_printed_names, pw.occurrence_count, pw.first_seen_date, pw.last_seen_date, pw.resolved_wrestler_id, w.primary_ring_name AS resolved_name, CASE WHEN pw.resolved_wrestler_id IS NOT NULL THEN true ELSE false END AS merged FROM pending_wrestlers pw LEFT JOIN wrestlers w ON pw.resolved_wrestler_id = w.id);