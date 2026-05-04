import {
  jsonCreated,
  jsonError,
  jsonOk,
  parseIdParam,
  parseJsonBody,
} from "@/lib/api/route-helpers";
import { citationCreateSchema } from "@/lib/api/schemas";
import { getSession } from "@/lib/auth/require-session";
import { db } from "@/lib/db/client";
import { addCitation } from "@/lib/db-ops/wrestlers";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return jsonError(401, "Unauthorized");

  const idParam = await parseIdParam(params);
  if (!idParam.ok) return idParam.response;

  const parsed = await parseJsonBody(req, citationCreateSchema);
  if (!parsed.ok) return parsed.response;

  const result = await addCitation(
    db,
    idParam.id,
    parsed.data.book_id,
    parsed.data.page,
    parsed.data.excerpt,
  );
  return result.created ? jsonCreated(result) : jsonOk(result);
}
