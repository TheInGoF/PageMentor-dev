// Eingebettete Bilder aus dem Docling-Markdown lösen: als Dateien ablegen statt base64 im Text
import { createHash } from "crypto";
import type { ExtractedImage } from "./types";

const DATA_IMAGE = /!\[([^\]]*)\]\(data:image\/([a-z+]+);base64,([A-Za-z0-9+/=\s]+)\)/g;

// Verweise zeigen auf bilder/<name>; Wiederholungen (Logo, Kopfgrafik auf jeder Seite) nur beim ersten Mal
export function splitEmbeddedImages(markdown: string): { markdown: string; images: ExtractedImage[] } {
  const images: ExtractedImage[] = [];
  const byHash = new Set<string>();
  const out = markdown.replace(DATA_IMAGE, (_m, alt: string, type: string, b64: string) => {
    const data = Buffer.from(b64.replace(/\s+/g, ""), "base64");
    const hash = createHash("sha1").update(data).digest("hex").slice(0, 10);
    if (byHash.has(hash)) return "";
    byHash.add(hash);
    const ext = type === "jpeg" ? "jpg" : type.replace(/\+xml$/, "");
    const name = `bild_${String(images.length + 1).padStart(3, "0")}_${hash}.${ext}`;
    images.push({ name, data });
    return `![${alt || "Abbildung"}](bilder/${name})`;
  });
  return { markdown: out.replace(/\n{3,}/g, "\n\n"), images };
}

// Bilddaten aus dem Docling-JSON entfernen, sonst wird die Ablage riesig
export function stripImageData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripImageData);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "uri" && typeof v === "string" && v.startsWith("data:")) continue;
      out[k] = stripImageData(v);
    }
    return out;
  }
  return value;
}
