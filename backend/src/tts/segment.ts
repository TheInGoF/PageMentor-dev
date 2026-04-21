/**
 * Text-Segmentierung für TTS.
 *
 * Chunk-Größe ist zur Laufzeit konfigurierbar:
 *   1. Settings → Qwen TTS → Advanced (llm-config `ttsMaxChunk`)
 *   2. ENV `PM_TTS_MAX_CHUNK` als Fallback
 *   3. Default 2500 — konservativ nach v1.18.041-Experiment, wo 4000
 *      auf 3090 zu Timeouts/Retries bei manchen Chunks führte.
 *
 * Akzeptiert 500-8000. Kleinere Werte = schnelleres Fail-Fast, größere
 * = bessere Prosodie-Kohärenz aber höheres GPU-Risiko.
 */

import { effective } from "../services/llmConfig";

const DEFAULT_MAX_CHUNK = 2500;

function getMaxChunk(): number {
  const raw = effective("ttsMaxChunk", "PM_TTS_MAX_CHUNK");
  if (!raw) return DEFAULT_MAX_CHUNK;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 500 || n > 8000) return DEFAULT_MAX_CHUNK;
  return n;
}

export interface Segment {
  /** Absätze innerhalb dieses Segments (mit Satz-Trennungen) */
  paragraphs: string[];
}

export function segmentText(text: string): Segment[] {
  // Per-call lookup, damit User-Setting-Änderungen sofort greifen
  // ohne Backend-Restart.
  const maxChunk = getMaxChunk();
  const paragraphs = splitParagraphs(text);
  const segments: Segment[] = [];
  let buf: string[] = [];
  let size = 0;

  for (const p of paragraphs) {
    // Ein einzelner Absatz ist zu lang → hart an Satzgrenzen splitten
    if (p.length > maxChunk) {
      if (buf.length) {
        segments.push({ paragraphs: buf });
        buf = [];
        size = 0;
      }
      for (const sub of splitLongParagraph(p, maxChunk)) {
        segments.push({ paragraphs: [sub] });
      }
      continue;
    }

    if (size + p.length + 2 > maxChunk && buf.length) {
      segments.push({ paragraphs: buf });
      buf = [];
      size = 0;
    }
    buf.push(p);
    size += p.length + 2;
  }

  if (buf.length) segments.push({ paragraphs: buf });
  return segments;
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function splitLongParagraph(p: string, max: number): string[] {
  const sentences = p.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [p];
  const out: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if ((buf + s).length > max && buf) {
      out.push(buf.trim());
      buf = "";
    }
    if (s.length > max) {
      // Satz selbst zu lang (unwahrscheinlich bei normalen Texten): harter Cut.
      for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max).trim());
    } else {
      buf += s;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
