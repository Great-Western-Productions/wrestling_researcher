import Link from "next/link";
import { createWrestlerAction } from "@/lib/actions/entities";
import { db } from "@/lib/db/client";
import { getPendingNamePrefill, getWrestlerFormOptions } from "@/lib/db-ops/wrestlers";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function pickInt(v: string | string[] | undefined): number | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

export default async function AddWrestlerPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const fromPending = pickInt(params.from_pending);

  const [opts, prefillName] = await Promise.all([
    getWrestlerFormOptions(db),
    fromPending ? getPendingNamePrefill(db, fromPending) : Promise.resolve(null),
  ]);

  // De-dup statuses to ensure 'queued' shows once at top
  const otherStatuses = opts.statuses.filter(
    (s) => !["queued", "published", "researching", "archived"].includes(s),
  );

  return (
    <>
      <p className="breadcrumbs">
        <Link href="/add">&laquo; Add</Link>
      </p>
      <h1>Add a wrestler</h1>

      {fromPending && (
        <p className="dim small">
          Promoting pending wrestler <Link href={`/pending/${fromPending}`}>#{fromPending}</Link>.
          On save, every ranking entry referencing this name will be backfilled to the new wrestler.
        </p>
      )}

      <form className="add-form" action={createWrestlerAction}>
        {fromPending && <input type="hidden" name="from_pending" value={fromPending} />}
        <div className="form-row">
          <label>
            Primary ring name <span className="req">*</span>
            <input
              type="text"
              name="primary_ring_name"
              required
              // biome-ignore lint/a11y/noAutofocus: this page exists only to fill in this form, so focusing its first field is the expected landing behavior
              autoFocus
              defaultValue={prefillName ?? ""}
            />
          </label>
          <label>
            Legal name
            <input type="text" name="legal_name" />
          </label>
        </div>

        <label>
          Other ring names / aliases
          <input type="text" name="other_ring_names" placeholder="comma-separated" />
        </label>

        <div className="form-row">
          <label>
            Born date
            <input type="text" name="born_date" placeholder="YYYY or YYYY-MM-DD" />
          </label>
          <label>
            Died date
            <input type="text" name="died_date" placeholder="YYYY or YYYY-MM-DD" />
          </label>
          <label>
            Living
            <select name="living" defaultValue="">
              <option value="">Unknown</option>
              <option value="1">Yes</option>
              <option value="0">No</option>
            </select>
          </label>
        </div>

        <div className="form-row">
          <label>
            Debut year
            <input type="number" name="debut_year" min="1900" max="2099" />
          </label>
          <label>
            Retired year
            <input type="number" name="retired_year" min="1900" max="2099" />
          </label>
          <label>
            Primary role
            <input
              type="text"
              name="primary_role"
              list="role-options"
              placeholder="wrestler, manager, announcer…"
            />
            <datalist id="role-options">
              {opts.roles.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </label>
        </div>

        <div className="form-row">
          <label>
            Hometown (billed)
            <input type="text" name="hometown_billed" />
          </label>
          <label>
            Hometown (real)
            <input type="text" name="hometown_real" />
          </label>
        </div>

        <div className="form-row">
          <label>
            Height (inches)
            <input
              type="number"
              name="height_inches"
              min="36"
              max="96"
              placeholder="73 = 6'1&quot;"
            />
          </label>
          <label>
            Weight (lbs)
            <input type="number" name="weight_lbs" min="50" max="800" />
          </label>
        </div>

        <div className="form-row">
          <label>
            Style
            <input type="text" name="style" placeholder="brawler, technical, lucha, comedy…" />
          </label>
          <label>
            Finisher
            <input type="text" name="finisher" />
          </label>
        </div>

        <div className="form-row">
          <label>
            Socials
            <input type="text" name="socials" />
          </label>
          <label>
            Convention status
            <input type="text" name="convention_status" />
          </label>
          <label>
            Last known appearance
            <input type="text" name="last_known_appearance" />
          </label>
        </div>

        <label>
          Footage notes
          <textarea name="footage_notes" rows={2} />
        </label>

        <div className="form-row">
          <label>
            Midcard Files status
            <select name="midcard_files_status" defaultValue="queued">
              <option value="queued">queued</option>
              <option value="published">published</option>
              <option value="researching">researching</option>
              <option value="archived">archived</option>
              {otherStatuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            Files priority (1=top)
            <input type="number" name="midcard_files_priority" min="1" max="5" />
          </label>
        </div>

        <label>
          Bio (long-form, sourced narrative)
          <textarea name="bio" rows={6} />
        </label>

        <label>
          Why they mattered
          <textarea name="why_they_mattered" rows={3} />
        </label>

        <label>
          Notes
          <textarea name="notes" rows={3} />
        </label>

        <div className="form-actions">
          <button type="submit">Save wrestler</button>
          <a className="clear" href="/wrestlers">
            Cancel
          </a>
        </div>
      </form>
    </>
  );
}
