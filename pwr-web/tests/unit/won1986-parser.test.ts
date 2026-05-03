import { describe, expect, it } from "vitest";
import { parseBornDate, parseCorpus, parseHometown, splitByPage } from "@/scripts/won1986/parser";

// ---------------------------------------------------------------------------
// Fixture — distilled from the actual OCR output the script will produce.
// Mirrors the layout the parser sees (header → labels → blank line → bio).
// ---------------------------------------------------------------------------

const FIXTURE = `<<<PAGE 13>>>
"GENTLEMAN" CHRIS ADAMS (6-0, 220)
Real name - Chris Adams
Age - 31 (born 2/10/55)
Years pro - 9
Hometown - Stratford-on-Avon, England (now lives in Highland Park, Texas)
Promotional affiliation - Mid South Sports
Other ring names - Masked Avenger

A former national judo champion in his native England. Started pro
wrestling in 1978 under the name "Judo" Chris Adams. Brother of
Neal Adams, silver medalist in judo.

Adams has always displayed good athletic ability in the ring.

BRIAN ADIAS (6-0, 215)
Real name - Brian Gower
Age - 26
Years pro - 4
Hometown - Arlington, Texas
Promotional affiliation - World Class Championship Wrestling
Other ring names - Brian Adidas

Former Southland Conference shot put champion from the University
of Texas at Arlington. Billed as the best friend of Kerry Von Erich.

ANDRE THE GIANT (6-10½, 520)
Real name - Andre Rousimoff
Age - 40 (born 5/19/46)
Years pro - 22
Hometown - Grenoble, France (now lives in Ellerbe, North Carolina)
Promotional affiliation - Titan Sports
Other ring names - Jean Ferre, The French Giant

Tried his hand at several sports before having his first pro match
in France during late 1964.
<<<PAGE 21>>>
CHRIS BENOIT (5-10, 170)
Real name - Chris Benoit
Age - 19
Years pro - 1
Hometown - Calgary, Alberta
Promotional affiliation - Stampede Wrestling
Other ring names - None

Made pro debut less than six months after graduating high school.
A leading candidate for 1986 rookie of the year.

BLACKMAN (5-6½, 155)
Real name -
Age - 33
Years pro - 10
Hometown - Mexico City, Mexico
Promotional affiliation - Universal Wrestling Association
Other ring names - Unknown

One of the most spectacular of the Mexican performers known for his
flying dives outside the ring.
<<<PAGE 140>>>
PRECIOUS PAUL ELLERING (6-2, 270)
Real name - Paul Ellering
Age - 33
Years pro - 8
Hometown - Minneapolis, Minnesota
Promotional affiliation - Jim Crockett Promotions
Other ring names - None

Manager of the Road Warriors.
`;

describe("splitByPage", () => {
  it("splits on <<<PAGE n>>> markers", () => {
    const pages = splitByPage(FIXTURE);
    expect(pages.map((p) => p.page)).toEqual([13, 21, 140]);
  });
});

describe("parseBornDate", () => {
  it("parses M/D/YY into ISO with the 1986-anchor heuristic", () => {
    expect(parseBornDate("2/10/55")).toBe("1955-02-10");
    expect(parseBornDate("5/19/46")).toBe("1946-05-19");
    expect(parseBornDate("9/15/53")).toBe("1953-09-15");
  });
  it("rejects malformed input", () => {
    expect(parseBornDate("not a date")).toBeNull();
    expect(parseBornDate("13/40/55")).toBeNull();
  });
});

describe("parseHometown", () => {
  it("splits the (now lives in ...) parenthetical", () => {
    const r = parseHometown("Stratford-on-Avon, England (now lives in Highland Park, Texas)");
    expect(r.billed).toBe("Stratford-on-Avon, England");
    expect(r.real).toBe("Highland Park, Texas");
  });
  it("handles a single-location hometown", () => {
    const r = parseHometown("Arlington, Texas");
    expect(r.billed).toBe("Arlington, Texas");
    expect(r.real).toBeNull();
  });
});

