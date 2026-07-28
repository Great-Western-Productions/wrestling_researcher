-- categories.code: make the live database agree with the migrations.
--
-- 0000_baseline declares this as a table constraint:
--
--   CONSTRAINT "categories_code_key" UNIQUE("code")
--
-- and lib/db/schema/tables.ts agrees, declaring unique("categories_code_key").
-- The long-lived local wrestling_bibliography database instead carries a bare
-- unique index of that name, with no row in pg_constraint. Uniqueness is
-- enforced either way, so nothing was broken at runtime -- but drizzle-kit
-- compares object kinds, so every diff against that database reported the
-- table as out of sync.
--
-- That report could never be cleared. drizzle's proposed repair is
-- ADD CONSTRAINT categories_code_key UNIQUE(code), which fails with
-- 42P07 relation "categories_code_key" already exists because the index is
-- sitting on the name. So the drift re-reported itself on every fresh
-- checkout and no automated fix could converge it.
--
-- ADD CONSTRAINT ... USING INDEX promotes the existing index in place. No
-- rebuild, no second index, and the constraint takes ownership of the index
-- already there. Guarded, because on any database built from 0000 forward the
-- constraint already exists and this must be a no-op.

-- The contype filter below is not decoration. books.category_code carries a
-- foreign key to categories(code), and a foreign key stores the index it
-- depends on in pg_constraint.conindid. So an unfiltered
-- "no pg_constraint row points at this index" test matches books_fk_0 and
-- concludes the constraint already exists. Only 'u' and 'p' rows own an index;
-- 'f' merely references one.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
    WHERE c.relname = 'categories_code_key'
      AND i.indrelid = 'public.categories'::regclass
      AND i.indisunique
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint con
        WHERE con.conindid = c.oid
          AND con.contype IN ('u', 'p')
      )
  ) THEN
    ALTER TABLE "categories"
      ADD CONSTRAINT "categories_code_key" UNIQUE USING INDEX "categories_code_key";
  END IF;
END $$;
