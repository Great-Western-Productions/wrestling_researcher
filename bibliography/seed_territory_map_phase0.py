#!/usr/bin/env python3
"""
seed_territory_map_phase0.py

Phase 0 and Phase 1 of the Territorial Era map corpus: the crosswalk backfill
and the national market list. Fills three things and nothing else:

  research_sources   the standing sources every era and market run cites
  territories        the offices the map draws that had no row, plus map_color
  markets            145 towns with verified coordinates

No territory_eras and no territory_market_runs. Those are Phase 2 onward.

Market coordinates come from the territory_maps repo's hand-checked production
data (src/data/nwa/markets.json on main, 147 entries). markets.json carries no
state, so each town's state was derived by point-in-polygon against the same
public/geo/na-states.geojson the map renders, then every town within 25 km of a
state line was checked by hand. Two corrections came out of that pass and both
are recorded in the row notes: Cincinnati, and the two venue-qualified names
that were really second entries for a town already in the list.

Postgres only. Idempotent: every insert is ON CONFLICT DO NOTHING or an
explicit update, so re-running changes nothing.

    python3 bibliography/seed_territory_map_phase0.py           # apply
    python3 bibliography/seed_territory_map_phase0.py --dry-run # report only
"""
from __future__ import annotations

import argparse
import os

import psycopg


# ---------------------------------------------------------------------------
# Sources. url is NOT NULL and unique; a book with no URL gets a stable
# non-web identifier.
# ---------------------------------------------------------------------------
SOURCES: list[tuple[str, str, str]] = [
    ("https://www.wrestlingdata.com/",
     "Wrestlingdata card and results index",
     "Dated card listings; strongest single source for which town ran when"),
    ("https://www.cagematch.net/",
     "Cagematch card index and promotion pages",
     "Card index is dated and citable; the promotion year spans are looser and belong at medium"),
    ("https://www.kayfabememories.com/",
     "Kayfabe Memories territory pages",
     "Fan-compiled secondary; corroborate against a dated card before going above medium"),
    ("https://chroniclingamerica.loc.gov/",
     "Chronicling America (Library of Congress) newspaper archive",
     "Free, and covers the pre-1950 years where this corpus is thinnest. Primary source for arena listings"),
    ("https://www.newspapers.com/",
     "Newspapers.com",
     "Primary; paywalled"),
    ("https://slamwrestling.net/",
     "Slam Wrestling obituaries, Card Exam series and territory history",
     "Published historian work, mostly Canadian; cite the article in the row notes"),
    ("https://en.wikipedia.org/",
     "Wikipedia",
     "A finding aid for its citations, never a source in its own right. Any row citing this "
     "should be re-pointed at the underlying reference and downgraded if none exists"),
    ("https://mapleleafwrestling.blogspot.com/",
     "Gary Will's Toronto Wrestling History",
     "Card-by-card Toronto research; strong on the Tunney years"),
    ("https://www.luchawiki.org/",
     "Luchawiki",
     "Spanish-language lucha libre reference; the starting point for EMLL/CMLL and UWA"),
    ("https://tonyrichards4.substack.com/",
     "Tony Richards, Pro Wrestling Time Tunnel",
     "Source of the seven-stage territory framework this map is structured by, plus per-office analysis"),
    ("repo:territory_maps/src/data/nwa",
     "territory_maps hand-authored map data (markets.json, territories.json on main)",
     "The 145 seeded markets and the 27-promotion palette. Hand-checked and already in production, "
     "but itself unsourced: treat a claim that rests only on this as medium at best"),
]


