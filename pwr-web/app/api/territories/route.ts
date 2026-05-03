import { sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { jsonError, jsonOk } from "@/lib/api/route-helpers";

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  if (!name) return jsonError(400, "name query param required");
  const rows = await db.execute<{ id: number; name: string; short_name: string | null }>(sql`
    SELECT id, name, short_name
      FROM territories
     WHERE LOWER(name) = LOWER(${name})
        OR LOWER(short_name) = LOWER(${name})
        OR aliases ILIKE ${`%${name}%`}
     LIMIT 1
  `);
  if (rows.length === 0) return jsonError(404, "Not found");
  return jsonOk(rows[0]);
}
