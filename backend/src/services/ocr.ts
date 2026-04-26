/**
 * OCR fallback for image-only PDFs.
 *
 * Strategy: when pdf-parse yields too little text per page, we render
 * the affected pages via `pdftoppm` (poppler-utils) as PNG and send
 * them to `tesseract` (subprocess). Both tools must be installed in
 * the Docker image (`apk add poppler-utils tesseract-ocr
 * tesseract-ocr-data-deu`). If they're missing, the pipeline
 * transparently falls back to the pdf-parse text.
 */

import { spawn } from "child_process";
import { readFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const MIN_CHARS_PER_PAGE = 40;

export function needsOcr(pages: string[]): boolean {
  if (pages.length === 0) return false;
  const thin = pages.filter((p) => p.trim().length < MIN_CHARS_PER_PAGE).length;
  // If more than a third of pages look empty, assume it's a scan.
  return thin / pages.length >= 0.33;
}

export async function isOcrAvailable(): Promise<boolean> {
  const [poppler, tess] = await Promise.all([
    which("pdftoppm"),
    which("tesseract"),
  ]);
  return poppler && tess;
}

export async function which(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("which", [cmd]);
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

async function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${bin} exited ${code}: ${stderr.slice(-500)}`))
    );
  });
}

/**
 * OCR all given pages of a PDF. Returns new text per page.
 * If OCR is unavailable, returns the passed fallback texts unchanged.
 */
export async function ocrPdfPages(params: {
  pdfPath: string;
  language: string;
  pageCount: number;
  fallback: string[];
  onProgress?: (current: number, total: number) => void;
}): Promise<string[]> {
  if (!(await isOcrAvailable())) {
    console.warn("[ocr] tesseract or pdftoppm missing — skipping OCR fallback");
    return params.fallback;
  }

  const tessLang = params.language === "de" ? "deu+eng" : "eng+deu";
  const workDir = join(tmpdir(), `pm-ocr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(workDir, { recursive: true });

  const out: string[] = new Array(params.pageCount).fill("");
  try {
    // Render all pages to PNG at 200 dpi.
    await run("pdftoppm", ["-r", "200", "-png", params.pdfPath, join(workDir, "page")]);

    for (let i = 1; i <= params.pageCount; i++) {
      params.onProgress?.(i, params.pageCount);
      // pdftoppm pads the page number: "page-001.png" for numbers < 1000, try a few widths.
      const png = resolvePage(workDir, i);
      if (!png) {
        out[i - 1] = params.fallback[i - 1] ?? "";
        continue;
      }
      try {
        const { stdout } = await run("tesseract", [png, "-", "-l", tessLang, "--psm", "6"]);
        const text = stdout.trim();
        // Only replace if we actually got more text than the text-layer gave us.
        const fallbackText = params.fallback[i - 1] ?? "";
        out[i - 1] = text.length > fallbackText.length ? text : fallbackText;
      } catch (err) {
        console.warn(`[ocr] page ${i} failed:`, err instanceof Error ? err.message : err);
        out[i - 1] = params.fallback[i - 1] ?? "";
      }
    }
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  return out;
}

function resolvePage(dir: string, n: number): string | null {
  for (const width of [1, 2, 3, 4, 5]) {
    const name = `page-${String(n).padStart(width, "0")}.png`;
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Render the first page of a PDF to a JPG (cover art).
 * Returns the output file path or null if rendering failed.
 */
export async function renderCover(pdfPath: string, outDir: string, docId: string): Promise<string | null> {
  if (!existsSync(pdfPath)) return null;
  if (!(await which("pdftoppm"))) {
    console.warn("[ocr] pdftoppm not found — skipping cover render");
    return null;
  }
  mkdirSync(outDir, { recursive: true });
  const base = join(outDir, docId);
  try {
    await run("pdftoppm", ["-f", "1", "-l", "1", "-r", "150", "-jpeg", pdfPath, base]);
    for (const width of [1, 2, 3, 4, 5]) {
      const name = `${base}-${String(1).padStart(width, "0")}.jpg`;
      if (existsSync(name)) return name;
    }
    const flat = `${base}.jpg`;
    if (existsSync(flat)) return flat;
    return null;
  } catch (err) {
    console.warn("[ocr] cover render failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

void readFileSync;
