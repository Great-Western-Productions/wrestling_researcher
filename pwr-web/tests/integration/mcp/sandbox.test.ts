import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { executeCode } from "@/mcp/sandbox/host";
import { closeTestDb, withTx } from "../../helpers/db";

afterAll(closeTestDb);

describe("executeCode (Code Mode sandbox)", () => {
  it("runs a pure script and returns its value", async () => {
    await withTx(async (tx) => {
      const result = await executeCode(tx, { code: "return 1 + 41;" });
      expect(result.returnValue).toBe(42);
      expect(result.rpcCalls).toEqual([]);
    });
  });

  it("dispatches a pure RPC call (dedup.normalizeName) back to the host", async () => {
    await withTx(async (tx) => {
      const result = await executeCode(tx, {
        code: "return await pwr.dedup.normalizeName('  Bret \"The Hitman\" Hart!  ');",
      });
      expect(result.returnValue).toBe("bret the hitman hart");
      expect(result.rpcCalls.map((c) => c.method)).toEqual(["dedup.normalizeName"]);
    });
  });

  it("dispatches a DB-backed RPC call (wrestlers.findByRingName)", async () => {
    await withTx(async (tx) => {
      await tx.execute(sql`
        INSERT INTO wrestlers (primary_ring_name, midcard_files_status)
        VALUES ('Hulk Hogan', 'queued')
      `);
      const result = await executeCode(tx, {
        code: "return await pwr.wrestlers.findByRingName('hulk hogan');",
      });
      expect(result.returnValue).toMatchObject({ primary_ring_name: "Hulk Hogan" });
    });
  });

  it("captures console.log into stdout", async () => {
    await withTx(async (tx) => {
      const result = await executeCode(tx, {
        code: "console.log('hello'); console.log('world'); return 'done';",
      });
      expect(result.stdout).toBe("hello\nworld");
      expect(result.returnValue).toBe("done");
    });
  });

  it("propagates errors thrown by user code with the original message", async () => {
    await withTx(async (tx) => {
      await expect(executeCode(tx, { code: "throw new Error('oh no');" })).rejects.toThrow(/oh no/);
    });
  });

  it("propagates errors thrown by API methods through the RPC bridge", async () => {
    await withTx(async (tx) => {
      await expect(
        executeCode(tx, { code: "return await pwr.wrestlers.mergeInto(1, 1);" }),
      ).rejects.toThrow(/same wrestler/i);
    });
  });

  it("rolls back DB writes when dryRun is true", async () => {
    await withTx(async (tx) => {
      const before = await tx.execute<{ count: string }>(
        sql`SELECT COUNT(*)::text AS count FROM wrestlers`,
      );
      const result = await executeCode(tx, {
        dryRun: true,
        code: `
          await pwr.wrestlers.add({
            primary_ring_name: 'Dry Run Wrestler',
            legal_name: null, other_ring_names: null, born_date: null, died_date: null,
            living: null, debut_year: null, retired_year: null, primary_role: null,
            hometown_billed: null, hometown_real: null, finisher: null, style: null,
            socials: null, convention_status: null, last_known_appearance: null,
            footage_notes: null, midcard_files_status: 'queued', midcard_files_priority: null,
            why_they_mattered: null, notes: null, height_inches: null, weight_lbs: null,
            bio: null, fromPending: null,
          });
          return 'ok';
        `,
      });
      expect(result.rolledBack).toBe(true);
      expect(result.returnValue).toBe("ok");
      const after = await tx.execute<{ count: string }>(
        sql`SELECT COUNT(*)::text AS count FROM wrestlers`,
      );
      expect(after[0]!.count).toBe(before[0]!.count);
    });
  });

  it("writes one mcp_audit_log row per execution with code excerpt and rpc_calls", async () => {
    await withTx(async (tx) => {
      await executeCode(tx, {
        code: "return await pwr.dedup.normalizeName('Audit Me!');",
      });
      const rows = await tx.execute<{
        code_excerpt: string;
        result_status: string;
        rpc_calls: unknown;
        dry_run: boolean;
      }>(
        sql`SELECT code_excerpt, result_status, rpc_calls, dry_run FROM mcp_audit_log ORDER BY id DESC LIMIT 1`,
      );
      expect(rows[0]).toBeTruthy();
      expect(rows[0]!.result_status).toBe("success");
      expect(rows[0]!.code_excerpt).toContain("normalizeName");
      expect(rows[0]!.dry_run).toBe(false);
      const calls = rows[0]!.rpc_calls as Array<{ method: string }>;
      expect(calls.map((c) => c.method)).toContain("dedup.normalizeName");
    });
  });

  it("writes audit row with result_status=error when user code throws", async () => {
    await withTx(async (tx) => {
      await executeCode(tx, { code: "throw new Error('boom');" }).catch(() => {});
      const rows = await tx.execute<{ result_status: string; error_message: string | null }>(
        sql`SELECT result_status, error_message FROM mcp_audit_log ORDER BY id DESC LIMIT 1`,
      );
      expect(rows[0]!.result_status).toBe("error");
      expect(rows[0]!.error_message).toContain("boom");
    });
  });

  it("times out a runaway script and rejects", async () => {
    await withTx(async (tx) => {
      await expect(
        executeCode(tx, {
          code: "while (true) {}",
          timeoutMs: 250,
        }),
      ).rejects.toThrow(/timed out/i);
    });
  });
});
