#!/usr/bin/env python3
"""
seed_territory_map_phase2.py

Phase 2 of the Territorial Era corpus: the eras and market runs that let the
database draw the map. Until these exist, `markets` is a list of towns nobody
ran and `v_territory_year_markets` is empty.

This is deliberately not new research. It encodes what the published map
already asserts, so the database can regenerate the map that exists before any
new work lands on top. If the corpus cannot reproduce today's map, more rows
will not produce a better one.

Source of the assertions is the territory_maps repo's hand-authored
src/data/nwa/{territories,markets}.json on main, which is why almost everything
here sits at `medium`. Rows corroborated by a dated secondary source during the
2026-07-27 research pass are marked `medium_search` and name the source.

Each map promotion becomes one or more SEGMENTS. A segment is one territories
row holding one footprint over one stretch. Multi-segment promotions are the
interesting ones:

  intermountain   two offices holding different halves at the same time,
                  Reynolds in Utah and Tex Hager in Idaho, so they split by state
  los-angeles     one turf changing hands, so the two rows split by year
  wwf             one row, three identities: Capitol, WWWF, WWF

Market runs follow from the segments. A segment takes the promotion's markets
whose state it claims, clipped to the segment's years and to the market's own
years where the map gives it any. A single-segment promotion takes all of its
markets, including the ones outside its fill footprint: the AWA genuinely ran
Winnipeg and Denver and Las Vegas, and those draw as markers even where no
county fill follows.

Postgres only. Idempotent.

    python3 bibliography/seed_territory_map_phase2.py --dry-run
    python3 bibliography/seed_territory_map_phase2.py
"""
from __future__ import annotations

import argparse
import os

import psycopg

REPO_SOURCE = "repo:territory_maps/src/data/nwa"
WIKI = "https://en.wikipedia.org/"
SLAM = "https://slamwrestling.net/"

