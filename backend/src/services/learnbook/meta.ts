// Name und Autor der Lernhörbücher: eigener Zusatz je Art, damit sie neben dem Original-Hörbuch erkennbar sind
// („Heft – Sprachlern-Hörbuch“, Autor „nach dem Buch von …“)
import { spokenAuthors } from "../../lib/authors";

export type LearnKindName = "subject" | "language";

export const LEARN_SUFFIX: Record<LearnKindName, string> = { subject: "Lernhörbuch", language: "Sprachlern-Hörbuch" };

export function learnTitle(base: string, kind: LearnKindName): string {
  return `${base} – ${LEARN_SUFFIX[kind]}`;
}

// Mehrere Autoren mit „und“ verbunden: „nach dem Buch von Ana Babiloni und Hildegard Ritter“
export function learnAuthor(author: string | null | undefined): string {
  const a = spokenAuthors(author);
  return a ? `nach dem Buch von ${a}` : "PageMentor";
}

// Dateiname neben dem Original-Hörbuch, ohne Umlaute
export function learnFileSuffix(kind: LearnKindName): string {
  return kind === "language" ? " - Sprachlern-Hoerbuch" : " - Lernhoerbuch";
}

const LANG_NAMES: Record<string, string> = { es: "Spanisch", en: "Englisch", fr: "Französisch", it: "Italienisch", pt: "Portugiesisch" };

// Gesprochenes Intro vor der ersten Einheit: Titel und Autor genau mit dem Zusatz wie in M4B und Audiobookshelf,
// dann Umfang und wie man damit lernt
export function introText(p: { kind: LearnKindName; lang: string; title: string; author: string | null; units: number }): string {
  const head = `${learnTitle(p.title, p.kind)}. ${p.author?.trim() ? `${learnAuthor(p.author)[0].toUpperCase()}${learnAuthor(p.author).slice(1)}.` : ""}`.trim();
  if (p.kind === "language") {
    return (
      `${head} Du lernst ${LANG_NAMES[p.lang] ?? p.lang} in ${p.units} Einheiten. ` +
      `Wenn eine Pause kommt, sprich laut nach oder antworte selbst, bevor die Lösung kommt. [PAUSE 1]`
    );
  }
  return (
    `${head} ${p.units} Einheiten erklären das Heft Schritt für Schritt, mit Beispielen und Denkfragen. ` +
    `Wenn eine Frage kommt, halte kurz an und überlege selbst, bevor die Antwort folgt. [PAUSE 1]`
  );
}