# ---------------------------------------------------------------------------
# Markets. 147 map entries collapse to 145 towns: "San Francisco (Cow Palace)"
# and "Salt Lake City (Salt Palace)" are venue-qualified second entries for
# towns already present, and a market is a town. The venue and its years belong
# on the territory_market_runs row, not here.
# ---------------------------------------------------------------------------
# (name, state, country, lat, lon, notes)
MARKETS: list[tuple] = [
    ("Calgary",        "AB", "CA",  51.0490,  -114.0660, None),
    ("Edmonton",       "AB", "CA",  53.5450,  -113.4900, None),
    ("Winnipeg",       "MB", "CA",  49.8950,   -97.1380, None),
    ("Regina",         "SK", "CA",  50.4450,  -104.6180, None),
    ("Birmingham",     "AL", "US",  33.5210,   -86.8020, None),
    ("Huntsville",     "AL", "US",  34.7300,   -86.5860, None),
    ("Mobile",         "AL", "US",  30.6940,   -88.0430, None),
    ("Montgomery",     "AL", "US",  32.3770,   -86.3000, None),
    ("Fort Smith",     "AR", "US",  35.3860,   -94.3980, None),
    ("Little Rock",    "AR", "US",  34.7460,   -92.2890, None),
    ("Casa Grande",    "AZ", "US",  32.8790,  -111.7570, None),
    ("Flagstaff",      "AZ", "US",  35.1980,  -111.6510, None),
    ("Phoenix",        "AZ", "US",  33.4480,  -112.0740, None),
    ("Prescott",       "AZ", "US",  34.5400,  -112.4690, None),
    ("Tucson",         "AZ", "US",  32.2220,  -110.9260, None),
    ("Yuma",           "AZ", "US",  32.6930,  -114.6280, None),
    ("Bakersfield",    "CA", "US",  35.3730,  -119.0190, None),
    ("Fresno",         "CA", "US",  36.7470,  -119.7720, None),
    ("Los Angeles",    "CA", "US",  34.0520,  -118.2440, None),
    ("Oakland",        "CA", "US",  37.8050,  -122.2710, None),
    ("Sacramento",     "CA", "US",  38.5820,  -121.4940, None),
    ("San Diego",      "CA", "US",  32.7160,  -117.1610, None),
    ("San Francisco",  "CA", "US",  37.7750,  -122.4190, "AWA Cow Palace cards (map market id cow-palace) fold into this row; the venue sits 8 km south in Daly City."),
    ("San Jose",       "CA", "US",  37.3390,  -121.8950, None),
    ("Denver",         "CO", "US",  39.7390,  -104.9900, None),
    ("Hartford",       "CT", "US",  41.7630,   -72.6850, None),
    ("Washington",     "DC", "US",  38.8980,   -77.0230, None),
    ("Wilmington",     "DE", "US",  39.7460,   -75.5460, None),
    ("Jacksonville",   "FL", "US",  30.3320,   -81.6560, None),
    ("Miami",          "FL", "US",  25.7610,   -80.1910, None),
    ("Orlando",        "FL", "US",  28.5380,   -81.3790, None),
    ("Pensacola",      "FL", "US",  30.4210,   -87.2170, None),
    ("Tallahassee",    "FL", "US",  30.4380,   -84.2810, None),
    ("Tampa",          "FL", "US",  27.9500,   -82.4570, None),
    ("Atlanta",        "GA", "US",  33.7490,   -84.3880, None),
    ("Columbus",       "GA", "US",  32.4610,   -84.9880, None),
    ("Macon",          "GA", "US",  32.8410,   -83.6330, None),
    ("Savannah",       "GA", "US",  32.0830,   -81.0990, None),
    ("Cedar Rapids",   "IA", "US",  41.9780,   -91.6650, None),
    ("Des Moines",     "IA", "US",  41.6000,   -93.6090, None),
    ("Boise",          "ID", "US",  43.6150,  -116.2020, None),
    ("Idaho Falls",    "ID", "US",  43.4920,  -112.0340, None),
    ("Pocatello",      "ID", "US",  42.8710,  -112.4450, None),
    ("Twin Falls",     "ID", "US",  42.5630,  -114.4610, None),
    ("Chicago",        "IL", "US",  41.8840,   -87.6320, None),
    ("East St. Louis", "IL", "US",  38.6250,   -90.1500, None),
    ("Moline",         "IL", "US",  41.5070,   -90.5150, None),
    ("Peoria",         "IL", "US",  40.6940,   -89.5890, None),
    ("Rockford",       "IL", "US",  42.2710,   -89.0940, None),
    ("Evansville",     "IN", "US",  37.9770,   -87.5710, None),
    ("Fort Wayne",     "IN", "US",  41.0790,   -85.1390, None),
    ("Indianapolis",   "IN", "US",  39.7680,   -86.1580, None),
    ("Lafayette",      "IN", "US",  40.4170,   -86.8750, None),
    ("Muncie",         "IN", "US",  40.1930,   -85.3860, None),
    ("South Bend",     "IN", "US",  41.6830,   -86.2500, None),
    ("Terre Haute",    "IN", "US",  39.4670,   -87.4040, None),
    ("Topeka",         "KS", "US",  39.0560,   -95.6890, None),
    ("Wichita",        "KS", "US",  37.6870,   -97.3360, None),
    ("Bowling Green",  "KY", "US",  36.9900,   -86.4440, None),
    ("Lexington",      "KY", "US",  38.0460,   -84.5040, None),
    ("Louisville",     "KY", "US",  38.2530,   -85.7590, None),
    ("Baton Rouge",    "LA", "US",  30.4510,   -91.1870, None),
    ("New Orleans",    "LA", "US",  29.9510,   -90.0710, None),
    ("Shreveport",     "LA", "US",  32.5250,   -93.7500, None),
    ("Boston",         "MA", "US",  42.3660,   -71.0620, None),
    ("Springfield",    "MA", "US",  42.1010,   -72.5890, None),
    ("Baltimore",      "MD", "US",  39.2900,   -76.6120, None),
    ("Bangor",         "ME", "US",  44.8010,   -68.7790, None),
    ("Portland",       "ME", "US",  43.6610,   -70.2550, None),
    ("Detroit",        "MI", "US",  42.3310,   -83.0460, None),
    ("Grand Rapids",   "MI", "US",  42.9630,   -85.6690, None),
    ("Lansing",        "MI", "US",  42.7330,   -84.5560, None),
    ("Duluth",         "MN", "US",  46.7860,   -92.1010, None),
    ("Minneapolis",    "MN", "US",  44.9780,   -93.2650, None),
    ("Rochester",      "MN", "US",  44.0220,   -92.4630, None),
    ("St. Paul",       "MN", "US",  44.9540,   -93.0930, None),
    ("Kansas City",    "MO", "US",  39.1000,   -94.5780, None),
    ("St. Joseph",     "MO", "US",  39.7590,   -94.8470, None),
    ("St. Louis",      "MO", "US",  38.6270,   -90.1990, None),
    ("Jackson",        "MS", "US",  32.2990,   -90.1850, None),
    ("Billings",       "MT", "US",  45.7830,  -108.5010, None),
    ("Great Falls",    "MT", "US",  47.5070,  -111.3010, None),
    ("Charlotte",      "NC", "US",  35.2270,   -80.8430, None),
    ("Greensboro",     "NC", "US",  36.0730,   -79.7920, None),
    ("Raleigh",        "NC", "US",  35.7800,   -78.6380, None),
    ("Bismarck",       "ND", "US",  46.8080,  -100.7840, None),
    ("Fargo",          "ND", "US",  46.8770,   -96.7900, None),
    ("Omaha",          "NE", "US",  41.2570,   -95.9340, None),
    ("Manchester",     "NH", "US",  42.9960,   -71.4540, None),
    ("Newark",         "NJ", "US",  40.7360,   -74.1720, None),
    ("Trenton",        "NJ", "US",  40.2170,   -74.7600, None),
    ("Albuquerque",    "NM", "US",  35.0840,  -106.6500, None),
    ("Las Vegas",      "NV", "US",  36.1700,  -115.1400, None),
    ("Reno",           "NV", "US",  39.5300,  -119.8140, None),
    ("Albany",         "NY", "US",  42.6520,   -73.7560, None),
    ("Buffalo",        "NY", "US",  42.8860,   -78.8780, None),
    ("New York",       "NY", "US",  40.7500,   -73.9930, None),
    ("Rochester",      "NY", "US",  43.1610,   -77.6110, None),
    ("Akron",          "OH", "US",  41.0810,   -81.5190, None),
    ("Cincinnati",     "OH", "US",  39.1030,   -84.5120, "State set to OH by hand: the simplified na-states layer puts the Ohio River ~6 km north and placed downtown Cincinnati in KY."),
    ("Cleveland",      "OH", "US",  41.4990,   -81.6940, None),
    ("Columbus",       "OH", "US",  39.9610,   -82.9990, None),
    ("Dayton",         "OH", "US",  39.7590,   -84.1920, None),
    ("Toledo",         "OH", "US",  41.6540,   -83.5550, None),
    ("Oklahoma City",  "OK", "US",  35.4670,   -97.5160, None),
    ("Tulsa",          "OK", "US",  36.1540,   -95.9930, None),
    ("Eugene",         "OR", "US",  44.0520,  -123.0870, None),
    ("Portland",       "OR", "US",  45.5230,  -122.6760, None),
    ("Salem",          "OR", "US",  44.9430,  -123.0350, None),
    ("Allentown",      "PA", "US",  40.6020,   -75.4700, None),
    ("Harrisburg",     "PA", "US",  40.2730,   -76.8840, None),
    ("Philadelphia",   "PA", "US",  39.9530,   -75.1650, None),
    ("Pittsburgh",     "PA", "US",  40.4410,   -79.9960, None),
    ("Scranton",       "PA", "US",  41.4090,   -75.6630, None),
    ("Providence",     "RI", "US",  41.8240,   -71.4130, None),
    ("Columbia",       "SC", "US",  34.0010,   -81.0350, None),
    ("Sioux Falls",    "SD", "US",  43.5500,   -96.7320, None),
    ("Chattanooga",    "TN", "US",  35.0460,   -85.3090, None),
    ("Dyersburg",      "TN", "US",  36.0350,   -89.3860, None),
    ("Knoxville",      "TN", "US",  35.9610,   -83.9210, None),
    ("Memphis",        "TN", "US",  35.1490,   -90.0490, None),
    ("Nashville",      "TN", "US",  36.1630,   -86.7810, None),
    ("Amarillo",       "TX", "US",  35.2220,  -101.8310, None),
    ("Austin",         "TX", "US",  30.2670,   -97.7430, None),
    ("Beaumont",       "TX", "US",  30.0800,   -94.1020, None),
    ("Corpus Christi", "TX", "US",  27.8000,   -97.3960, None),
    ("Dallas",         "TX", "US",  32.7770,   -96.7970, None),
    ("El Paso",        "TX", "US",  31.7590,  -106.4850, None),
    ("Fort Worth",     "TX", "US",  32.7560,   -97.3310, None),
    ("Galveston",      "TX", "US",  29.3010,   -94.7980, None),
    ("Houston",        "TX", "US",  29.7600,   -95.3690, None),
    ("Lubbock",        "TX", "US",  33.5780,  -101.8550, None),
    ("Odessa",         "TX", "US",  31.8450,  -102.3680, None),
    ("San Antonio",    "TX", "US",  29.4240,   -98.4940, None),
    ("Ogden",          "UT", "US",  41.2230,  -111.9730, None),
    ("Salt Lake City", "UT", "US",  40.7610,  -111.8910, "AWA Salt Palace cards (map market id salt-palace) fold into this row."),
    ("Norfolk",        "VA", "US",  36.8510,   -76.2850, None),
    ("Richmond",       "VA", "US",  37.5410,   -77.4360, None),
    ("Burlington",     "VT", "US",  44.4760,   -73.2130, None),
    ("Seattle",        "WA", "US",  47.6060,  -122.3300, None),
    ("Spokane",        "WA", "US",  47.6590,  -117.4260, None),
    ("Green Bay",      "WI", "US",  44.5130,   -88.0160, None),
    ("La Crosse",      "WI", "US",  43.8010,   -91.2390, None),
    ("Milwaukee",      "WI", "US",  43.0390,   -87.9060, None),
    ("Cheyenne",       "WY", "US",  41.1400,  -104.8020, None),
]


