import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const execFileAsync = promisify(execFile);

async function ocrSinglePage(opts: {
  pdfPath: string;
  page: number;
  tmpDir: string;
}): Promise<string> {
  const pngBase = path.join(opts.tmpDir, `p${String(opts.page).padStart(3, "0")}`);
  await execFileAsync("pdftoppm", [
    "-png",
    "-r", "300",
    "-gray",
    "-f", String(opts.page),
    "-l", String(opts.page),
    "-singlefile",
    opts.pdfPath,
    pngBase,
  ]);
  const pngPath = `${pngBase}.png`;
  // --psm 1: automatic page segmentation with orientation/script detection.
  // Crucial for the WON two-column layout — psm 4 (single column) interleaves
  // both columns onto the same lines.
  const { stdout } = await execFileAsync(
    "tesseract",
    [pngPath, "stdout", "-l", "eng", "--psm", "1"],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  await fs.unlink(pngPath).catch(() => {});
  return stdout;
}

/**
 * Render each PDF page to a PNG (300dpi greyscale) and OCR with tesseract,
 * concatenating the result with `<<<PAGE N>>>` markers. The final text is
 * cached at `<pdf>.ocr.txt` so subsequent runs are instant.
 *
 * Pages are processed in parallel (default concurrency = 4) since the
 * pdftoppm + tesseract pipeline is mostly CPU-bound and embarrassingly
 * parallel page-by-page.
 */
export async function ocrPdf(opts: {
  pdfPath: string;
  firstPage: number;
  lastPage: number;
  cachePath?: string;
  onProgress?: (p: { page: number; total: number; elapsedMs: number }) => void;
  /** When true, force re-OCR even if cache exists. */
  refresh?: boolean;
  concurrency?: number;
}): Promise<string> {
  const { pdfPath, firstPage, lastPage } = opts;
  const cachePath = opts.cachePath ?? `${pdfPath}.ocr.txt`;

  if (!opts.refresh && existsSync(cachePath)) {
    return fs.readFile(cachePath, "utf8");
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "won1986-ocr-"));
  const startTs = Date.now();
  const total = lastPage - firstPage + 1;
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const results = new Array<string | null>(total).fill(null);

  try {
    let cursor = 0;
    let done = 0;
    const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= total) return;
        const page = firstPage + idx;
        const text = await ocrSinglePage({ pdfPath, page, tmpDir: tmp });
        results[idx] = `<<<PAGE ${page}>>>\n${text}`;
        done++;
        opts.onProgress?.({ page, total, elapsedMs: Date.now() - startTs });
      }
    });
    await Promise.all(workers);
    const corpus = results.join("\n\f");
    await fs.writeFile(cachePath, corpus, "utf8");
    return corpus;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
