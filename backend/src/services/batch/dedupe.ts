// Dubletten erkennen, bevor Docling und KI rechnen
// Stufe 1: gleiche Datei (SHA-1). Stufe 2: gleicher Inhalt in anderer Datei (MinHash über den Text,
// vor Docling aus der Textebene, bei Scans nach Docling aus dem erkannten Text)
import { createHash } from "crypto";
import { createReadStream, existsSync } from "fs";
import { db } from "../../db";
import { fromDataPath } from "../../paths";

export function fileSha1(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha1");
    createReadStream(path)
      .on("data", (b) => h.update(b))
      .on("error", reject)
      .on("end", () => resolve(h.digest("hex")));
  });
}

// Ältere Dokumente haben noch keinen Fingerabdruck: einmalig nachtragen
export async function backfillSha1(): Promise<number> {
  const rows = db().prepare("SELECT id, stored_path FROM documents WHERE file_sha1 IS NULL").all() as Array<{ id: string; stored_path: string }>;
  let n = 0;
  for (const r of rows) {
    const p = fromDataPath(r.stored_path);
    if (!existsSync(p)) continue;
    db().prepare("UPDATE documents SET file_sha1 = ? WHERE id = ?").run(await fileSha1(p), r.id);
    n++;
  }
  return n;
}

export interface Duplicate {
  documentId: string;
  title: string;
  similarity: number;
}

export function documentBySha1(sha1: string): Duplicate | null {
  const r = db().prepare("SELECT id, title FROM documents WHERE file_sha1 = ? LIMIT 1").get(sha1) as { id: string; title: string } | null;
  return r ? { documentId: r.id, title: r.title, similarity: 1 } : null;
}

const HASHES = 64;
const SHINGLE = 5;
// Unter dieser Textmenge (z. B. Scan ohne Textebene) ist der Vergleich nicht aussagekräftig
const MIN_SHINGLES = 40;
export const SIMILAR = 0.9;

const SEEDS = Array.from({ length: HASHES }, (_, i) => Math.imul(i + 1, 0x9e3779b1) >>> 0);

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function mix(h: number, seed: number): number {
  let x = (h ^ seed) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

// Fingerabdruck des Inhalts; unabhängig von Seitenumbrüchen, Leerzeichen und Groß-/Kleinschreibung
export function textMinhash(text: string): number[] | null {
  const words = text.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  if (words.length < SHINGLE + MIN_SHINGLES) return null;
  const mins = new Array<number>(HASHES).fill(0xffffffff);
  for (let i = 0; i + SHINGLE <= words.length; i++) {
    const h = fnv1a(words.slice(i, i + SHINGLE).join(" "));
    for (let k = 0; k < HASHES; k++) {
      const v = mix(h, SEEDS[k]);
      if (v < mins[k]) mins[k] = v;
    }
  }
  return mins;
}

// Docling-Markdown auf den Lesetext bringen, damit es mit dem Fingerabdruck aus der Textebene vergleichbar ist:
// Bildverweise, HTML-Kommentare (<!-- image -->) und LaTeX fallen weg, in der Textebene stehen sie so nicht
export function markdownPlainText(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\$[^$\n]+\$/g, " ")
    .replace(/\\[a-zA-Z]+/g, " ");
}

export function similarity(a: number[], b: number[]): number {
  let same = 0;
  for (let k = 0; k < HASHES; k++) if (a[k] === b[k]) same++;
  return same / HASHES;
}

export function findTextDuplicate(hash: number[], excludeId?: string): Duplicate | null {
  const rows = db().prepare("SELECT id, title, text_minhash FROM documents WHERE text_minhash IS NOT NULL AND duplicate_of IS NULL").all() as Array<{ id: string; title: string; text_minhash: string }>;
  let best: Duplicate | null = null;
  for (const r of rows) {
    if (r.id === excludeId) continue;
    const s = similarity(hash, JSON.parse(r.text_minhash));
    if (s >= SIMILAR && (!best || s > best.similarity)) best = { documentId: r.id, title: r.title, similarity: s };
  }
  return best;
}

export function describeDuplicate(d: Duplicate): string {
  return d.similarity >= 1 ? `Dublette: gleiche Datei wie „${d.title}“` : `Dublette: Inhalt zu ${Math.round(d.similarity * 100)} % gleich wie „${d.title}“`;
}