# ---------------------------------------------------------------------------
# Offices the map draws that have no territories row. Spans are the sourced
# ones, which is why several disagree with what Cagematch would say; the
# disagreements are in notes rather than papered over.
#
# (name, short_name, region, hq_city, hq_state, country, founded, closed,
#  lineage, nwa_member, aliases, notes)
# ---------------------------------------------------------------------------
NEW_TERRITORIES: list[tuple] = [
    ("NWA Tri-State", "Tri-State", "Southwest", "Tulsa", "OK", "US", 1958, 1982,
     "Leroy McGuirk", True, None,
     "Successor to Sam Avey Promotions (territories.id 297). Watts bought the southern half "
     "in 1979 and McGuirk held Oklahoma and Arkansas to the end. Ran OK, AR, LA and MS."),

    ("Maple Leaf Wrestling", "Maple Leaf", "Canada", "Toronto", "ON", "CA", 1930, 1995,
     "Jack Corcoran; John and Frank Tunney from 1939; Jack Tunney", True,
     "Queensbury Athletic Club",
     "Founded 12 Mar 1930 by Jack Corcoran, sold to the Tunney brothers in 1939, closed "
     "17 Sep 1995. Frank Tunney was NWA First Vice-President in 1954 and NWA President from "
     "1960. The NWA world title made its last Toronto appearance in May 1984, when Jack Tunney "
     "left Crockett for the WWF."),

    ("NWA All-Star Wrestling", "All-Star (Vancouver)", "Canada", "Vancouver", "BC", "CA",
     1960, 1989, "Rod Fenton; Gene Kiniski, Sandor Kovacs and Don Owen from 1968; "
     "Al Tomko from 1977", True, "Big Time Wrestling (Vancouver)",
     "British Columbia. Came into its own once CHAN-TV began carrying the show in 1962."),

    ("Atlantic Grand Prix Wrestling", "AGPW", "Canada", "Moncton", "NB", "CA", 1977, 1991,
     "Emile Duprée", False, "Grand Prix Wrestling (Maritimes)",
     "Ran seasonally, late spring to early fall, touring New Brunswick, Nova Scotia and "
     "Prince Edward Island. Distinct from Paul Vachon's Montreal Grand Prix of the early 1970s. "
     "The ATV television show ran to January 1991."),

    ("Empresa Mexicana de Lucha Libre", "EMLL / CMLL", "Mexico", "Mexico City", "CMX", "MX",
     1933, None, "Salvador Lutteroth; Lutteroth family", False,
     "CMLL; Consejo Mundial de Lucha Libre",
     "First show 21 Sep 1933. The oldest promotion still operating. Renamed Consejo Mundial "
     "de Lucha Libre in early 1992, so the CMLL years fall outside this map's 1995 close. "
     "Anniversary shows have run at Arena Mexico since the building opened in 1956."),

    ("Universal Wrestling Association", "UWA (Mexico)", "Mexico", "Naucalpan", "MEX", "MX",
     1975, 1995, "Ray Mendoza, Francisco Flores, Benjamin Mora Jr.", False,
     "Lucha Libre Internacional; LLI",
     "First show 29 Jan 1975. Lucha Libre Internacional was the company; UWA was the "
     "storyline sanctioning body it was known by outside Mexico. Not to be confused with "
     "Bill Watts's Universal Wrestling Federation (territories.id 26)."),

    # Quebec is three rows rather than one row with three eras. Josh's call on
    # 2026-07-27, against the brief's section 4: these were three unrelated
    # companies with real gaps between them, not one office changing hands.
    # They share lineage_key 'quebec' and one map_color, so the map still reads
    # as continuous ground.
    ("Canadian Athletic Promotions", "Quinn (Montreal)", "Canada", "Montreal", "QC", "CA",
     1939, 1965, "Eddie Quinn", True, "Montreal Athletic Commission office; Eddie Quinn Promotions",
     "The Montreal Athletic Commission granted Quinn the rights to promote the Forum on "
     "27 Jul 1939. He ran Quebec and into New England and died in December 1965. "
     "nwa_member is set true for the office overall; the era rows carry the sourced answer."),

    ("Grand Prix Wrestling (Montreal)", "Grand Prix", "Canada", "Montreal", "QC", "CA",
     1971, 1975, "Maurice and Paul Vachon", False, "Les Grands Prix de la Lutte",
     "Debut card 1 Jun 1971, launched in direct competition with Johnny Rougeau's "
     "established All-Star Wrestling. Ran as far as Newfoundland and British Columbia at "
     "its peak and drew 29,000 to Jarry Park in July 1973. Distinct from Emile Dupree's "
     "Atlantic Grand Prix in the Maritimes."),

    ("Lutte Internationale", "International (Montreal)", "Canada", "Montreal", "QC", "CA",
     1980, 1987, "Frank Valois, Andre the Giant, Gino Brito", False,
     "International Wrestling; Promotions Varoussac",
     "Traded as Promotions Varoussac 1980-1984, then International Wrestling. Closed "
     "June 1987."),
]


