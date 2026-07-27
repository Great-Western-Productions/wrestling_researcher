<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Database migrations

**Commit the migration file before you apply it.** A `PreToolUse` hook
(`scripts/check-migrations-committed.sh`) blocks `db:migrate` while anything under
`lib/db/migrations/` is uncommitted.

Every worktree shares one local Postgres database. `drizzle.config.ts` falls back to
`postgresql://localhost:5432/wrestling_bibliography` when no `.env` is present, and Claude
worktrees are created without one. So `db:migrate` in any worktree moves the schema that all of
them read. If the `.sql` file is still uncommitted, the database ends up ahead of every branch
with nothing in git that recreates it, and deleting the worktree loses the SQL while the tables
survive.

**Never run `pnpm db:generate`.** The meta snapshots in `lib/db/migrations/meta/` stop at
`0003_snapshot.json`, so drizzle-kit diffs against that and re-emits every table added since. The
result fails on `auth_account already exists`. Write the `.sql` and the `meta/_journal.json` entry
by hand.

**Pick the `when` value deliberately.** The migrator's only gate is
`max(created_at) < migration.folderMillis` against the newest row in
`drizzle.__drizzle_migrations`. A migration dated at or below that value is skipped in silence,
and a migration already recorded can never re-run. Repair schema drift with a new forward
migration using `CREATE TABLE IF NOT EXISTS`. Check `.claude/worktrees/*` for migration files
another branch has not merged yet before choosing the next number.
