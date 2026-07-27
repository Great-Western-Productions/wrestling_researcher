-- A turf's continuity across the promotions that held it.
--
-- territories rows are promotions. The turf itself -- the Tulsa office, the
-- Detroit office -- has no row, so when a territory changes hands the two
-- holders are two rows with nothing joining them. Up to now that continuity
-- was carried only by giving both rows the same map_color by hand, which the
-- map reads and no query can.
--
-- lineage_key tags both rows with the same short slug, so "who held Tulsa in
-- 1965" is answerable and the shared colour becomes a consequence of the data
-- rather than the only record of it. Nullable: most promotions held a turf
-- nobody else ever did, and those stay null.

ALTER TABLE "territories" ADD COLUMN IF NOT EXISTS "lineage_key" text;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_territories_lineage" ON "territories" USING btree ("lineage_key");
