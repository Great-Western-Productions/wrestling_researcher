import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe Auth.js config — imported by middleware.ts. Must not pull in any
 * Node-only modules (no DB client, no bcryptjs). The full config in `auth.ts`
 * extends this with the DrizzleAdapter and Credentials provider for use in
 * route handlers and server actions.
 */
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  providers: [],
  trustHost: true,
} satisfies NextAuthConfig;
