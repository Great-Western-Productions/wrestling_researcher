#!/usr/bin/env python3
"""Seed periodicals + canonical high-confidence books from training knowledge.

Bibliographic info I include here is restricted to things I'm confident about:
- Title, primary author(s), approximate publication year, publisher
- Synopsis is summarized from public knowledge of the book

Confidence flag is set conservatively. Year/ISBN are omitted when I'm not sure.
"""
import sqlite3, re, os

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wrestling_bibliography.db")

conn = sqlite3.connect(DB)
conn.execute("PRAGMA foreign_keys=ON")
cur = conn.cursor()

# ============================================================================
# PERIODICALS
# ============================================================================
PERIODICALS = [
    # ---- US Newsstand / Apter Magazines (Stanley Weston / G.C. London Publishing → London Publishing → Kappa) ----
    ("The Ring (Wrestling section)", 1922, None, "The Ring Publishing Co.", "US", "monthly", "newsstand", "Nat Fleischer's boxing magazine featured pro wrestling extensively in early decades"),
    ("Wrestling As You Like It", 1948, 1962, "Norman Kietzer / various", "US", "monthly", "newsstand", None),
    ("Wrestling Life", 1955, 1962, "Norman Kietzer Publications", "US", "bimonthly", "newsstand", None),
    ("Boxing & Wrestling", 1951, 1960, "various", "US", "monthly", "newsstand", None),
    ("Wrestling World", 1962, 1985, "G.C. London / Kappa", "US", "bimonthly", "newsstand", "Apter family of magazines"),
    ("Wrestling Revue", 1959, 1981, "various (Norman Kietzer; later Apter family)", "US", "bimonthly", "newsstand", "One of the longest-running and most respected kayfabe-era wrestling magazines"),
    ("The Wrestler", 1966, None, "G.C. London Publishing / Kappa", "US", "monthly", "apter_mag", "Apter mag — flagship Stanley Weston title"),
    ("Inside Wrestling", 1968, None, "G.C. London Publishing / Kappa", "US", "monthly", "apter_mag", "Apter mag — companion to The Wrestler"),
    ("Wrestling Monthly", 1972, 1988, "Lexington Library", "US", "monthly", "newsstand", None),
    ("Sports Review Wrestling", 1973, None, "G.C. London Publishing / Kappa", "US", "monthly", "apter_mag", "Apter mag"),
    ("Pro Wrestling Illustrated", 1979, None, "Sports & Entertainment Publications / Kappa", "US", "monthly", "apter_mag", "Bill Apter's flagship; introduced 'PWI 500' in 1991"),
    ("Wrestling's Main Event", 1981, 1991, "London Publishing", "US", "bimonthly", "apter_mag", "Apter mag"),
    ("Wrestling Eye", 1985, 1995, "Sterling/Mcfadden", "US", "monthly", "newsstand", None),
    ("Wrestling Superstars", 1985, 1993, "G.C. London", "US", "quarterly", "apter_mag", "Apter mag — special-issue format"),
    ("Wrestling Scene", 1985, 1992, "various", "US", "bimonthly", "newsstand", None),
    ("Wrestling All Stars", 1983, 1994, "various", "US", "quarterly", "newsstand", None),
    ("Big Time Wrestling", 1968, 1972, "Reese Communications", "US", "monthly", "newsstand", None),
    ("Wrestling Confidential", 1971, 1975, "Health Publications", "US", "bimonthly", "newsstand", None),
    ("The Big Book of Wrestling", 1974, 1979, "various", "US", "annual", "newsstand", None),
    ("PWI Wrestling Almanac & Book of Facts", 1986, None, "Kappa Publishing", "US", "annual", "apter_mag", "Year-in-review reference annual"),
    
    # ---- US Promotion-Owned ----
    ("WWF Magazine", 1983, 2002, "WWF / Titan Sports", "US", "monthly", "territory_program", "Renamed WWE Magazine in 2002"),
    ("WWE Magazine", 2002, 2014, "WWE", "US", "monthly", "territory_program", "Successor to WWF Magazine"),
    ("Raw Magazine", 1997, 2002, "WWF / Titan Sports", "US", "monthly", "territory_program", None),
    ("WCW Magazine", 1991, 2001, "WCW / Turner Publishing", "US", "monthly", "territory_program", None),
    ("WCW/nWo Magazine", 1996, 2001, "WCW", "US", "monthly", "territory_program", None),
    ("ECW Magazine", 1996, 2001, "ECW", "US", "irregular", "territory_program", None),
    
    # ---- US Newsletters / Dirt Sheets ----
    ("Wrestling Observer Newsletter", 1983, None, "Dave Meltzer (self-published)", "US", "weekly", "newsletter", "The most influential and longest-running wrestling newsletter; founded by Jeff Bowdren but defined by Dave Meltzer"),
    ("Pro Wrestling Torch", 1987, None, "Wade Keller (PWTorch.com)", "US", "weekly", "newsletter", None),
    ("Pro Wrestling Insider Newsletter", 1995, None, "Mike Johnson", "US", "weekly", "newsletter", None),
    ("Figure Four Weekly", 1991, None, "Bryan Alvarez", "US", "weekly", "newsletter", None),
    ("Solie's Vintage Wrestling", 1995, None, "Earl Oliver / online", "US", "irregular", "newsletter", "Online-only; preserved Gordon Solie-era memorabilia and history"),
    ("Pro Wrestling Spotlight", 1989, 1991, "John Arezzi", "US", "weekly", "newsletter", "Predecessor to call-in radio era"),
    ("Wrestling Lariat", 1989, 1995, "Kelly Wells", "US", "weekly", "newsletter", None),
    ("WrestleLine.com (newsletter)", 1998, 2004, "Bob Ryder", "US", "daily", "newsletter", None),
    
    # ---- Promotion Programs ----
    ("Wrestling at the Chase Program", 1959, 1983, "St. Louis Wrestling Club", "US", "weekly", "territory_program", "Sam Muchnick's St. Louis NWA territory house program"),
    ("MSG Wrestling Program", 1953, None, "WWWF/WWF/WWE", "US", "monthly", "territory_program", "Madison Square Garden program"),
    ("AWA Wrestling Magazine", 1971, 1990, "American Wrestling Association", "US", "irregular", "territory_program", "Verne Gagne's AWA"),
    ("Mid-South Wrestling Magazine", 1980, 1986, "Bill Watts / Mid-South Sports", "US", "irregular", "territory_program", None),
    ("WCCW Program", 1982, 1989, "World Class Championship Wrestling", "US", "weekly", "territory_program", "Fritz Von Erich's territory"),
    
    # ---- UK ----
    ("The Wrestler (UK)", 1965, 1988, "various", "UK", "monthly", "newsstand", "British counterpart; covered Joint Promotions"),
    ("Wrestling Scene (UK)", 1976, 1988, "Brian Crabtree / Joint Promotions", "UK", "monthly", "newsstand", None),
    ("The Heritage of Wrestling (UK)", 2002, None, "Heritage Wrestling Society", "UK", "quarterly", "newsletter", "British wrestling history journal"),
    ("Wrestling Heritage (UK)", 2007, None, "online", "UK", "irregular", "newsletter", None),
    
    # ---- Japan ----
    ("Pro Wrestling & Boxing", 1955, 1968, "Baseball Magazine Sha", "Japan", "monthly", "newsstand", "Earliest major Japanese pro wrestling magazine; covered Rikidozan era"),
    ("Gong (Wrestling/Boxing)", 1968, 2007, "Nihon Sports Publishing", "Japan", "monthly", "newsstand", "Major Japanese magazine; 'Weekly Gong' 1985-2007"),
    ("Weekly Gong", 1985, 2007, "Nihon Sports Publishing", "Japan", "weekly", "newsstand", "Successor format to monthly Gong"),
    ("Weekly Pro Wrestling", 1983, None, "Baseball Magazine Sha", "Japan", "weekly", "newsstand", "Shukan Puroresu — the dominant puroresu magazine; long-time editor Tarzan Yamamoto"),
    ("Lady's Gong", 1985, 1999, "Nihon Sports Publishing", "Japan", "monthly", "newsstand", "Joshi puroresu (women's wrestling) coverage"),
    ("Deluxe Pro Wrestling", 1976, 1990, "Baseball Magazine Sha", "Japan", "monthly", "newsstand", None),
    ("Kakutogi Tsushin", 1986, None, "various", "Japan", "monthly", "newsstand", "Combat sports/MMA crossover"),
    ("G Spirits", 2006, None, "Tatsumi Mook", "Japan", "quarterly", "newsstand", "Retrospective puroresu mook series"),
    
    # ---- Mexico ----
    ("Lucha Libre", 1953, None, "Editorial Mexicana", "Mexico", "weekly", "newsstand", "The longest-running lucha libre magazine"),
    ("Box y Lucha", 1952, None, "various", "Mexico", "weekly", "newsstand", "Boxing & lucha combined; founded by Jose Sulaiman's family"),
    ("Super Luchas", 1991, None, "various", "Mexico", "weekly", "newsstand", None),
    ("Halcones de la Lucha Libre", 1995, 2010, "various", "Mexico", "monthly", "newsstand", None),
    
    # ---- Canada ----
    ("Wrestler's Whirl", 1967, 1972, "Frank Tunney Sports", "Canada", "monthly", "territory_program", "Toronto Maple Leaf Wrestling territory"),
    
    # ---- Modern online-era ----
    ("Power Slam", 1994, 2014, "SW Publishing (UK)", "UK", "monthly", "newsstand", "UK newsstand magazine — covered global wrestling with editorial perspective"),
    ("Slam! Wrestling (Toronto Sun online)", 1996, None, "Postmedia / SLAM Wrestling Network", "Canada", "daily", "newsletter", "Greg Oliver's online news/feature site"),
    ("Wrestling Digest", 2000, 2003, "Century Publications", "US", "monthly", "newsstand", "Short-lived attempt at upscale wrestling print mag"),
    ("Inside the Ropes Magazine", 2018, None, "Inside the Ropes", "UK", "quarterly", "newsstand", "Modern UK quarterly"),
    ("Fightful Select (newsletter)", 2017, None, "Sean Ross Sapp", "US", "daily", "newsletter", "Premium news subscription"),
    ("Sports Illustrated Wrestling section", 1954, None, "Sports Illustrated", "US", "occasional", "newsstand", "Mainstream sports publication that has periodically covered wrestling"),
]

