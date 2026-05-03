import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { verifyUserPassword } from "@/lib/auth/users";
import { db } from "@/lib/db/client";
import { auth_account, auth_session, auth_user, auth_verification_token } from "@/lib/db/schema";

// To add Facebook later:
//
//   import Facebook from "next-auth/providers/facebook";
//   providers: [
//     Credentials({ ... }),
//     Facebook({ clientId: process.env.FACEBOOK_CLIENT_ID, clientSecret: process.env.FACEBOOK_CLIENT_SECRET }),
//   ],
//
// The Drizzle adapter will populate `auth_account` automatically on first sign-in.

export const { auth, signIn, signOut, handlers } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: auth_user,
    accountsTable: auth_account,
    sessionsTable: auth_session,
    verificationTokensTable: auth_verification_token,
  }),
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = String(credentials?.email ?? "");
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;
        const user = await verifyUserPassword(db, email, password);
        if (!user) return null;
        return { id: user.id, email: user.email, name: user.name ?? undefined };
      },
    }),
  ],
});
