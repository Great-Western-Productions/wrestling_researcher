import Link from "next/link";

export default function AddIndex() {
  return (
    <>
      <h1>Add to the bibliography</h1>
      <p className="subtitle">Quick entry forms. Required fields are marked.</p>

      <section className="cards">
        <Link className="card" href="/add/book">
          <div className="card-count">+</div>
          <div className="card-label">Book</div>
        </Link>
        <Link className="card alt" href="/add/periodical">
          <div className="card-count">+</div>
          <div className="card-label">Periodical</div>
        </Link>
        <Link className="card terr" href="/add/territory">
          <div className="card-count">+</div>
          <div className="card-label">Territory</div>
        </Link>
        <Link className="card wr" href="/add/wrestler">
          <div className="card-count">+</div>
          <div className="card-label">Wrestler</div>
        </Link>
        <Link className="card" href="/add/run">
          <div className="card-count">+</div>
          <div className="card-label">Wrestler-Territory run</div>
        </Link>
      </section>

      <p className="dim small">
        Tip: you can also link directly from any wrestler or territory page to add a run pre-filled
        with that record.
      </p>
    </>
  );
}
