#!/usr/bin/env python3
"""
Seed the wrestlers / territories / wrestler_territory_runs tables with
30 underdocumented mid-card territorial subjects + ~14 territories.

Idempotent: uses INSERT OR IGNORE on territories (UNIQUE name) and
SELECT-then-INSERT for wrestlers (matched by primary_ring_name).

Dates and run timeframes are approximate where verified primary sources
were not consulted; uncertain facts are tagged in notes with [VERIFY].
"""
import sqlite3
import os
DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wrestling_bibliography.db")

# ---- Territories ----------------------------------------------------------

TERRITORIES = [
    # (name, short_name, region, nwa_member, hq_city, hq_state, founded, closed, lineage, notes)
    ("Continental Wrestling Association", "CWA / Memphis", "Mid-South",
     1, "Memphis", "TN", 1977, 1989,
     "Jerry Jarrett, Jerry Lawler",
     "Memphis-based; ran the Mid-South Coliseum on Mondays. Merged into USWA in 1989."),
    ("Mid-South Wrestling", "Mid-South", "Mid-South",
     1, "Shreveport", "LA", 1979, 1987,
     "Bill Watts, Cowboy Bill Watts (UWF rebrand 1986)",
     "Watts split from Tri-State; rebranded UWF in 1986; sold to Crockett 1987."),
    ("World Class Championship Wrestling", "WCCW", "Texas",
     1, "Dallas", "TX", 1982, 1990,
     "Fritz Von Erich (Jack Adkisson), Ken Mantell, Kerry Von Erich",
     "Spun out of Big Time Wrestling Dallas. NWA exit 1986. Folded into USWA 1989."),
    ("Big Time Wrestling (Dallas)", "Big Time / Texas", "Texas",
     1, "Dallas", "TX", 1966, 1982,
     "Fritz Von Erich, Ed McLemore",
     "WCCW's predecessor brand under the Adkisson family."),
    ("Pacific Northwest Wrestling", "PNW / Don Owen", "Pacific Northwest",
     1, "Portland", "OR", 1948, 1992,
     "Don Owen, Sandy Barr",
     "Long-running Owen family promotion. Portland Sports Arena home base."),
    ("American Wrestling Association", "AWA", "Upper Midwest",
     0, "Minneapolis", "MN", 1960, 1991,
     "Verne Gagne, Wally Karbo",
     "Ran Minneapolis, Chicago, Milwaukee, Winnipeg. Talent raids by WWF gutted it mid-80s."),
    ("Championship Wrestling from Florida", "CWF / Florida", "Florida",
     1, "Tampa", "FL", 1961, 1987,
     "Eddie Graham, Mike Graham",
     "Eddie Graham's territory. Sold to Crockett 1987."),
    ("Georgia Championship Wrestling", "GCW / Georgia", "Southeast",
     1, "Atlanta", "GA", 1944, 1985,
     "Paul Jones (promoter), Jim Barnett, Ole Anderson",
     "Black Saturday 1984 marked the WWF takeover; closed under Crockett 1985."),
    ("Jim Crockett Promotions", "JCP / Mid-Atlantic", "Mid-Atlantic",
     1, "Charlotte", "NC", 1931, 1988,
     "Jim Crockett Sr., Jim Crockett Jr., Dusty Rhodes (book)",
     "Mid-Atlantic NWA territory; sold to Turner 1988, became WCW."),
    ("Stampede Wrestling", "Stampede", "Western Canada",
     1, "Calgary", "AB", 1948, 1989,
     "Stu Hart, Bruce Hart",
     "Hart family promotion. Closed 1984 (sold to WWF), reopened 1985, closed again 1989."),
    ("World Wrestling Council", "WWC", "Puerto Rico",
     1, "San Juan", "PR", 1973, None,
     "Carlos Colón, Victor Jovica",
     "Long-running Puerto Rican promotion. Still active under Colón family."),
    ("World Wrestling Federation", "WWF", "National",
     0, "Stamford", "CT", 1963, None,
     "Vincent J. McMahon, Vincent K. McMahon",
     "Northeast territory that went national in 1984. Tracked here for cross-territory runs only."),
    ("Smoky Mountain Wrestling", "SMW", "Appalachia",
     0, "Knoxville", "TN", 1991, 1995,
     "Jim Cornette",
     "Cornette's deliberately old-school territory; ran for four years."),
    ("United States Wrestling Association", "USWA", "Mid-South / Texas",
     0, "Memphis", "TN", 1989, 1997,
     "Jerry Jarrett, Jerry Lawler",
     "Merger of CWA and WCCW. Carried Memphis/Dallas into the 90s."),
    ("World Championship Wrestling", "WCW", "National",
     0, "Atlanta", "GA", 1988, 2001,
     "Ted Turner, Jim Herd, Bill Watts, Eric Bischoff",
     "Successor to JCP under Turner. Tracked here for cross-territory runs."),
]

# ---- Wrestlers ------------------------------------------------------------
# Each entry: dict with wrestler fields + 'runs' list of (territory_name, start_y, end_y, role_during, primary, notes)

