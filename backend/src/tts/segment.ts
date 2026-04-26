/**
 * Text segmentation for TTS.
 *
 * Chunk size is configurable at runtime:
 *   1. Settings → Qwen TTS → Advanced (llm-config `ttsMaxChunk`)
 *   2. ENV `PM_TTS_MAX_CHUNK` as fallback
 *   3. Default 2500 — conservative after the v1.18.041 experiment, where
 *      4000 on the 3090 caused timeouts/retries for some chunks.
 *
 * Accepts 500-8000. Smaller values = faster fail-fast, larger
 * = better prosody coherence but higher GPU risk.
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

/** Diagnostic: shows which source provides the current maxChunk. */
function sourceOfMaxChunk(): string {
  const cfg = effective("ttsMaxChunk", "PM_TTS_MAX_CHUNK");
  if (!cfg) return `default=${DEFAULT_MAX_CHUNK}`;
  // effective() prefers DB config over ENV. We do a rough check here
  // for whether it came from config or ENV, so the user immediately
  // sees in the log whether their Settings save actually persisted.
  const fromEnv = process.env.PM_TTS_MAX_CHUNK;
  if (fromEnv && fromEnv === cfg) return `env=${cfg}`;
  return `config=${cfg}`;
}

export interface Segment {
  /** Paragraphs within this segment (with sentence splits) */
  paragraphs: string[];
}

export function segmentText(text: string): Segment[] {
  // Per-call lookup so user setting changes take effect immediately
  // without a backend restart.
  const maxChunk = getMaxChunk();
  console.log(
    `[segment] text=${text.length}c maxChunk=${maxChunk} (src=${sourceOfMaxChunk()})`
  );
  const paragraphs = splitParagraphs(text);
  const segments: Segment[] = [];
  let buf: string[] = [];
  let size = 0;

  for (const p of paragraphs) {
    // A single paragraph is too long → hard-split at sentence boundaries
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
      // Sentence itself too long (unlikely for normal texts): hard cut.
      for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max).trim());
    } else {
      buf += s;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
