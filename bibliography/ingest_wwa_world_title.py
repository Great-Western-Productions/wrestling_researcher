#!/usr/bin/env python3
"""
ingest_wwa_world_title.py

Inserts the WWA World Heavyweight Championship (cagematch id=70) into the
titles table, upserts the title-holder roster into the wrestlers table,
and inserts every reign + vacancy in chronological order into the reigns
table.

Source: https://www.cagematch.net/?id=5&nr=70  (captured 2026-04-28)

Postgres only. Idempotent.

Run after migrate_titles_reigns.py:
    python3 bibliography/migrate_titles_reigns.py
    python3 bibliography/ingest_wwa_world_title.py
"""
from __future__ import annotations

import os
import sys
from typing import Optional

import psycopg


SOURCE_URL = "https://www.cagematch.net/?id=5&nr=70"
TITLE_CAGEMATCH_ID = "70"
WWA_TERRITORY_CM_ID = "103"   # World Wrestling Association (Indianapolis)


# ---------------------------------------------------------------------------
# Wrestler roster: name -> cagematch_id (None for Stormy Granzig, no profile)
# ---------------------------------------------------------------------------
WRESTLERS: dict[str, Optional[str]] = {
    "Dick The Bruiser":     "1149",
    "Gene Kiniski":         "471",
    "Mitsu Arakawa":        "3036",
    "Wilbur Snyder":        "3275",
    "Blackjack Lanza":      "491",
    "Baron von Raschke":    "262",
    "Billy Red Cloud":      "9005",
    "Bob Ellis":            "1929",
    "Jimmy Valiant":        "1150",
    "Ox Baker":             "1441",
    "Pepper Gomez":         "1973",
    "The Masked Strangler": "2605",
    "Ivan Koloff":          "687",
    "King Kong Brody":      "786",
    "Ernie Ladd":           "1139",
    "Johnny Valiant":       "868",
    "Bobo Brazil":          "852",
    "Blackjack Mulligan":   "325",
    "Harley Race":          "341",
    "Bobby Colt":           "8100",
    "Spike Huber":          "2531",
    "Stormy Granzig":       None,
    "Greg Wojokowski":      "7998",
    "Scott Rechsteiner":    "844",
    "Golden Lion":          "5837",
}


# ---------------------------------------------------------------------------
# Reigns in CHRONOLOGICAL order (oldest first). sequence_order = 1..N.
# Vacancies are first-class rows.
#
# Date encoding:
#   ('YYYY-MM-DD', 'day')
#   ('YYYY-MM',    'month')
#   ('YYYY',       'year')
#   (None,         'unknown')
#
# duration_days: cagematch's value when given; otherwise None.
# notes: only when there's something worth flagging.
# ---------------------------------------------------------------------------
# Each row:
#   (reign_number, wrestler_name, reign_for_wrestler,
#    start_date, start_prec, end_date, end_prec,
#    duration_days, city, state, country, is_vacancy, notes)