# (territory_id, from_year, to_year, states, promotion_name, promoter,
#  nwa_member, confidence, source_url, notes)
SEGMENTS: dict[str, list[tuple]] = {
    "mid-atlantic": [
        (9, 1952, 1988, ["NC", "SC", "VA"], "Jim Crockett Promotions",
         "Jim Crockett Sr.; Jim Crockett Jr. from 1973", True, "medium", REPO_SOURCE, None),
    ],
    "georgia": [
        (8, 1950, 1985, ["GA"], "Georgia Championship Wrestling",
         "Paul Jones; Jim Barnett from 1972", True, "medium", REPO_SOURCE, None),
    ],
    "florida": [
        (7, 1950, 1987, ["FL"], "Championship Wrestling from Florida",
         "Cowboy Luttrall; Eddie Graham from 1970", True, "medium", REPO_SOURCE, None),
    ],
    "gulf-coast": [
        (147, 1950, 1980, ["AL"], "Gulf Coast Championship Wrestling",
         "Lee Fields", True, "medium", REPO_SOURCE, None),
    ],
    "mid-america": [
        (227, 1950, 1980, ["TN", "KY", "AL"], "NWA Mid-America",
         "Nick Gulas and Roy Welch", True, "medium", REPO_SOURCE, None),
    ],
    "memphis": [
        (1, 1977, 1989, ["TN", "KY"], "Continental Wrestling Association",
         "Jerry Jarrett and Jerry Lawler", True, "medium", REPO_SOURCE,
         "Splits from Nick Gulas's Mid-America in 1977 and takes the Memphis half."),
    ],
    "tri-state": [
        (406, 1958, 1978, ["OK", "AR", "LA", "MS"], "NWA Tri-State",
         "Leroy McGuirk", True, "medium_search", WIKI,
         "Span corroborated 2026-07-27: Tri-State ran 1958-1982 under McGuirk, with Watts "
         "buying the southern half in 1979. The map ends this at 1978 and opens Mid-South at "
         "1979; the territories row keeps the full 1958-1982 span."),
    ],
    "mid-south": [
        (2, 1979, 1987, ["LA", "AR", "OK", "MS"], "Mid-South Wrestling",
         "Bill Watts", True, "medium_search", WIKI,
         "Watts acquired the southern half of Tri-State from McGuirk in 1979 and rebranded it."),
    ],
    "world-class": [
        (4, 1966, 1982, ["TX"], "Big Time Wrestling",
         "Ed McLemore; Fritz Von Erich", True, "medium", REPO_SOURCE, None),
        (3, 1982, 1990, ["TX"], "World Class Championship Wrestling",
         "Fritz Von Erich", True, "medium", REPO_SOURCE,
         "Same Dallas turf renamed; the two rows share lineage_key 'dallas'."),
    ],
    "houston": [
        (146, 1950, 1987, ["TX"], "Houston Wrestling",
         "Morris Sigel; Paul Boesch from 1967", True, "medium", REPO_SOURCE, None),
    ],
    "san-antonio": [
        (314, 1978, 1985, ["TX"], "Southwest Championship Wrestling",
         "Joe Blanchard", True, "medium", REPO_SOURCE, None),
    ],
    "western-states": [
        (237, 1950, 1982, ["TX", "NM"], "NWA Western States Sports",
         "Doc Sarpolis; Dory Funk Sr. and the Funks", True, "medium", REPO_SOURCE, None),
    ],
    "central-states": [
        (99, 1950, 1988, ["KS", "NE", "IA", "MO"], "Central States Wrestling",
         "Gust Karras; Bob Geigel", True, "medium", REPO_SOURCE, None),
    ],
    "st-louis": [
        (317, 1950, 1985, ["MO", "IL"], "St. Louis Wrestling Club",
         "Sam Muchnick", True, "medium", REPO_SOURCE,
         "Two markets only. This office draws over a hundred counties off St. Louis and East "
         "St. Louis, so it is one of the highest-value targets for real market research."),
    ],
    "detroit": [
        (90, 1950, 1966, ["MI"], "NWA Detroit",
         "Harry Light; Jim Barnett and Johnny Doyle from 1959", True, "medium", REPO_SOURCE,
         "The Sheik buys in during 1964; the map keeps one Michigan-only stretch to 1966."),
    ],
    "big-time": [
        (90, 1967, 1980, ["MI", "OH"], "Big Time Wrestling",
         "The Sheik (Ed Farhat)", False, "medium", REPO_SOURCE,
         "Ohio enters in 1967 when Al Haft's Columbus office hands it over."),
    ],
    "columbus": [
        (205, 1950, 1966, ["OH"], "Midwest Wrestling Association",
         "Al Haft", True, "medium", REPO_SOURCE,
         "NWA charter member. Hands Ohio to the Sheik in 1967."),
    ],
    "pacific-northwest": [
        (5, 1950, 1988, ["OR", "WA"], "Pacific Northwest Wrestling",
         "Don Owen", True, "medium", REPO_SOURCE, None),
    ],
    "los-angeles": [
        (226, 1950, 1958, ["CA"], "NWA Los Angeles",
         "Johnny Doyle; Cal Eaton", True, "medium", REPO_SOURCE, None),
        (223, 1958, 1982, ["CA"], "NWA Hollywood Wrestling",
         "Cal Eaton; Aileen Eaton and Mike LeBell", True, "medium", REPO_SOURCE,
         "Same Olympic Auditorium turf; the two rows share lineage_key 'los-angeles'."),
    ],
    "san-francisco": [
        (233, 1935, 1960, ["CA"], "NWA San Francisco",
         "Joe Malcewicz", True, "medium", REPO_SOURCE,
         "The map draws San Francisco only from 1960 because its entry describes Roy Shire's "
         "office. Malcewicz held the same towns from the 1930s, so this era runs earlier than "
         "the map currently shows. Reno is not included: NV belongs to Shire's footprint."),
        (70, 1960, 1981, ["CA", "NV"], "NWA San Francisco (Roy Shire)",
         "Roy Shire", True, "medium", REPO_SOURCE,
         "Cagematch opens this row at 1961; the map opens the territory at 1960."),
    ],
    "arizona": [
        (79, 1950, 1960, ["AZ"], "Arizona Athletic Association",
         "Rod Fenton; Ernie Mohamed", False, "medium", REPO_SOURCE, None),
        (375, 1960, 1990, ["AZ"], "World Athletic Association",
         "Ernie Mohamed", False, "medium", REPO_SOURCE,
         "Cagematch closes this row in 1972 while the map runs Arizona to 1990. The 1972-1990 "
         "tail is unresearched and the era should be cut when a source dates the end."),
    ],
    "intermountain": [
        (296, 1950, 1962, ["UT"], "Salt Lake Wrestling Club",
         "Dave Reynolds", True, "medium_search", WIKI,
         "The map draws one Intermountain promotion across Idaho and Utah. It was two offices: "
         "Reynolds ran Utah out of Salt Lake City, and its NWA tag title version ran 1955-1959. "
         "The territories row carries headquarters_state ID, which contradicts every source and "
         "should read UT."),
        (339, 1950, 1962, ["ID"], "Tri-State Sports",
         "Tex Hager", False, "medium_search", SLAM,
         "Tex Hager founded Tri-State Sports as the Boise promoter in the early 1950s and ran "
         "the I-15 corridor through Idaho and Utah. The territories row carries headquarters "
         "Spokane WA, which contradicts every source and should read Boise ID. Not to be "
         "confused with McGuirk's NWA Tri-State out of Tulsa."),
    ],
    "stampede": [
        (10, 1957, 1989, ["AB", "SK", "MT"], "Stampede Wrestling",
         "Stu Hart", True, "medium", REPO_SOURCE,
         "The map lists only MT because the county layer it renders holds no Canadian units. "
         "AB and SK are recorded here so the footprint is right when the base layer is rebuilt; "
         "they change nothing about what draws today."),
    ],
    "awa": [
        (6, 1960, 1991, ["MN", "WI", "IA", "SD", "ND", "IL", "CO"], "American Wrestling Association",
         "Verne Gagne and Wally Karbo", False, "medium", REPO_SOURCE,
         "Runs Omaha, Winnipeg, Cheyenne, Salt Lake City, San Francisco and Las Vegas outside "
         "this footprint. Those draw as markers; the states list stays to what the map claims."),
    ],
    "wwf": [
        (12, 1953, 1963, ["NY", "NJ", "PA", "CT", "RI", "MA", "VT", "NH", "ME", "MD", "DE", "DC"],
         "Capitol Wrestling Corporation", "Vincent J. McMahon", True, "medium_search", WIKI,
         "The territories row gives year_founded 1963, which is when the company left the NWA "
         "and became the WWWF. Capitol was promoting the Northeast from the early 1950s, so the "
         "Cagematch span understates it by a decade. VA is dropped from the map's footprint for "
         "all three eras: Capitol ran northern Virginia out of the DC office, but the corpus has "
         "no Virginia town for it, and Richmond and Norfolk belong to Crockett. Claiming the "
         "state with no town behind it would paint Virginia on nothing. Add Alexandria or "
         "Richmond under Capitol and put VA back."),
        (12, 1963, 1979, ["NY", "NJ", "PA", "CT", "RI", "MA", "VT", "NH", "ME", "MD", "DE", "DC"],
         "World Wide Wrestling Federation", "Vincent J. McMahon", False, "medium_search", WIKI,
         "Leaves the NWA in 1963 over the Buddy Rogers title dispute."),
        (12, 1979, 1990, ["NY", "NJ", "PA", "CT", "RI", "MA", "VT", "NH", "ME", "MD", "DE", "DC"],
         "World Wrestling Federation", "Vincent J. McMahon; Vincent K. McMahon from 1982",
         False, "medium", REPO_SOURCE, None),
    ],
    "indianapolis": [
        (224, 1950, 1963, ["IN"], "NWA Indianapolis",
         "Billy Thom; Jim Barnett and Johnny Doyle from the mid-1950s", True, "medium",
         REPO_SOURCE, None),
    ],
    "wwa": [
        (383, 1964, 1989, ["IN", "OH"], "World Wrestling Association",
         "Dick the Bruiser and Wilbur Snyder", False, "medium", REPO_SOURCE, None),
    ],
}