WRESTLERS = [
    # ---- Memphis / CWA group ---------------------------------------------
    {
        "primary_ring_name": "Plowboy Frazier",
        "legal_name": "Stan Frazier",
        "other_ring_names": "Uncle Elmer, Giant Frazier",
        "born_date": "1937", "died_date": "1992", "living": 0,
        "debut_year": 1969, "retired_year": 1990,
        "primary_role": "wrestler",
        "hometown_billed": "Cullman, Alabama",
        "convention_status": "none",
        "midcard_files_status": "queued", "midcard_files_priority": 2,
        "why_they_mattered": "A 600-pound comedy giant who held down Memphis undercards for over a decade and got a national WWF moment as Uncle Elmer in the 1985 SNME wedding angle. The kind of working big man the territories specialized in.",
        "notes": "Death year 1992 [VERIFY date].",
        "runs": [
            ("Continental Wrestling Association", 1976, 1985, "mid", 1, "Long-running Memphis comedy/midcard fixture."),
            ("World Wrestling Federation", 1985, 1986, "enhancement", 0, "Uncle Elmer character; SNME wedding angle Oct 1985."),
        ],
    },
    {
        "primary_ring_name": "Tojo Yamamoto",
        "legal_name": None,  # commonly listed as Harold Watanabe — [VERIFY]
        "other_ring_names": None,
        "born_date": "1927", "died_date": "1992", "living": 0,
        "debut_year": 1955, "retired_year": 1989,
        "primary_role": "wrestler",
        "hometown_billed": "Tokyo, Japan",
        "convention_status": "none",
        "midcard_files_status": "queued", "midcard_files_priority": 1,
        "why_they_mattered": "Japanese-American who played the Japanese heel across the South for 30 years and later managed in Memphis. A walking history of how the territories handled Asian heel characters before and after Vietnam.",
        "notes": "Real name commonly cited as Harold Watanabe but contested across sources [VERIFY]. Korean War veteran [VERIFY].",
        "runs": [
            ("Continental Wrestling Association", 1977, 1989, "mid", 1, "Memphis fixture; later managed for Lawler/Jarrett."),
            ("Championship Wrestling from Florida", 1968, 1972, "mid", 0, "Pre-Memphis era [VERIFY years]."),
        ],
    },
    {
        "primary_ring_name": "Pat Tanaka",
        "legal_name": "Patrick Tanaka",
        "other_ring_names": "Half of Badd Company",
        "born_date": "1961", "died_date": None, "living": 1,
        "debut_year": 1983, "retired_year": 2010,
        "primary_role": "wrestler",
        "hometown_billed": "Tokyo, Japan",
        "convention_status": "occasional",
        "midcard_files_status": "queued", "midcard_files_priority": 1,
        "why_they_mattered": "Son of Duke Keomuka. Half of Badd Company with Paul Diamond — the AWA tag team that bridged the territorial style and the late-80s tag boom. A native Hawaiian who worked Japanese heel and worked it well.",
        "notes": "",
        "runs": [
            ("Championship Wrestling from Florida", 1984, 1985, "mid", 0, "Early career."),
            ("Continental Wrestling Association", 1985, 1986, "mid", 0, "Memphis run."),
            ("American Wrestling Association", 1986, 1988, "upper-mid", 1, "Badd Company w/ Paul Diamond; AWA World Tag Champs."),
            ("World Wrestling Federation", 1989, 1992, "mid", 0, "Orient Express w/ Sato then Kato."),
        ],
    },
    {
        "primary_ring_name": "Sonny King",
        "legal_name": "Charles King",
        "other_ring_names": None,
        "born_date": "1942", "died_date": "1989", "living": 0,
        "debut_year": 1968, "retired_year": 1985,
        "primary_role": "wrestler",
        "hometown_billed": "Atlanta, Georgia",
        "convention_status": "none",
        "midcard_files_status": "queued", "midcard_files_priority": 2,
        "why_they_mattered": "Held the WWWF World Tag Team titles with Chief Jay Strongbow in 1972 — one of the few Black wrestlers in the WWWF main event tag scene of the era. Spent most of his career in Memphis and Mid-South.",
        "notes": "Death year 1989 [VERIFY exact date].",
        "runs": [
            ("World Wrestling Federation", 1971, 1973, "upper-mid", 0, "WWWF tag champ with Chief Jay Strongbow 1972."),
            ("Continental Wrestling Association", 1976, 1983, "mid", 1, "Memphis-area regular."),
        ],
    },
    {
        "primary_ring_name": "Eddie Marlin",
        "legal_name": "Walter Eddie Marlin",
        "other_ring_names": None,
        "born_date": "1932", "died_date": "2017", "living": 0,
        "debut_year": 1959, "retired_year": 1990,
        "primary_role": "wrestler",
        "hometown_billed": "Tennessee",
        "convention_status": "none",
        "midcard_files_status": "queued", "midcard_files_priority": 3,
        "why_they_mattered": "Promoter, on-screen authority figure, and journeyman wrestler in the Jarrett-Lawler Memphis territory for two-plus decades. The kind of behind-the-scenes hand whose absence would've collapsed the operation.",
        "notes": "Father-in-law of Jeff Jarrett; father of Jerry Jarrett's wife [VERIFY relationship chain].",
        "runs": [
            ("Continental Wrestling Association", 1977, 1989, "mid", 1, "On-screen 'commissioner' and bookerly presence."),
            ("United States Wrestling Association", 1989, 1995, "mid", 0, "Continued authority-figure role into USWA era."),
        ],
    },

    # ---- Mid-South / WCCW / Texas group ----------------------------------
    {
        "primary_ring_name": "Iceman King Parsons",
        "legal_name": "Herbert Parsons",
        "other_ring_names": "Iceman Parsons",
        "born_date": "1949", "died_date": None, "living": 1,
        "debut_year": 1978, "retired_year": 2010,
        "primary_role": "wrestler",
        "hometown_billed": "Houston, Texas",
        "convention_status": "occasional",
        "midcard_files_status": "queued", "midcard_files_priority": 1,
        "why_they_mattered": "Top Black babyface in WCCW and Mid-South in the 1980s. Tag champ with Brickhouse Brown; the Iceman dance hook predated wrestlers-as-personalities going national.",
        "notes": "Real name [VERIFY].",
        "runs": [
            ("Mid-South Wrestling", 1980, 1983, "mid", 0, "Early Mid-South run."),
            ("World Class Championship Wrestling", 1983, 1989, "upper-mid", 1, "WCCW Texas Heavyweight and Tag titles."),
        ],
    },
    {
        "primary_ring_name": "Buddy Roberts",
        "legal_name": "Dale Hey",
        "other_ring_names": "Dale Valentine, half of the Hollywood Blonds",
        "born_date": "1947", "died_date": "2012", "living": 0,
        "debut_year": 1969, "retired_year": 1990,
        "primary_role": "wrestler",
        "hometown_billed": "Hollywood, California",
        "convention_status": "none",
        "midcard_files_status": "queued", "midcard_files_priority": 1,
        "why_they_mattered": "The forgotten Freebird. Hayes and Gordy got the books and the documentaries; Roberts was the third chair who made the angles work, particularly the WCCW hair-vs-hair feud with Kerry Von Erich. Earlier ran with Jerry Brown as the original Hollywood Blonds — one of the formative tag teams of the 1970s.",
        "notes": "",
        "runs": [
            ("Pacific Northwest Wrestling", 1972, 1974, "upper-mid", 0, "Hollywood Blonds w/ Jerry Brown."),
            ("Georgia Championship Wrestling", 1979, 1981, "mid", 0, "Pre-Freebirds Georgia run."),
            ("World Class Championship Wrestling", 1983, 1986, "upper-mid", 1, "Fabulous Freebirds Von Erich feud era."),
            ("American Wrestling Association", 1987, 1988, "mid", 0, "Late-career Freebirds AWA run."),
        ],
    },
    {
        "primary_ring_name": "Brian Adias",
        "legal_name": None,
        "other_ring_names": None,
        "born_date": "1956", "died_date": None, "living": 1,
        "debut_year": 1982, "retired_year": 1992,
        "primary_role": "wrestler",
        "hometown_billed": "Dallas, Texas",
        "convention_status": "occasional",
        "midcard_files_status": "queued", "midcard_files_priority": 2,
        "why_they_mattered": "WCCW high-flyer who briefly ran with the Von Erich-style babyface push and got over enough that his heel turn against Kevin Von Erich in 1986 still gets cited in WCCW lore. Real-life childhood friend of the Adkissons.",
        "notes": "Legal name reportedly Brian Talley [VERIFY].",
        "runs": [
            ("World Class Championship Wrestling", 1982, 1989, "mid", 1, "Babyface partner of Kevin Von Erich; 1986 heel turn."),
        ],
    },
    {
        "primary_ring_name": "Frank Dusek",
        "legal_name": "Frank Dusek",
        "other_ring_names": None,
        "born_date": "1950", "died_date": None, "living": 1,
        "debut_year": 1969, "retired_year": 1995,
        "primary_role": "wrestler",
        "hometown_billed": "Omaha, Nebraska",
        "convention_status": "none",
        "midcard_files_status": "queued", "midcard_files_priority": 3,
        "why_they_mattered": "Son of Emil Dusek of the original Dusek Riot Squad, brother of Bill, Jerry, and Ernie. Worked Texas, Mid-South, Florida, and Mid-Atlantic across two decades; later the long-tenured booker for Houston Wrestling.",
        "notes": "",
        "runs": [
            ("Big Time Wrestling (Dallas)", 1971, 1976, "mid", 0, "Early Texas career."),
            ("Mid-South Wrestling", 1979, 1982, "mid", 0, "Tag work."),
            ("World Class Championship Wrestling", 1983, 1986, "mid", 1, "WCCW commentary work and in-ring."),
        ],
    },
    {
        "primary_ring_name": "Killer Tim Brooks",
        "legal_name": "Tim Brooks",
        "other_ring_names": "Dirty Tim Brooks",
        "born_date": "1947", "died_date": None, "living": None,
        "debut_year": 1971, "retired_year": 1992,
        "primary_role": "wrestler",
        "hometown_billed": "Dallas, Texas",
        "convention_status": "none",
        "midcard_files_status": "queued", "midcard_files_priority": 3,
        "why_they_mattered": "Bare-knuckle Texas brawler who could work as a heel in any 1970s territory and did. Held the WCCW Television title and was tag champ with Frank Dusek; later promoted Texas indies.",
        "notes": "Living/deceased status [VERIFY] — sources conflict.",
        "runs": [
            ("Big Time Wrestling (Dallas)", 1973, 1981, "mid", 1, "Long Texas tenure."),
            ("Mid-South Wrestling", 1981, 1983, "mid", 0, ""),
            ("World Class Championship Wrestling", 1983, 1985, "mid", 0, "TV title; tag champ w/ Dusek."),
        ],
    },

    # ---- Pacific NW / AWA group ------------------------------------------
    {
        "primary_ring_name": "Buddy Rose",
        "legal_name": "Paul Perschmann",
        "other_ring_names": "Playboy Buddy Rose",
        "born_date": "1952", "died_date": "2009", "living": 0,
        "debut_year": 1973, "retired_year": 1995,
        "primary_role": "wrestler",
        "hometown_billed": "Hollywood, California",
        "convention_status": "none",
        "midcard_files_status": "queued", "midcard_files_priority": 1,
        "why_they_mattered": "PNW Heavyweight Champion six times — a regional anchor in Portland through Don Owen's last decade running. The Blow Away Diet vignettes in WWF turned him into a cult joke nationally, but the man could promo anybody off the map in Portland.",
        "notes": "",
        "runs": [
            ("Pacific Northwest Wrestling", 1977, 1991, "top", 1, "Six-time PNW Heavyweight Champ."),
            ("World Wrestling Federation", 1982, 1984, "mid", 0, ""),
            ("American Wrestling Association", 1985, 1988, "upper-mid", 0, "Doug Somers tag run; AWA World Tag Champs."),
            ("World Wrestling Federation", 1990, 1991, "enhancement", 0, "Blow Away Diet vignettes."),
        ],
    },
    {
        "primary_ring_name": "Stan Stasiak",
        "legal_name": "George Stipich",
        "other_ring_names": "Crusher Stan Stasiak",
        "born_date": "1937", "died_date": "1997", "living": 0,
        "debut_year": 1958, "retired_year": 1984,
        "primary_role": "wrestler",
        "hometown_billed": "Buzzards Bay, Massachusetts",
        "convention_status": "none",
        "midcard_files_status": "queued", "midcard_files_priority": 2,
        "why_they_mattered": "Held the WWWF World Heavyweight Title for nine days in 1973 — the transition from Pedro Morales to Bruno Sammartino. Career home was Pacific Northwest, where he was a long-running upper-card heel under Don Owen for 15+ years. Father of Shawn Stasiak.",
        "notes": "",
        "runs": [
            ("Pacific Northwest Wrestling", 1968, 1984, "upper-mid", 1, "Long PNW tenure under Don Owen."),
            ("World Wrestling Federation", 1973, 1973, "top", 0, "9-day WWWF Heavyweight Title reign Dec 1973."),
        ],
    },
    {
        "primary_ring_name": "Brett Sawyer",
        "legal_name": "Bret Sawyer",
        "other_ring_names": None,
        "born_date": "1959", "died_date": None, "living": None,
        "debut_year": 1979, "retired_year": 1995,
        "primary_role": "wrestler",
        "hometown_billed": "Daytona Beach, Florida",
        "convention_status": "none",
        "midcard_files_status": "queued", "midcard_files_priority": 3,
        "why_they_mattered": "Buzz Sawyer's brother. Worked under his older brother's shadow across Florida, Georgia, and PNW, holding regional titles but never breaking out. A test case for what 'getting in on the family name' actually buys you.",
        "notes": "Living/deceased [VERIFY] — minimal recent footprint.",
        "runs": [
            ("Championship Wrestling from Florida", 1981, 1984, "mid", 1, "Florida years."),
            ("Pacific Northwest Wrestling", 1985, 1988, "mid", 0, ""),
            ("Georgia Championship Wrestling", 1980, 1981, "opener", 0, ""),
        ],
    },
    {
        "primary_ring_name": "Steve Olsonoski",
        "legal_name": "Steven Olsonoski",
        "other_ring_names": "Steve O, Steve Olson",
        "born_date": "1956", "died_date": None, "living": 1,
        "debut_year": 1978, "retired_year": 1990,
        "primary_role": "wrestler",
        "hometown_billed": "St. Paul, Minnesota",
        "convention_status": "occasional",
        "midcard_files_status": "queued", "midcard_files_priority": 3,
        "why_they_mattered": "AWA mid-card babyface for nearly a decade — the kind of clean-cut Minnesotan Verne kept around because he could work, could promo, and would do business. Mid-South and Florida runs in between. The shape of an AWA career that wasn't Hennig, Saito, or Hogan.",
        "notes": "",
        "runs": [
            ("American Wrestling Association", 1980, 1985, "mid", 1, "AWA mid-card."),
            ("Mid-South Wrestling", 1985, 1986, "mid", 0, ""),
            ("Championship Wrestling from Florida", 1979, 1980, "opener", 0, ""),
        ],
    },
    {
        "primary_ring_name": "Greg Gagne",
        "legal_name": "Gregory Gagne",
        "other_ring_names": None,
        "born_date": "1948", "died_date": None, "living": 1,
        "debut_year": 1973, "retired_year": 1990,
        "primary_role": "wrestler",
        "hometown_billed": "Mound, Minnesota",
        "convention_status": "occasional",
        "midcard_files_status": "queued", "midcard_files_priority": 2,
        "why_they_mattered": "Verne's son. Spent 15 years carrying the AWA midcard as half of the High Flyers with Jim Brunzell. The criticism that he got pushed past his ceiling because of his father is fair; the work he put in night after night is also fair to acknowledge.",
        "notes": "",
        "runs": [
            ("American Wrestling Association", 1973, 1990, "upper-mid", 1, "High Flyers w/ Jim Brunzell; multiple AWA World Tag reigns."),
        ],
    },

    # ---- Florida group ---------------------------------------------------
    {
        "primary_ring_name": "Mike Graham",
        "legal_name": "Michael Gossett",
        "other_ring_names": None,
        "born_date": "1951", "died_date": "2012", "living": 0,
        "debut_year": 1972, "retired_year": 1990,
        "primary_role": "wrestler",
        "hometown_billed": "Tampa, Florida",
        "convention_status": "none",
        "midcard_files_status": "queued", "midcard_files_priority": 1,
        "why_they_mattered": "Eddie Graham's son and the most reliable junior heavyweight in Florida for over a decade. Tag champ with Steve Keirn as the Florida YoungStars. Took his own life in 2012, not long after his father's similar fate; story is darker than the in-ring legacy.",
        "notes": "",
        "runs": [
            ("Championship Wrestling from Florida", 1972, 1987, "upper-mid", 1, "Florida lifer; Tag champ w/ Steve Keirn."),
        ],
    },
    {
        "primary_ring_name": "Bob Roop",
        "legal_name": "Robert Roop",
        "other_ring_names": None,
        "born_date": "1944", "died_date": None, "living": 1,
        "debut_year": 1969, "retired_year": 1985,
        "primary_role": "wrestler",
        "hometown_billed": "Tampa, Florida",
        "convention_status": "occasional",
        "midcard_files_status": "queued", "midcard_files_priority": 1,
        "why_they_mattered": "1968 Olympic Greco-Roman wrestler turned territory hand. Head booker for Florida and later Mid-South. The kind of legitimately credentialed athlete the territories absorbed and reshaped — a useful counterweight when fans talk about the territorial era as all carny.",
        "notes": "",
        "runs": [
            ("Championship Wrestling from Florida", 1971, 1980, "upper-mid", 1, "Booker and top heel."),
            ("Mid-South Wrestling", 1980, 1983, "mid", 0, "Booking and in-ring."),
        ],
    },
    {
        "primary_ring_name": "Steve Keirn",
        "legal_name": "Stephen Keirn",
        "other_ring_names": "Skinner",
        "born_date": "1951", "died_date": None, "living": 1,
        "debut_year": 1973, "retired_year": 1995,
        "primary_role": "wrestler",
        "hometown_billed": "Tampa, Florida",
        "convention_status": "occasional",
        "midcard_files_status": "queued", "midcard_files_priority": 2,
        "why_they_mattered": "Florida YoungStar with Mike Graham, journeyman through Memphis and the AWA, then Skinner in WWF. More important downstream as the trainer who ran Florida Championship Wrestling and later WWE's Performance Center for years.",
        "notes": "",
        "runs": [
            ("Championship Wrestling from Florida", 1974, 1987, "upper-mid", 1, "Florida YoungStars w/ Mike Graham."),
            ("Continental Wrestling Association", 1981, 1983, "mid", 0, "Fabulous Ones w/ Stan Lane in Memphis."),
            ("World Wrestling Federation", 1991, 1993, "mid", 0, "Skinner."),
        ],
    },
    {
        "primary_ring_name": "Boris Malenko",
        "legal_name": "Larry Simon",
        "other_ring_names": "The Great Malenko, Professor Boris Malenko",
        "born_date": "1933", "died_date": "1994", "living": 0,
        "debut_year": 1952, "retired_year": 1980,
        "primary_role": "wrestler",
        "hometown_billed": "Moscow, Russia (billed)",
        "convention_status": "none",
        "midcard_files_status": "queued", "midcard_files_priority": 1,
        "why_they_mattered": "Brooklyn-born playing the Russian heel through the Cold War territories. Father of Joe and Dean Malenko, and ran the Florida wrestling school that trained generations. The pre-Volkoff Russian-heel template most fans don't know about.",
        "notes": "",
        "runs": [
            ("Championship Wrestling from Florida", 1965, 1978, "upper-mid", 1, "Long Florida heel run."),
            ("Big Time Wrestling (Dallas)", 1968, 1970, "mid", 0, ""),
        ],
    },

    # ---- Georgia / Mid-Atlantic group ------------------------------------
    {
        "primary_ring_name": "Mr. Wrestling",
        "legal_name": "Tim Woods",
        "other_ring_names": "Tim Woods, George Burrell Woodin",
        "born_date": "1934", "died_date": "2002", "living": 0,
        "debut_year": 1962, "retired_year": 1983,
        "primary_role": "wrestler",
        "hometown_billed": "Hollywood, California (billed)",
        "convention_status": "none",
        "midcard_files_status": "queued", "midcard_files_priority": 1,
        "why_they_mattered": "Held kayfabe even on the Wilmington plane crash with Ric Flair, Johnny Valentine, and David Crockett — claimed under his real name to be a 'promoter' rather than admit he was the masked Mr. Wrestling traveling with three heels. Georgia and Mid-Atlantic top babyface for over a decade.",
        "notes": "",
        "runs": [
            ("Georgia Championship Wrestling", 1972, 1980, "top", 1, "Top masked babyface for years."),
            ("Jim Crockett Promotions", 1975, 1978, "upper-mid", 0, "Mid-Atlantic crossover; on the plane in October 1975."),
        ],
    },
    {
        "primary_ring_name": "Don Kernodle",
        "legal_name": "Don Kernodle",
        "other_ring_names": "Pvt. Don Kernodle",
        "born_date": "1949", "died_date": None, "living": 1,
        "debut_year": 1976, "retired_year": 1992,
        "primary_role": "wrestler",
        "hometown_billed": "Burlington, North Carolina",
        "convention_status": "occasional",
        "midcard_files_status": "queued", "midcard_files_priority": 2,
        "why_they_mattered": "Mid-Atlantic tag champ with Sgt. Slaughter as the Cobra Corps; their feud with Ricky Steamboat and Jay Youngblood produced one of the great babyface turns of the 1980s when the Anderson family beat down Kernodle and Slaughter saved him. Career almost entirely in JCP.",
        "notes": "",
        "runs": [
            ("Jim Crockett Promotions", 1979, 1988, "upper-mid", 1, "NWA World Tag Champs w/ Sgt. Slaughter."),
        ],
    },
    {
        "primary_ring_name": "Sandy Scott",
        "legal_name": "Angus Mackay Scott",
        "other_ring_names": None,
        "born_date": "1934", "died_date": "2010", "living": 0,
        "debut_year": 1956, "retired_year": 1985,
        "primary_role": "wrestler",
        "hometown_billed": "Hamilton, Ontario",
        "convention_status": "none",
        "midcard_files_status": "queued", "midcard_files_priority": 2,
        "why_they_mattered": "Wrestled for two decades as half of the Flying Scotts with brother George, then transitioned to referee, road agent, and booker for Mid-Atlantic. The kind of multi-decade utility man whose career maps the whole Crockett operation.",
        "notes": "",
        "runs": [
            ("Jim Crockett Promotions", 1968, 1985, "mid", 1, "Wrestler, then ref/agent/booker."),
        ],
    },
    {
        "primary_ring_name": "Klondike Bill",
        "legal_name": "William Soloweyko",
        "other_ring_names": None,
        "born_date": "1932", "died_date": "1996", "living": 0,
        "debut_year": 1958, "retired_year": 1975,
        "primary_role": "wrestler",
        "hometown_billed": "Yukon Territory, Canada (billed)",
        "convention_status": "none",
        "midcard_files_status": "queued", "midcard_files_priority": 2,
        "why_they_mattered": "Worked as a wrestler through the 60s and 70s, then ran the ring crew for Jim Crockett Promotions for the better part of two decades — built the rings, drove the trucks, was the guy you didn't see who made every TV taping happen.",
        "notes": "Death year [VERIFY].",
        "runs": [
            ("Jim Crockett Promotions", 1970, 1988, "opener", 1, "Wrestler, then ring crew chief."),
        ],
    },
    {
        "primary_ring_name": "Brad Armstrong",
        "legal_name": "Robert Bradley James",
        "other_ring_names": "Badstreet, Buzzkill, Arachnaman, Candyman",
        "born_date": "1962", "died_date": "2012", "living": 0,
        "debut_year": 1980, "retired_year": 2001,
        "primary_role": "wrestler",
        "hometown_billed": "Marietta, Georgia",
        "convention_status": "none",
        "midcard_files_status": "queued", "midcard_files_priority": 1,
        "why_they_mattered": "'Bullet' Bob Armstrong's son. Considered one of the most technically proficient wrestlers nobody got behind. Spent two decades being told he was about to be pushed; ended up cycling through gimmicks (Badstreet, Arachnaman, Candyman) instead. The case study for how the industry can fail a great in-ring worker.",
        "notes": "",
        "runs": [
            ("Georgia Championship Wrestling", 1980, 1985, "mid", 0, "Early career."),
            ("Jim Crockett Promotions", 1985, 1988, "mid", 1, ""),
            ("World Championship Wrestling", 1991, 2000, "mid", 0, "WCW gimmick cycle."),
        ],
    },
    {
        "primary_ring_name": "Tim Horner",
        "legal_name": "Tim Horner",
        "other_ring_names": None,
        "born_date": "1960", "died_date": None, "living": 1,
        "debut_year": 1981, "retired_year": 1995,
        "primary_role": "wrestler",
        "hometown_billed": "Morristown, Tennessee",
        "convention_status": "occasional",
        "midcard_files_status": "queued", "midcard_files_priority": 2,
        "why_they_mattered": "Mid-Atlantic and SMW babyface workhorse. SMW Tag Champ with Brian Lee; the kind of solid hand Cornette built SMW around when the territory needed someone who could have a good match every night.",
        "notes": "",
        "runs": [
            ("Jim Crockett Promotions", 1985, 1988, "mid", 0, ""),
            ("Smoky Mountain Wrestling", 1992, 1995, "upper-mid", 1, "SMW Tag Champ w/ Brian Lee."),
        ],
    },

    # ---- International / Other group -------------------------------------
    {
        "primary_ring_name": "The Cuban Assassin",
        "legal_name": "Angel Acevedo",
        "other_ring_names": "Cuban Assassin",
        "born_date": "1937", "died_date": "2010", "living": 0,
        "debut_year": 1962, "retired_year": 1995,
        "primary_role": "wrestler",
        "hometown_billed": "Havana, Cuba (billed)",
        "convention_status": "none",
        "midcard_files_status": "queued", "midcard_files_priority": 1,
        "why_they_mattered": "Stampede heel staple for over a decade. The opponent Bret Hart and Owen Hart and dozens of others learned to work against. Foundational figure in Calgary that almost never gets named when people romanticize Stu Hart's territory.",
        "notes": "",
        "runs": [
            ("Stampede Wrestling", 1976, 1989, "mid", 1, "Heel mainstay; multiple British Commonwealth Mid-Heavyweight reigns."),
        ],
    },
    {
        "primary_ring_name": "Hercules Ayala",
        "legal_name": "Hercules Ayala",
        "other_ring_names": None,
        "born_date": "1947", "died_date": None, "living": 1,
        "debut_year": 1976, "retired_year": 2000,
        "primary_role": "wrestler",
        "hometown_billed": "Puerto Rico",
        "convention_status": "occasional",
        "midcard_files_status": "queued", "midcard_files_priority": 2,
        "why_they_mattered": "WWC Universal Heavyweight Champion multiple times in the 1980s — the babyface Carlos Colón teamed with and feuded with for years. The Puerto Rican territorial scene barely registers in US fan circles; Ayala is the case for why that's a gap worth filling.",
        "notes": "",
        "runs": [
            ("World Wrestling Council", 1979, 1995, "top", 1, "Multiple WWC Universal Heavyweight Title reigns."),
        ],
    },

    # ---- Non-wrestlers (managers / valets / announcers) ------------------
    {
        "primary_ring_name": "Sunshine",
        "legal_name": "Valerie French",
        "other_ring_names": None,
        "born_date": "1962", "died_date": None, "living": 1,
        "debut_year": 1983, "retired_year": 1989,
        "primary_role": "valet",
        "hometown_billed": "Dallas, Texas",
        "convention_status": "occasional",
        "midcard_files_status": "queued", "midcard_files_priority": 1,
        "why_they_mattered": "WCCW valet whose feud with Missy Hyatt — culminating in a televised slap fight and hair match — was one of the first non-wrestling women's angles to draw money on its own merits. The template for the heel-vs-face valet beef that ran through the late 80s.",
        "notes": "",
        "runs": [
            ("World Class Championship Wrestling", 1983, 1986, "upper-mid", 1, "Valet for Chris Adams; feuded with Missy Hyatt."),
        ],
    },
    {
        "primary_ring_name": "Skandor Akbar",
        "legal_name": "Jim Wehba",
        "other_ring_names": "General Skandor Akbar",
        "born_date": "1934", "died_date": "2010", "living": 0,
        "debut_year": 1960, "retired_year": 2010,
        "primary_role": "manager",
        "hometown_billed": "Baghdad, Iraq (billed)",
        "convention_status": "none",
        "midcard_files_status": "queued", "midcard_files_priority": 1,
        "why_they_mattered": "Run the Devastation Inc. stable in WCCW for years and changed how heel managers worked — less mouthpiece, more general managing a roster of heels. Texas-born Lebanese-American playing the Arab oilman heel through the entire post-1979 oil-crisis period.",
        "notes": "",
        "runs": [
            ("Big Time Wrestling (Dallas)", 1972, 1982, "upper-mid", 0, "Wrestler, then manager."),
            ("World Class Championship Wrestling", 1982, 1990, "upper-mid", 1, "Devastation Inc."),
        ],
    },
    {
        "primary_ring_name": "Boyd Pierce",
        "legal_name": "Boyd Pierce",
        "other_ring_names": None,
        "born_date": "1925", "died_date": "1992", "living": 0,
        "debut_year": 1955, "retired_year": 1987,
        "primary_role": "announcer",
        "hometown_billed": "New Orleans, Louisiana",
        "convention_status": "none",
        "midcard_files_status": "queued", "midcard_files_priority": 1,
        "why_they_mattered": "Mid-South ring announcer and color commentator across the Watts era. The plaid sport coats are the meme; the actual contribution was three decades of selling the in-ring action with a calm, conversational style that was the opposite of the bombast around him.",
        "notes": "",
        "runs": [
            ("Mid-South Wrestling", 1979, 1987, "mid", 1, "Ring announcer and color commentator."),
        ],
    },
]

