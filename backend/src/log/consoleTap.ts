// console.* abfangen: alte Aufrufe landen strukturiert im Log
import { emitLog } from "./logger";
import type { LogLevel } from "./types";

// Präfix "[xyz]" → Bereich
const AREA_BY_PREFIX: Record<string, string> = {
  tts: "tts",
  "qwen-tts": "tts",
  "voice-samples": "tts",
  "voice-designs": "tts",
  audiobook: "audiobook",
  "audio-preprocess": "audiobook",
  m4b: "audiobook",
  "rebuild-m4b": "audiobook",
  cover: "audiobook",
  pipeline: "pipeline",
  reprocess: "pipeline",
  ocr: "pipeline",
  docling: "docling",
  search: "search",
  llm: "llm",
  "llm-config": "llm",
  "gemma-lock": "llm",
  embeddings: "llm",
  "cards.build": "cards",
  tutor: "tutor",
  abs: "abs",
  "sidecar-log-pump": "engine",
  pagementor: "ui",
};

function areaOf(message: string): string {
  const m = /^\[([a-zA-Z0-9_.:-]+)\]/.exec(message);
  if (!m) return "app";
  const key = m[1].split(":")[0];
  return AREA_BY_PREFIX[key] ?? key;
}

function argToText(a: unknown): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) return a.message;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

let installed = false;

export function installConsoleTap(): void {
  if (installed) return;
  installed = true;
  const wrap = (level: LogLevel) => (...args: unknown[]) => {
    const err = args.find((a) => a instanceof Error);
    const message = args.filter((a) => a !== err).map(argToText).join(" ");
    emitLog(level, areaOf(message), message, { err });
  };
  console.log = wrap("info");
  console.info = wrap("info");
  console.warn = wrap("warn");
  console.error = wrap("error");
  console.debug = wrap("debug");
}
