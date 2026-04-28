#!/usr/bin/env python3
"""
Describe magazine covers using the Anthropic API (vision).

Walks the Magazines library, renders the first page of each PDF as a
small JPEG, and asks Claude Haiku to describe what's on the cover —
focusing on the cover wrestlers/photo subjects (not article text).

Output: cover_descriptions.csv next to this script, with columns
    Filename, What's on the Cover

Resumable: rows already in the CSV are skipped on re-run.

Setup:
    export ANTHROPIC_API_KEY="sk-ant-..."
    pip3 install --user anthropic pdf2image
    brew install poppler          # for pdf2image's pdftoppm

Usage:
    python3 describe_covers.py [--limit N] [--year YYYY] [--mag NAME] [--dry-run]
"""
import os, re, csv, sys, time, base64, argparse
from io import BytesIO
from pathlib import Path

try:
    import anthropic
except ImportError:
    sys.exit("Install dependencies first:  pip3 install --user anthropic pdf2image")
try:
    from pdf2image import convert_from_path
except ImportError:
    sys.exit("Install dependencies first:  pip3 install --user pdf2image  (and brew install poppler)")

MAGAZINES_ROOT = Path(
    "/Users/jschairb-gwp/Library/CloudStorage/"
    "GoogleDrive-josh@greatwesternproductions.com/My Drive/"
    "BACKGROUND_RESEARCH/Magazines"
)
CSV_PATH = Path(__file__).parent / "cover_descriptions.csv"

MODEL = "claude-haiku-4-5"  # cheap and fast
MAX_TOKENS = 200
THUMB_WIDTH = 800            # rendered cover width in px
JPEG_QUALITY = 75

PROMPT = (
    "This is the cover of a vintage professional-wrestling magazine. "
    "In one short line (max 25 words), name the main wrestler(s) shown in the cover photograph "
    "and any clear inset subjects. Mention notable text/cover-story labels only if they identify a wrestler "
    "(e.g. 'Hulk Hogan', 'BEARCAT WRIGHT'). Do not list every article teaser. "
    "If a wrestler isn't named on the cover but you can identify them confidently, name them. "
    "If unsure, describe the wrestler succinctly (e.g. 'masked wrestler in black trunks'). "
    "Return only the description text — no preamble, no quotes."
)

def render_first_page_jpeg(pdf_path: Path) -> bytes:
    """Render page 1 to a small in-memory JPEG."""
    images = convert_from_path(
        str(pdf_path), first_page=1, last_page=1,
        dpi=72, fmt="jpeg", size=(THUMB_WIDTH, None),
    )
    if not images:
        raise RuntimeError("no page rendered")
    buf = BytesIO()
    images[0].save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return buf.getvalue()

def already_done(csv_path: Path) -> set:
    if not csv_path.exists():
        return set()
    seen = set()
    with csv_path.open(newline="") as f:
        r = csv.reader(f)
        next(r, None)  # header
        for row in r:
            if row:
                seen.add(row[0])
    return seen

def append_row(csv_path: Path, filename: str, description: str):
    new = not csv_path.exists()
    with csv_path.open("a", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["Filename", "What's on the Cover"])
        w.writerow([filename, description])

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--year", type=int, default=0)
    p.add_argument("--mag", default="")
    p.add_argument("--dry-run", action="store_true", help="render thumbs and list, but don't call API")
    args = p.parse_args()

    if not os.getenv("ANTHROPIC_API_KEY"):
        sys.exit("Set ANTHROPIC_API_KEY first:  export ANTHROPIC_API_KEY=sk-ant-...")

    client = anthropic.Anthropic()

    seen = already_done(CSV_PATH)
    pdfs = []
    name_re = re.compile(r"(.+?) - (\d{4}) - .+\.pdf$")
    for decade in ("1960s", "1970s", "1980s"):
        d = MAGAZINES_ROOT / decade
        if not d.exists(): continue
        for path in sorted(d.rglob("*.pdf")):
            if path.name in seen:
                continue
            if " (1).pdf" in path.name or " (2).pdf" in path.name or " (3).pdf" in path.name:
                continue
            m = name_re.match(path.name)
            year = int(m.group(2)) if m else None
            mag  = m.group(1) if m else ""
            if args.year and year != args.year:
                continue
            if args.mag and args.mag.lower() not in mag.lower():
                continue
            pdfs.append(path)

    print(f"[plan] {len(pdfs)} PDFs queued (already described: {len(seen)})")
    if args.limit:
        pdfs = pdfs[: args.limit]
        print(f"[plan] limited to {len(pdfs)}")

    for i, pdf in enumerate(pdfs, 1):
        rel = pdf.relative_to(MAGAZINES_ROOT)
        print(f"[{i}/{len(pdfs)}] {rel}", flush=True)
        try:
            jpg = render_first_page_jpeg(pdf)
        except Exception as e:
            print(f"   render failed: {e}")
            append_row(CSV_PATH, pdf.name, f"(render failed: {e})")
            continue

        if args.dry_run:
            print(f"   rendered {len(jpg)} bytes")
            continue

        try:
            b64 = base64.standard_b64encode(jpg).decode()
            resp = client.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {
                            "type": "base64", "media_type": "image/jpeg", "data": b64,
                        }},
                        {"type": "text", "text": PROMPT},
                    ],
                }],
            )
            description = resp.content[0].text.strip().replace("\n", " ")
            print(f"   -> {description}")
            append_row(CSV_PATH, pdf.name, description)
        except Exception as e:
            print(f"   API error: {e}")
            append_row(CSV_PATH, pdf.name, f"(API error: {e})")
            time.sleep(2)

    print(f"[done] {CSV_PATH}")

if __name__ == "__main__":
    main()
