/**
 * Cover management — renders the user-selected thumb_page as JPG on
 * demand. Called before the M4B build so the cover art of the MP4
 * file matches the thumbnail currently set in Settings.
 *
 *   covers/<docId>-p<page>.jpg
 *
 * The page suffix makes the file self-documenting (no stamp file
 * needed to know which page was rendered) and prevents stale-cache
 * issues when the user changes thumb_page — the new file is stored
 * under a different name, the old one stays around harmlessly
 * (cleaned up via rm -rf on doc delete).
 */

import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { db } from "../db";
import { run } from "../tts/ffmpeg";
import { which } from "./ocr";
import { DATA_DIR } from "../paths";


function coverTargetPath(docId: string, page: number): string {
  return join(DATA_DIR, "covers", `${docId}-p${page}.jpg`);
}

function findRenderedJpg(base: string, page: number): string | undefined {
  for (const width of [1, 2, 3, 4, 5]) {
    const candidate = `${base}-${String(page).padStart(width, "0")}.jpg`;
    if (existsSync(candidate)) return candidate;
  }
  // Single-digit-pages at page 1 can also produce just "<base>-1.jpg"
  // which the loop covers (width=1). Defensive noop here.
  return undefined;
}

/** Ensures a doc has a JPG cover on disk that matches the current
 *  `thumb_page` selection. On error/missing tooling, returns
 *  undefined (M4B build without cover). */
export async function ensureCover(
  docId: string
): Promise<string | undefined> {
  const doc = db()
    .prepare("SELECT stored_path, thumb_page FROM documents WHERE id = ?")
    .get(docId) as
    | { stored_path: string; thumb_page: number }
    | undefined;
  if (!doc) return undefined;
  const page = doc.thumb_page && doc.thumb_page > 0 ? doc.thumb_page : 1;
  const target = coverTargetPath(docId, page);
  if (existsSync(target)) return target;

  if (!(await which("pdftoppm"))) {
    console.warn(
      `[cover] pdftoppm not on PATH — cover for ${docId} (p${page}) cannot be rendered`
    );
    return undefined;
  }

  mkdirSync(dirname(target), { recursive: true });
  // stored_path is relative to DATA_DIR (see upload pipeline).
  const pdfFullPath = doc.stored_path.startsWith("/")
    ? doc.stored_path
    : join(DATA_DIR, doc.stored_path);
  const tmpBase = join(DATA_DIR, "covers", `${docId}-tmp-${Date.now()}`);
  try {
    await run("pdftoppm", [
      "-f",
      String(page),
      "-l",
      String(page),
      "-r",
      "150",
      "-jpeg",
      pdfFullPath,
      tmpBase,
    ]);
    const rendered = findRenderedJpg(tmpBase, page);
    if (!rendered) {
      console.warn(
        `[cover] pdftoppm output not found for ${docId} p${page} (base=${tmpBase})`
      );
      return undefined;
    }
    renameSync(rendered, target);
    console.log(`[cover] rendered ${docId} p${page} → ${target}`);
    return target;
  } catch (err) {
    console.warn(
      `[cover] render failed for ${docId} p${page}:`,
      err instanceof Error ? err.message : err
    );
    return undefined;
  }
}
