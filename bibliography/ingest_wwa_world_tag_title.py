#!/usr/bin/env python3
"""
ingest_wwa_world_tag_title.py

Inserts the WWA World Tag Team Championship (cagematch id=915) and its
73 numbered reigns + 6 vacancies into the titles / reigns /
reign_participants tables. Upserts wrestlers along the way.

Source: https://www.cagematch.net/?id=5&nr=915  (captured 2026-04-28)

Postgres only. Idempotent.

Run AFTER:
    python3 bibliography/migrate_titles_reigns.py
    python3 bibliography/migrate_titles_tag_support.py
    python3 bibliography/ingest_wwa_world_title.py    # (singles, optional)
Then:
    python3 bibliography/ingest_wwa_world_tag_title.py
"""
from __future__ import annotations

import os
import sys
from typing import Optional

import psycopg


SOURCE_URL = "https://www.cagematch.net/?id=5&nr=915"
TITLE_CAGEMATCH_ID = "915"
WWA_TERRITORY_CM_ID = "103"


# ---------------------------------------------------------------------------
# Wrestler roster: name -> cagematch_id (None for those without a profile).
# Cagematch sometimes maps multiple ring names onto a single wrestler row
# (the cm_id is what matters; my upsert keys off it first).
#
# Known overlaps in this title's roster:
#   2349  Igor Volkoff  ==  Pvt. Zarinoff LeBeouf
#   2605  Jerry Valiant ==  Assassin #1   (and == The Masked Strangler from singles)
#   5068  Jack Dillinger ==  Pvt. Don Fargo
# ---------------------------------------------------------------------------
WRESTLERS: dict[str, Optional[str]] = {
    "Dick The Bruiser":         "1149",
    "Wilbur Snyder":            "3275",
    "Angelo Poffo":              "631",
    "Nicoli Volkoff":           "9027",
    "Karl von Brauner":         "7300",
    "Kurt von Brauner":          "390",
    "Boris Volkoff":            "3051",
    "Assassin #1":              "2605",
    "Assassin #2":              "3283",
    "Moose Cholak":              "942",
    "Luis Martinez":            "6762",
    "Chris Markoff":            "1993",
    "The Crusher":              "1138",
    "Dr. Moto":                 "1423",
    "Mitsu Arakawa":            "3036",
    "Pat O'Connor":             "1945",
    "Frank Dillinger":         "15935",
    "Jack Dillinger":           "5068",
    "Jim Dillinger":            "3246",
    "Bill Miller":              "1392",
    "Al Costello":               "953",
    "Don Kent":                 "3274",
    "Paul Christy":             "5457",
    "Blackjack Lanza":           "491",
    "Blackjack Mulligan":        "325",
    "Baron von Raschke":         "262",
    "Ernie Ladd":               "1139",
    "Bruno Sammartino":          "243",
    "Jimmy Valiant":            "1150",
    "Johnny Valiant":            "868",
    "Pepper Gomez":             "1973",
    "Pvt. Don Fargo":           "5068",
    "Sgt. Jacques Goulet":       "326",
    "Pvt. Zarinoff LeBeouf":    "2349",
    "Chuck O'Connor":            "310",
    "Ox Baker":                 "1441",
    "Bounty Hunter I":          "6556",
    "Bounty Hunter II":         "6557",
    "Dominic DeNucci":          "1418",
    "Igor Volkoff":             "2349",
    "Roger Kirby":              "5894",
    "Spike Huber":              "2531",
    "Mike Kelly":              "17856",
    "Pat Kelly":                "3140",
    "Ali Hassan":               "8553",
    "Steve Regal":              "3968",
    "Dream Machine":            "2944",
    "Rick McGraw":              "3323",
    "Jerry Valiant":            "2605",
    "Jeff Van Camp":            "7303",
    "Madd Maxx":                "2542",
    "Super Maxx":               "3740",
    "Bobby Colt":               "8100",
    "JR Hogg":                  "5870",
    "King Harley Hogg":         "2557",
    "Stormy Granzig":            None,
    "Bobo Brazil":               "852",
    "Chris Carter":             "7957",
    "Calypso Jim":              "3609",
    "Polynesian Wildman":        None,
    "Prince Mama Mohammad":      None,
    "Denny Kass":               "2220",
    "Mohammad Saad":            "5763",
    "Jerry Graham Jr.":         "9306",
    "Scott Rechsteiner":         "844",
    "Al Snow":                   "179",
    "Mickey Doyle":             "2219",
    "Abdullah The Great":         None,
}