# ---------------------------------------------------------------------------
# map_color. The 27 the map already draws keep the exact hex they render with
# today, so nothing on the live map shifts. Promotions that succeeded one
# another over the same towns share a hue on purpose, which is why Tri-State
# and Mid-South are both #d97b29 and Detroit and Big Time are both #b5651d.
#
# Where the map draws one promotion and the database splits it across two rows,
# both rows take the colour: the two Los Angeles offices, the two San Francisco
# offices, the two Arizona offices, the two Dallas offices, and Intermountain,
# which is really two separate offices (see the crosswalk note below).
#
# territory_id -> (hex, why)
# ---------------------------------------------------------------------------
MAP_COLORS: dict[int, tuple[str, str]] = {
    9:   ("#b0413e", "mid-atlantic"),
    8:   ("#cc9a3a", "georgia"),
    7:   ("#2f8f83", "florida"),
    147: ("#7a9a3a", "gulf-coast"),
    227: ("#31687d", "mid-america"),
    1:   ("#6a4c93", "memphis"),
    2:   ("#d97b29", "mid-south; shares Tri-State's hue so the 1979 handover reads as continuity"),
    3:   ("#2e6f95", "world-class"),
    4:   ("#2e6f95", "world-class, earlier Dallas era (Big Time Wrestling)"),
    146: ("#55708a", "houston"),
    314: ("#c76b98", "san-antonio"),
    237: ("#8a6d3b", "western-states"),
    99:  ("#4f8a5f", "central-states"),
    317: ("#9c4f96", "st-louis"),
    90:  ("#b5651d", "detroit and big-time are one row with two eras"),
    205: ("#7a3f55", "columbus"),
    5:   ("#5f8a3a", "pacific-northwest"),
    223: ("#d1a02e", "los-angeles (NWA Hollywood)"),
    226: ("#d1a02e", "los-angeles, earlier era (NWA Los Angeles)"),
    233: ("#3a8f8f", "san-francisco (NWA San Francisco)"),
    70:  ("#3a8f8f", "san-francisco, later era (Roy Shire)"),
    79:  ("#a83f70", "arizona (Arizona Athletic Association)"),
    375: ("#a83f70", "arizona, later era (World Athletic Association)"),
    296: ("#3d8a91", "intermountain, Utah half (Salt Lake Wrestling Club)"),
    339: ("#3d8a91", "intermountain, Idaho half (Tex Hager's Tri-State Sports)"),
    10:  ("#4f6db0", "stampede"),
    6:   ("#2d4a75", "awa"),
    12:  ("#1f5546", "wwf / capitol"),
    224: ("#6a5fa0", "indianapolis"),
    383: ("#4f9fb0", "wwa"),

    # Ruled in on 2026-07-27, after the brief left them open. Neither is one of
    # the 27 the map draws today, so these hues are new rather than inherited.
    # Both are islands, so nothing constrains them but each other.
    11:  ("#b8523f", "puerto rico, World Wrestling Council 1973-"),
    201: ("#8a7f4f", "hawaii, Mid-Pacific 1936-1979"),
    231: ("#8a7f4f", "hawaii, NWA Polynesian 1979-1988, straight succession so it shares the hue"),
}