REIGNS = [
    # 1
    (1,  "Dick The Bruiser",     1,  "1964-04-22","day","1965-03-12","day", 324, None,           None,None,False, None),
    # vacancy
    (None,None,                  None,"1965-03-12","day","1965-04-10","day", 29, None,           None,None,True,  None),
    (2,  "Dick The Bruiser",     2,  "1965-04-10","day","1965-08-21","day", 133, "Indianapolis","IN","USA",False, None),
    (3,  "Gene Kiniski",         1,  "1965-08-21","day","1965-12-25","day", 126, "Indianapolis","IN","USA",False, None),
    (4,  "Dick The Bruiser",     3,  "1965-12-25","day","1966-10-08","day", 287, "Indianapolis","IN","USA",False, None),
    (5,  "Mitsu Arakawa",        1,  "1966-10-08","day","1967-09-30","day", 357, "Indianapolis","IN","USA",False, None),
    (6,  "Wilbur Snyder",        1,  "1967-09-30","day","1967-12-27","day",  88, "Indianapolis","IN","USA",False, None),
    (7,  "Blackjack Lanza",      1,  "1967-12-27","day","1969-08-29","day", 611, "Indianapolis","IN","USA",False, None),
    (8,  "Dick The Bruiser",     4,  "1969-08-29","day","1970-03-07","day", 190, "Indianapolis","IN","USA",False, None),
    (9,  "Baron von Raschke",    1,  "1970-03-07","day","1971-10-14","day", 586, "Indianapolis","IN","USA",False, None),
    (10, "Dick The Bruiser",     5,  "1971-10-14","day","1971-11-26","day",  43, "Indianapolis","IN","USA",False, None),
    (11, "Baron von Raschke",    2,  "1971-11-26","day","1972-03-21","day", 116, "Detroit",     "MI","USA",False, None),
    (12, "Billy Red Cloud",      1,  "1972-03-21","day","1972-06-02","day",  73, "Indianapolis","IN","USA",False, None),
    (13, "Baron von Raschke",    3,  "1972-06-02","day","1973-03-31","day", 302, "Indianapolis","IN","USA",False, None),
    (14, "Bob Ellis",            1,  "1973-03-31","day","1974-01",   "month",None,"Indianapolis","IN","USA",False, None),
    (15, "Jimmy Valiant",        1,  "1974-01",   "month","1974-01", "month",None,"Detroit",     "MI","USA",False, None),
    (16, "Bob Ellis",            2,  "1974-01",   "month","1974-08-10","day",None,"Detroit",     "MI","USA",False, None),
    (17, "Ox Baker",             1,  "1974-08-10","day","1975-11-29","day", 476, "Indianapolis","IN","USA",False, None),
    (18, "Pepper Gomez",         1,  "1975-11-29","day","1976-05-01","day", 154, "Indianapolis","IN","USA",False, None),
    (19, "The Masked Strangler", 1,  "1976-05-01","day","1977-03-05","day", 308, "Indianapolis","IN","USA",False, None),
    (20, "Dick The Bruiser",     6,  "1977-03-05","day","1977-04-30","day",  56, "Indianapolis","IN","USA",False, None),
    (None,None,                  None,"1977-04-30","day","1977-06-18","day", 49, None,           None,None,True,  None),
    (21, "Ivan Koloff",          1,  "1977-06-18","day","1977-11-12","day", 147, "Indianapolis","IN","USA",False, None),
    (None,None,                  None,"1977-11-12","day","1977-12-26","day", 44, None,           None,None,True,  None),
    (22, "Dick The Bruiser",     7,  "1977-12-26","day","1979-04-28","day", 488, "Indianapolis","IN","USA",False, None),
    (None,None,                  None,"1979-04-28","day","1979-06-09","day", 42, None,           None,None,True,  None),
    (23, "Dick The Bruiser",     8,  "1979-06-09","day","1979-08-04","day",  56, "Indianapolis","IN","USA",False, None),
    (24, "King Kong Brody",      1,  "1979-08-04","day","1980-05-31","day", 301, "Indianapolis","IN","USA",False, None),
    (25, "Dick The Bruiser",     9,  "1980-05-31","day","1980-10-04","day", 126, "Indianapolis","IN","USA",False, None),
    (None,None,                  None,"1980-10-04","day","1980-11-01","day", 28, None,           None,None,True,  None),
    (26, "Ernie Ladd",           1,  "1980-11-01","day","1980-11-29","day",  28, "Indianapolis","IN","USA",False, None),
    (27, "Dick The Bruiser",    10,  "1980-11-29","day","1981-04-04","day", 126, "Indianapolis","IN","USA",False, None),
    (28, "Johnny Valiant",       1,  "1981-04-04","day","1981-04",   "month",None,"Indianapolis","IN","USA",False, None),
    (29, "Dick The Bruiser",    11,  "1981-04",   "month","1981-04-25","day",None,None,           None,None,False, None),
    (30, "Johnny Valiant",       2,  "1981-04-25","day","1981-07-24","day",  90, "Indianapolis","IN","USA",False, None),
    (31, "Bobo Brazil",          1,  "1981-07-24","day","1981-10-11","day",  79, "Bartonville", "IL","USA",False, None),
    (32, "Blackjack Mulligan",   1,  "1981-10-11","day","1981-11",   "month",None,"Indianapolis","IN","USA",False, None),
    (33, "Bobo Brazil",          2,  "1981-11",   "month","1982-02-13","day",None,None,           None,None,False, None),
    (None,None,                  None,"1982-02-13","day","1982-04-24","day", 70, None,           None,None,True,  None),
    (34, "Harley Race",          1,  "1982-04-24","day","1982-07",   "month",None,"Indianapolis","IN","USA",False, None),
    (None,None,                  None,"1982-07",   "month","1983-01","month",None,None,          None,None,True,  None),
    (35, "Dick The Bruiser",    12,  "1983-01",   "month","1983-06-25","day",None,None,           None,None,False, None),
    (36, "Bobby Colt",           1,  "1983-06-25","day","1984-01-07","day", 196, "Indianapolis","IN","USA",False, None),
    (37, "Spike Huber",          1,  "1984-01-07","day","1984",      "year",None,"Indianapolis","IN","USA",False, None),
    (38, "Stormy Granzig",       1,  "1984",      "year","1984-07",  "month",None,None,          None,None,False, None),
    (39, "Greg Wojokowski",      1,  "1984-07",   "month","1985-01-29","day",None,"Indianapolis","IN","USA",False, None),
    (40, "Dick The Bruiser",    13,  "1985-01-29","day","1985",      "year",None,"Indianapolis","IN","USA",False, None),
    (41, "Greg Wojokowski",      2,  "1985",      "year","1986-08-14","day",None,None,           None,None,False, None),
    (42, "Scott Rechsteiner",    1,  "1986-08-14","day","1987-05-03","day", 262, "Dearborn",    "MI","USA",False, None),
    (43, "Greg Wojokowski",      3,  "1987-05-03","day","1988",      "year",None,"Toledo",      "OH","USA",False, None),
    # Cagematch shows this vacancy as "xx.xx.1988 - 16.04.1987" — endpoints
    # are reversed relative to chronology. Preserved as recorded; flag it.
    (None,None,                  None,"1988",      "year","1987-04-16","day",None,None,         None,None,True,
        "Cagematch lists this vacancy with end_date earlier than start_date "
        "(xx.xx.1988 → 16.04.1987). Likely a source data error; verify before publishing."),
    (44, "Golden Lion",          1,  "1987-04-16","day","1988",      "year",None,"Toledo",      "OH","USA",False,
        "Win date 1987-04-16 predates Greg Wojokowski's third reign start (1987-05-03) "
        "in cagematch's lineage — verify before publishing."),
]


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------
def database_url() -> str:
    if url := os.environ.get("DATABASE_URL"):
        return url
    host = os.environ.get("PWBIB_PG_HOST", "localhost")
    port = os.environ.get("PWBIB_PG_PORT", "5432")
    db   = os.environ.get("PWBIB_PG_DB", "wrestling_bibliography")
    user = os.environ.get("PWBIB_PG_USER")
    auth = f"{user}@" if user else ""
    return f"postgresql://{auth}{host}:{port}/{db}"