# ---------------------------------------------------------------------------
# Reigns in CHRONOLOGICAL order (oldest first). Each tuple:
# (reign_number, team_name, [partners], reign_for_team,
#  start, start_prec, end, end_prec, duration,
#  city, state, country, is_vacancy, notes)
# ---------------------------------------------------------------------------
N5 = ["Dick The Bruiser", "Wilbur Snyder"]    # most-frequent unnamed pairing
REIGNS = [
    # 1
    (1,  None,                    N5,                                         1, "1964-04-25","day","1964-07-31","day", 97, None,           None,None,False, None),
    (2,  None,                    ["Angelo Poffo","Nicoli Volkoff"],          1, "1964-07-31","day","1964-09-04","day", 35, "Indianapolis","IN","USA",False, None),
    (3,  None,                    N5,                                         2, "1964-09-04","day","1964-10",   "month",None,"Indianapolis","IN","USA",False, None),
    (4,  "The Von Brauners",      ["Karl von Brauner","Kurt von Brauner"],    1, "1964-10",   "month","1965-05-17","day",None,"Memphis",     "TN","USA",False, None),
    (5,  "The Volkoff Brothers",  ["Boris Volkoff","Nicoli Volkoff"],         1, "1965-05-17","day","1965-07-17","day", 61, "Memphis",     "TN","USA",False, None),
    (6,  "The Assassins",         ["Assassin #1","Assassin #2"],              1, "1965-07-17","day","1965-12-25","day",161, "Indianapolis","IN","USA",False, None),
    (7,  None,                    ["Moose Cholak","Wilbur Snyder"],           1, "1965-12-25","day","1966-03-03","day", 68, "Indianapolis","IN","USA",False, None),
    (8,  "The Assassins",         ["Assassin #1","Assassin #2"],              2, "1966-03-03","day","1966-06-11","day",100, "Fort Wayne",  "IN","USA",False, None),
    (9,  None,                    N5,                                         3, "1966-06-11","day","1966-06-25","day", 14, "Indianapolis","IN","USA",False, None),
    (10, "The Assassins",         ["Assassin #1","Assassin #2"],              3, "1966-06-25","day","1966-07-23","day", 28, "Indianapolis","IN","USA",False, None),
    (11, None,                    ["Luis Martinez","Wilbur Snyder"],          1, "1966-07-23","day","1966-09",   "month",None,"Indianapolis","IN","USA",False, None),
    (12, "The Devil's Duo",       ["Angelo Poffo","Chris Markoff"],           1, "1966-09",   "month","1967-01-21","day",None,None,           None,None,False, None),
    (13, None,                    ["Dick The Bruiser","The Crusher"],         1, "1967-01-21","day","1967-02-17","day", 27, "Indianapolis","IN","USA",False, None),
    (14, "The Devil's Duo",       ["Angelo Poffo","Chris Markoff"],           2, "1967-02-17","day","1967-07-15","day",148, "Indianapolis","IN","USA",False, None),
    (15, None,                    ["Dick The Bruiser","The Crusher"],         2, "1967-07-15","day","1967-10-13","day", 90, "Indianapolis","IN","USA",False, None),
    (16, None,                    ["Dr. Moto","Mitsu Arakawa"],               1, "1967-10-13","day","1968-08-24","day",316, "Indianapolis","IN","USA",False, None),
    (17, None,                    ["Pat O'Connor","Wilbur Snyder"],           1, "1968-08-24","day","1968-10-26","day", 63, "Indianapolis","IN","USA",False, None),
    (18, None,                    ["Dr. Moto","Mitsu Arakawa"],               2, "1968-10-26","day","1968-12-28","day", 63, "Elkhart",     "IN","USA",False, None),
    (19, None,                    ["Dick The Bruiser","The Crusher"],         3, "1968-12-28","day","1969-06-20","day",174, "Chicago",     "IL","USA",False, None),
    (20, "The Chain Gang",        ["Frank Dillinger","Jack Dillinger"],       1, "1969-06-20","day","1969-09",   "month",None,"Indianapolis","IN","USA",False, None),
    # vacancy
    (None,None,                   [],                                      None, "1969-09",   "month","1969-11-27","day",None,None,           None,None,True,  None),
    (21, "The Chain Gang",        ["Jack Dillinger","Jim Dillinger"],         2, "1969-11-27","day","1970-06-26","day",211, "Indianapolis","IN","USA",False, None),
    (22, None,                    ["Bill Miller","Dick The Bruiser"],         1, "1970-06-26","day","1970-07-17","day", 21, "Indianapolis","IN","USA",False, None),
    (23, "The Fabulous Kangaroos",["Al Costello","Don Kent"],                 1, "1970-07-17","day","1970-12-26","day",162, "Indianapolis","IN","USA",False, None),
    (24, None,                    ["Moose Cholak","Wilbur Snyder"],           2, "1970-12-26","day","1971-02-23","day", 59, "Indianapolis","IN","USA",False, None),
    # vacancy
    (None,None,                   [],                                      None, "1971-02-23","day","1971-03-27","day", 32, None,           None,None,True,  None),
    (25, None,                    ["Moose Cholak","Wilbur Snyder"],           3, "1971-03-27","day","1971-06-18","day", 83, "Indianapolis","IN","USA",False, None),
    (26, "The Fabulous Kangaroos",["Al Costello","Don Kent"],                 2, "1971-06-18","day","1971-08-21","day", 64, "Indianapolis","IN","USA",False, None),
    (27, None,                    ["Paul Christy","Wilbur Snyder"],           1, "1971-08-21","day","1971-11-06","day", 77, "Indianapolis","IN","USA",False, None),
    (28, "The Blackjacks",        ["Blackjack Lanza","Blackjack Mulligan"],   1, "1971-11-06","day","1972-12-02","day",392, "Detroit",     "MI","USA",False, None),
    (29, None,                    ["Dick The Bruiser","The Crusher"],         4, "1972-12-02","day","1973-02-24","day", 84, "Detroit",     "MI","USA",False, None),
    (30, None,                    ["Baron von Raschke","Ernie Ladd"],         1, "1973-02-24","day","1973-07-21","day",147, "Detroit",     "MI","USA",False, None),
    (31, "Annihilation Inc.",     ["Bruno Sammartino","Dick The Bruiser"],    1, "1973-07-21","day","1974-01-05","day",168, "Detroit",     "MI","USA",False, None),
    (32, "The Valiant Brothers",  ["Jimmy Valiant","Johnny Valiant"],         1, "1974-01-05","day","1974-01-25","day", 20, "Indianapolis","IN","USA",False, None),
    # vacancy
    (None,None,                   [],                                      None, "1974-01-25","day","1974-02-07","day", 13, None,           None,None,True,  None),
    (33, "The Valiant Brothers",  ["Jimmy Valiant","Johnny Valiant"],         2, "1974-02-07","day","1974-05-04","day", 86, "Indianapolis","IN","USA",False, None),
    (34, None,                    ["Pepper Gomez","Wilbur Snyder"],           1, "1974-05-04","day","1974-09-21","day",140, "Indianapolis","IN","USA",False, None),
    (35, "The Legionnaires",      ["Pvt. Don Fargo","Sgt. Jacques Goulet"],   1, "1974-09-21","day","1975-04",   "month",None,"Indianapolis","IN","USA",False, None),
    (36, "The Legionnaires",      ["Pvt. Zarinoff LeBeouf","Sgt. Jacques Goulet"], 2,"1975-04","month","1975-09-20","day",None,None,         None,None,False, None),
    (37, None,                    ["Dick The Bruiser","The Crusher"],         4, "1975-09-20","day","1976-03-13","day",175, "Indianapolis","IN","USA",False,
        "Cagematch labels this as Bruiser & Crusher's 4th reign, matching #29's "
        "label. By chronological count this should be their 5th. Preserved as recorded; verify."),
    (38, None,                    ["Chuck O'Connor","Ox Baker"],              1, "1976-03-13","day","1976-05-01","day", 49, "Indianapolis","IN","USA",False, None),
    (39, None,                    ["Dick The Bruiser","The Crusher"],         5, "1976-05-01","day","1976-08-14","day",105, "Indianapolis","IN","USA",False, None),
    (40, "The Bounty Hunters",    ["Bounty Hunter I","Bounty Hunter II"],     1, "1976-08-14","day","1977-02-12","day",182, "Indianapolis","IN","USA",False, None),
    (41, None,                    ["Moose Cholak","Paul Christy"],            1, "1977-02-12","day","1977-06-18","day",126, "Indianapolis","IN","USA",False, None),
    (42, "The Valiant Brothers",  ["Jimmy Valiant","Johnny Valiant"],         3, "1977-06-18","day","1978-03-04","day",259, "Indianapolis","IN","USA",False, None),
    (43, None,                    ["Dominic DeNucci","Wilbur Snyder"],        1, "1978-03-04","day","1978-07-22","day",140, "Indianapolis","IN","USA",False, None),
    (44, "The Valiant Brothers",  ["Jimmy Valiant","Johnny Valiant"],         4, "1978-07-22","day","1978-12-02","day",133, "Indianapolis","IN","USA",False, None),
    (45, None,                    ["Pepper Gomez","Wilbur Snyder"],           2, "1978-12-02","day","1979-04-01","day",120, "Indianapolis","IN","USA",False, None),
    (46, None,                    ["Igor Volkoff","Roger Kirby"],             1, "1979-04-01","day","1979-05",   "month",None,"Indianapolis","IN","USA",False, None),
    # vacancy
    (None,None,                   [],                                      None, "1979-05",   "month","1979-06-09","day",None,None,         None,None,True,  None),
    (47, None,                    ["Paul Christy","Roger Kirby"],             1, "1979-06-09","day","1979-10-07","day",120, "Indianapolis","IN","USA",False, None),
    (48, None,                    ["Dick The Bruiser","Spike Huber"],         1, "1979-10-07","day","1980-04-27","day",203, "Indianapolis","IN","USA",False, None),
    (49, None,                    ["Jerry Valiant","Roger Kirby"],            1, "1980-04-27","day","1980-08-16","day",111, "Indianapolis","IN","USA",False, None),
    (50, None,                    ["Spike Huber","Wilbur Snyder"],            1, "1980-08-16","day","1981-06-13","day",301, "Indianapolis","IN","USA",False, None),
    (51, "The Kelly Twins",       ["Mike Kelly","Pat Kelly"],                 1, "1981-06-13","day","1982-02",   "month",None,"Indianapolis","IN","USA",False, None),
    (52, None,                    ["Spike Huber","Wilbur Snyder"],            2, "1982-02",   "month","1982-06-05","day",None,None,         None,None,False, None),
    (53, None,                    ["Abdullah The Great","Ali Hassan"],        1, "1982-06-05","day","1982-07",   "month",None,"Indianapolis","IN","USA",False, None),
    (54, None,                    ["Spike Huber","Steve Regal"],              1, "1982-07",   "month","1982-09-25","day",None,None,         None,None,False, None),
    (55, "The New York Dolls",    ["Dream Machine","Rick McGraw"],            1, "1982-09-25","day","1982-12",   "month",None,"Memphis",     "TN","USA",False, None),
    (56, None,                    ["Spike Huber","Steve Regal"],              2, "1982-12",   "month","1983-06",  "month",None,None,         None,None,False, None),
    (57, None,                    ["Abdullah The Great","Jerry Valiant"],     1, "1983-06",   "month","1984-01-07","day",None,None,         None,None,False, None),
    (58, None,                    ["Dick The Bruiser","Jeff Van Camp"],       1, "1984-01-07","day","1984-09",   "month",None,"Indianapolis","IN","USA",False, None),
    (59, "The Wild Warriors",     ["Madd Maxx","Super Maxx"],                 1, "1984-09",   "month","1985",     "year",None,None,         None,None,False, None),
    (60, None,                    ["Bobby Colt","Dick The Bruiser"],          1, "1985",      "year","1985-01-19","day",None,None,         None,None,False, None),
    (61, "The Wild Hoggs",        ["JR Hogg","King Harley Hogg"],             1, "1985-01-19","day","1985",      "year",None,"Indianapolis","IN","USA",False, None),
    (62, None,                    ["Chris Carter","Stormy Granzig"],          1, "1985",      "year","1985",      "year",None,None,         None,None,False, None),
    (63, None,                    ["Don Kent","Jerry Graham Jr."],            1, "1985",      "year",None,        "unknown",None,None,      None,None,False, None),
    (64, None,                    ["Bobo Brazil","Chris Carter"],             1, None,        "unknown",None,     "unknown",None,None,      None,None,False, None),
    (65, None,                    ["Don Kent","Jerry Graham Jr."],            2, None,        "unknown","1986",   "year",None,None,         None,None,False, None),
    (66, None,                    ["Calypso Jim","Chris Carter"],             1, "1986",      "year","1986",      "year",None,None,         None,None,False, None),
    (67, None,                    ["Polynesian Wildman","Prince Mama Mohammad"], 1, "1986",   "year","1986",      "year",None,None,         None,None,False, None),
    # vacancy
    (None,None,                   [],                                      None, "1986",      "year","1986",      "year",None,None,         None,None,True,  None),
    (68, None,                    ["Chris Carter","Denny Kass"],              1, "1986",      "year",None,        "unknown",None,None,      None,None,False, None),
    (69, None,                    ["Chris Carter","Mohammad Saad"],           1, None,        "unknown","1987-10-04","day",None,None,       None,None,False, None),
    (70, None,                    ["Jerry Graham Jr.","Scott Rechsteiner"],   1, "1987-10-04","day","1987-12-06","day", 63, None,         None,None,False, None),
    (71, None,                    ["Chris Carter","Don Kent"],                1, "1987-12-06","day","1987-12",   "month",None,"Toledo",      "OH","USA",False, None),
    # vacancy
    (None,None,                   [],                                      None, "1987-12",   "month","1988-02-14","day",None,None,         None,None,True,  None),
    (72, None,                    ["Calypso Jim","Chris Carter"],             2, "1988-02-14","day","1989-04-16","day",427, "Toledo",      "OH","USA",False, None),
    (73, "The Motor City Hitmen", ["Al Snow","Mickey Doyle"],                 1, "1989-04-16","day","1989",      "year",None,"Toledo",      "OH","USA",False, None),
]