# ---------------------------------------------------------------------------
# lineage_key: the turf, as opposed to the promotion that held it. Two rows
# share a key when they held the same ground, whether they took turns (Tulsa,
# Dallas, Hawaii) or contested it at the same time (Arizona, the Intermountain
# West). Overlapping holders are expected and are not an error.
#
# Only groups that are defensible right now are filled. Memphis and Central
# States almost certainly have lineages too, and belong to the sessions that
# research those eras.
# ---------------------------------------------------------------------------
LINEAGE_KEYS: dict[str, list[int]] = {
    # Avey's Tulsa office -> McGuirk's Tri-State -> Watts's Mid-South
    "tulsa":         [297, 2],
    "dallas":        [4, 3],
    "los-angeles":   [226, 223],
    "san-francisco": [233, 70],
    "arizona":       [79, 375],
    # Two offices holding different halves of one region at the same time:
    # Reynolds in Utah, Tex Hager in Idaho.
    "intermountain": [296, 339],
    "detroit":       [90],
    "hawaii":        [201, 231],
}

# Rows this script inserts, keyed by name because their ids are assigned on
# insert.
NEW_LINEAGE: dict[str, str] = {
    "NWA Tri-State":                   "tulsa",
    "Canadian Athletic Promotions":    "quebec",
    "Grand Prix Wrestling (Montreal)": "quebec",
    "Lutte Internationale":            "quebec",
}