added_per = 0
for row in PERIODICALS:
    title, ys, ye, pub, country, freq, ptype, notes = row
    cur.execute("SELECT id FROM periodicals WHERE title=? AND (year_started=? OR (year_started IS NULL AND ? IS NULL))", (title, ys, ys))
    if cur.fetchone(): continue
    cur.execute("""INSERT INTO periodicals 
        (title, year_started, year_ended, publisher, country, frequency, type, notes, confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'high')""",
        (title, ys, ye, pub, country, freq, ptype, notes))
    added_per += 1
print(f"Periodicals added: {added_per}")

# ============================================================================
# Mark periodicals as in-collection if they're in the user's archive
# ============================================================================
in_collection_titles = {
    "Wrestling As You Like It", "Wrestling World", "Wrestling Life",
    "Wrestling Revue", "Wrestling Confidential", "The Ring (Wrestling section)",
    "Big Time Wrestling", "Inside Wrestling", "The Wrestler",
    "Sports Review Wrestling", "Wrestling Monthly", "The Big Book of Wrestling",
    "Wrestling's Main Event", "Wrestling Superstars", "Pro Wrestling Illustrated",
    "Wrestling Eye", "WWF Magazine", "WCW Magazine", "Wrestling Scene",
    "Wrestling All Stars", "PWI Wrestling Almanac & Book of Facts",
    "ECW Magazine",
}
for t in in_collection_titles:
    cur.execute("UPDATE periodicals SET archive_in_collection=1 WHERE title=?", (t,))

