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

  // Topic-Density-Pass: jeden Chunk pruefen ob ein Substantiv zu oft
  // wiederholt wird ("Mimik, Mimik, Mimik..." Lehrbuch-Pattern).
  // Wenn ja: an Satzgrenze halbieren. Schuetzt vor Topic-Anchored-
  // Loops im Qwen-Decoder ohne Settings-Anpassung pro Lauf.
  return segments.flatMap((seg) => splitOnTopicDensity(seg));
}

/** Threshold: Substantiv erscheint mehr als 5x pro 1000c → splitten.
 *  Empirisch genug um den Loop bei "Mimik"-Kapiteln (7-9x in 1000c)
 *  und "Stimme"-Kapiteln (9-10x in 1000c) zu verhindern, ohne dass
 *  normale Texte mit thematischer Wiederholung getroffen werden. */
const TOPIC_DENSITY_PER_1000C = 5;
const MIN_SPLIT_CHARS = 400;

function splitOnTopicDensity(seg: Segment): Segment[] {
  const text = seg.paragraphs.join("\n\n");
  if (text.length < MIN_SPLIT_CHARS * 2) return [seg];

  const limit = Math.max(
    TOPIC_DENSITY_PER_1000C,
    Math.floor((text.length / 1000) * TOPIC_DENSITY_PER_1000C),
  );

  const counts = countCapitalizedNouns(text);
  let maxCount = 0;
  let maxWord = "";
  for (const [word, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      maxWord = word;
    }
  }
  if (maxCount <= limit) return [seg];

  // Splitte an Satzgrenze möglichst in der Mitte. Wenn der Segment
  // mehrere Paragraphen hat, splitte zwischen Paragraphen — sonst
  // splitte den einzelnen Paragraphen an Satzgrenzen.
  const paragraphs = seg.paragraphs;
  if (paragraphs.length >= 2) {
    const half = Math.ceil(paragraphs.length / 2);
    const a: Segment = { paragraphs: paragraphs.slice(0, half) };
    const b: Segment = { paragraphs: paragraphs.slice(half) };
    console.log(
      `[segment] topic-density split: "${maxWord}" appears ${maxCount}x in ${text.length}c (limit ${limit}) → 2 sub-chunks`,
    );
    return [...splitOnTopicDensity(a), ...splitOnTopicDensity(b)];
  }

  // Single paragraph: split at sentence boundary near middle.
  const sentences = paragraphs[0].match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g);
  if (!sentences || sentences.length < 2) return [seg];
  const mid = Math.ceil(sentences.length / 2);
  const a: Segment = { paragraphs: [sentences.slice(0, mid).join("").trim()] };
  const b: Segment = { paragraphs: [sentences.slice(mid).join("").trim()] };
  console.log(
    `[segment] topic-density split: "${maxWord}" appears ${maxCount}x in ${text.length}c (limit ${limit}) → 2 sub-chunks (sentence-level)`,
  );
  return [...splitOnTopicDensity(a), ...splitOnTopicDensity(b)];
}

/** Heuristik: alles was an Wort-Boundary mit Großbuchstaben startet
 *  und mindestens 4 Zeichen hat, ist mit hoher Wahrscheinlichkeit
 *  ein deutsches Substantiv (im Deutschen sind Substantive immer
 *  großgeschrieben). False-Positives bei Eigennamen + Satz-Anfang-
 *  Wörtern, aber für die Density-Heuristik egal — wenn ein Eigenname
 *  9x auftaucht ist das Loop-Risiko genauso hoch. */
function countCapitalizedNouns(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const re = /\b([A-ZÄÖÜ][a-zäöüß]{3,})\b/g;
  for (const m of text.matchAll(re)) {
    const word = m[1];
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return counts;
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
