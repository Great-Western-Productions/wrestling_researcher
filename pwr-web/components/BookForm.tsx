import { CATEGORIES } from "@/lib/format";
import type { BookRow } from "@/lib/queries/books";

type Props = {
  action: (formData: FormData) => Promise<void>;
  book?: BookRow | null;
  authorsText?: string;
  countries: string[];
  eras: string[];
  submitLabel: string;
  cancelHref: string;
};

const CONFIDENCE_LEVELS = ["medium", "high", "low", "low_searched"];

export function BookForm({
  action,
  book,
  authorsText = "",
  countries,
  eras,
  submitLabel,
  cancelHref,
}: Props) {
  const v = (key: keyof BookRow): string => {
    const x = book?.[key];
    return x === null || x === undefined ? "" : String(x);
  };
  const cat = book?.category_code ?? CATEGORIES[0]?.[0] ?? "";
  const conf = book?.confidence ?? "medium";

  return (
    <form className="add-form" action={action}>
      <div className="form-row">
        <label>
          Title <span className="req">*</span>
          {/* biome-ignore lint/a11y/noAutofocus: this form is the whole point of the page that renders it, so focusing its first field is the expected landing behavior */}
          <input type="text" name="title" required autoFocus defaultValue={v("title")} />
        </label>
        <label>
          Subtitle
          <input type="text" name="subtitle" defaultValue={v("subtitle")} />
        </label>
      </div>

      <div className="form-row">
        <label>
          Category <span className="req">*</span>
          <select name="category_code" required defaultValue={cat}>
            {CATEGORIES.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Confidence
          <select name="confidence" defaultValue={conf}>
            {CONFIDENCE_LEVELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="form-row">
        <label className="grow">
          Author(s) — comma-separated; will be created if new
          <input
            type="text"
            name="authors"
            defaultValue={authorsText}
            placeholder="e.g., Mick Foley, Larry Sweeney"
          />
        </label>
        <label className="check">
          <input type="checkbox" name="authors_are_wrestlers" value="1" /> New author(s) are
          wrestlers
        </label>
      </div>

      <div className="form-row">
        <label>
          Publisher
          <input type="text" name="publisher" defaultValue={v("publisher")} />
        </label>
        <label>
          Year
          <input
            type="number"
            name="year_published"
            min="1900"
            max="2099"
            defaultValue={v("year_published")}
          />
        </label>
        <label>
          Pages
          <input type="number" name="pages" min="1" defaultValue={v("pages")} />
        </label>
      </div>

      <div className="form-row">
        <label>
          ISBN-10
          <input type="text" name="isbn10" defaultValue={v("isbn10")} />
        </label>
        <label>
          ISBN-13
          <input type="text" name="isbn13" defaultValue={v("isbn13")} />
        </label>
        <label>
          Format
          <input
            type="text"
            name="format"
            defaultValue={v("format")}
            placeholder="hardcover, paperback, ebook…"
          />
        </label>
      </div>

      <div className="form-row">
        <label>
          Language
          <input type="text" name="language" defaultValue={book ? v("language") : "English"} />
        </label>
        <label>
          Country
          <input
            type="text"
            name="country"
            list="country-options"
            defaultValue={v("country")}
            placeholder="US, UK, Japan…"
          />
          <datalist id="country-options">
            {countries.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label>
          Era
          <input
            type="text"
            name="era"
            list="era-options"
            defaultValue={v("era")}
            placeholder="territorial, attitude…"
          />
          <datalist id="era-options">
            {eras.map((e) => (
              <option key={e} value={e} />
            ))}
          </datalist>
        </label>
      </div>

      <div className="form-row">
        <label>
          Subject wrestler (if biography)
          <input type="text" name="subject_wrestler" defaultValue={v("subject_wrestler")} />
        </label>
        <label>
          Territory / promotion
          <input
            type="text"
            name="territory_or_promotion"
            defaultValue={v("territory_or_promotion")}
          />
        </label>
      </div>

      <label>
        Synopsis
        <textarea name="synopsis" rows={4} defaultValue={v("synopsis")} />
      </label>

      <label>
        Source URL
        <input
          type="url"
          name="source_url"
          defaultValue={v("source_url")}
          placeholder="https://…"
        />
      </label>

      <div className="form-actions">
        <button type="submit">{submitLabel}</button>
        <a className="clear" href={cancelHref}>
          Cancel
        </a>
      </div>
    </form>
  );
}