# ---------------------------------------------------------------------------
# DB helpers
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


def upsert_title(cur, *, name, status, title_type, weight_class,
                 territory_id, promotion_name, inception_date, retired_date,
                 cagematch_id, notes) -> int:
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


def upsert_title_alias(cur, title_id, name, effective_from, effective_to, notes) -> None:
    cur.execute("""
        INSERT INTO title_aliases (title_id, name, effective_from, effective_to, notes)
        VALUES (%s,%s,%s,%s,%s)
        ON CONFLICT (title_id, name, effective_from) DO UPDATE
            SET effective_to = EXCLUDED.effective_to,
                notes = EXCLUDED.notes
    """, (title_id, name, effective_from, effective_to, notes))


def upsert_wrestler(cur, name: str, cagematch_id: Optional[str]) -> int:
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

    role = "tag_team" if name.lower().startswith(("the ",)) else "wrestler"
    cur.execute("""
        INSERT INTO wrestlers (primary_ring_name, primary_role, cagematch_id, notes)
        VALUES (%s, %s, %s, %s)
        RETURNING id
    """, (name, role, cagematch_id,
          f"Imported from cagematch.net WWA World Tag Team Championship lineage "
          f"(cmId {cagematch_id or 'none'}). Metadata sparse — verify before publishing."))
    return cur.fetchone()[0]


