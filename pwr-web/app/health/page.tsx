import { sql as raw } from "@/lib/db/client";

export const dynamic = "force-dynamic";

type DbProbe = { ok: true; books: number } | { ok: false; error: string };

async function probe(): Promise<DbProbe> {
  try {
    const rows = await raw<{ count: string }[]>`SELECT count(*)::text AS count FROM books`;
    return { ok: true, books: Number(rows[0]?.count ?? 0) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function HealthPage() {
  const result = await probe();
  return (
    <main className="p-8 font-mono text-sm">
      <h1 className="text-lg mb-4">pwr-web health</h1>
      <pre>{JSON.stringify(result, null, 2)}</pre>
    </main>
  );
}