# Colours for the rows this script inserts, keyed by name because the ids are
# assigned on insert. Chosen against the neighbours each office actually
# touches: Toronto against Detroit and the WWF, Vancouver against the Pacific
# Northwest and Stampede, EMLL against UWA since they shared Mexico City.
NEW_COLORS: dict[str, str] = {
    "NWA Tri-State":                   "#d97b29",
    "Maple Leaf Wrestling":            "#5c8a7a",
    "NWA All-Star Wrestling":          "#a8763a",
    "Atlantic Grand Prix Wrestling":   "#8a4f7a",
    "Empresa Mexicana de Lucha Libre": "#a33b2f",
    "Universal Wrestling Association": "#2f7d5c",
    # One hue across all three Quebec offices, chosen against the neighbours
    # Montreal actually touches: Toronto, the Maritimes and the WWF's New England.
    "Canadian Athletic Promotions":    "#3f6a8a",
    "Grand Prix Wrestling (Montreal)": "#3f6a8a",
    "Lutte Internationale":            "#3f6a8a",
}


# ---------------------------------------------------------------------------
# Database
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


def seed_sources(cur) -> int:
    """research_sources.url is unique, so ON CONFLICT carries the idempotency."""
    added = 0
    for url, description, notes in SOURCES:
        cur.execute(
            """INSERT INTO research_sources (url, description, notes)
               VALUES (%s, %s, %s)
               ON CONFLICT (url) DO NOTHING
               RETURNING id""",
            (url, description, notes),
        )
        if cur.fetchone():
            added += 1
    return added