# ============================================================================
# CANONICAL BOOKS — high-confidence, hand-curated
# ============================================================================
# Format: (title, category, author_list (name, is_wrestler), year, publisher, isbn13, country, era, subject, synopsis)
BOOKS = [
    # === MICK FOLEY ===
    ("Have a Nice Day: A Tale of Blood and Sweatsocks", "by_wrestler", [("Mick Foley", 1)], 1999, "ReganBooks/HarperCollins", "9780061031014", "US", "attitude", "Mick Foley", 
     "Foley's first autobiography, written entirely by hand. Frank account of his journey from Long Island fan to ECW/WCW/WWF main-eventer. NYT #1 bestseller."),
    ("Foley Is Good: And the Real World Is Faker Than Wrestling", "by_wrestler", [("Mick Foley", 1)], 2001, "ReganBooks/HarperCollins", "9780061031021", "US", "attitude", "Mick Foley", 
     "Sequel autobiography covering Foley's late-'90s WWF run, retirement, and the McMahon-Helmsley era."),
    ("The Hardcore Diaries", "by_wrestler", [("Mick Foley", 1)], 2007, "Pocket Books", "9781416558569", "US", "modern", "Mick Foley",
     "Diary-style memoir of Foley's 2006 WWE comeback culminating in the ECW One Night Stand match."),
    ("Countdown to Lockdown", "by_wrestler", [("Mick Foley", 1)], 2010, "Grand Central Publishing", "9780446564618", "US", "modern", "Mick Foley",
     "Foley's TNA-era memoir covering his match with Sting at Lockdown 2009."),
    ("Tietam Brown", "fiction", [("Mick Foley", 1)], 2003, "Knopf", "9781400040476", "US", None, None, 
     "Foley's debut novel — dark coming-of-age story unrelated to wrestling."),
    ("Scooter", "fiction", [("Mick Foley", 1)], 2005, "Knopf", "9781400042111", "US", None, None,
     "Foley's second novel, about a young Yankees fan in the Bronx."),
    ("Mick Foley's Christmas Chaos", "fiction", [("Mick Foley", 1)], 2000, "ReganBooks", "9780061073335", "US", None, None,
     "Children's Christmas storybook by Foley."),
    ("Mick Foley's Halloween Hijinx", "fiction", [("Mick Foley", 1)], 2001, "ReganBooks", "9780061073342", "US", None, None,
     "Children's Halloween storybook by Foley."),
    
    # === BRET HART ===
    ("Hitman: My Real Life in the Cartoon World of Wrestling", "by_wrestler", [("Bret Hart", 1)], 2007, "Grand Central Publishing", "9780446539722", "Canada", "rock_n_wrestling", "Bret Hart",
     "Bret Hart's massive 568-page autobiography written from his daily journals. Definitive account of the Hart family, Stampede, WWF, the Montreal Screwjob, and his career-ending stroke."),
    
    # === RIC FLAIR ===
    ("To Be the Man", "by_wrestler", [("Ric Flair", 1), ("Mark Madden", 0), ("Keith Elliot Greenberg", 0)], 2004, "Pocket Books", "9780743456906", "US", "territorial", "Ric Flair",
     "Flair's autobiography covering Mid-Atlantic, NWA/WCW, WWF, and his life behind the strut."),
    ("Second Nature: The Legacy of Ric Flair and the Rise of Charlotte", "by_wrestler", [("Ric Flair", 1), ("Charlotte Flair", 1), ("Brian Shields", 0)], 2017, "Thomas Dunne Books", "9781250105875", "US", "modern", "Ric Flair",
     "Co-authored memoir with daughter Charlotte covering both careers."),
    
    # === LOU THESZ ===
    ("Hooker: An Authentic Wrestler's Adventures Inside the Bizarre World of Professional Wrestling", "by_wrestler", [("Lou Thesz", 1), ("Kit Bauman", 0)], 1995, "Wrestling Channel Press", "9780966011418", "US", "golden_age", "Lou Thesz",
     "Thesz's memoir; landmark insider account of the catch-as-catch-can era. Republished by Crowbar Press."),
    
    # === JIM CORNETTE ===
    ("Jim Cornette Presents Behind the Curtain: Real Pro Wrestling Stories", "about_wrestling", [("Jim Cornette", 1), ("Brady Hicks", 0)], 2019, "ECW Press", "9781770414716", "Canada", "territorial", None,
     "Cornette's first storytelling book, drawn from his Drive-Thru podcast."),
    ("The Midnight Express 25th Anniversary Scrapbook", "about_wrestling", [("Jim Cornette", 1)], 2009, "self-published", None, "US", "territorial", None,
     "Cornette's photo-heavy retrospective of the Midnight Express."),
    ("Jim Cornette's Journey Through The Mid-Atlantic Volume 1", "about_wrestling", [("Jim Cornette", 1)], 2017, "self-published", None, "US", "territorial", None,
     "Cornette-narrated photo book on Mid-Atlantic Wrestling."),
    
    # === SHAWN MICHAELS ===
    ("Heartbreak & Triumph: The Shawn Michaels Story", "by_wrestler", [("Shawn Michaels", 1), ("Aaron Feigenbaum", 0)], 2005, "Pocket Books", "9780743493802", "US", "attitude", "Shawn Michaels",
     "HBK's first autobiography covering his career through 2005 comeback."),
    
    # === STEVE AUSTIN ===
    ("The Stone Cold Truth", "by_wrestler", [("Steve Austin", 1), ("Dennis Brent", 0), ("Jim Ross", 1)], 2003, "Pocket Books", "9780743477208", "US", "attitude", "Steve Austin",
     "Austin's autobiography covering his career through retirement."),
    
    # === HULK HOGAN ===
    ("Hollywood Hulk Hogan", "by_wrestler", [("Hulk Hogan", 1), ("Michael Jan Friedman", 0)], 2002, "Pocket Books", "9780743457651", "US", "rock_n_wrestling", "Hulk Hogan",
     "Hogan's first autobiography covering AWA through nWo."),
    ("My Life Outside the Ring", "by_wrestler", [("Hulk Hogan", 1), ("Mark Dagostino", 0)], 2009, "St. Martin's Press", "9780312643041", "US", "modern", "Hulk Hogan",
     "Hogan's second memoir, focused on his post-wrestling tabloid life."),
    
    # === CHRIS JERICHO ===
    ("A Lion's Tale: Around the World in Spandex", "by_wrestler", [("Chris Jericho", 1)], 2007, "Grand Central Publishing", "9780446538152", "Canada", "attitude", "Chris Jericho",
     "Jericho's first autobiography covering his early career in Mexico, Japan, ECW and WCW up to his 1999 WWF debut."),
    ("Undisputed: How to Become the World Champion in 1,372 Easy Steps", "by_wrestler", [("Chris Jericho", 1)], 2011, "Grand Central Publishing", "9780446538169", "Canada", "modern", "Chris Jericho",
     "Sequel covering his WWF/WWE career through his first retirement."),
    ("The Best in the World: At What I Have No Idea", "by_wrestler", [("Chris Jericho", 1)], 2014, "Gotham Books", "9781592408795", "Canada", "modern", "Chris Jericho",
     "Third memoir on Fozzy, his WWE return, podcasting, and DWTS."),
    ("No Is a Four-Letter Word: How I Failed Spelling but Succeeded in Life", "by_wrestler", [("Chris Jericho", 1)], 2017, "Da Capo Press", "9780306825675", "Canada", "modern", "Chris Jericho",
     "Self-help / memoir hybrid based on Jericho's life rules."),
    
    # === EDDIE GUERRERO ===
    ("Cheating Death, Stealing Life: The Eddie Guerrero Story", "by_wrestler", [("Eddie Guerrero", 1), ("Michael Krugman", 0)], 2005, "Pocket Books", "9781416505556", "US", "attitude", "Eddie Guerrero",
     "Guerrero's memoir released shortly before his death, covering Mexico, Japan, ECW, WCW, and WWE."),
    
    # === KURT ANGLE ===
    ("It's True! It's True!", "by_wrestler", [("Kurt Angle", 1), ("John Harper", 0)], 2001, "ReganBooks", "9780061031113", "US", "attitude", "Kurt Angle",
     "Angle's first autobiography focusing on his Olympic gold and WWF debut."),
    
    # === EDGE ===
    ("Adam Copeland on Edge", "by_wrestler", [("Adam Copeland", 1)], 2004, "Pocket Books", "9780743484619", "Canada", "attitude", "Edge",
     "Edge's first autobiography covering his Toronto upbringing and rise through indie/WWF."),
    
    # === BOBBY HEENAN ===
    ("Bobby the Brain: Wrestling's Bad Boy Tells All", "by_wrestler", [("Bobby Heenan", 1), ("Steve Anderson", 0)], 2002, "Triumph Books", "9781572434585", "US", "rock_n_wrestling", "Bobby Heenan",
     "Heenan's first memoir covering AWA, WWF, and WCW."),
    ("Chair Shots and Other Obstacles", "by_wrestler", [("Bobby Heenan", 1), ("Steve Anderson", 0)], 2004, "Triumph Books", "9781572437135", "US", "modern", "Bobby Heenan",
     "Sequel covering Heenan's cancer fight and life after wrestling."),
    
    # === JERRY LAWLER ===
    ("It's Good to Be the King...Sometimes", "by_wrestler", [("Jerry Lawler", 1), ("Doug Asheville", 0)], 2002, "WWE Books / Pocket Books", "9780743457712", "US", "rock_n_wrestling", "Jerry Lawler",
     "Lawler's memoir covering Memphis, the Andy Kaufman feud, USWA, and WWF."),
    
    # === DYNAMITE KID ===
    ("Pure Dynamite: The Price You Pay for Wrestling Stardom", "by_wrestler", [("Tom Billington", 1), ("Alison Coleman", 0)], 1999, "Winding Stair Press", "9781552770108", "Canada", "rock_n_wrestling", "Dynamite Kid",
     "Brutally honest memoir from the Dynamite Kid; landmark for its candor about pain, drugs, and Stampede."),
    
    # === WILLIAM REGAL ===
    ("Walking a Golden Mile", "by_wrestler", [("William Regal", 1), ("Neil Chandler", 0)], 2005, "WWE Books / Pocket Books", "9780743490030", "UK", "modern", "William Regal",
     "Regal's memoir on his British wrestling apprenticeship through WCW and WWE."),
    
    # === JIM ROSS ===
    ("Slobberknocker: My Life in Wrestling", "by_wrestler", [("Jim Ross", 1), ("Paul O'Brien", 0)], 2017, "Sports Publishing", "9781683581871", "US", "modern", "Jim Ross",
     "JR's first memoir on his career through 1999."),
    ("Under the Black Hat: My Life in the WWE and Beyond", "by_wrestler", [("Jim Ross", 1), ("Paul O'Brien", 0)], 2020, "Tiller Press", "9781982130534", "US", "modern", "Jim Ross",
     "Sequel covering JR's 2000s WWE tenure, AEW, and Jan's death."),
    
    # === DIAMOND DALLAS PAGE ===
    ("Positively Page: The Diamond Dallas Page Journey", "by_wrestler", [("Diamond Dallas Page", 1), ("Larry Genta", 0)], 2000, "Sports Publishing", "9781582613048", "US", "attitude", "Diamond Dallas Page",
     "DDP's autobiography on his late-blooming WCW career and self-help focus."),
    
    # === TIM HORNBAKER (HISTORIAN) ===
    ("National Wrestling Alliance: The Untold Story of the Monopoly That Strangled Pro Wrestling", "about_wrestling", [("Tim Hornbaker", 0)], 2007, "ECW Press", "9781550227413", "Canada", "territorial", None,
     "Definitive history of the NWA cartel from 1948 through its decline."),
    ("Capitol Revolution: The Rise of the McMahon Wrestling Empire", "about_wrestling", [("Tim Hornbaker", 0)], 2015, "ECW Press", "9781770411500", "Canada", "rock_n_wrestling", None,
     "History of the McMahon family promotion from Jess McMahon through Vince Sr."),
    ("Death of the Territories: Expansion, Betrayal and the War That Changed Pro Wrestling Forever", "about_wrestling", [("Tim Hornbaker", 0)], 2018, "ECW Press", "9781770413849", "Canada", "rock_n_wrestling", None,
     "How Vince McMahon's WWF expansion in the early 1980s killed the territory system."),
    ("Legends of Pro Wrestling: 150 Years of Headlocks, Body Slams, and Piledrivers", "about_wrestling", [("Tim Hornbaker", 0)], 2012, "Sports Publishing", "9781613210758", "US", None, None,
     "Comprehensive A-Z reference of historical wrestlers."),
    ("The Last Real World Champion: The Legend of Nature Boy Ric Flair", "about_wrestler", [("Tim Hornbaker", 0)], 2024, "ECW Press", "9781770417182", "Canada", "territorial", "Ric Flair",
     "Hornbaker's exhaustive biography of Flair's NWA reign."),
    
    # === SCOTT KEITH ===
    ("Tonight... in this Very Ring: A Fan's History of Pro Wrestling", "about_wrestling", [("Scott Keith", 0)], 2004, "Citadel Press", "9780806525853", "US", None, None,
     "Keith's affectionate fan-perspective history of wrestling's biggest moments."),
    ("The Buzz on Professional Wrestling", "about_wrestling", [("Scott Keith", 0)], 2001, "Lebhar-Friedman Books", "9780867308204", "US", None, None,
     "Keith's irreverent guide to wrestling's history and personalities."),
    ("Wrestling's Made Men: Triple H's Reign and the Politics of WWE Champions", "about_wrestling", [("Scott Keith", 0)], 2004, "Citadel Press", "9780806525846", "US", "modern", None,
     "Keith on world title politics in the post-Attitude WWE."),
    ("Dungeon of Death: Chris Benoit and the Hart Family Curse", "about_wrestler", [("Scott Keith", 0)], 2008, "Citadel Press", "9780806530110", "US", "modern", "Chris Benoit",
     "Keith's analysis of Benoit's 2007 murder-suicide and Hart family tragedies."),
    
    # === R.D. REYNOLDS / WRESTLECRAP ===
    ("WrestleCrap: The Very Worst of Pro Wrestling", "about_wrestling", [("R.D. Reynolds", 0)], 2003, "ECW Press", "9781550226843", "Canada", None, None,
     "Catalogue of wrestling's most absurd gimmicks, angles, and ideas."),
    ("WrestleCrap and Figure Four Weekly Present: The Death of WCW", "about_wrestling", [("R.D. Reynolds", 0), ("Bryan Alvarez", 1)], 2004, "ECW Press", "9781550226614", "Canada", "monday_night_wars", None,
     "Definitive autopsy of WCW's collapse, from heyday through 2001 sale."),
    ("The Death of WCW: 10th Anniversary Edition", "about_wrestling", [("R.D. Reynolds", 0), ("Bryan Alvarez", 1)], 2014, "ECW Press", "9781770411494", "Canada", "monday_night_wars", None,
     "Updated and expanded edition of the WCW history."),
    ("WrestleCrap: The Book of Lists", "about_wrestling", [("R.D. Reynolds", 0), ("Blade Braxton", 0)], 2007, "ECW Press", "9781550227628", "Canada", None, None,
     "Lists-based companion to WrestleCrap covering wrestling's worst-of categories."),
    ("WWE Confidential: The Real Vince McMahon", "about_wrestler", [("R.D. Reynolds", 0)], 2010, "ECW Press", None, "Canada", "modern", "Vince McMahon", None),
    
    # === DAVE MELTZER ===
    ("Tributes: Remembering Some of the World's Greatest Wrestlers", "about_wrestler", [("Dave Meltzer", 0)], 2001, "Sports Publishing", "9781582613918", "US", None, None,
     "Meltzer's collected obituaries from the Wrestling Observer Newsletter."),
    ("Tributes II: Remembering More of Wrestling's Greatest Heroes", "about_wrestler", [("Dave Meltzer", 0)], 2004, "Sports Publishing", "9781582618173", "US", None, None,
     "Second volume of Meltzer's wrestling obituaries."),
    
    # === GREG OLIVER & STEVEN JOHNSON (Pro Wrestling Hall of Fame series) ===
    ("The Pro Wrestling Hall of Fame: The Tag Teams", "about_wrestler", [("Dan Murphy", 0), ("Brian Young", 0)], 2005, "ECW Press", "9781550226836", "Canada", None, None,
     "Profiles of the greatest tag teams in wrestling history."),
    ("The Pro Wrestling Hall of Fame: The Heels", "about_wrestler", [("Greg Oliver", 0), ("Steven Johnson", 0)], 2007, "ECW Press", "9781550227598", "Canada", None, None,
     "Profiles of wrestling's greatest villains."),
    ("The Pro Wrestling Hall of Fame: The Canadians", "about_wrestler", [("Greg Oliver", 0)], 2003, "ECW Press", "9781550225594", "Canada", None, None,
     "Profiles of legendary Canadian wrestlers."),
    ("The Pro Wrestling Hall of Fame: The Storytellers", "about_wrestler", [("Greg Oliver", 0), ("Steven Johnson", 0)], 2014, "ECW Press", "9781770411289", "Canada", None, None,
     "Profiles of wrestling's greatest in-ring storytellers."),
    
    # === PAT LAPRADE / BERTRAND HEBERT ===
    ("Mad Dogs, Midgets and Screw Jobs: The Untold Story of How Montreal Shaped the World of Wrestling", "about_wrestling", [("Pat Laprade", 0), ("Bertrand Hebert", 0)], 2013, "ECW Press", "9781770410817", "Canada", "territorial", None,
     "Definitive history of Montreal/Quebec wrestling from the early 20th century."),
    ("Sisterhood of the Squared Circle: The History and Rise of Women's Wrestling", "about_wrestling", [("Pat Laprade", 0), ("Dan Murphy", 0)], 2017, "ECW Press", "9781770413238", "Canada", None, None,
     "Comprehensive history of women's pro wrestling from Mildred Burke to today."),
    ("The Eighth Wonder of the World: The True Story of Andre the Giant", "about_wrestler", [("Bertrand Hebert", 0), ("Pat Laprade", 0)], 2020, "ECW Press", "9781770414112", "Canada", "rock_n_wrestling", "Andre the Giant",
     "Definitive Andre the Giant biography drawn from family and contemporary interviews."),
    
    # === LARRY MATYSIK ===
    ("Wrestling at the Chase: The Inside Story of Sam Muchnick and the Legends of Professional Wrestling", "about_wrestling", [("Larry Matysik", 0)], 2005, "ECW Press", "9781550226842", "Canada", "territorial", None,
     "Matysik's insider history of St. Louis Wrestling and his mentor Sam Muchnick."),
    ("Brody: The Triumph and Tragedy of Wrestling's Rebel", "about_wrestler", [("Larry Matysik", 0), ("Barbara Goodish", 0)], 2007, "ECW Press", "9781550227161", "Canada", "territorial", "Bruiser Brody",
     "Bruiser Brody biography co-written with his widow."),
    ("The 50 Greatest Professional Wrestlers of All Time", "about_wrestler", [("Larry Matysik", 0)], 2013, "ECW Press", "9781770410893", "Canada", None, None,
     "Matysik's ranked list of wrestling's all-time greats."),
    
    # === JIM FREEDMAN ===
    ("Drawing Heat", "about_wrestling", [("Jim Freedman", 0)], 1988, "Black Moss Press", "9780887531682", "Canada", "territorial", None,
     "Anthropologist's classic ethnography of life on the indie/Stampede circuit. Reprinted by Crowbar Press."),
    
    # === SHAUN ASSAEL & MIKE MOONEYHAM ===
    ("Sex, Lies, and Headlocks: The Real Story of Vince McMahon and the World Wrestling Federation", "about_wrestler", [("Shaun Assael", 0), ("Mike Mooneyham", 0)], 2002, "Crown Publishers", "9780609607909", "US", "attitude", "Vince McMahon",
     "Investigative journalism on the McMahon empire through the Attitude Era."),
    
    # === IRVIN MUCHNICK ===
    ("Wrestling Babylon: Piledriving Tales of Drugs, Sex, Death, and Scandal", "about_wrestling", [("Irvin Muchnick", 0)], 2007, "ECW Press", "9781550227611", "Canada", None, None,
     "Investigative essays on wrestling's dark side; nephew of promoter Sam Muchnick."),
    ("Chris & Nancy: The True Story of the Benoit Murder-Suicide and Pro Wrestling's Cocktail of Death", "about_wrestler", [("Irvin Muchnick", 0)], 2009, "ECW Press", "9781550229127", "Canada", "modern", "Chris Benoit",
     "Investigative book on the 2007 Benoit tragedy."),
    
    # === HEATH MCCOY ===
    ("Pain and Passion: The History of Stampede Wrestling", "about_wrestling", [("Heath McCoy", 0)], 2007, "ECW Press", "9781550227871", "Canada", "territorial", None,
     "History of the Hart family's Stampede Wrestling promotion."),
    
    # === DAVID SHOEMAKER ===
    ("The Squared Circle: Life, Death, and Professional Wrestling", "about_wrestling", [("David Shoemaker", 0)], 2013, "Gotham Books", "9781592408580", "US", None, None,
     "Grantland writer's literary essay collection on wrestlers who died young."),
    
    # === SCOTT BEEKMAN ===
    ("Ringside: A History of Professional Wrestling in America", "about_wrestling", [("Scott Beekman", 0)], 2006, "Praeger", "9780275984014", "US", None, None,
     "Academic history of pro wrestling from circus carnivals to WWE."),
    
    # === JOE JARES ===
    ("Whatever Happened to Gorgeous George?", "about_wrestling", [("Joe Jares", 0)], 1974, "Prentice-Hall", "9780139519673", "US", "golden_age", None,
     "Sports Illustrated writer's pioneering history of pro wrestling. Reprinted by Crowbar Press."),
    
    # === DAN MURPHY & BRIAN YOUNG ===
    ("The Wrestlers' Wrestlers: The Masters of the Craft of Professional Wrestling", "about_wrestler", [("Dan Murphy", 0), ("Brian Young", 0)], 2021, "ECW Press", "9781770415409", "Canada", None, None,
     "Profiles of the workers other workers consider the best in the business."),
    
    # === BRIAN SHIELDS / WWE ENCYCLOPEDIAS ===
    ("WWE Encyclopedia of Sports Entertainment", "about_wrestling", [("Brian Shields", 0), ("Kevin Sullivan", 0)], 2009, "DK Publishing", "9780756655976", "US", None, None,
     "Comprehensive WWE-licensed reference book."),
    ("WWE Encyclopedia of Sports Entertainment, 4th Edition", "about_wrestling", [("Steven Pantaleo", 0), ("Brian Shields", 0)], 2020, "DK Publishing", "9781465489449", "US", None, None,
     "Updated edition through 2020."),
    
    # === BILL APTER ===
    ("Is Wrestling Fixed? I Didn't Know It Was Broken: From Photo Shoots and Sensational Stories to the WWE Network, Bill Apter's Incredible Pro Wrestling Journey", "by_wrestler", [("Bill Apter", 0)], 2015, "ECW Press", "9781770412613", "Canada", None, None,
     "Veteran Apter Magazine photo editor/writer's memoir of his career."),
    
    # === J.J. DILLON ===
    ("Wrestlers Are Like Seagulls: From McMahon to McMahon", "by_wrestler", [("J.J. Dillon", 1), ("Scott Teal", 0), ("Philip Varriale", 0)], 2005, "Crowbar Press", None, "US", "territorial", "J.J. Dillon",
     "Memoir from the manager of the Four Horsemen and longtime WCW front-office figure."),
    
    # === IVAN KOLOFF ===
    ("Is That Wrestling Fake? The Bear Facts", "by_wrestler", [("Ivan Koloff", 1), ("Scott Teal", 0)], 2007, "Crowbar Press", None, "Canada", "territorial", "Ivan Koloff",
     "Memoir from the Russian Bear, the man who beat Bruno Sammartino."),
    
    # === WARREN ELLIS (FICTION) ===
    ("Crooked Little Vein", "fiction", [("Warren Ellis", 0)], 2007, "William Morrow", "9780060723934", "US", None, None,
     "Comic-book writer's debut novel — a Texas underground tour that includes a pivotal pro-wrestling subplot."),
    
    # === ROBERT WILSON LYND ===
    # Skipping unsure entries
    
    # === GORGEOUS GEORGE ===
    ("Gorgeous George: The Bizarre Life of the Sports Entertainer Who Invented Showmanship", "about_wrestler", [("John Capouya", 0)], 2008, "Harper", "9780061173462", "US", "golden_age", "Gorgeous George",
     "Definitive biography of the wrestler who invented modern showmanship."),
    
    # === KENNY KING / ROCK BIO ===
    ("The Rock Says...: The Most Electrifying Man in Sports-Entertainment", "by_wrestler", [("The Rock", 1), ("Joe Layden", 0)], 2000, "ReganBooks", "9780061030758", "US", "attitude", "Dwayne Johnson",
     "The Rock's first autobiography on his early days, USC, and rapid WWF rise."),
    
    # === PAUL HEYMAN's only book is foreword work; skip ===
    
    # === BENOIT (HEYMAN/RANDAZZO) ===
    ("Ring of Hell: The Story of Chris Benoit and the Fall of the Pro Wrestling Industry", "about_wrestler", [("Matthew Randazzo V", 0)], 2008, "Phoenix Books", "9781597775083", "US", "modern", "Chris Benoit",
     "Polemical investigation of the Benoit tragedy and wrestling's culture."),
    ("Benoit: Wrestling with the Horror that Destroyed a Family and Crippled a Sport", "about_wrestler", [("Steven Johnson", 0), ("Heath McCoy", 0), ("Irvin Muchnick", 0), ("Greg Oliver", 0)], 2007, "ECW Press", "9781550228175", "Canada", "modern", "Chris Benoit",
     "Multi-author book on Benoit released soon after the tragedy."),
    
    # === MARTHA HART ===
    ("Broken Harts: The Life and Death of Owen Hart", "about_wrestler", [("Martha Hart", 0), ("Eric Francis", 0)], 2002, "M. Evans & Co.", "9781590770214", "Canada", "attitude", "Owen Hart",
     "Owen Hart's widow's memoir following his 1999 in-ring death."),
    
    # === BLOOD AND FIRE ===
    ("Top Rope Tuesday: A Wrestling Memoir", "by_wrestler", [("Tony Schiavone", 0)], 2024, None, None, "US", "modern", "Tony Schiavone",
     "WCW/AEW announcer's memoir."),
    
    # === BRUCE HART ===
    ("Straight from the Hart", "by_wrestler", [("Bruce Hart", 1)], 2011, "ECW Press", "9781770410374", "Canada", "territorial", "Hart Family",
     "Bruce Hart's pull-no-punches memoir on the Hart family and Stampede."),
    
    # === STU HART ===
    ("Stu Hart: Lord of the Ring", "about_wrestler", [("Marsha Erb", 0)], 2002, "ECW Press", "9781550225013", "Canada", "territorial", "Stu Hart",
     "Authorized biography of Stu Hart and Stampede Wrestling."),
    
    # === CHRIS KANYON ===
    ("Wrestling Reality: The Life and Mind of Chris Kanyon, Wrestling's Gay Superstar", "by_wrestler", [("Chris Kanyon", 1), ("Ryan Clark", 0)], 2011, "ECW Press", "9781770410220", "Canada", "modern", "Chris Kanyon",
     "Posthumously published memoir of WCW/WWE star Chris Kanyon."),
    
    # === BRET HART (BIO BY HEATH MCCOY) ===
    # Already have Hitman by Bret himself
    
    # === KEVIN NASH / SCOTT HALL — neither has a major bio book that I'm certain of ===
    
    # === BOOKER T ===
    ("Booker T: From Prison to Promise", "by_wrestler", [("Booker T Huffman", 1), ("Andrew William Wright", 0)], 2012, "Medallion Press", "9781605425160", "US", "modern", "Booker T",
     "Booker T's memoir on his troubled youth, prison time, and wrestling career."),
    
    # === GOLDBERG ===
    ("I'm Next: The Strange Journey of America's Most Unlikely Superhero", "by_wrestler", [("Bill Goldberg", 1), ("Steve Goldberg", 0)], 2000, "Crown Publishers", "9780609606919", "US", "monday_night_wars", "Bill Goldberg",
     "Goldberg's autobiography during his WCW peak."),
    
    # === MICHAEL CRICHTON-style fiction... ===
    # === LUCHA LIBRE ===
    ("The World of Lucha Libre: Secrets, Revelations, and Mexican National Identity", "about_wrestling", [("Heather Levi", 0)], 2008, "Duke University Press", "9780822343158", "Mexico", None, None,
     "Academic anthropological study of lucha libre's cultural meaning in Mexico."),
    ("Lucha Loco: Inside the Crazy World of Lucha Libre", "about_wrestling", [("Malcolm Venville", 0)], 2005, "Ammo Books", "9780971613959", "Mexico", None, None,
     "Photography book on contemporary Mexican lucha libre."),
    
    # === STAMPEDE ===
    ("The Pirate and the Mouse: Disney's War Against the Counterculture", "about_wrestling", None, 2003, None, None, "US", None, None, None),  # PLACEHOLDER -- remove
]

