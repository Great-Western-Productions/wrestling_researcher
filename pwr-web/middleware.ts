import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Edge middleware: just attaches the session cookie/JWT context to every
// request. Per-route gating happens via `requireSession()` in mutating server
// actions and API route handlers (see lib/auth/require-session.ts) — reads
// remain public.
const { auth } = NextAuth(authConfig);
export default auth;

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
