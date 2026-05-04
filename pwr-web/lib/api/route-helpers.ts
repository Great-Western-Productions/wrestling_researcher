import type { ZodError, ZodSchema } from "zod";

export function jsonOk<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data, { status: 200, ...init });
}

export function jsonCreated<T>(data: T): Response {
  return Response.json(data, { status: 201 });
}

export function jsonError(status: number, message: string, extra?: unknown): Response {
  return Response.json({ error: message, ...(extra ? { details: extra } : {}) }, { status });
}

export async function parseJsonBody<T>(
  req: Request,
  schema: ZodSchema<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: jsonError(400, "Invalid JSON body") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const err = parsed.error as ZodError;
    return { ok: false, response: jsonError(400, "Validation failed", err.issues) };
  }
  return { ok: true, data: parsed.data };
}

export async function parseIdParam(
  paramsPromise: Promise<{ id: string }>,
): Promise<{ ok: true; id: number } | { ok: false; response: Response }> {
  const { id } = await paramsPromise;
  const n = Number.parseInt(id, 10);
  if (!Number.isFinite(n)) return { ok: false, response: jsonError(400, "Invalid id") };
  return { ok: true, id: n };
}