def upsert_title(cur, *, name: str, status: str, title_type: str, weight_class: str,
                 territory_id: Optional[int], promotion_name: str,
                 inception_date: str, retired_date: Optional[str],
                 cagematch_id: str, notes: str) -> int:
    cur.execute("SELECT id FROM titles WHERE cagematch_id = %s", (cagematch_id,))
    row = cur.fetchone()
    if row:
        title_id = row[0]
        cur.execute("""
            UPDATE titles
               SET name = %s, status = %s, title_type = %s, weight_class = %s,
                   territory_id = %s, promotion_name = %s,
                   inception_date = %s, retired_date = %s, notes = %s
             WHERE id = %s
        """, (name, status, title_type, weight_class, territory_id, promotion_name,
              inception_date, retired_date, notes, title_id))
        return title_id
    cur.execute("""
        INSERT INTO titles (name, status, title_type, weight_class,
                            territory_id, promotion_name,
                            inception_date, retired_date, cagematch_id, notes)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        RETURNING id
    """, (name, status, title_type, weight_class, territory_id, promotion_name,
          inception_date, retired_date, cagematch_id, notes))
    return cur.fetchone()[0]


def upsert_title_alias(cur, title_id: int, name: str, effective_from: str,
                       effective_to: Optional[str], notes: Optional[str]) -> None:
    cur.execute("""
        INSERT INTO title_aliases (title_id, name, effective_from, effective_to, notes)
        VALUES (%s,%s,%s,%s,%s)
        ON CONFLICT (title_id, name, effective_from) DO UPDATE
            SET effective_to = EXCLUDED.effective_to,
                notes = EXCLUDED.notes
    """, (title_id, name, effective_from, effective_to, notes))


