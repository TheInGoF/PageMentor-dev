// Whisper über den GPU-Arbiter (Engine "stt"): Audio-Datei rein, Wörter mit Zeit und Sicherheit raus
import { basename } from "node:path";
import { baseUrl } from "../../tts/engines/qwen/config";
import { extraStatus } from "../../tts/engines/extra/probe";
import type { HeardWord } from "./align";

export function sttAvailable(): boolean {
  const s = extraStatus()["stt"];
  return !!s && s.container !== "missing" && !s.container.startsWith("error");
}

export async function transcribe(file: string, language: string): Promise<{ words: HeardWord[]; duration: number }> {
  const form = new FormData();
  form.append("file", Bun.file(file), basename(file));
  form.append("language", language.slice(0, 2));
  const r = await fetch(`${baseUrl()}/tts/stt/v1/audio/transcriptions`, { method: "POST", body: form, signal: AbortSignal.timeout(30 * 60_000) });
  if (!r.ok) throw new Error(`Whisper: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { words: HeardWord[]; duration: number };
  return { words: j.words ?? [], duration: j.duration ?? 0 };
}
