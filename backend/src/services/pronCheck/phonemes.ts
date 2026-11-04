// Lautschrift über den Whisper-Baustein (Engine "stt"): was die Stimme wirklich gesagt hat (Phonem-Modell, ohne
// Wörterbuch) und wie ein Text klingen soll (espeak-ng). Beide im selben Zeichensatz, ein Laut je Eintrag
import { basename } from "node:path";
import { baseUrl } from "../../tts/engines/qwen/config";

const url = (path: string) => `${baseUrl()}/tts/stt/v1/audio/${path}`;

export async function heardPhonemes(file: string): Promise<string[]> {
  const form = new FormData();
  form.append("file", Bun.file(file), basename(file));
  const r = await fetch(url("phonemes"), { method: "POST", body: form, signal: AbortSignal.timeout(10 * 60_000) });
  if (!r.ok) throw new Error(`Lautschrift: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return ((await r.json()) as { phonemes?: string[] }).phonemes ?? [];
}

// Je Wort die Laute; language wie in der App (de, en, es …)
export async function targetPhonemes(text: string, language: string): Promise<string[][]> {
  const r = await fetch(url("phonemize"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, language: language.slice(0, 2) }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`Soll-Lautschrift: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return ((await r.json()) as { words?: string[][] }).words ?? [];
}
