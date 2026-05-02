import Link from "next/link";
import { db } from "@/lib/db/client";
import { getTerritoryRegions } from "@/lib/db-ops/territories";
import { createTerritoryAction } from "@/lib/actions/entities";

export const dynamic = "force-dynamic";

export default async function AddTerritoryPage() {
  const regions = await getTerritoryRegions(db);

  return (
    <>
      <p className="breadcrumbs">
        <Link href="/add">&laquo; Add</Link>
      </p>
      <h1>Add a territory</h1>

      <form className="add-form" action={createTerritoryAction}>
        <div className="form-row">
          <label>
            Name <span className="req">*</span>
            <input type="text" name="name" required autoFocus />
          </label>
          <label>
            Short name
            <input type="text" name="short_name" placeholder="WCCW, CWA…" />
          </label>
        </div>

        <div className="form-row">
          <label>
            Region
            <input
              type="text"
              name="region"
              list="region-options"
              placeholder="Mid-South, Northeast, Japan…"
            />
            <datalist id="region-options">
              {regions.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </label>
          <label className="check">
            <input type="checkbox" name="nwa_member" value="1" /> NWA member
          </label>
        </div>

        <div className="form-row">
          <label>
            HQ city
            <input type="text" name="headquarters_city" />
          </label>
          <label>
            HQ state / region
            <input type="text" name="headquarters_state" />
          </label>
        </div>

        <div className="form-row">
          <label>
            Year founded
            <input type="number" name="year_founded" min="1900" max="2099" />
          </label>
          <label>
            Year closed (blank if active)
            <input type="number" name="year_closed" min="1900" max="2099" />
          </label>
        </div>

        <label>
          Promoter lineage
          <input
            type="text"
            name="promoter_lineage"
            placeholder="e.g., Fritz Von Erich, Ken Mantell…"
          />
        </label>

        <label>
          Notes
          <textarea name="notes" rows={4} />
        </label>

        <div className="form-actions">
          <button type="submit">Save territory</button>
          <a className="clear" href="/territories">
            Cancel
          </a>
        </div>
      </form>
    </>
  );
}