def upsert_wrestler(cur, name: str, cagematch_id: Optional[str]) -> int:
    """
    Match priority:
      1. cagematch_id (when present)
      2. primary_ring_name (case-insensitive)
    Inserts a stub row when no match found.
    """
    if cagematch_id:
        cur.execute("SELECT id FROM wrestlers WHERE cagematch_id = %s", (cagematch_id,))
        row = cur.fetchone()
        if row:
            return row[0]

    cur.execute("SELECT id, cagematch_id FROM wrestlers WHERE LOWER(primary_ring_name) = LOWER(%s)", (name,))
    row = cur.fetchone()
    if row:
        wid, existing_cm = row
        if cagematch_id and not existing_cm:
            cur.execute("UPDATE wrestlers SET cagematch_id = %s WHERE id = %s", (cagematch_id, wid))
        return wid

    cur.execute("""
        INSERT INTO wrestlers (primary_ring_name, primary_role, cagematch_id, notes)
        VALUES (%s, 'wrestler', %s, %s)
        RETURNING id
    """, (name, cagematch_id,
          f"Imported from cagematch.net WWA World Heavyweight Championship lineage "
          f"(cmId {cagematch_id or 'none'}). Metadata sparse — verify before publishing."))
    return cur.fetchone()[0]


def insert_reign(cur, *, title_id: int, wrestler_id: Optional[int], is_vacancy: bool,
                 sequence_order: int, reign_number: Optional[int],
                 reign_for_wrestler: Optional[int],
                 start_date: Optional[str], start_prec: str,
                 end_date: Optional[str], end_prec: str,
                 duration_days: Optional[int],
                 city: Optional[str], state: Optional[str], country: Optional[str],
                 source_url: str, notes: Optional[str]) -> bool:
    cur.execute("SELECT id FROM reigns WHERE title_id = %s AND sequence_order = %s",
                (title_id, sequence_order))
    if cur.fetchone():
        cur.execute("""
            UPDATE reigns
               SET wrestler_id = %s, is_vacancy = %s, reign_number = %s,
                   reign_number_for_wrestler = %s,
                   start_date = %s, start_date_precision = %s,
                   end_date = %s, end_date_precision = %s,
                   duration_days = %s,
                   won_in_city = %s, won_in_state = %s, won_in_country = %s,
                   source_url = %s, notes = %s
             WHERE title_id = %s AND sequence_order = %s
        """, (wrestler_id, is_vacancy, reign_number, reign_for_wrestler,
              start_date, start_prec, end_date, end_prec, duration_days,
              city, state, country, source_url, notes,
              title_id, sequence_order))
        return False
    cur.execute("""
        INSERT INTO reigns (title_id, wrestler_id, is_vacancy, sequence_order,
                            reign_number, reign_number_for_wrestler,
                            start_date, start_date_precision,
                            end_date, end_date_precision,
                            duration_days,
                            won_in_city, won_in_state, won_in_country,
                            source_url, notes)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """, (title_id, wrestler_id, is_vacancy, sequence_order,
          reign_number, reign_for_wrestler,
          start_date, start_prec, end_date, end_prec,
          duration_days, city, state, country, source_url, notes))
    return True


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    url = database_url()
    print(f"Connecting: {url}")
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            # Look up WWA territory by cagematch_id (103 = WWA Indianapolis).
            cur.execute("SELECT id, name FROM territories WHERE cagematch_id = %s",
                        (WWA_TERRITORY_CM_ID,))
            terr = cur.fetchone()
            if terr:
                territory_id, territory_name = terr
                print(f"WWA territory matched: id={territory_id}, name={territory_name!r}")
            else:
                territory_id, territory_name = None, None
                print(f"WWA territory (cagematch_id={WWA_TERRITORY_CM_ID}) not found "
                      f"— linking title with promotion_name only")

            # ---- 1. Title ----
            title_id = upsert_title(
                cur,
                name="WWA World Heavyweight Championship",
                status="inactive",
                title_type="singles",
                weight_class="heavyweight",
                territory_id=territory_id,
                promotion_name="World Wrestling Association",
                inception_date="1964-06-22",
                retired_date="1988",
                cagematch_id=TITLE_CAGEMATCH_ID,
                notes=("Primary singles title of the World Wrestling Association "
                       "(Indianapolis-based, Dick the Bruiser/Wilbur Snyder territory). "
                       f"Source: {SOURCE_URL}"),
            )
            print(f"titles: id={title_id}")

            upsert_title_alias(
                cur, title_id,
                name="WWA World Heavyweight Championship",
                effective_from="1964-06-22",
                effective_to=None,
                notes="Cagematch records this name from 22.06.1964 onward.",
            )

            # ---- 2. Wrestlers ----
            wrestler_ids: dict[str, int] = {}
            for name, cm_id in WRESTLERS.items():
                wid = upsert_wrestler(cur, name, cm_id)
                wrestler_ids[name] = wid
            print(f"wrestlers upserted: {len(wrestler_ids)}")

            # ---- 3. Reigns ----
            inserted = 0
            updated = 0
            for seq, row in enumerate(REIGNS, start=1):
                (reign_number, wname, reign_for_wrestler,
                 start_date, start_prec, end_date, end_prec,
                 duration_days, city, state, country, is_vacancy, notes) = row
                wid = None if is_vacancy else wrestler_ids[wname]
                was_new = insert_reign(
                    cur,
                    title_id=title_id,
                    wrestler_id=wid,
                    is_vacancy=is_vacancy,
                    sequence_order=seq,
                    reign_number=reign_number,
                    reign_for_wrestler=reign_for_wrestler,
                    start_date=start_date,
                    start_prec=start_prec,
                    end_date=end_date,
                    end_prec=end_prec,
                    duration_days=duration_days,
                    city=city,
                    state=state,
                    country=country,
                    source_url=SOURCE_URL,
                    notes=notes,
                )
                if was_new:
                    inserted += 1
                else:
                    updated += 1
            print(f"reigns: inserted={inserted}, updated={updated}, total={len(REIGNS)}")

        conn.commit()

        # ---- Verification ----
        with conn.cursor() as cur:
            cur.execute("""
                SELECT COUNT(*) FILTER (WHERE is_vacancy = FALSE),
                       COUNT(*) FILTER (WHERE is_vacancy = TRUE),
                       COUNT(*)
                  FROM reigns WHERE title_id = %s
            """, (title_id,))
            held, vacant, total = cur.fetchone()
            print(f"sanity: {held} held + {vacant} vacant = {total} rows")

            cur.execute("""
                SELECT COUNT(*) FROM reigns r
                JOIN wrestlers w ON w.id = r.wrestler_id
                WHERE r.title_id = %s AND w.primary_ring_name = 'Dick The Bruiser'
            """, (title_id,))
            print(f"sanity: Dick The Bruiser reigns = {cur.fetchone()[0]} (expected 13)")

    print("Ingest complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
