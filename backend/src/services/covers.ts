/**
 * Cover-Management — bei Bedarf das User-gewählte thumb_page als JPG
 * rendern. Wird vor dem M4B-Build aufgerufen, damit das Titelbild der
 * MP4-Datei zum aktuell in Settings eingestellten Thumbnail passt.
 *
 *   covers/<docId>-p<page>.jpg
 *
 * Page-Suffix macht die Datei selbst-dokumentierend (kein Stamp-File
 * nötig um zu wissen welches Page gerendert wurde) und verhindert
 * Stale-Cache-Probleme wenn der User thumb_page ändert — die neue
 * Datei wird unter anderem Namen gespeichert, alte bleibt harmlos
 * liegen (lässt sich bei Doc-Delete mit rm -rf aufräumen).
 */

import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { db } from "../db";
import { run } from "../tts/ffmpeg";
import { which } from "./ocr";

const DATA_DIR = process.env.PM_DATA_DIR || "./data";

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

/** Stellt sicher dass für ein Doc ein JPG-Cover auf Disk liegt, das
 *  der aktuellen `thumb_page`-Auswahl entspricht. Bei Fehler/Missing-
 *  Tooling wird undefined zurückgegeben (M4B-Build ohne Cover). */
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
      `[cover] pdftoppm nicht im PATH — cover für ${docId} (p${page}) kann nicht gerendert werden`
    );
    return undefined;
  }

  mkdirSync(dirname(target), { recursive: true });
  // stored_path ist relativ zu DATA_DIR (siehe Upload-Pipeline).
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
        `[cover] pdftoppm output nicht gefunden für ${docId} p${page} (base=${tmpBase})`
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