def upsert_reign(cur, *, title_id, wrestler_id, is_vacancy, sequence_order,
                 reign_number, reign_for_team, team_name,
                 start_date, start_prec, end_date, end_prec, duration_days,
                 city, state, country, source_url, notes) -> tuple[int, bool]:
    """Returns (reign_id, was_inserted)."""
    cur.execute("SELECT id FROM reigns WHERE title_id = %s AND sequence_order = %s",
                (title_id, sequence_order))
    row = cur.fetchone()
    if row:
        rid = row[0]
        cur.execute("""
            UPDATE reigns
               SET wrestler_id = %s, is_vacancy = %s, reign_number = %s,
                   reign_number_for_wrestler = %s, team_name = %s,
                   start_date = %s, start_date_precision = %s,
                   end_date = %s, end_date_precision = %s,
                   duration_days = %s,
                   won_in_city = %s, won_in_state = %s, won_in_country = %s,
                   source_url = %s, notes = %s
             WHERE id = %s
        """, (wrestler_id, is_vacancy, reign_number, reign_for_team, team_name,
              start_date, start_prec, end_date, end_prec, duration_days,
              city, state, country, source_url, notes, rid))
        return rid, False
    cur.execute("""
        INSERT INTO reigns (title_id, wrestler_id, is_vacancy, sequence_order,
                            reign_number, reign_number_for_wrestler, team_name,
                            start_date, start_date_precision,
                            end_date, end_date_precision,
                            duration_days,
                            won_in_city, won_in_state, won_in_country,
                            source_url, notes)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        RETURNING id
    """, (title_id, wrestler_id, is_vacancy, sequence_order,
          reign_number, reign_for_team, team_name,
          start_date, start_prec, end_date, end_prec,
          duration_days, city, state, country, source_url, notes))
    return cur.fetchone()[0], True


