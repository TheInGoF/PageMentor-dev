// Fertiges M4B nach Dokumente\PageMentor\Hörbücher kopieren und anzeigen
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { spawn } from "child_process";
import { join } from "path";
import { db } from "../../db";
import { AUDIOBOOK_EXPORT_DIR, DATA_DIR, IS_WINDOWS } from "../../paths";
import { logger } from "../../log/logger";

const log = logger("audiobook");

// Titel für Dateinamen säubern: Umlaute ausschreiben, Sonderzeichen → _
export function safeFilename(s: string): string {
  return s
    .replace(/ä/g, "ae").replace(/Ä/g, "Ae")
    .replace(/ö/g, "oe").replace(/Ö/g, "Oe")
    .replace(/ü/g, "ue").replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}\- ]/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "audiobook";
}

// Dateiname: Kürzel_Autor_Titel.m4b, leere Teile weglassen
export function bookFileName(docId: string): string {
  const doc = db()
    .prepare("SELECT title, doc_title, author, short_code FROM documents WHERE id = ?")
    .get(docId) as
    | { title: string; doc_title: string | null; author: string | null; short_code: string | null }
    | undefined;
  const baseTitle = doc?.doc_title?.trim() || doc?.title || "audiobook";
  const parts = [doc?.short_code?.trim(), doc?.author?.trim(), baseTitle]
    .map((s) => (s ? safeFilename(s) : ""))
    .filter((s) => s.length > 0);
  return `${parts.join("_")}.m4b`;
}

export function exportedBookPath(docId: string): string {
  return join(AUDIOBOOK_EXPORT_DIR, bookFileName(docId));
}

// Nach dem Bauen kopieren; Fehler nur loggen, das Hörbuch bleibt nutzbar
export function exportBook(docId: string): string | null {
  const src = join(DATA_DIR, "audio", docId, "book.m4b");
  if (!existsSync(src)) return null;
  try {
    mkdirSync(AUDIOBOOK_EXPORT_DIR, { recursive: true });
    const dest = exportedBookPath(docId);
    copyFileSync(src, dest);
    log.info(`Hörbuch abgelegt: ${dest}`, { docId });
    return dest;
  } catch (err) {
    log.warn("Hörbuch konnte nicht in den Hörbücher-Ordner kopiert werden", err, { docId });
    return null;
  }
}

// Im Explorer markieren; außerhalb von Windows nur den Pfad liefern
export function revealInFolder(path: string): boolean {
  if (!IS_WINDOWS) return false;
  try {
    spawn("explorer.exe", [`/select,${path}`], { detached: true, windowsHide: false, stdio: "ignore" }).unref();
    return true;
  } catch (err) {
    log.warn("Explorer konnte nicht geöffnet werden", err);
    return false;
  }
}

// Ordner im Explorer öffnen
export function openFolder(dir: string): boolean {
  if (!IS_WINDOWS) return false;
  try {
    spawn("explorer.exe", [dir], { detached: true, windowsHide: false, stdio: "ignore" }).unref();
    return true;
  } catch (err) {
    log.warn("Explorer konnte nicht geöffnet werden", err);
    return false;
  }
}
