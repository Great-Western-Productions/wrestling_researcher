import { loginAction } from "@/lib/actions/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorMessage =
    error === "invalid"
      ? "Invalid email or password."
      : error === "missing"
        ? "Email and password are required."
        : null;

  return (
    <main style={{ maxWidth: 360, margin: "4rem auto", padding: "1rem" }}>
      <h1 style={{ marginBottom: "1.5rem" }}>Sign in</h1>
      {errorMessage ? (
        <p
          role="alert"
          style={{
            background: "#fee",
            border: "1px solid #f99",
            color: "#900",
            padding: "0.5rem 0.75rem",
            marginBottom: "1rem",
            borderRadius: 4,
          }}
        >
          {errorMessage}
        </p>
      ) : null}
      <form action={loginAction}>
        <label htmlFor="email" style={{ display: "block", marginBottom: "0.25rem" }}>
          Email
        </label>
        <input
          type="email"
          id="email"
          name="email"
          required
          autoComplete="email"
          style={{ width: "100%", padding: "0.5rem", marginBottom: "1rem" }}
        />
        <label htmlFor="password" style={{ display: "block", marginBottom: "0.25rem" }}>
          Password
        </label>
        <input
          type="password"
          id="password"
          name="password"
          required
          autoComplete="current-password"
          style={{ width: "100%", padding: "0.5rem", marginBottom: "1rem" }}
        />
        <button
          type="submit"
          style={{
            width: "100%",
            padding: "0.6rem",
            background: "#222",
            color: "#fff",
            border: 0,
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