def upsert_reign_participant(cur, reign_id: int, wrestler_id: int,
                             position: int, ring_name_used: str) -> None:
    cur.execute("""
        INSERT INTO reign_participants (reign_id, wrestler_id, position, ring_name_used)
        VALUES (%s,%s,%s,%s)
        ON CONFLICT (reign_id, wrestler_id) DO UPDATE
            SET position = EXCLUDED.position,
                ring_name_used = EXCLUDED.ring_name_used
    """, (reign_id, wrestler_id, position, ring_name_used))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    url = database_url()
    print(f"Connecting: {url}")
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name FROM territories WHERE cagematch_id = %s",
                        (WWA_TERRITORY_CM_ID,))
            terr = cur.fetchone()
            territory_id = terr[0] if terr else None
            print(f"WWA territory: {terr or 'not found — using promotion_name only'}")

            # ---- 1. Title ----
            title_id = upsert_title(
                cur,
                name="WWA World Tag Team Championship",
                status="inactive",
                title_type="tag",
                weight_class=None,
                territory_id=territory_id,
                promotion_name="World Wrestling Association",
                inception_date="1964-04-25",
                retired_date="1989",
                cagematch_id=TITLE_CAGEMATCH_ID,
                notes=("Top tag-team title of the World Wrestling Association "
                       "(Indianapolis-based). Held by Bruiser & Snyder for the inaugural "
                       f"reign on 25.04.1964. Source: {SOURCE_URL}"),
            )
            print(f"titles: id={title_id}")

            upsert_title_alias(cur, title_id,
                name="WWA World Tag Team Championship",
                effective_from="1964-04-25", effective_to=None,
                notes="Cagematch records this name from 25.04.1964 onward.")

            # ---- 2. Wrestlers ----
            wrestler_ids: dict[str, int] = {}
            for name, cm_id in WRESTLERS.items():
                wrestler_ids[name] = upsert_wrestler(cur, name, cm_id)
            print(f"wrestlers upserted: {len(wrestler_ids)}")

            # ---- 3. Reigns + participants ----
            r_inserted = r_updated = 0
            p_count = 0
            for seq, row in enumerate(REIGNS, start=1):
                (reign_number, team_name, partners, reign_for_team,
                 start_date, start_prec, end_date, end_prec,
                 duration_days, city, state, country, is_vacancy, notes) = row

                rid, was_new = upsert_reign(
                    cur,
                    title_id=title_id,
                    wrestler_id=None,            # tag title — always null
                    is_vacancy=is_vacancy,
                    sequence_order=seq,
                    reign_number=reign_number,
                    reign_for_team=reign_for_team,
                    team_name=team_name,
                    start_date=start_date, start_prec=start_prec,
                    end_date=end_date, end_prec=end_prec,
                    duration_days=duration_days,
                    city=city, state=state, country=country,
                    source_url=SOURCE_URL,
                    notes=notes,
                )
                if was_new: r_inserted += 1
                else:       r_updated += 1

                if not is_vacancy:
                    for position, partner_name in enumerate(partners, start=1):
                        wid = wrestler_ids[partner_name]
                        upsert_reign_participant(cur, rid, wid, position, partner_name)
                        p_count += 1

            print(f"reigns: inserted={r_inserted}, updated={r_updated}, total={len(REIGNS)}")
            print(f"reign_participants written/refreshed: {p_count}")

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
            print(f"sanity: {held} held + {vacant} vacant = {total} rows (expect 73 + 6 = 79)")

            cur.execute("""
                SELECT COUNT(*)
                  FROM reign_participants rp
                  JOIN reigns r ON r.id = rp.reign_id
                 WHERE r.title_id = %s
            """, (title_id,))
            print(f"sanity: reign_participants linked to this title: {cur.fetchone()[0]} (expect 146)")

            # Spot-check: how many reigns did Dick The Bruiser participate in?
            cur.execute("""
                SELECT COUNT(*)
                  FROM reign_participants rp
                  JOIN reigns r ON r.id = rp.reign_id
                  JOIN wrestlers w ON w.id = rp.wrestler_id
                 WHERE r.title_id = %s AND w.cagematch_id = '1149'
            """, (title_id,))
            print(f"sanity: Dick The Bruiser tag reigns = {cur.fetchone()[0]}")

    print("Tag title ingest complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
