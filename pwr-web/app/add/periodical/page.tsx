import Link from "next/link";
import { db } from "@/lib/db/client";
import { listPeriodicals } from "@/lib/queries/periodicals";
import { createPeriodicalAction } from "@/lib/actions/entities";

export const dynamic = "force-dynamic";

export default async function AddPeriodicalPage() {
  // Reuse listPeriodicals just for the distinct countries/types arrays.
  const opts = await listPeriodicals(db, {});

  return (
    <>
      <p className="breadcrumbs">
        <Link href="/add">&laquo; Add</Link>
      </p>
      <h1>Add a periodical</h1>

      <form className="add-form" action={createPeriodicalAction} method="post">
        <div className="form-row">
          <label>
            Title <span className="req">*</span>
            <input type="text" name="title" required autoFocus />
          </label>
          <label>
            Publisher
            <input type="text" name="publisher" />
          </label>
        </div>

        <div className="form-row">
          <label>
            Country
            <input type="text" name="country" list="country-options" />
            <datalist id="country-options">
              {opts.countries.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label>
            Language
            <input type="text" name="language" defaultValue="English" />
          </label>
          <label>
            Frequency
            <input type="text" name="frequency" placeholder="monthly, weekly…" />
          </label>
        </div>

        <div className="form-row">
          <label>
            Year started
            <input type="number" name="year_started" min="1900" max="2099" />
          </label>
          <label>
            Year ended (blank if active)
            <input type="number" name="year_ended" min="1900" max="2099" />
          </label>
          <label>
            Issue count (known)
            <input type="number" name="issue_count_known" min="1" />
          </label>
        </div>

        <div className="form-row">
          <label>
            Type
            <input
              type="text"
              name="type"
              list="type-options"
              placeholder="newsstand, dirt_sheet…"
            />
            <datalist id="type-options">
              {opts.types.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>
          <label>
            Parent company
            <input type="text" name="parent_company" />
          </label>
          <label>
            Confidence
            <select name="confidence" defaultValue="medium">
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="low">low</option>
            </select>
          </label>
        </div>

        <label className="check">
          <input type="checkbox" name="archive_in_collection" value="1" /> I have issues in my
          archive
        </label>

        <label>
          Source URL
          <input type="url" name="source_url" />
        </label>

        <label>
          Notes
          <textarea name="notes" rows={3} />
        </label>

        <div className="form-actions">
          <button type="submit">Save periodical</button>
          <a className="clear" href="/periodicals">
            Cancel
          </a>
        </div>
      </form>
    </>
  );
}