# ---------------------------------------------------------------------------
# Which towns each map promotion ran, at what tier. Straight from the repo
# markets.json, with the two venue-qualified duplicates folded onto their town.
# own_from/own_to are the few markets the map dates itself.
# ---------------------------------------------------------------------------
MEMBERSHIPS: list[tuple] = [
    ("arizona",           "Casa Grande",             "AZ", "US", "Secondary",  None, None),
    ("arizona",           "Flagstaff",               "AZ", "US", "Tertiary",   None, None),
    ("arizona",           "Phoenix",                 "AZ", "US", "Primary",    None, None),
    ("arizona",           "Prescott",                "AZ", "US", "Tertiary",   None, None),
    ("arizona",           "Tucson",                  "AZ", "US", "Primary",    None, None),
    ("arizona",           "Yuma",                    "AZ", "US", "Secondary",  None, None),
    ("awa",               "Bismarck",                "ND", "US", "Tertiary",   None, None),
    ("awa",               "Cedar Rapids",            "IA", "US", "Secondary",  None, None),
    ("awa",               "Cheyenne",                "WY", "US", "Tertiary",   1972, 1982),
    ("awa",               "Chicago",                 "IL", "US", "Primary",    None, None),
    ("awa",               "Denver",                  "CO", "US", "Primary",    None, None),
    ("awa",               "Duluth",                  "MN", "US", "Secondary",  None, None),
    ("awa",               "Fargo",                   "ND", "US", "Secondary",  None, None),
    ("awa",               "Green Bay",               "WI", "US", "Secondary",  None, None),
    ("awa",               "La Crosse",               "WI", "US", "Tertiary",   None, None),
    ("awa",               "Las Vegas",               "NV", "US", "Secondary",  1985, 1991),
    ("awa",               "Milwaukee",               "WI", "US", "Primary",    None, None),
    ("awa",               "Minneapolis",             "MN", "US", "Primary",    None, None),
    ("awa",               "Moline",                  "IL", "US", "Secondary",  None, None),
    ("awa",               "Omaha",                   "NE", "US", "Secondary",  None, None),
    ("awa",               "Peoria",                  "IL", "US", "Tertiary",   None, None),
    ("awa",               "Rochester",               "MN", "US", "Tertiary",   None, None),
    ("awa",               "Rockford",                "IL", "US", "Tertiary",   None, None),
    ("awa",               "Salt Lake City",          "UT", "US", "Secondary",  1982, 1987),
    ("awa",               "San Francisco",           "CA", "US", "Secondary",  1982, 1985),
    ("awa",               "Sioux Falls",             "SD", "US", "Secondary",  None, None),
    ("awa",               "St. Paul",                "MN", "US", "Secondary",  None, None),
    ("awa",               "Winnipeg",                "MB", "CA", "Primary",    None, None),
    ("big-time",          "Akron",                   "OH", "US", "Secondary",  None, None),
    ("big-time",          "Cleveland",               "OH", "US", "Primary",    None, None),
    ("big-time",          "Columbus",                "OH", "US", "Primary",    None, None),
    ("big-time",          "Detroit",                 "MI", "US", "Primary",    None, None),
    ("big-time",          "Grand Rapids",            "MI", "US", "Secondary",  None, None),
    ("big-time",          "Lansing",                 "MI", "US", "Secondary",  None, None),
    ("big-time",          "Toledo",                  "OH", "US", "Secondary",  None, None),
    ("central-states",    "Des Moines",              "IA", "US", "Secondary",  None, None),
    ("central-states",    "Kansas City",             "MO", "US", "Primary",    None, None),
    ("central-states",    "Omaha",                   "NE", "US", "Secondary",  None, None),
    ("central-states",    "St. Joseph",              "MO", "US", "Tertiary",   None, None),
    ("central-states",    "St. Louis",               "MO", "US", "Primary",    None, None),
    ("central-states",    "Topeka",                  "KS", "US", "Tertiary",   None, None),
    ("central-states",    "Wichita",                 "KS", "US", "Secondary",  None, None),
    ("columbus",          "Akron",                   "OH", "US", "Secondary",  None, None),
    ("columbus",          "Cleveland",               "OH", "US", "Primary",    None, None),
    ("columbus",          "Columbus",                "OH", "US", "Primary",    None, None),
    ("columbus",          "Toledo",                  "OH", "US", "Secondary",  None, None),
    ("detroit",           "Detroit",                 "MI", "US", "Primary",    None, None),
    ("detroit",           "Grand Rapids",            "MI", "US", "Secondary",  None, None),
    ("detroit",           "Lansing",                 "MI", "US", "Secondary",  None, None),
    ("florida",           "Jacksonville",            "FL", "US", "Secondary",  None, None),
    ("florida",           "Miami",                   "FL", "US", "Primary",    None, None),
    ("florida",           "Orlando",                 "FL", "US", "Secondary",  None, None),
    ("florida",           "Tallahassee",             "FL", "US", "Tertiary",   None, None),
    ("florida",           "Tampa",                   "FL", "US", "Primary",    None, None),
    ("georgia",           "Atlanta",                 "GA", "US", "Primary",    None, None),
    ("georgia",           "Columbus",                "GA", "US", "Secondary",  None, None),
    ("georgia",           "Macon",                   "GA", "US", "Secondary",  None, None),
    ("georgia",           "Savannah",                "GA", "US", "Secondary",  None, None),
    ("gulf-coast",        "Birmingham",              "AL", "US", "Secondary",  None, None),
    ("gulf-coast",        "Mobile",                  "AL", "US", "Primary",    None, None),
    ("gulf-coast",        "Montgomery",              "AL", "US", "Secondary",  None, None),
    ("gulf-coast",        "Pensacola",               "FL", "US", "Secondary",  None, None),
    ("houston",           "Beaumont",                "TX", "US", "Secondary",  None, None),
    ("houston",           "Galveston",               "TX", "US", "Tertiary",   None, None),
    ("houston",           "Houston",                 "TX", "US", "Primary",    None, None),
    ("indianapolis",      "Evansville",              "IN", "US", "Secondary",  None, None),
    ("indianapolis",      "Fort Wayne",              "IN", "US", "Primary",    None, None),
    ("indianapolis",      "Indianapolis",            "IN", "US", "Primary",    None, None),
    ("intermountain",     "Boise",                   "ID", "US", "Primary",    None, None),
    ("intermountain",     "Idaho Falls",             "ID", "US", "Primary",    None, None),
    ("intermountain",     "Ogden",                   "UT", "US", "Secondary",  None, None),
    ("intermountain",     "Pocatello",               "ID", "US", "Secondary",  None, None),
    ("intermountain",     "Salt Lake City",          "UT", "US", "Primary",    None, None),
    ("intermountain",     "Twin Falls",              "ID", "US", "Secondary",  None, None),
    ("los-angeles",       "Bakersfield",             "CA", "US", "Secondary",  None, None),
    ("los-angeles",       "Fresno",                  "CA", "US", "Secondary",  None, None),
    ("los-angeles",       "Los Angeles",             "CA", "US", "Primary",    None, None),
    ("los-angeles",       "San Diego",               "CA", "US", "Secondary",  None, None),
    ("memphis",           "Chattanooga",             "TN", "US", "Secondary",  None, None),
    ("memphis",           "Knoxville",               "TN", "US", "Secondary",  None, None),
    ("memphis",           "Lexington",               "KY", "US", "Secondary",  None, None),
    ("memphis",           "Louisville",              "KY", "US", "Secondary",  None, None),
    ("memphis",           "Memphis",                 "TN", "US", "Primary",    None, None),
    ("memphis",           "Nashville",               "TN", "US", "Primary",    None, None),
    ("mid-america",       "Birmingham",              "AL", "US", "Secondary",  None, None),
    ("mid-america",       "Bowling Green",           "KY", "US", "Tertiary",   None, None),
    ("mid-america",       "Chattanooga",             "TN", "US", "Secondary",  None, None),
    ("mid-america",       "Dyersburg",               "TN", "US", "Tertiary",   None, None),
    ("mid-america",       "Huntsville",              "AL", "US", "Secondary",  None, None),
    ("mid-america",       "Knoxville",               "TN", "US", "Secondary",  None, None),
    ("mid-america",       "Lexington",               "KY", "US", "Secondary",  None, None),
    ("mid-america",       "Louisville",              "KY", "US", "Secondary",  None, None),
    ("mid-america",       "Memphis",                 "TN", "US", "Primary",    None, None),
    ("mid-america",       "Nashville",               "TN", "US", "Primary",    None, None),
    ("mid-atlantic",      "Charlotte",               "NC", "US", "Primary",    None, None),
    ("mid-atlantic",      "Columbia",                "SC", "US", "Secondary",  None, None),
    ("mid-atlantic",      "Greensboro",              "NC", "US", "Primary",    None, None),
    ("mid-atlantic",      "Norfolk",                 "VA", "US", "Secondary",  None, None),
    ("mid-atlantic",      "Raleigh",                 "NC", "US", "Secondary",  None, None),
    ("mid-atlantic",      "Richmond",                "VA", "US", "Secondary",  None, None),
    ("mid-south",         "Baton Rouge",             "LA", "US", "Secondary",  None, None),
    ("mid-south",         "Fort Smith",              "AR", "US", "Secondary",  None, None),
    ("mid-south",         "Jackson",                 "MS", "US", "Secondary",  None, None),
    ("mid-south",         "Little Rock",             "AR", "US", "Secondary",  None, None),
    ("mid-south",         "New Orleans",             "LA", "US", "Primary",    None, None),
    ("mid-south",         "Oklahoma City",           "OK", "US", "Primary",    None, None),
    ("mid-south",         "Shreveport",              "LA", "US", "Primary",    None, None),
    ("mid-south",         "Tulsa",                   "OK", "US", "Primary",    None, None),
    ("pacific-northwest", "Eugene",                  "OR", "US", "Secondary",  None, None),
    ("pacific-northwest", "Portland",                "OR", "US", "Primary",    None, None),
    ("pacific-northwest", "Salem",                   "OR", "US", "Secondary",  None, None),
    ("pacific-northwest", "Seattle",                 "WA", "US", "Primary",    None, None),
    ("pacific-northwest", "Spokane",                 "WA", "US", "Secondary",  None, None),
    ("san-antonio",       "Austin",                  "TX", "US", "Secondary",  None, None),
    ("san-antonio",       "Corpus Christi",          "TX", "US", "Secondary",  None, None),
    ("san-antonio",       "San Antonio",             "TX", "US", "Primary",    None, None),
    ("san-francisco",     "Oakland",                 "CA", "US", "Secondary",  None, None),
    ("san-francisco",     "Reno",                    "NV", "US", "Secondary",  None, None),
    ("san-francisco",     "Sacramento",              "CA", "US", "Secondary",  None, None),
    ("san-francisco",     "San Francisco",           "CA", "US", "Primary",    None, None),
    ("san-francisco",     "San Jose",                "CA", "US", "Secondary",  None, None),
    ("st-louis",          "East St. Louis",          "IL", "US", "Tertiary",   None, None),
    ("st-louis",          "St. Louis",               "MO", "US", "Primary",    None, None),
    ("stampede",          "Billings",                "MT", "US", "Tertiary",   None, None),
    ("stampede",          "Calgary",                 "AB", "CA", "Primary",    None, None),
    ("stampede",          "Edmonton",                "AB", "CA", "Primary",    None, None),
    ("stampede",          "Great Falls",             "MT", "US", "Secondary",  None, None),
    ("stampede",          "Regina",                  "SK", "CA", "Secondary",  None, None),
    ("tri-state",         "Fort Smith",              "AR", "US", "Secondary",  None, None),
    ("tri-state",         "Jackson",                 "MS", "US", "Secondary",  None, None),
    ("tri-state",         "Little Rock",             "AR", "US", "Secondary",  None, None),
    ("tri-state",         "Oklahoma City",           "OK", "US", "Primary",    None, None),
    ("tri-state",         "Shreveport",              "LA", "US", "Primary",    None, None),
    ("tri-state",         "Tulsa",                   "OK", "US", "Primary",    None, None),
    ("western-states",    "Albuquerque",             "NM", "US", "Secondary",  None, None),
    ("western-states",    "Amarillo",                "TX", "US", "Primary",    None, None),
    ("western-states",    "El Paso",                 "TX", "US", "Primary",    None, None),
    ("western-states",    "Lubbock",                 "TX", "US", "Secondary",  None, None),
    ("western-states",    "Odessa",                  "TX", "US", "Tertiary",   None, None),
    ("world-class",       "Dallas",                  "TX", "US", "Primary",    None, None),
    ("world-class",       "Fort Worth",              "TX", "US", "Secondary",  None, None),
    ("wwa",               "Chicago",                 "IL", "US", "Primary",    None, None),
    ("wwa",               "Cincinnati",              "OH", "US", "Secondary",  None, None),
    ("wwa",               "Dayton",                  "OH", "US", "Tertiary",   None, None),
    ("wwa",               "Detroit",                 "MI", "US", "Primary",    None, None),
    ("wwa",               "Evansville",              "IN", "US", "Secondary",  None, None),
    ("wwa",               "Fort Wayne",              "IN", "US", "Primary",    None, None),
    ("wwa",               "Indianapolis",            "IN", "US", "Primary",    None, None),
    ("wwa",               "Lafayette",               "IN", "US", "Tertiary",   None, None),
    ("wwa",               "Muncie",                  "IN", "US", "Tertiary",   None, None),
    ("wwa",               "South Bend",              "IN", "US", "Secondary",  None, None),
    ("wwa",               "Terre Haute",             "IN", "US", "Secondary",  None, None),
    ("wwf",               "Albany",                  "NY", "US", "Tertiary",   None, None),
    ("wwf",               "Allentown",               "PA", "US", "Secondary",  None, None),
    ("wwf",               "Baltimore",               "MD", "US", "Primary",    None, None),
    ("wwf",               "Bangor",                  "ME", "US", "Tertiary",   None, None),
    ("wwf",               "Boston",                  "MA", "US", "Primary",    None, None),
    ("wwf",               "Buffalo",                 "NY", "US", "Secondary",  None, None),
    ("wwf",               "Burlington",              "VT", "US", "Tertiary",   None, None),
    ("wwf",               "Harrisburg",              "PA", "US", "Tertiary",   None, None),
    ("wwf",               "Hartford",                "CT", "US", "Secondary",  None, None),
    ("wwf",               "Manchester",              "NH", "US", "Tertiary",   None, None),
    ("wwf",               "New York",                "NY", "US", "Primary",    None, None),
    ("wwf",               "Newark",                  "NJ", "US", "Secondary",  None, None),
    ("wwf",               "Philadelphia",            "PA", "US", "Primary",    None, None),
    ("wwf",               "Pittsburgh",              "PA", "US", "Primary",    None, None),
    ("wwf",               "Portland",                "ME", "US", "Secondary",  None, None),
    ("wwf",               "Providence",              "RI", "US", "Secondary",  None, None),
    ("wwf",               "Rochester",               "NY", "US", "Tertiary",   None, None),
    ("wwf",               "Scranton",                "PA", "US", "Tertiary",   None, None),
    ("wwf",               "Springfield",             "MA", "US", "Secondary",  None, None),
    ("wwf",               "Trenton",                 "NJ", "US", "Tertiary",   None, None),
    ("wwf",               "Washington",              "DC", "US", "Primary",    None, None),
    ("wwf",               "Wilmington",              "DE", "US", "Tertiary",   None, None),
]


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


