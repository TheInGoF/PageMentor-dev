// Cover je Heft und Hörbuch-Art: die Originalseite (pdftoppm) oder eine der eigenen Vorlagen (resvg).
// Dateien unter covers/: <heft>-p<seite>.jpg fürs Original, <heft>-<vorlage>-<hash>.png für die Vorlagen.
// Der Hash deckt Titel, Modulfarbe, Art und Format ab; alte Dateien bleiben bis zum Löschen des Hefts
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { db } from "../db";
import { run } from "../tts/ffmpeg";
import { which } from "./ocr";
import { DATA_DIR, fromDataPath } from "../paths";
import { libraryCoverAspect } from "./cover/aspect";
import { coverSvg, pixelSize, type CoverKind, type CoverSpec, type CoverStyle } from "./cover/templates";
import { ready, renderPng } from "./cover/text";

export type { CoverKind } from "./cover/templates";
export type CoverChoice = CoverStyle | "original";
export const COVER_CHOICES: readonly CoverChoice[] = ["original", "a", "c", "d"];
export const DEFAULT_COVER: CoverChoice = "c";
// Bei Änderungen an den Vorlagen hochzählen, damit fertige Dateien neu gezeichnet werden
const TEMPLATE_VERSION = 2;

export function isCoverChoice(v: unknown): v is CoverChoice {
  return typeof v === "string" && (COVER_CHOICES as readonly string[]).includes(v);
}

export function isCoverKind(v: unknown): v is CoverKind {
  return v === "original" || v === "subject" || v === "language";
}

type DocRow = {
  stored_path: string;
  thumb_page: number;
  title: string;
  doc_title: string | null;
  filename: string;
  cover_style: string | null;
  module_color: string | null;
};

function docRow(docId: string): DocRow | undefined {
  return db()
    .prepare(
      `SELECT d.stored_path, d.thumb_page, d.title, d.doc_title, d.filename, d.cover_style, m.color AS module_color
       FROM documents d LEFT JOIN modules m ON m.id = d.module_id WHERE d.id = ?`
    )
    .get(docId) as DocRow | undefined;
}

// Gewählte Vorlage des Hefts, sonst der Standard der App
export function coverChoice(doc: { cover_style: string | null }): CoverChoice {
  return isCoverChoice(doc.cover_style) ? doc.cover_style : DEFAULT_COVER;
}

/** Sorgt für eine Cover-Datei zum Heft (Original oder Vorlage) und gibt den Pfad zurück; ohne Heft oder
 *  Werkzeug undefined (M4B ohne Cover). kind bestimmt die Pille (Hörbuch, Lernhörbuch, Sprachlern-Hörbuch),
 *  style überstimmt die Wahl des Hefts (Vorschau). */
export async function ensureCover(docId: string, kind: CoverKind = "original", style?: CoverChoice): Promise<string | undefined> {
  const doc = docRow(docId);
  if (!doc) return undefined;
  const choice = style ?? coverChoice(doc);
  if (choice === "original") return renderOriginal(docId, doc);
  const aspect = await libraryCoverAspect();
  const page = doc.thumb_page > 0 ? doc.thumb_page : 1;
  const spec: CoverSpec = {
    style: choice,
    aspect,
    kind,
    title: doc.title?.trim() || doc.doc_title?.trim() || doc.filename,
    color: doc.module_color,
    image: null,
  };
  const stamp = createHash("sha1")
    .update(JSON.stringify([TEMPLATE_VERSION, spec.style, spec.aspect, spec.kind, spec.title, spec.color, choice === "d" ? page : 0]))
    .digest("hex")
    .slice(0, 10);
  const target = join(DATA_DIR, "covers", `${docId}-${choice}-${stamp}.png`);
  if (existsSync(target)) return target;
  if (choice === "d") {
    const original = await renderOriginal(docId, doc);
    if (original) spec.image = { mime: "image/jpeg", bytes: new Uint8Array(readFileSync(original)) };
  }
  try {
    await ready();
    const png = renderPng(coverSvg(spec), pixelSize(aspect).width);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, png);
    console.log(`[cover] Vorlage ${choice} (${kind}, ${aspect}) für ${docId} → ${target}`);
    return target;
  } catch (err) {
    console.warn(`[cover] Vorlage ${choice} für ${docId} fehlgeschlagen, Originalseite stattdessen:`, err instanceof Error ? err.message : err);
    return renderOriginal(docId, doc);
  }
}

function findRenderedJpg(base: string, page: number): string | undefined {
  for (const width of [1, 2, 3, 4, 5]) {
    const candidate = `${base}-${String(page).padStart(width, "0")}.jpg`;
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

// Gewählte Seite des Hefts (thumb_page) als JPG, einmal je Seite
async function renderOriginal(docId: string, doc: Pick<DocRow, "stored_path" | "thumb_page">): Promise<string | undefined> {
  const page = doc.thumb_page && doc.thumb_page > 0 ? doc.thumb_page : 1;
  const target = join(DATA_DIR, "covers", `${docId}-p${page}.jpg`);
  if (existsSync(target)) return target;

  if (!(await which("pdftoppm"))) {
    console.warn(`[cover] pdftoppm not on PATH — cover for ${docId} (p${page}) cannot be rendered`);
    return undefined;
  }

  mkdirSync(dirname(target), { recursive: true });
  // stored_path ist relativ zu DATA_DIR (Upload-Pipeline)
  const pdfFullPath = doc.stored_path.startsWith("/") ? doc.stored_path : fromDataPath(doc.stored_path);
  const tmpBase = join(DATA_DIR, "covers", `${docId}-tmp-${Date.now()}`);
  try {
    await run("pdftoppm", ["-f", String(page), "-l", String(page), "-r", "150", "-jpeg", pdfFullPath, tmpBase]);
    const rendered = findRenderedJpg(tmpBase, page);
    if (!rendered) {
      console.warn(`[cover] pdftoppm output not found for ${docId} p${page} (base=${tmpBase})`);
      return undefined;
    }
    renameSync(rendered, target);
    console.log(`[cover] rendered ${docId} p${page} → ${target}`);
    return target;
  } catch (err) {
    console.warn(`[cover] render failed for ${docId} p${page}:`, err instanceof Error ? err.message : err);
    return undefined;
  }
}
