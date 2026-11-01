// Standard-Intro aus den Metadaten, wie im Hörbuch-Tab (IntroEditor): Titel, Autor, Modell, Engine und Stimme
import type { Voice } from "../../tts/engines/base";
import { spokenAuthors } from "../../lib/authors";
import { spokenModel } from "../../lib/spokenModel";

const ENGINE_NAMES: Record<string, string> = { qwen: "Qwen3-TTS", kokoro: "Kokoro", f5: "F5-TTS", tada: "TADA" };

export function defaultIntroText(meta: { title: string; author: string | null; language: string; module?: string | null }, voice: Voice | null, model: string): string {
  const de = meta.language === "de";
  // Zusätze wie „(Vorlage)“ oder „· Design“ aus dem Stimmnamen entfernen
  const voiceLabel = voice ? voice.label.replace(/\s*[·•]\s*\S.*$/, "").replace(/\s*\([^)]*\)\s*/g, " ").trim() : "";
  const engine = voice ? ENGINE_NAMES[voice.engine] ?? voice.engine : "";
  // Modul als eigene Zeile, dann „Hörbuch: Titel“
  const lines: string[] = [];
  if (meta.module?.trim()) lines.push(`${meta.module.trim()}.`);
  lines.push(de ? `Hörbuch: ${meta.title}.` : `Audiobook: ${meta.title}.`, "");
  // Mehrere Autoren zum Vorlesen mit „und“ verbunden
  const by = spokenAuthors(meta.author, meta.language);
  if (by) lines.push(de ? `Von ${by}.` : `By ${by}.`);
  if (model) lines.push(de ? `Aufbereitet durch ${spokenModel(model)}.` : `Prepared with ${spokenModel(model)}.`);
  if (voice) lines.push(de ? `Gesprochen durch ${engine}, mit der Stimme ${voiceLabel}.` : `Narrated by ${engine}, with the voice ${voiceLabel}.`);
  lines.push(de ? "Erstellt mit PageMentor." : "Created with PageMentor.");
  return lines.join("\n");
}

// Titel fürs Intro: PDF-Metadaten zuerst; ohne sie der Dateiname ohne Endung, Unterstriche und Bindestriche
export function introTitle(docTitle: string | null, title: string): string {
  if (docTitle?.trim()) return docTitle.trim();
  return title.replace(/\.(pdf|md|txt)$/i, "").replace(/[_]+/g, " ").replace(/\s+-\s+|-{2,}/g, " – ").replace(/\s+/g, " ").trim();
}
