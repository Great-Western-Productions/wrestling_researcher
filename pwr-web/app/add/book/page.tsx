import Link from "next/link";
import { BookForm } from "@/components/BookForm";
import { createBookAction } from "@/lib/actions/books";
import { db } from "@/lib/db/client";
import { getBookFormOptions } from "@/lib/queries/books";

export const dynamic = "force-dynamic";

export default async function AddBookPage() {
  const { countries, eras } = await getBookFormOptions(db);
  return (
    <>
      <p className="breadcrumbs">
        <Link href="/add">&laquo; Add</Link>
      </p>
      <h1>Add a book</h1>
      <BookForm
        action={createBookAction}
        countries={countries}
        eras={eras}
        submitLabel="Save book"
        cancelHref="/books"
      />
    </>
  );
}
