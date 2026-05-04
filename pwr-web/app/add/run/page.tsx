import Link from "next/link";
import { createRunAction } from "@/lib/actions/entities";
import { db } from "@/lib/db/client";
import { getRunFormOptions } from "@/lib/db-ops/runs";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function pickInt(v: string | string[] | undefined): number | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

export default async function AddRunPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const preselectWrestler = pickInt(params.wrestler);
  const preselectTerritory = pickInt(params.territory);

  const opts = await getRunFormOptions(db);

  return (
    <>
      <p className="breadcrumbs">
        <Link href="/add">&laquo; Add</Link>
      </p>
      <h1>Add a wrestler-territory run</h1>
      <p className="subtitle">Records a stretch when a wrestler worked a specific territory.</p>

      <form className="add-form" action={createRunAction}>
        <div className="form-row">
          <label>
            Wrestler <span className="req">*</span>
            <select name="wrestler_id" required defaultValue={preselectWrestler ?? ""}>
              <option value="">— select wrestler —</option>
              {opts.wrestlers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.primary_ring_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Territory <span className="req">*</span>
            <select name="territory_id" required defaultValue={preselectTerritory ?? ""}>
              <option value="">— select territory —</option>
              {opts.territories.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.short_name ? ` (${t.short_name})` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="form-row">
          <label>
            Start year
            <input type="number" name="start_year" min="1900" max="2099" />
          </label>
          <label>
            Start month
            <input type="number" name="start_month" min="1" max="12" />
          </label>
          <label>
            End year
            <input type="number" name="end_year" min="1900" max="2099" />
          </label>
          <label>
            End month
            <input type="number" name="end_month" min="1" max="12" />
          </label>
        </div>

        <div className="form-row">
          <label>
            Role during run
            <input
              type="text"
              name="role_during_run"
              placeholder="main event, mid, enhancement, manager…"
            />
          </label>
          <label>
            Ring name during run
            <input
              type="text"
              name="ring_name_during_run"
              placeholder="leave blank if same as primary"
            />
          </label>
          <label className="check">
            <input type="checkbox" name="primary_run" value="1" /> Primary run for this wrestler
          </label>
        </div>

        <label>
          Notes
          <textarea name="notes" rows={3} />
        </label>

        <div className="form-actions">
          <button type="submit">Save run</button>
          <a className="clear" href="/add">
            Cancel
          </a>
        </div>
      </form>
    </>
  );
}
