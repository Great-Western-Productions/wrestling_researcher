import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { categoryLabel, ifnull } from "@/lib/format";
import { authorsForBook, getBookById } from "@/lib/queries/books";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function BookDetail({ params }: Props) {
  const { id } = await params;
  const bookId = Number.parseInt(id, 10);
  if (!Number.isFinite(bookId)) notFound();

  const [book, authors] = await Promise.all([getBookById(db, bookId), authorsForBook(db, bookId)]);
  if (!book) notFound();

  const isbn = book.isbn13 || book.isbn10;

  return (
    <>
      <p className="breadcrumbs">
        <Link href="/books">&laquo; All books</Link>
      </p>

      <p className="actions-row">
        <Link className="btn-inline" href={`/book/${book.id}/edit`}>
          Edit book
        </Link>
      </p>

      <article className="book-detail">
        <img
          className="book-cover"
          src={`/book/${book.id}/cover`}
          alt={`Cover of ${book.title}`}
          loading="lazy"
        />

        <h1>{book.title}</h1>
        {book.subtitle && <p className="subtitle">{book.subtitle}</p>}

        <div className="badges">
          <span className={`cat-tag ${book.category_code}`}>
            {categoryLabel(book.category_code)}
          </span>
          <span className={`conf ${book.confidence ?? ""}`}>{book.confidence ?? "—"}</span>
        </div>

        {authors.length > 0 && (
          <p className="authors">
            <strong>By:</strong>{" "}
            {authors.map((a, i) => (
              <span key={a.id}>
                <Link href={`/author/${a.id}`}>{a.name}</Link>
                {a.is_wrestler && <span className="tag wr"> wrestler</span>}
                {a.role !== "author" && <span className="dim"> ({a.role})</span>}
                {i < authors.length - 1 ? ", " : ""}
              </span>
            ))}
          </p>
        )}

        <table className="meta-table">
          <tbody>
            <tr>
              <th>Year</th>
              <td>{ifnull(book.year_published)}</td>
            </tr>
            <tr>
              <th>Publisher</th>
              <td>{ifnull(book.publisher)}</td>
            </tr>
            <tr>
              <th>ISBN-13</th>
              <td>{ifnull(book.isbn13)}</td>
            </tr>
            <tr>
              <th>ISBN-10</th>
              <td>{ifnull(book.isbn10)}</td>
            </tr>
            <tr>
              <th>Pages</th>
              <td>{ifnull(book.pages)}</td>
            </tr>
            <tr>
              <th>Format</th>
              <td>{ifnull(book.format)}</td>
            </tr>
            <tr>
              <th>Country</th>
              <td>{ifnull(book.country)}</td>
            </tr>
            <tr>
              <th>Language</th>
              <td>{ifnull(book.language)}</td>
            </tr>
            <tr>
              <th>Era</th>
              <td>{ifnull(book.era)}</td>
            </tr>
            <tr>
              <th>Territory / promotion</th>
              <td>{ifnull(book.territory_or_promotion)}</td>
            </tr>
            <tr>
              <th>Subject (wrestler)</th>
              <td>{ifnull(book.subject_wrestler)}</td>
            </tr>
          </tbody>
        </table>

        {book.synopsis && (
          <section className="synopsis">
            <h2>Synopsis</h2>
            <p>{book.synopsis}</p>
          </section>
        )}

        {book.source_url && (
          <p className="source">
            <a href={book.source_url} target="_blank" rel="noopener">
              Source &rarr;
            </a>
          </p>
        )}

        {isbn && (
          <p className="lookup">
            Find a copy:{" "}
            <a target="_blank" href={`https://www.worldcat.org/isbn/${isbn}`} rel="noopener">
              WorldCat
            </a>
            {" · "}
            <a
              target="_blank"
              href={`https://www.abebooks.com/servlet/SearchResults?isbn=${isbn}`}
              rel="noopener"
            >
              AbeBooks
            </a>
            {book.isbn13 && (
              <>
                {" · "}
                <a target="_blank" href={`https://www.amazon.com/s?k=${isbn}`} rel="noopener">
                  Amazon
                </a>
                {" · "}
                <a
                  target="_blank"
                  href={`https://archive.org/search?query=%22${isbn}%22`}
                  rel="noopener"
                >
                  Internet Archive
                </a>
              </>
            )}
          </p>
        )}
      </article>
    </>
  );
}
