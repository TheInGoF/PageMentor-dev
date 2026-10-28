// Lesbare Wissensdatenbank im Datenordner: je Dokument ein Ordner mit Markdown und Bildern
// Für Menschen und andere Programme; die App selbst sucht über die Datenbank
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import { basename, dirname, extname, isAbsolute, join } from "path";
import { db } from "../../db";
import { KNOWLEDGE_DIR } from "../../paths";
import type { ExtractedImage } from "../docling/types";

function safeName(s: string): string {
  return s.replace(/[<>:"/\\|?*\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 80) || "Dokument";
}

const suffix = (docId: string) => `__${docId.slice(0, 8)}`;

export function findKnowledgeFolder(docId: string, root = KNOWLEDGE_DIR): string | null {
  if (!existsSync(root)) return null;
  const hit = readdirSync(root).find((n) => n.endsWith(suffix(docId)));
  return hit ? join(root, hit) : null;
}

export function removeKnowledgeFolder(docId: string, root = KNOWLEDGE_DIR): void {
  const dir = findKnowledgeFolder(docId, root);
  if (dir) rmSync(dir, { recursive: true, force: true });
}

// Bildverweise eines übernommenen Studium-Maker-Markdowns: Datei suchen und mitkopieren
const IMAGE_REF = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
function adoptImages(markdown: string, mdPath: string): { markdown: string; images: Array<{ name: string; from: string }> } {
  const images: Array<{ name: string; from: string }> = [];
  const mdDir = dirname(mdPath);
  const stem = basename(mdPath, extname(mdPath));
  const out = markdown.replace(IMAGE_REF, (m, alt: string, ref: string) => {
    if (/^(data:|https?:|bilder\/)/.test(ref)) return m;
    const name = basename(ref.replace(/\\/g, "/"));
    const candidates = [isAbsolute(ref) ? ref : join(mdDir, ref), join(mdDir, "assets", stem, name), join(mdDir, "..", "assets", stem, name)];
    const from = candidates.find((c) => existsSync(c));
    if (!from) return "";
    if (!images.some((i) => i.name === name)) images.push({ name, from });
    return `![${alt || "Abbildung"}](bilder/${name})`;
  });
  return { markdown: out, images };
}

export function writeKnowledgeFolder(docId: string, markdown: string, images: ExtractedImage[] = [], adoptedFrom: string | null = null, root = KNOWLEDGE_DIR): string {
  const doc = db()
    .prepare("SELECT d.title, d.doc_title, d.type, d.filename, d.page_count, m.code AS module_code, m.name AS module_name FROM documents d LEFT JOIN modules m ON m.id = d.module_id WHERE d.id = ?")
    .get(docId) as { title: string; doc_title: string | null; type: string; filename: string; page_count: number; module_code: string | null; module_name: string | null } | null;
  if (!doc) throw new Error("Dokument nicht gefunden");
  removeKnowledgeFolder(docId, root);
  const title = doc.doc_title?.trim() || doc.title;
  const dir = join(root, safeName(title) + suffix(docId));
  mkdirSync(join(dir, "bilder"), { recursive: true });

  let body = markdown;
  if (adoptedFrom) {
    const adopted = adoptImages(markdown, adoptedFrom);
    body = adopted.markdown;
    for (const img of adopted.images) copyFileSync(img.from, join(dir, "bilder", img.name));
  }
  for (const img of images) writeFileSync(join(dir, "bilder", img.name), img.data);

  const yaml = (v: string | number | null) => (v === null ? "" : JSON.stringify(v));
  const head = [
    "---",
    `titel: ${yaml(title)}`,
    `datei: ${yaml(doc.filename)}`,
    `typ: ${yaml(doc.type)}`,
    `modul: ${yaml(doc.module_code ? `${doc.module_code} ${doc.module_name ?? ""}`.trim() : null)}`,
    `seiten: ${doc.page_count ?? 0}`,
    `pagementor_id: ${yaml(docId)}`,
    "---",
    "",
  ].join("\n");
  writeFileSync(join(dir, `${safeName(title)}.md`), head + body.trim() + "\n");
  return dir;
}
