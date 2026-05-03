import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, describe, expect, it } from "vitest";
import { createServer } from "@/mcp/server";
import { closeTestDb, withTx } from "../../helpers/db";

afterAll(closeTestDb);

async function connectClient(db: Parameters<Parameters<typeof withTx>[0]>[0]) {
  const server = createServer(db);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, server };
}

describe("MCP server", () => {
  it("registers execute_code, list_api, and query_sql_readonly", async () => {
    await withTx(async (tx) => {
      const { client } = await connectClient(tx);
      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name).sort();
      expect(names).toContain("execute_code");
      expect(names).toContain("list_api");
      expect(names).toContain("query_sql_readonly");
      await client.close();
    });
  });

  it("execute_code runs Code Mode TS and returns the result as text", async () => {
    await withTx(async (tx) => {
      const { client } = await connectClient(tx);
      const result = await client.callTool({
        name: "execute_code",
        arguments: { code: "return await pwr.dedup.normalizeName('Bret Hart');" },
      });
      const text = (result.content as Array<{ type: string; text?: string }>)[0]!.text!;
      expect(text).toContain("bret hart");
      expect(text).toContain("dedup.normalizeName");
      await client.close();
    });
  });

  it("list_api returns the api.d.ts contents", async () => {
    await withTx(async (tx) => {
      const { client } = await connectClient(tx);
      const result = await client.callTool({ name: "list_api", arguments: {} });
      const text = (result.content as Array<{ type: string; text?: string }>)[0]!.text!;
      expect(text).toContain("export interface PwrApi");
      expect(text).toContain("findDuplicateCandidates");
      await client.close();
    });
  });

  it("query_sql_readonly accepts SELECT and returns rows as JSON text", async () => {
    await withTx(async (tx) => {
      const { client } = await connectClient(tx);
      const result = await client.callTool({
        name: "query_sql_readonly",
        arguments: { sql: "SELECT 7 AS n" },
      });
      const text = (result.content as Array<{ type: string; text?: string }>)[0]!.text!;
      expect(text).toMatch(/"n":\s*7/);
      await client.close();
    });
  });

  it("query_sql_readonly rejects non-SELECT statements", async () => {
    await withTx(async (tx) => {
      const { client } = await connectClient(tx);
      const result = await client.callTool({
        name: "query_sql_readonly",
        arguments: { sql: "DELETE FROM wrestlers" },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text?: string }>)[0]!.text!;
      expect(text).toMatch(/SELECT|read-only/i);
      await client.close();
    });
  });
});
