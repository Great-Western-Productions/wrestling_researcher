import { sql } from "drizzle-orm";
import { jsonError, jsonOk, parseIdParam, parseJsonBody } from "@/lib/api/route-helpers";
import { wrestlerPatchSchema } from "@/lib/api/schemas";
import { getSession } from "@/lib/auth/require-session";
import { db } from "@/lib/db/client";
import { patchWrestlerFillBlanks } from "@/lib/db-ops/wrestlers";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const idParam = await parseIdParam(params);
  if (!idParam.ok) return idParam.response;
  const rows = await db.execute<{ id: number; primary_ring_name: string }>(
    sql`SELECT id, primary_ring_name FROM wrestlers WHERE id = ${idParam.id}`,
  );
  if (rows.length === 0) return jsonError(404, "Not found");
  return jsonOk(rows[0]);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return jsonError(401, "Unauthorized");

  const idParam = await parseIdParam(params);
  if (!idParam.ok) return idParam.response;

  const parsed = await parseJsonBody(req, wrestlerPatchSchema);
  if (!parsed.ok) return parsed.response;

  const changed = await patchWrestlerFillBlanks(db, idParam.id, parsed.data);
  return jsonOk({ id: idParam.id, changed });
}
