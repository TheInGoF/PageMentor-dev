// Laufzustand, Abbruch, gemeinsame Typen
import { emit } from "../events";
import { effective } from "../llmConfig";

export interface Chapter {
  id: string;
  document_id: string;
  number: number;
  title: string;
  text: string;
  start_page: number;
  end_page: number;
  sort_order: number;
  kind?: string;
  include_in_audio?: number | null;
}

// Standard ohne include_in_audio: Inhalt + Zusammenfassung an
function defaultIncludeForKind(kind: string | undefined): boolean {
  return kind === "content" || kind === "summary";
}

export function isIncluded(ch: Pick<Chapter, "kind" | "include_in_audio">): boolean {
  if (ch.include_in_audio == null) return defaultIncludeForKind(ch.kind);
  return ch.include_in_audio === 1;
}

export interface Document {
  id: string;
  title: string;
  doc_title: string | null;
  author: string | null;
  short_code: string | null;
  series_sequence: string | null;
  module_name: string | null;
  language: string;
}

// Fortschritt pro laufendem Hörbuch, nur im Speicher
// Frontend holt ihn nach Reload über /api/audio/progress
export interface RunState {
  ctrl: AbortController;
  startedAt: number;
  totalChapters: number;
  currentChapter: number;
  chunkCurrent: number;
  chunkTotal: number;
  // Zeichen pro Kapitel, Basis der Restzeit-Schätzung
  chapterChars: number[];
}

export const running = new Map<string, RunState>();

export function isGenerating(docId: string): boolean {
  return running.has(docId);
}

// Fortschritt für das Frontend nach Reload, null ohne Lauf
export function getRunProgress(docId: string): {
  startedAt: number;
  totalChapters: number;
  currentChapter: number;
  chunkCurrent: number;
  chunkTotal: number;
  chapterChars: number[];
} | null {
  const r = running.get(docId);
  if (!r) return null;
  return {
    startedAt: r.startedAt,
    totalChapters: r.totalChapters,
    currentChapter: r.currentChapter,
    chunkCurrent: r.chunkCurrent,
    chunkTotal: r.chunkTotal,
    chapterChars: r.chapterChars,
  };
}

export class AudiobookCanceled extends Error {
  constructor() {
    super("audiobook.canceled");
    this.name = "AudiobookCanceled";
  }
}

// Abbrechen: Worker stoppt nach dem aktuellen Chunk
// Arbiter-Reset beendet die laufende Generierung im Sidecar
// Fertige Kapitel-MP3s bleiben
export function cancelAudiobook(docId: string): boolean {
  const r = running.get(docId);
  if (!r) return false;
  r.ctrl.abort();
  // Sofort austragen: Worker kann lange in fetch hängen
  // sonst bleibt der Generieren-Knopf gesperrt
  // Doppelter Lauf möglich, Arbiter-Reset lässt alten Synth scheitern
  running.delete(docId);
  // UI sofort informieren, nicht auf den Worker warten
  emit({
    phase: "audiobook.canceled",
    docId,
    message: "aborted by user",
  });
  // Nicht auf den Arbiter-Neustart warten
  void resetGpuViaArbiter().catch((err) => {
    console.warn(
      "[audiobook] cancel: arbiter reset failed (sidecar may still be running):",
      err,
    );
  });
  return true;
}

async function resetGpuViaArbiter(reason: string = "cancel"): Promise<void> {
  const base = effective("qwenTtsUrl", "PM_QWEN_TTS_URL");
  if (!base) {
    console.warn(
      `[audiobook] ${reason}: no arbiter URL configured — Sidecar may ` +
        "keep generating until its own timeout",
    );
    return;
  }
  const url = base.replace(/\/+$/, "") + "/admin/gpu/reset";
  const apiKey = effective("qwenTtsApiKey", "PM_QWEN_TTS_API_KEY");
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  console.log(`[audiobook] ${reason}: hard-resetting GPU via ${url}`);
  const res = await fetch(url, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`arbiter reset ${res.status}`);
  }
}
