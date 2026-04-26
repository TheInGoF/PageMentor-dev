/**
 * Minimal backend i18n. Reads Accept-Language from the request and
 * translates user-visible error messages.
 *
 * For service-layer code that has no Hono Context (audiobook, pipeline,
 * docling), use {@link pickLang} with the document's stored language and
 * {@link tLang} to pick a string from the dictionary directly.
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
    "err.noSegments": "No segments from chapter text.",
    "err.noFinishedAudio": "No finished chapter audio found — generate chapters first.",
    "err.allAudioMissing": "All chapter file references point nowhere — please regenerate chapters.",
    "err.absUrlMissing": "ABS URL not configured",
    "err.absKeyMissing": "ABS API key not configured",
    "err.absLibraryMissing": "No ABS library selected",
    "err.absM4bMissing": "book.m4b does not exist — generate chapters and build the M4B first",
    "err.absLibraryNoFolder": "ABS library {libraryId} has no folder — add one in ABS settings",
    "err.doclingUnreachable": "docling-serve unreachable. Is the docling container running?",
    // SSE / progress messages — visible in the UI status line
    "label.chapter": "Chapter",
    "label.intro": "Intro",
    "msg.audiobookStart": "Generating {count} chapters with {voice}",
    "msg.buildingM4B": "Building M4B with chapter markers …",
    "msg.doclingChecking": "Checking Docling connection …",
    "msg.doclingUploading": "Docling: uploading PDF …",
    "msg.doclingFetchResult": "Docling: fetching result …",
    "msg.chaptersCount": "{count} chapters",
    "msg.pagesAndChapters": "{pages} pages, {count} chapters",
    "msg.audioPreprocessUnavailable":
      "[audiobook] LLM preprocessor not available — using original text. Audiobook may sound rough (abbreviations, citations, formulas).",
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
    "err.noSegments": "Keine Segmente aus Kapiteltext.",
    "err.noFinishedAudio": "Keine fertigen Kapitel-Audios gefunden — zuerst Kapitel generieren.",
    "err.allAudioMissing": "Alle Kapitel-Datei-Referenzen zeigen ins Leere — bitte Kapitel neu generieren.",
    "err.absUrlMissing": "ABS-URL nicht konfiguriert",
    "err.absKeyMissing": "ABS-API-Key nicht konfiguriert",
    "err.absLibraryMissing": "Keine ABS-Library ausgewählt",
    "err.absM4bMissing": "book.m4b existiert nicht — zuerst Kapitel generieren + M4B bauen",
    "err.absLibraryNoFolder": "ABS-Library {libraryId} hat keinen Ordner — in ABS-Settings hinzufügen",
    "err.doclingUnreachable": "docling-serve nicht erreichbar. Läuft der docling-Container?",
    "label.chapter": "Kapitel",
    "label.intro": "Einleitung",
    "msg.audiobookStart": "Generiere {count} Kapitel mit {voice}",
    "msg.buildingM4B": "Baue M4B mit Kapitelmarken …",
    "msg.doclingChecking": "Docling-Verbindung prüfen …",
    "msg.doclingUploading": "Docling: PDF hochladen …",
    "msg.doclingFetchResult": "Docling: Ergebnis abholen …",
    "msg.chaptersCount": "{count} Kapitel",
    "msg.pagesAndChapters": "{pages} Seiten, {count} Kapitel",
    "msg.audioPreprocessUnavailable":
      "[audiobook] LLM-Preprocessor nicht verfügbar — verwende Original-Text. Hörbuch klingt evtl. holprig (Abkürzungen, Zitate, Formeln).",
  },
};

export function resolveLocale(c: Pick<Context, "req">): Locale {
  const header = c.req.header("accept-language") ?? "";
  // Parse q-values roughly: "de-DE,de;q=0.9,en;q=0.8" — take first entry.
  const first = header.split(",")[0]?.trim().toLowerCase() ?? "";
  if (first.startsWith("de")) return "de";
  return "en";
}

/**
 * Service-layer locale picker. Maps a stored document language code
 * (from `documents.language`, e.g. `de`, `en`, `de-DE`) onto our
 * supported locales. Anything starting with "de" → "de", everything
 * else → "en".
 */
export function pickLang(documentLanguage: string | null | undefined): Locale {
  const v = (documentLanguage ?? "").toLowerCase();
  return v.startsWith("de") ? "de" : "en";
}

function applyParams(s: string, params?: Record<string, string | number>): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));
}

export function tt(
  c: Pick<Context, "req">,
  key: string,
  params?: Record<string, string | number>
): string {
  const locale = resolveLocale(c);
  const s = dict[locale][key] ?? dict.en[key] ?? key;
  return applyParams(s, params);
}

/**
 * Service-layer translator. Use when there is no request Context
 * (background pipelines, audiobook synthesis) but a known document
 * language. Falls back to English if the key is missing.
 */
export function tLang(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>
): string {
  const s = dict[locale][key] ?? dict.en[key] ?? key;
  return applyParams(s, params);
}

/**
 * Convenience: chapter label fallback ("Kapitel 3" / "Chapter 3").
 */
export function chapterLabel(locale: Locale, number: number): string {
  return `${tLang(locale, "label.chapter")} ${number}`;
}