describe("parseCorpus", () => {
  it("parses every entry across pages", () => {
    const entries = parseCorpus(FIXTURE);
    expect(entries.map((e) => e.primary_ring_name).sort()).toEqual([
      '"GENTLEMAN" CHRIS ADAMS',
      "ANDRE THE GIANT",
      "BLACKMAN",
      "BRIAN ADIAS",
      "CHRIS BENOIT",
      "PRECIOUS PAUL ELLERING",
    ]);
  });

  it("converts feet/inches to total inches", () => {
    const entries = parseCorpus(FIXTURE);
    const adams = entries.find((e) => e.primary_ring_name === '"GENTLEMAN" CHRIS ADAMS')!;
    expect(adams.height_inches).toBe(72); // 6'0"
    const andre = entries.find((e) => e.primary_ring_name === "ANDRE THE GIANT")!;
    expect(andre.height_inches).toBe(82); // 6'10" (½ truncated, warning logged)
    expect(andre.warnings).toContain("fractional_height_truncated");
    const benoit = entries.find((e) => e.primary_ring_name === "CHRIS BENOIT")!;
    expect(benoit.height_inches).toBe(70); // 5'10"
  });

  it("reads weight in pounds", () => {
    const entries = parseCorpus(FIXTURE);
    const andre = entries.find((e) => e.primary_ring_name === "ANDRE THE GIANT")!;
    expect(andre.weight_lbs).toBe(520);
  });

  it("captures legal_name when present, null when blank or 'Unknown'", () => {
    const entries = parseCorpus(FIXTURE);
    expect(entries.find((e) => e.primary_ring_name === '"GENTLEMAN" CHRIS ADAMS')!.legal_name).toBe(
      "Chris Adams",
    );
    expect(entries.find((e) => e.primary_ring_name === "BLACKMAN")!.legal_name).toBeNull();
  });

  it("derives debut_year from years_pro", () => {
    const entries = parseCorpus(FIXTURE);
    expect(entries.find((e) => e.primary_ring_name === '"GENTLEMAN" CHRIS ADAMS')!.debut_year).toBe(
      1977,
    );
    expect(entries.find((e) => e.primary_ring_name === "CHRIS BENOIT")!.debut_year).toBe(1985);
  });

  it("splits hometown billed vs. real when '(now lives in ...)' present", () => {
    const entries = parseCorpus(FIXTURE);
    const adams = entries.find((e) => e.primary_ring_name === '"GENTLEMAN" CHRIS ADAMS')!;
    expect(adams.hometown_billed).toBe("Stratford-on-Avon, England");
    expect(adams.hometown_real).toBe("Highland Park, Texas");
    const benoit = entries.find((e) => e.primary_ring_name === "CHRIS BENOIT")!;
    expect(benoit.hometown_billed).toBe("Calgary, Alberta");
    expect(benoit.hometown_real).toBeNull();
  });

  it("normalizes 'None'/'Unknown'/blank to null on optional fields", () => {
    const entries = parseCorpus(FIXTURE);
    const benoit = entries.find((e) => e.primary_ring_name === "CHRIS BENOIT")!;
    expect(benoit.other_ring_names).toBeNull();
    expect(entries.find((e) => e.primary_ring_name === "BLACKMAN")!.other_ring_names).toBeNull();
  });

  it("captures the bio narrative as everything after the label block", () => {
    const entries = parseCorpus(FIXTURE);
    const benoit = entries.find((e) => e.primary_ring_name === "CHRIS BENOIT")!;
    expect(benoit.bio).toContain("Made pro debut less than six months");
    expect(benoit.bio).toContain("rookie of the year");
  });

  it("tags entries with the source PDF page", () => {
    const entries = parseCorpus(FIXTURE);
    const adams = entries.find((e) => e.primary_ring_name === '"GENTLEMAN" CHRIS ADAMS')!;
    expect(adams.source_page).toBe(13);
    const benoit = entries.find((e) => e.primary_ring_name === "CHRIS BENOIT")!;
    expect(benoit.source_page).toBe(21);
    const ellering = entries.find((e) => e.primary_ring_name === "PRECIOUS PAUL ELLERING")!;
    expect(ellering.source_page).toBe(140);
  });
});

// ---------------------------------------------------------------------------
// Realistic OCR fixture — mirrors what tesseract actually produces:
//   - blank lines between labels
//   - label values wrapping across lines
//   - a label value split by a blank line ("Mid\n\nSouth Sports")
//   - bio prose where the first line has lots of capitalized words
//   - an Other-ring-names list-continuation line starting with `,`
// ---------------------------------------------------------------------------
const OCR_FIXTURE = `<<<PAGE 16>>>
"GENTLEMAN" CHRIS ADAMS (6-0, 220)

Real name - Chris Adams

Age - 31 (born 2/10/55)

Years pro - 9

Hometown - Stratford-on-Avon,
England (now lives in Highland
Park, Texas)

Promotional affiliation - Mid

South Sports
Other ring names - Masked Avenger

A former national judo champion in
his native England. Started pro
wrestling in 1978.

BRIAN ADIAS (6-0, 215)

Real name - Brian Gower

Age - 26

Years pro - 4

Hometown - Arlington, Texas

Promotional affiliation - World
Class Championship Wrestling

Other ring names - Brian Adidas
Former Southland Conference shot
put champion from the University
of Texas at Arlington.

"ADORABLE" ADRIAN ADONIS (6-1, 305)

Real name - Keith Franke

Age - 33 (born 9/15/53)

Years pro - 12

Hometown - Buffalo, New York (now
lives in Bakersfield, California)

Other ring names - Keith Franks,
"Gorgeous" Keith Franks

Former high school wrestler who
turned pro in British Columbia.
<<<PAGE 17>>>
in late 1974 after a Canadian Football
League try-out.
`;

describe("parseCorpus on realistic OCR layout", () => {
  it("collects multi-line label values across blank lines", () => {
    const entries = parseCorpus(OCR_FIXTURE);
    const adams = entries.find((e) => e.primary_ring_name === '"GENTLEMAN" CHRIS ADAMS')!;
    expect(adams.promotional_affiliation).toBe("Mid South Sports");
    expect(adams.hometown_billed).toBe("Stratford-on-Avon, England");
    expect(adams.hometown_real).toBe("Highland Park, Texas");
  });

  it("does not leak bio prose into Other ring names", () => {
    const entries = parseCorpus(OCR_FIXTURE);
    const adias = entries.find((e) => e.primary_ring_name === "BRIAN ADIAS")!;
    expect(adias.other_ring_names).toBe("Brian Adidas");
    expect(adias.bio).toMatch(/^Former Southland Conference/);
  });

  it("keeps list continuation (e.g. 'Keith Franks, Gorgeous Keith Franks')", () => {
    const entries = parseCorpus(OCR_FIXTURE);
    const adonis = entries.find((e) => e.primary_ring_name === '"ADORABLE" ADRIAN ADONIS')!;
    expect(adonis.other_ring_names).toBe('Keith Franks, "Gorgeous" Keith Franks');
  });

  it("picks the entry's source page from where the header lives, not the bio's pages", () => {
    const entries = parseCorpus(OCR_FIXTURE);
    const adonis = entries.find((e) => e.primary_ring_name === '"ADORABLE" ADRIAN ADONIS')!;
    expect(adonis.source_page).toBe(16);
    // …and the bio should still include the page-17 continuation
    expect(adonis.bio).toContain("Canadian Football");
  });
});