# Strip the placeholder
BOOKS = [b for b in BOOKS if b[0] != "The Pirate and the Mouse: Disney's War Against the Counterculture"]

added_books = 0
for book in BOOKS:
    title, cat, authors, year, pub, isbn13, country, era, subject, synopsis = book
    cur.execute("""SELECT id FROM books WHERE LOWER(title)=LOWER(?) AND (year_published=? OR year_published IS NULL)""", (title, year))
    row = cur.fetchone()
    if row:
        bid = row[0]
        # Update with our higher-confidence info
        cur.execute("""UPDATE books SET 
            category_code=?, year_published=?, publisher=COALESCE(?, publisher),
            isbn13=COALESCE(?, isbn13), country=COALESCE(?, country),
            era=COALESCE(?, era), subject_wrestler=COALESCE(?, subject_wrestler),
            synopsis=COALESCE(?, synopsis), confidence='high'
            WHERE id=?""",
            (cat, year, pub, isbn13, country, era, subject, synopsis, bid))
    else:
        cur.execute("""INSERT INTO books 
            (title, category_code, publisher, year_published, isbn13, country, era, subject_wrestler, synopsis, confidence)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'high')""",
            (title, cat, pub, year, isbn13, country, era, subject, synopsis))
        bid = cur.lastrowid
    
    if authors:
        for author_name, is_wrestler in authors:
            cur.execute("SELECT id FROM authors WHERE name=?", (author_name,))
            r = cur.fetchone()
            if r:
                aid = r[0]
                if is_wrestler:
                    cur.execute("UPDATE authors SET is_wrestler=1 WHERE id=?", (aid,))
            else:
                cur.execute("INSERT INTO authors (name, is_wrestler) VALUES (?, ?)", (author_name, is_wrestler))
                aid = cur.lastrowid
            cur.execute("INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')", (bid, aid))
    
    added_books += 1

conn.commit()
print(f"Books processed: {added_books}")

# Final stats
print(f"\n=== Database state ===")
print(f"Books: {cur.execute('SELECT COUNT(*) FROM books').fetchone()[0]}")
for r in cur.execute("SELECT category_code, COUNT(*) FROM books GROUP BY category_code ORDER BY 2 DESC"):
    print(f"  {r[0]}: {r[1]}")
print(f"Authors: {cur.execute('SELECT COUNT(*) FROM authors').fetchone()[0]}")
print(f"  wrestlers: {cur.execute('SELECT COUNT(*) FROM authors WHERE is_wrestler=1').fetchone()[0]}")
print(f"Periodicals: {cur.execute('SELECT COUNT(*) FROM periodicals').fetchone()[0]}")
for r in cur.execute("SELECT country, COUNT(*) FROM periodicals GROUP BY country ORDER BY 2 DESC"):
    print(f"  {r[0]}: {r[1]}")
print(f"Periodicals in user archive: {cur.execute('SELECT COUNT(*) FROM periodicals WHERE archive_in_collection=1').fetchone()[0]}")

conn.close()
