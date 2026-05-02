import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import {
  authorsForBook,
  getBookById,
  getBookFormOptions,
} from "@/lib/queries/books";
import { updateBookAction } from "@/lib/actions/books";
import { BookForm } from "@/components/BookForm";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function EditBookPage({ params }: Props) {
  const { id } = await params;
  const bookId = Number.parseInt(id, 10);
  if (!Number.isFinite(bookId)) notFound();

  const [book, authors, options] = await Promise.all([
    getBookById(db, bookId),
    authorsForBook(db, bookId),
    getBookFormOptions(db),
  ]);
  if (!book) notFound();

  const authorsText = authors.map((a) => a.name).join(", ");
  const action = updateBookAction.bind(null, bookId);

  return (
    <>
      <p className="breadcrumbs">
        <Link href={`/book/${book.id}`}>&laquo; {book.title}</Link>
      </p>
      <h1>Edit book</h1>
      <BookForm
        action={action}
        book={book}
        authorsText={authorsText}
        countries={options.countries}
        eras={options.eras}
        submitLabel="Save changes"
        cancelHref={`/book/${book.id}`}
      />
    </>
  );
}
