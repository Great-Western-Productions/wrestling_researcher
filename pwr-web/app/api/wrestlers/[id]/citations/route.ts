import { db } from "@/lib/db/client";
import { citationCreateSchema } from "@/lib/api/schemas";
import { jsonCreated, jsonOk, parseIdParam, parseJsonBody } from "@/lib/api/route-helpers";
import { addCitation } from "@/lib/db-ops/wrestlers";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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
