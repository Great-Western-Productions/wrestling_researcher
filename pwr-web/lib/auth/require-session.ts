import type { Session } from "next-auth";
import { auth } from "@/auth";

/**
 * For server actions (mutating). Throws "Unauthorized" if no active session —
 * server actions don't have a clean way to return 401, so we throw and let the
 * caller's error boundary surface it. The user will already have been bounced
 * to /login by the middleware before they could trigger the action in normal
 * flow; this guards the direct-POST escape hatch.
 */
export async function requireSessionOrThrow(): Promise<Session> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  return session;
}

/**
 * For API route handlers. Returns the session-or-null; the caller decides how
 * to respond (typically `if (!session) return new Response(null, { status: 401 })`).
 */
export async function getSession(): Promise<Session | null> {
  return auth();
}