def source_ids(cur) -> dict[str, int]:
    cur.execute("SELECT url, id FROM research_sources")
    return dict(cur.fetchall())


def market_ids(cur) -> dict[tuple[str, str, str], int]:
    cur.execute("SELECT name, state, country, id FROM markets")
    return {(n, s, c): i for n, s, c, i in cur.fetchall()}


def seed_eras(cur, sources: dict[str, int]) -> tuple[int, int]:
    added = skipped = 0
    for map_id, segs in SEGMENTS.items():
        for (tid, frm, to, states, promo, promoter, nwa, conf, src, notes) in segs:
            cur.execute(
                "SELECT id FROM territory_eras WHERE territory_id=%s AND from_year=%s",
                (tid, frm),
            )
            if cur.fetchone():
                skipped += 1
                continue
            cur.execute(
                """INSERT INTO territory_eras
                     (territory_id, from_year, to_year, states, nwa_member,
                      promotion_name, promoter, confidence, source_id, notes)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (tid, frm, to, states, nwa, promo, promoter, conf,
                 sources.get(src), notes),
            )
            added += 1
    return added, skipped


def planned_runs() -> list[tuple]:
    """Expand segments against memberships.

    A segment takes the promotion's markets whose state it claims, unless the
    promotion has only one segment, in which case it takes all of them. That
    single rule covers every case: Intermountain splits by state because its two
    offices held different halves, Los Angeles splits by year because one turf
    changed hands, and the AWA keeps Winnipeg and Las Vegas because it has
    nothing to split with.
    """
    by_map: dict[str, list[tuple]] = {}
    for m in MEMBERSHIPS:
        by_map.setdefault(m[0], []).append(m)

    out: list[tuple] = []
    for map_id, segs in SEGMENTS.items():
        mkts = by_map.get(map_id, [])
        single = len(segs) == 1
        for (tid, s_from, s_to, states, _p, _pr, _n, conf, src, _notes) in segs:
            for (_mid, name, state, country, tier, own_from, own_to) in mkts:
                if not single and state not in states:
                    continue
                frm = max(s_from, own_from or s_from)
                to = min(s_to, own_to or s_to)
                if frm > to:
                    continue  # the market's own years miss this stretch entirely
                out.append((tid, name, state, country, frm, to, tier, conf, src))
    return out


def seed_runs(cur, sources: dict[str, int], markets: dict) -> tuple[int, int, list]:
    added = skipped = 0
    missing: list = []
    for (tid, name, state, country, frm, to, tier, conf, src) in planned_runs():
        mid = markets.get((name, state, country))
        if mid is None:
            missing.append((name, state, country))
            continue
        cur.execute(
            """SELECT id FROM territory_market_runs
                WHERE territory_id=%s AND market_id=%s AND from_year=%s""",
            (tid, mid, frm),
        )
        if cur.fetchone():
            skipped += 1
            continue
        cur.execute(
            """INSERT INTO territory_market_runs
                 (territory_id, market_id, from_year, to_year, tier, confidence, source_id)
               VALUES (%s,%s,%s,%s,%s,%s,%s)""",
            (tid, mid, frm, to, tier, conf, sources.get(src)),
        )
        added += 1
    return added, skipped, missing


def report(cur) -> None:
    cur.execute("SELECT count(*) FROM territory_eras")
    eras = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM territory_market_runs")
    runs = cur.fetchone()[0]
    cur.execute("""SELECT count(DISTINCT territory_id) FROM territory_eras""")
    terrs = cur.fetchone()[0]
    print()
    print(f"  territory_eras          {eras} across {terrs} promotions")
    print(f"  territory_market_runs   {runs}")

    print()
    print("  --- eras claiming a state with no town in it ---")
    cur.execute("""
        SELECT t.name, e.from_year, e.to_year, s
        FROM territory_eras e
        JOIN territories t ON t.id = e.territory_id
        CROSS JOIN LATERAL unnest(e.states) AS s
        WHERE NOT EXISTS (
          SELECT 1 FROM territory_market_runs r JOIN markets m ON m.id = r.market_id
          WHERE r.territory_id = e.territory_id AND m.state = s
            AND r.from_year <= COALESCE(e.to_year, 2100)
            AND COALESCE(r.to_year, 2100) >= e.from_year)
        ORDER BY t.name, e.from_year
    """)
    orphans = cur.fetchall()
    if orphans:
        for name, a, b, s in orphans:
            print(f"    {name} {a}-{b}: claims {s} with no town")
    else:
        print("    none")

    print()
    print("  --- rows with no provenance ---")
    cur.execute("""
        SELECT count(*) FROM territory_eras WHERE source_id IS NULL OR confidence IS NULL
    """)
    e_bad = cur.fetchone()[0]
    cur.execute("""
        SELECT count(*) FROM territory_market_runs WHERE source_id IS NULL OR confidence IS NULL
    """)
    r_bad = cur.fetchone()[0]
    print(f"    eras {e_bad}, runs {r_bad}")

    print()
    print("  --- the four snapshot years ---")
    for year in (1958, 1965, 1975, 1985):
        cur.execute("""
            SELECT count(DISTINCT territory_id), count(*)
            FROM v_territory_year_markets WHERE year = %s
        """, (year,))
        n_terr, n_mkt = cur.fetchone()
        print(f"    {year}: {n_terr} promotions, {n_mkt} town-runs")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="roll back instead of committing")
    args = ap.parse_args()

    with psycopg.connect(database_url()) as conn:
        with conn.cursor() as cur:
            sources = source_ids(cur)
            markets = market_ids(cur)

            n_era, s_era = seed_eras(cur, sources)
            n_run, s_run, missing = seed_runs(cur, sources, markets)

            print(f"territory_eras        +{n_era}  ({s_era} already present)")
            print(f"territory_market_runs +{n_run}  ({s_run} already present)")
            if missing:
                print(f"  markets referenced but not in the table: {sorted(set(missing))}")

            report(cur)

        if args.dry_run:
            conn.rollback()
            print("\n--dry-run: rolled back")
        else:
            conn.commit()
            print("\ncommitted")


if __name__ == "__main__":
    main()
