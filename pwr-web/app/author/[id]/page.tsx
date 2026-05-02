import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { booksForAuthor, getAuthorById } from "@/lib/queries/authors";
import { categoryLabel, ifnull } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function AuthorDetail({ params }: Props) {
  const { id } = await params;
  const aid = Number.parseInt(id, 10);
  if (!Number.isFinite(aid)) notFound();

  const author = await getAuthorById(db, aid);
  if (!author) notFound();

  const books = await booksForAuthor(db, aid);

  return (
    <>
      <p className="breadcrumbs">
        <Link href="/books">&laquo; All books</Link>
      </p>

      <h1>
        {author.name}
        {author.is_wrestler && <span className="tag wr"> wrestler</span>}
      </h1>

      {author.ring_name && author.ring_name !== author.name && (
        <p className="subtitle">
          Also known as <strong>{author.ring_name}</strong>
        </p>
      )}
      {author.notes && <p>{author.notes}</p>}

      <h2>
        {books.length} book{books.length !== 1 ? "s" : ""}
      </h2>

      <table className="books">
        <thead>
          <tr>
            <th>Title</th>
            <th>Year</th>
            <th>Role</th>
            <th>Category</th>
          </tr>
        </thead>
        <tbody>
          {books.map((b) => (
            <tr key={b.id}>
              <td>
                <Link href={`/book/${b.id}`}>{b.title}</Link>
              </td>
              <td>{ifnull(b.year_published)}</td>
              <td>{b.role}</td>
              <td>
                <span className={`cat-tag ${b.category_code}`}>
                  {categoryLabel(b.category_code)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