# ---- Insert routine -------------------------------------------------------

def get_or_create_territory(cur, **fields):
    cur.execute("SELECT id FROM territories WHERE name = ?", (fields["name"],))
    row = cur.fetchone()
    if row:
        return row[0]
    cur.execute("""
        INSERT INTO territories
        (name, short_name, region, nwa_member, headquarters_city, headquarters_state,
         year_founded, year_closed, promoter_lineage, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (fields["name"], fields["short_name"], fields["region"], fields["nwa_member"],
          fields["hq_city"], fields["hq_state"], fields["year_founded"], fields["year_closed"],
          fields["promoter_lineage"], fields["notes"]))
    return cur.lastrowid

def get_or_create_wrestler(cur, w):
    cur.execute("SELECT id FROM wrestlers WHERE primary_ring_name = ?", (w["primary_ring_name"],))
    row = cur.fetchone()
    if row:
        return row[0]
    cur.execute("""
        INSERT INTO wrestlers
        (legal_name, primary_ring_name, other_ring_names, born_date, died_date, living,
         debut_year, retired_year, primary_role, hometown_billed, convention_status,
         midcard_files_status, midcard_files_priority, why_they_mattered, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (w.get("legal_name"), w["primary_ring_name"], w.get("other_ring_names"),
          w.get("born_date"), w.get("died_date"), w.get("living"),
          w.get("debut_year"), w.get("retired_year"), w.get("primary_role"),
          w.get("hometown_billed"), w.get("convention_status"),
          w.get("midcard_files_status"), w.get("midcard_files_priority"),
          w.get("why_they_mattered"), w.get("notes")))
    return cur.lastrowid

def insert_run(cur, wrestler_id, territory_id, start_y, end_y, role_during, primary, notes):
    # Skip if an exact-match run already exists
    cur.execute("""
        SELECT id FROM wrestler_territory_runs
        WHERE wrestler_id = ? AND territory_id = ? AND start_year = ? AND end_year = ?
    """, (wrestler_id, territory_id, start_y, end_y))
    if cur.fetchone():
        return
    cur.execute("""
        INSERT INTO wrestler_territory_runs
        (wrestler_id, territory_id, start_year, end_year, role_during_run, primary_run, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (wrestler_id, territory_id, start_y, end_y, role_during, primary, notes))

def main():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    # Territories
    territory_ids = {}
    for t in TERRITORIES:
        name, short_name, region, nwa, hq_city, hq_state, founded, closed, lineage, notes = t
        tid = get_or_create_territory(cur, name=name, short_name=short_name, region=region,
                                      nwa_member=nwa, hq_city=hq_city, hq_state=hq_state,
                                      year_founded=founded, year_closed=closed,
                                      promoter_lineage=lineage, notes=notes)
        territory_ids[name] = tid
    conn.commit()

    # Wrestlers + runs
    for w in WRESTLERS:
        wid = get_or_create_wrestler(cur, w)
        for run in w.get("runs", []):
            tname, start_y, end_y, role_during, primary, notes = run
            tid = territory_ids.get(tname)
            if not tid:
                print(f"  WARN: territory '{tname}' not found for {w['primary_ring_name']}")
                continue
            insert_run(cur, wid, tid, start_y, end_y, role_during, primary, notes)
    conn.commit()

    cur.execute("SELECT COUNT(*) FROM territories")
    print(f"territories: {cur.fetchone()[0]}")
    cur.execute("SELECT COUNT(*) FROM wrestlers")
    print(f"wrestlers: {cur.fetchone()[0]}")
    cur.execute("SELECT COUNT(*) FROM wrestler_territory_runs")
    print(f"wrestler_territory_runs: {cur.fetchone()[0]}")
    cur.execute("SELECT COUNT(*) FROM wrestlers WHERE midcard_files_status = 'queued'")
    print(f"queued for Midcard Files: {cur.fetchone()[0]}")

    conn.close()
    print("Seed complete; DB copied back.")

if __name__ == "__main__":
    main()
