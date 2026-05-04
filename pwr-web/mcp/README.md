# pwr-research MCP server (Code Mode)

A local MCP server that lets an LLM add data, dedup data, and add/merge
wrestlers, books, territories, and pending-wrestler records against the
`pwr-web` Postgres database.

Built in **Code Mode** style (Cloudflare): instead of exposing dozens of
narrowly-scoped MCP tools, it exposes a single `execute_code` tool that
runs the model's TypeScript inside a `node:worker_threads` sandbox. The
worker has no DB handle of its own — every `pwr.<ns>.<method>(...)` call
crosses an RPC boundary back to the host, which runs it through Drizzle.

## What's in here

```
mcp/
  server.ts                  # MCP entry: registers execute_code, list_api, query_sql_readonly
  sandbox/
    host.ts                  # esbuild transpile → worker → RPC dispatch → audit log
    worker.js                # CJS worker: runs user JS with the `pwr` Proxy injected
  api/
    index.ts                 # REGISTRY: "namespace.method" -> async (db, ...args) => result
    wrestlers.ts             # mergeInto, findDuplicateCandidates
    books.ts                 # mergeBooks (port of tests/test_book_merge.py)
    territories.ts           # upsertByCagematch (port of merge_cagematch_promotions.py)
    pending-wrestlers.ts     # list, resolveTo, promote
    dedup.ts                 # normalizeName + WRatio-equivalent fuzzy()
  types/api.d.ts             # Hand-curated TS surface doc returned by list_api
```

## Tools

The MCP server exposes three tools — only the first is for real work.

### `execute_code({ code, dryRun?, timeoutMs? })`
Run TypeScript in the sandbox. The body is wrapped as
`(async (pwr, console) => { ... })`, so top-level `await` and `return` are
fine. Returns `{ returnValue, stdout, stderr, rpcCalls, durationMs, rolledBack }`.

`dryRun: true` opens a Postgres transaction around all DB writes and rolls
it back at the end — perfect for previewing a merge.

### `list_api()`
Returns the contents of `mcp/types/api.d.ts`. Read this first to see what
methods are available on `pwr`. Calling this once per session is enough.

### `query_sql_readonly({ sql })`
Single-statement escape hatch for ad-hoc SELECT/WITH queries. Rejects
anything that isn't a single read-only statement.

## Run it

```sh
# from pwr-web/
pnpm install                # picks up @modelcontextprotocol/sdk, esbuild, tsx
DATABASE_URL=postgresql://localhost:5432/wrestling_bibliography \
  pnpm mcp:start            # stdio MCP server, ready to be plugged into a client
```

You can poke at it with the MCP inspector:

```sh
DATABASE_URL=postgresql://localhost:5432/wrestling_bibliography \
  pnpm dlx @modelcontextprotocol/inspector pnpm mcp:start
```

## Register with Claude Code

Add to `~/.claude.json` (or a project-local `.mcp.json`):

```json
{
  "mcpServers": {
    "pwr-research": {
      "command": "pnpm",
      "args": [
        "--silent",
        "--dir",
        "/Users/jschairb-gwp/src/ProWrestling Researcher/pwr-web",
        "mcp:start"
      ],
      "env": {
        "DATABASE_URL": "postgresql://localhost:5432/wrestling_bibliography"
      }
    }
  }
}
```

Restart Claude Code, then ask the agent something like *"find duplicate
candidates for Ric Flair and report without merging"* — it should call
`list_api`, then write a short Code-Mode script.

## Safety

- The worker has no DB handle, no `process.env`, no filesystem access. The
  only capability is the RPC bridge to the host.
- Hard timeout (default 30s) terminates runaway scripts via
  `worker.terminate()`.
- Every execution writes one `mcp_audit_log` row (`code_excerpt`, `dry_run`,
  `result_status`, `rpc_calls` JSON, `error_message`). Run
  `pwr.audit.recent()` from inside a script to inspect history.
- `dryRun: true` is the way to preview merges. The audit row still gets
  written (outside the rolled-back transaction).

## Adding a new API method

1. Implement `(db, ...args) => Promise<unknown>` in the right `mcp/api/*.ts`.
2. Add an entry to `REGISTRY` in `mcp/api/index.ts`.
3. Add the TS signature to `mcp/types/api.d.ts` so the model can find it.
4. Write tests under `tests/integration/mcp/` or `tests/unit/mcp/`.

The MCP tool surface stays at three — new methods only show up inside
`pwr` and via `list_api`.
