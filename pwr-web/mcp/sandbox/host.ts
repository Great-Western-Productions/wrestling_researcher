import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { transform } from "esbuild";
import type * as schema from "@/lib/db/schema";
import { REGISTRY } from "@/mcp/api";

type Db = PostgresJsDatabase<typeof schema>;

export type RpcCall = { method: string; durationMs: number; ok: boolean };

export type ExecuteResult = {
  returnValue: unknown;
  stdout: string;
  stderr: string;
  durationMs: number;
  rpcCalls: RpcCall[];
  rolledBack: boolean;
};

export type ExecuteOptions = {
  code: string;
  dryRun?: boolean;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const __filename = fileURLToPath(import.meta.url);
const WORKER_PATH = path.join(path.dirname(__filename), "worker.js");

class _Rollback extends Error {}
const ROLLBACK = new _Rollback("dry-run rollback");

async function dispatch(db: Db, method: string, args: unknown[]): Promise<unknown> {
  const fn = REGISTRY[method];
  if (!fn) throw new Error(`Unknown API method: ${method}`);
  return await fn(db, ...(args as []));
}

type WorkerMessage =
  | { type: "call"; id: number; method: string; args: unknown[] }
  | { type: "done"; returnValue: unknown; stdout: string; stderr: string }
  | { type: "throw"; message: string; stack?: string; stdout: string; stderr: string };

type RunResult = {
  returnValue: unknown;
  stdout: string;
  stderr: string;
  rpcCalls: RpcCall[];
  durationMs: number;
};

async function runOnce(db: Db, jsCode: string, timeoutMs: number): Promise<RunResult> {
  const start = Date.now();
  const rpcCalls: RpcCall[] = [];
  const worker = new Worker(WORKER_PATH);
  let timer: NodeJS.Timeout | undefined;

  return await new Promise((resolve, reject) => {
    const settle = (fn: () => void) => {
      if (timer) clearTimeout(timer);
      worker.removeAllListeners();
      worker.terminate().catch(() => {});
      fn();
    };

    timer = setTimeout(() => {
      settle(() => reject(new Error(`execute_code timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    worker.on("error", (err) => {
      settle(() => reject(err));
    });

    worker.on("message", async (msg: WorkerMessage) => {
      if (msg.type === "call") {
        const t0 = Date.now();
        try {
          const value = await dispatch(db, msg.method, msg.args);
          rpcCalls.push({ method: msg.method, durationMs: Date.now() - t0, ok: true });
          worker.postMessage({ type: "result", id: msg.id, value });
        } catch (err) {
          rpcCalls.push({ method: msg.method, durationMs: Date.now() - t0, ok: false });
          worker.postMessage({
            type: "error",
            id: msg.id,
            message: (err as Error).message,
          });
        }
        return;
      }
      if (msg.type === "done") {
        settle(() =>
          resolve({
            returnValue: msg.returnValue,
            stdout: msg.stdout,
            stderr: msg.stderr,
            rpcCalls,
            durationMs: Date.now() - start,
          }),
        );
        return;
      }
      if (msg.type === "throw") {
        settle(() => reject(new Error(msg.message)));
        return;
      }
    });

    worker.postMessage({ type: "ready", code: jsCode });
  });
}

async function writeAuditLog(
  db: Db,
  args: {
    code: string;
    dryRun: boolean;
    durationMs: number;
    status: "success" | "error";
    rpcCalls: RpcCall[];
    errorMessage: string | null;
  },
): Promise<void> {
  const codeHash = createHash("sha256").update(args.code).digest("hex").slice(0, 16);
  const codeExcerpt = args.code.slice(0, 2000);
  await db.execute(sql`
    INSERT INTO mcp_audit_log
      (code_hash, code_excerpt, dry_run, duration_ms, result_status, rpc_calls, error_message)
    VALUES
      (${codeHash}, ${codeExcerpt}, ${args.dryRun}, ${args.durationMs},
       ${args.status}, ${JSON.stringify(args.rpcCalls)}::jsonb, ${args.errorMessage})
  `);
}

export async function executeCode(db: Db, opts: ExecuteOptions): Promise<ExecuteResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const wrapped = `(async (pwr, console) => {\n${opts.code}\n})`;
  const transformed = await transform(wrapped, { loader: "ts", target: "node20" });
  const jsCode = transformed.code.trim().replace(/;$/, "");

  const startTs = Date.now();
  let runResult: RunResult | undefined;
  let runError: Error | undefined;

  try {
    if (opts.dryRun) {
      try {
        await db.transaction(async (tx) => {
          runResult = await runOnce(tx as unknown as Db, jsCode, timeoutMs);
          throw ROLLBACK;
        });
      } catch (err) {
        if (err !== ROLLBACK) throw err;
      }
    } else {
      runResult = await runOnce(db, jsCode, timeoutMs);
    }
  } catch (err) {
    runError = err as Error;
  }

  // Audit logging is best-effort. If the write fails (missing table, dropped
  // connection), the sandbox has already done its work, so swallow the failure
  // rather than discarding a good result or masking the sandbox's own error.
  // stderr is the safe channel: the MCP server speaks JSON-RPC over stdout.
  try {
    await writeAuditLog(db, {
      code: opts.code,
      dryRun: !!opts.dryRun,
      durationMs: Date.now() - startTs,
      status: runError ? "error" : "success",
      rpcCalls: runResult?.rpcCalls ?? [],
      errorMessage: runError?.message ?? null,
    });
  } catch (auditError) {
    console.error("[mcp] mcp_audit_log write failed:", (auditError as Error).message);
  }

  if (runError) throw runError;
  if (!runResult) throw new Error("Sandbox run finished without an error or a result.");
  return {
    returnValue: runResult.returnValue,
    stdout: runResult.stdout,
    stderr: runResult.stderr,
    durationMs: runResult.durationMs,
    rpcCalls: runResult.rpcCalls,
    rolledBack: !!opts.dryRun,
  };
}
