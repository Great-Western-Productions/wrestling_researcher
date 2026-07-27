#!/usr/bin/env bash
# PreToolUse guard: refuse `db:migrate` while Drizzle migration files are uncommitted.
#
# Every worktree points at the same local Postgres database (drizzle.config.ts
# defaults to postgresql://localhost:5432/wrestling_bibliography when no .env is
# present). Applying a migration whose .sql file lives only in one working tree
# leaves the database ahead of every branch, with nothing in git that recreates
# it. Delete that worktree and the SQL is gone while the tables remain.
#
# Reads the PreToolUse payload on stdin. Silence means allow.
set -uo pipefail

payload=$(cat)
command=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')

case "$command" in
  *db:migrate* | *"drizzle-kit migrate"*) ;;
  *) exit 0 ;;
esac

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
dirty=$(git -C "$root" status --porcelain -- pwr-web/lib/db/migrations 2>/dev/null)

[ -z "$dirty" ] && exit 0

jq -n --arg files "$dirty" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: (
      "Uncommitted Drizzle migration files. Every worktree shares one local Postgres database, so applying these would move the shared schema while the SQL that recreates it exists only in this working tree. Commit them first, then re-run:\n\n"
      + $files
    )
  }
}'
