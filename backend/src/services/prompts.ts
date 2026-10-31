// Gemma-Anweisungen: Original aus src/prompts, eigene Fassung im Datenordner (prompts/<id>.md).
// Eine eigene Fassung bleibt über Updates erhalten; ändert ein Update das Original, merkt die App das
// am gespeicherten Fingerabdruck und bietet die neue Fassung an. „Original“ löscht die eigene Fassung.
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "../paths";
import chapterDe from "../prompts/audio-chapter.de.md" with { type: "text" };
import chapterEn from "../prompts/audio-chapter.en.md" with { type: "text" };
import introDe from "../prompts/audio-intro.de.md" with { type: "text" };
import introEn from "../prompts/audio-intro.en.md" with { type: "text" };
import cardsDe from "../prompts/cards.de.md" with { type: "text" };
import cardsEn from "../prompts/cards.en.md" with { type: "text" };
import tutorDe from "../prompts/tutor.de.md" with { type: "text" };
import tutorEn from "../prompts/tutor.en.md" with { type: "text" };
import langDe from "../prompts/audio-lang.de.md" with { type: "text" };
import conceptsDe from "../prompts/concepts.de.md" with { type: "text" };
import tutorMemoryDe from "../prompts/tutor-memory.de.md" with { type: "text" };
import learnLanguageDe from "../prompts/learn-language.de.md" with { type: "text" };
import learnSubjectDe from "../prompts/learn-subject.de.md" with { type: "text" };
import learnCheckDe from "../prompts/learn-check.de.md" with { type: "text" };

export const PROMPTS = {
  "audio-chapter.de": chapterDe,
  "audio-chapter.en": chapterEn,
  "audio-intro.de": introDe,
  "audio-intro.en": introEn,
  "cards.de": cardsDe,
  "cards.en": cardsEn,
  "tutor.de": tutorDe,
  "tutor.en": tutorEn,
  "audio-lang.de": langDe,
  "concepts.de": conceptsDe,
  "tutor-memory.de": tutorMemoryDe,
  "learn-language.de": learnLanguageDe,
  "learn-subject.de": learnSubjectDe,
  "learn-check.de": learnCheckDe,
} as const;

export type PromptId = keyof typeof PROMPTS;

const DIR = join(DATA_DIR, "prompts");
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const file = (id: PromptId) => join(DIR, `${id}.md`);
const baseFile = (id: PromptId) => join(DIR, `${id}.base`);

export function isPromptId(id: string): id is PromptId {
  return id in PROMPTS;
}

// Beim Aufruf lesen: Änderungen gelten sofort, ohne Neustart
export function getPrompt(id: PromptId): string {
  try {
    if (existsSync(file(id))) return readFileSync(file(id), "utf8");
  } catch {
    /* Original nehmen */
  }
  return PROMPTS[id];
}

export function promptInfo(id: PromptId): { id: PromptId; text: string; original: string; custom: boolean; originalChanged: boolean } {
  const custom = existsSync(file(id));
  let originalChanged = false;
  if (custom) {
    try {
      originalChanged = readFileSync(baseFile(id), "utf8").trim() !== hash(PROMPTS[id]);
    } catch {
      originalChanged = false;
    }
  }
  return { id, text: getPrompt(id), original: PROMPTS[id], custom, originalChanged };
}

export function savePrompt(id: PromptId, text: string): void {
  mkdirSync(DIR, { recursive: true });
  // Gleich dem Original: keine eigene Fassung anlegen
  if (text.trim() === PROMPTS[id].trim()) return resetPrompt(id);
  writeFileSync(file(id), text);
  writeFileSync(baseFile(id), hash(PROMPTS[id]));
}

export function resetPrompt(id: PromptId): void {
  rmSync(file(id), { force: true });
  rmSync(baseFile(id), { force: true });
}