def seed_markets(cur) -> int:
    """markets is unique on (name, state, country)."""
    added = 0
    for name, state, country, lat, lon, notes in MARKETS:
        cur.execute(
            """INSERT INTO markets (name, state, country, lat, lon, notes)
               VALUES (%s, %s, %s, %s, %s, %s)
               ON CONFLICT (name, state, country) DO NOTHING
               RETURNING id""",
            (name, state, country, lat, lon, notes),
        )
        if cur.fetchone():
            added += 1
    return added


def seed_territories(cur) -> tuple[int, int]:
    """territories has no unique index on name, so the guard is an explicit
    lookup rather than ON CONFLICT."""
    added = skipped = 0
    for (name, short_name, region, city, state, country, founded, closed,
         lineage, nwa, aliases, notes) in NEW_TERRITORIES:
        cur.execute("SELECT id, map_color, lineage_key FROM territories WHERE name = %s",
                    (name,))
        existing = cur.fetchone()
        if existing:
            # Already inserted by an earlier run. Still reconcile the two fields
            # a later run may have introduced, so re-running repairs rather
            # than silently leaving the row half-filled.
            tid, colour, lin = existing
            want_colour, want_lin = NEW_COLORS.get(name), NEW_LINEAGE.get(name)
            if colour != want_colour or lin != want_lin:
                cur.execute(
                    "UPDATE territories SET map_color = %s, lineage_key = %s WHERE id = %s",
                    (want_colour, want_lin, tid))
            skipped += 1
            continue
        cur.execute(
            """INSERT INTO territories
                 (name, short_name, region, headquarters_city, headquarters_state,
                  country, year_founded, year_closed, promoter_lineage, nwa_member,
                  aliases, notes, map_color, lineage_key)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (name, short_name, region, city, state, country, founded, closed,
             lineage, nwa, aliases, notes, NEW_COLORS.get(name), NEW_LINEAGE.get(name)),
        )
        added += 1
    return added, skipped


def apply_lineage(cur) -> tuple[int, list[int]]:
    changed, missing = 0, []
    for key, ids in LINEAGE_KEYS.items():
        for tid in ids:
            cur.execute("SELECT lineage_key FROM territories WHERE id = %s", (tid,))
            row = cur.fetchone()
            if row is None:
                missing.append(tid)
                continue
            if row[0] != key:
                cur.execute("UPDATE territories SET lineage_key = %s WHERE id = %s",
                            (key, tid))
                changed += 1
    return changed, missing


def apply_colors(cur) -> tuple[int, list[int]]:
    """Only writes where the value would actually change, so a re-run reports
    zero rather than restating every row."""
    changed, missing = 0, []
    for tid, (hexcolor, _why) in MAP_COLORS.items():
        cur.execute("SELECT map_color FROM territories WHERE id = %s", (tid,))
        row = cur.fetchone()
        if row is None:
            missing.append(tid)
            continue
        if row[0] != hexcolor:
            cur.execute("UPDATE territories SET map_color = %s WHERE id = %s",
                        (hexcolor, tid))
            changed += 1
    return changed, missing


def report(cur) -> None:
    cur.execute("SELECT count(*) FROM research_sources")
    sources = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM markets")
    markets = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM markets WHERE lat IS NULL OR lon IS NULL")
    no_coords = cur.fetchone()[0]
    cur.execute("SELECT country, count(*) FROM markets GROUP BY country ORDER BY 1")
    by_country = cur.fetchall()
    cur.execute("SELECT count(*) FROM territories")
    terrs = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM territories WHERE map_color IS NOT NULL")
    coloured = cur.fetchone()[0]
    cur.execute("""SELECT lineage_key, count(*) FROM territories
                    WHERE lineage_key IS NOT NULL GROUP BY 1 ORDER BY 1""")
    lineages = cur.fetchall()

    print()
    print(f"  research_sources        {sources}")
    print(f"  markets                 {markets}   ({no_coords} without coordinates)")
    print(f"    by country            {', '.join(f'{c}={n}' for c, n in by_country)}")
    print(f"  territories             {terrs}")
    print(f"  territories.map_color   {coloured}")
    print(f"  territories.lineage_key {sum(n for _, n in lineages)} rows across "
          f"{len(lineages)} turfs")
    print(f"    {', '.join(f'{k}={n}' for k, n in lineages)}")

    # The four rows that must never be drawn: sanctioning bodies and buckets.
    cur.execute("""SELECT id, name FROM territories
                    WHERE id IN (21, 240, 392, 289) AND map_color IS NOT NULL""")
    drawn = cur.fetchall()
    if drawn:
        print("  WARNING, a non-promotion has a colour:", drawn)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true",
                    help="roll back instead of committing")
    args = ap.parse_args()

    with psycopg.connect(database_url()) as conn:
        with conn.cursor() as cur:
            n_src = seed_sources(cur)
            n_mkt = seed_markets(cur)
            n_terr, n_skip = seed_territories(cur)
            n_col, missing = apply_colors(cur)
            n_lin, lin_missing = apply_lineage(cur)

            print(f"research_sources  +{n_src}")
            print(f"markets           +{n_mkt}")
            print(f"territories       +{n_terr}  ({n_skip} already present)")
            print(f"map_color         {n_col} set or changed")
            print(f"lineage_key       {n_lin} set or changed")
            if missing:
                print(f"  territory ids in MAP_COLORS with no row: {missing}")
            if lin_missing:
                print(f"  territory ids in LINEAGE_KEYS with no row: {lin_missing}")

            report(cur)

        if args.dry_run:
            conn.rollback()
            print("\n--dry-run: rolled back")
        else:
            conn.commit()
            print("\ncommitted")


if __name__ == "__main__":
    main()
