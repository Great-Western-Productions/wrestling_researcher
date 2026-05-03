import {
  jsonCreated,
  jsonError,
  jsonOk,
  parseIdParam,
  parseJsonBody,
} from "@/lib/api/route-helpers";
import { runCreateSchema } from "@/lib/api/schemas";
import { getSession } from "@/lib/auth/require-session";
import { db } from "@/lib/db/client";
import { findOrCreateRun } from "@/lib/db-ops/wrestlers";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return jsonError(401, "Unauthorized");

  const idParam = await parseIdParam(params);
  if (!idParam.ok) return idParam.response;

  const parsed = await parseJsonBody(req, runCreateSchema);
  if (!parsed.ok) return parsed.response;

  const result = await findOrCreateRun(db, idParam.id, {
    territory_id: parsed.data.territory_id,
    start_year: parsed.data.start_year,
    start_month: parsed.data.start_month,
    end_year: parsed.data.end_year,
    end_month: parsed.data.end_month,
    role_during_run: parsed.data.role_during_run,
    ring_name_during_run: parsed.data.ring_name_during_run,
    primary_run: parsed.data.primary_run,
    notes: parsed.data.notes,
  });
  return result.created ? jsonCreated(result) : jsonOk(result);
}
