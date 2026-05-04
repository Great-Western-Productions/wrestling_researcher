import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";
import type * as schema from "@/lib/db/schema";
import { executeCode } from "@/mcp/sandbox/host";

type Db = PostgresJsDatabase<typeof schema>;

const __filename = fileURLToPath(import.meta.url);
const API_TYPES_PATH = path.join(path.dirname(__filename), "types", "api.d.ts");

const READONLY_OK = /^\s*(SELECT|WITH)\b/i;
const FORBIDDEN_TOKENS = /;\s*(?!\s*$)/; // any `;` followed by more SQL (defense in depth)

function textResult(text: string, isError = false) {
  return {
    isError,
    content: [{ type: "text" as const, text }],
  };
}

export function createServer(db: Db): McpServer {
  const server = new McpServer({
    name: "pwr-research",
    version: "0.1.0",
  });

  server.registerTool(
    "execute_code",
    {
      title: "Execute Code Mode TypeScript",
      description:
        "Run TypeScript in a sandboxed worker that calls the `pwr` API namespace " +
        "(see list_api). Top-level `await` and `return` are allowed; the script body " +
        "is wrapped as `(async (pwr, console) => { ... })`. Pass dryRun=true to wrap " +
        "all DB writes in a transaction that is rolled back at the end.",
      inputSchema: {
        code: z.string().describe("TypeScript source — body of an async function"),
        dryRun: z
          .boolean()
          .optional()
          .describe("If true, all DB writes are rolled back (preview mode)"),
        timeoutMs: z.number().int().positive().optional(),
      },
    },
    async ({ code, dryRun, timeoutMs }) => {
      try {
        const result = await executeCode(db, { code, dryRun, timeoutMs });
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return textResult(`execute_code failed: ${(err as Error).message}`, true);
      }
    },
  );

  server.registerTool(
    "list_api",
    {
      title: "List the pwr API surface",
      description:
        "Returns the api.d.ts that documents every method available inside execute_code. " +
        "Read this first before composing a Code Mode script.",
      inputSchema: {},
    },
    async () => {
      const text = readFileSync(API_TYPES_PATH, "utf8");
      return textResult(text);
    },
  );

  server.registerTool(
    "query_sql_readonly",
    {
      title: "Run a single read-only SQL statement",
      description:
        "Escape hatch for ad-hoc SELECT/WITH queries when you don't need the full Code Mode. " +
        "Rejects anything that doesn't start with SELECT or WITH, or that contains a chained " +
        "statement separator. Returns the rows as JSON.",
      inputSchema: {
        sql: z.string(),
      },
    },
    async ({ sql: rawSql }) => {
      const trimmed = rawSql.trim();
      if (!READONLY_OK.test(trimmed)) {
        return textResult(
          "query_sql_readonly only accepts statements starting with SELECT or WITH.",
          true,
        );
      }
      // Strip a single trailing semicolon, then refuse if there are any more.
      const noTrailing = trimmed.replace(/;\s*$/, "");
      if (FORBIDDEN_TOKENS.test(noTrailing)) {
        return textResult(
          "query_sql_readonly rejects multi-statement payloads (chained `;`).",
          true,
        );
      }
      try {
        const rows = await db.execute(sql.raw(noTrailing));
        return textResult(JSON.stringify(rows, null, 2));
      } catch (err) {
        return textResult(`query failed: ${(err as Error).message}`, true);
      }
    },
  );

  return server;
}

async function main(): Promise<void> {
  const { db } = await import("@/lib/db/client");
  const server = createServer(db);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isDirectRun = (() => {
  if (typeof process === "undefined") return false;
  const arg1 = process.argv[1];
  if (!arg1) return false;
  return path.resolve(arg1) === path.resolve(__filename) || arg1.endsWith("mcp/server.ts");
})();

if (isDirectRun) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("pwr-research MCP server failed:", err);
    process.exit(1);
  });
}
