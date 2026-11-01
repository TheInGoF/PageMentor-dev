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

// Vorlage fürs Intro, aufgebaut wie beim Original-Hörbuch (Titel, Autor, Hinweis, PageMentor); anders ist nur der
// Metadaten-Vorbau: Titel mit dem Zusatz wie in M4B und Audiobookshelf, „Nach dem Buch von …“, Umfang und wie man lernt
export function introText(p: { kind: LearnKindName; lang: string; title: string; author: string | null; units: number; module?: string | null }): string {
  // Modulname vor dem Hefttitel, wie beim Original-Hörbuch
  const lines = [`${p.module?.trim() ? `${p.module.trim()}, ` : ""}${learnTitle(p.title, p.kind)}.`, ""];
  if (p.author?.trim()) {
    const a = learnAuthor(p.author);
    lines.push(`${a[0].toUpperCase()}${a.slice(1)}.`);
  }
  if (p.kind === "language") {
    lines.push(`Du lernst ${LANG_NAMES[p.lang] ?? p.lang} in ${p.units} Einheiten.`);
    lines.push("Wenn eine Pause kommt, sprich laut nach oder antworte selbst, bevor die Lösung kommt.");
  } else {
    lines.push(`${p.units} Einheiten erklären das Heft Schritt für Schritt, mit Beispielen und Denkfragen.`);
    lines.push("Wenn eine Frage kommt, halte kurz an und überlege selbst, bevor die Antwort folgt.");
  }
  lines.push("Erstellt mit PageMentor.");
  return lines.join("\n");
}
