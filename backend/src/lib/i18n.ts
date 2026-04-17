/**
 * Minimales Backend-i18n. Liest Accept-Language aus dem Request und
 * übersetzt User-sichtbare Fehlermeldungen.
 */

import type { Context } from "hono";

export type Locale = "en" | "de";

const dict: Record<Locale, Record<string, string>> = {
  en: {
    "err.notFound": "Not found",
    "err.docNotFound": "Document not found",
    "err.chapterNotFound": "Chapter not found",
    "err.chapterTooShort": "Chapter text is too short.",
    "err.chapterTooShortSummary": "Chapter text is too short for a summary.",
    "err.noChapters": "No chapters — run chapter detection first.",
    "err.emptyText": "Chapter text is too short or empty.",
    "err.ollamaUnavailable": "Ollama is not available.",
    "err.ollamaFailed": "Ollama request failed.",
    "err.invalidLevel": "Invalid level",
    "err.invalidQuality": "Invalid quality",
    "err.invalidVoice": "Unknown voice",
    "err.missingFile": "Missing file",
    "err.missingAnswers": "Missing answers",
    "err.missingFields": "Missing fields",
    "err.alreadySubmitted": "Already submitted",
    "err.notReady": "Not ready",
    "err.fileMissing": "File missing",
    "err.stillGenerating": "Still generating",
    "err.csvEmpty": "CSV appears to be empty.",
    "err.csvColumns": "CSV needs at least 'question' and 'answer' columns.",
    "err.csvParseFailed": "Could not extract cards from response.",
    "err.ttsFailed": "TTS failed.",
    "err.noCards": "No cards available.",
    "err.invalidToken": "Invalid token",
    "err.wrongPassword": "Wrong password",
    "err.unauthorized": "Unauthorized",
  },
  de: {
    "err.notFound": "Nicht gefunden",
    "err.docNotFound": "Dokument nicht gefunden",
    "err.chapterNotFound": "Kapitel nicht gefunden",
    "err.chapterTooShort": "Kapiteltext zu kurz.",
    "err.chapterTooShortSummary": "Kapiteltext ist zu kurz für eine Zusammenfassung.",
    "err.noChapters": "Keine Kapitel — Kapitel-Erkennung zuerst ausführen.",
    "err.emptyText": "Kapiteltext ist zu kurz oder leer.",
    "err.ollamaUnavailable": "Ollama ist nicht erreichbar.",
    "err.ollamaFailed": "Ollama-Anfrage fehlgeschlagen.",
    "err.invalidLevel": "Ungültige Detailstufe",
    "err.invalidQuality": "Ungültige Bewertung",
    "err.invalidVoice": "Unbekannte Stimme",
    "err.missingFile": "Keine Datei übergeben",
    "err.missingAnswers": "Antworten fehlen",
    "err.missingFields": "Pflichtfelder fehlen",
    "err.alreadySubmitted": "Bereits abgegeben",
    "err.notReady": "Noch nicht bereit",
    "err.fileMissing": "Datei nicht vorhanden",
    "err.stillGenerating": "Wird noch generiert",
    "err.csvEmpty": "CSV scheint leer zu sein.",
    "err.csvColumns": "CSV braucht mindestens die Spalten 'question' und 'answer'.",
    "err.csvParseFailed": "Konnte keine Karten aus der Antwort extrahieren.",
    "err.ttsFailed": "TTS fehlgeschlagen.",
    "err.noCards": "Keine Karten verfügbar.",
    "err.invalidToken": "Ungültiges Token",
    "err.wrongPassword": "Falsches Passwort",
    "err.unauthorized": "Nicht autorisiert",
  },
};

export function resolveLocale(c: Pick<Context, "req">): Locale {
  const header = c.req.header("accept-language") ?? "";
  // Parse q-values roughly: "de-DE,de;q=0.9,en;q=0.8" — take first entry.
  const first = header.split(",")[0]?.trim().toLowerCase() ?? "";
  if (first.startsWith("de")) return "de";
  return "en";
}

export function tt(
  c: Pick<Context, "req">,
  key: string,
  params?: Record<string, string | number>
): string {
  const locale = resolveLocale(c);
  const s = dict[locale][key] ?? dict.en[key] ?? key;
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));
}
