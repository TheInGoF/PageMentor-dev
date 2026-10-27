// Aufgaben der Cloud-Hilfe: aus Daten der App den genauen Text bauen, der rausgehen würde
import { db } from "../../db";
import { PROMPTS } from "../../study/material/prompts";
import { getFailure } from "./failures";

export type CloudTask = "lektorat" | "rezepte" | "zweite_meinung" | "diagnose";

export interface BuiltTask {
  task: CloudTask;
  title: string;
  system: string;
  text: string;
  // Wohin das Ergebnis gehört (für „Übernehmen“)
  ref: string | null;
}

const LEKTORAT = `Du bist Fachlektor für ein technisches Studium. Prüfe den Katalog-Eintrag fachlich:
Formeln, Vorzeichen, Einheiten, Begriffe, Verständlichkeit. Ändere nur, was falsch oder unklar ist.
Formeln als LaTeX in $...$ bzw. $$...$$ wie im Original. Antworte nur mit JSON:
{"korrigiert_md": "<ganzer korrigierter Eintrag in Markdown>", "hinweise": ["<was du geändert hast und warum>"], "sicher": true|false}`;

const ZWEITE_MEINUNG = `Du bist ein zweiter Tutor. Prüfe die Antwort eines lokalen Tutors auf eine Frage eines Studierenden
anhand der mitgegebenen Quellen. Sag knapp: was stimmt, was fehlt oder falsch ist, und gib bei Bedarf eine verbesserte Kurzantwort.
Bleib bei den Quellen; wenn sie nicht reichen, sag das.`;

const DIAGNOSE = `Du hilfst beim Entwickeln einer Lern-App, die lokal ein kleines Sprachmodell (Ollama) nutzt.
Ein Aufruf ist gescheitert. Analysiere Eingabe, Ausgabe und Fehler: Was ist die wahrscheinlichste Ursache
(Prompt, Kontextlänge, Schema, Modell, Daten)? Schlage konkrete Änderungen vor (Prompt-Text, Parameter, Vorverarbeitung).`;

export function buildTask(task: CloudTask, params: Record<string, unknown>): BuiltTask {
  if (task === "lektorat") {
    const id = String(params.itemId ?? "");
    const it = db().prepare("SELECT m.id, m.kind, m.title, m.body_md, m.source_ref, mo.name AS module FROM material_items m LEFT JOIN modules mo ON mo.id = m.module_id WHERE m.id = ?").get(id) as
      | { id: string; kind: string; title: string; body_md: string; source_ref: string | null; module: string | null }
      | null;
    if (!it) throw new Error("Eintrag nicht gefunden");
    return {
      task,
      title: `Lektorat ${it.id}`,
      system: LEKTORAT,
      text: `Modul: ${it.module ?? "–"}\nArt: ${it.kind}\nTitel: ${it.title}\nQuelle: ${it.source_ref ?? "–"}\n\n${it.body_md}`,
      ref: it.id,
    };
  }
  if (task === "rezepte") {
    const moduleId = String(params.moduleId ?? "");
    const rows = db().prepare("SELECT title, body_md FROM material_items WHERE module_id = ? AND kind = 'aufgabe' ORDER BY id").all(moduleId) as Array<{ title: string; body_md: string }>;
    if (!rows.length) throw new Error("Noch keine Aufgaben im Modul");
    return { task, title: "Rezepte bilden", system: `${PROMPTS.rezept}\n\nAntworte nur mit JSON der Form {"aufgabentypen": [...]}.`, text: rows.map((r) => `### ${r.title}\n${r.body_md}`).join("\n\n"), ref: moduleId };
  }
  if (task === "zweite_meinung") {
    const sources = Array.isArray(params.sources) ? (params.sources as Array<{ n: number; label: string; snippet: string }>) : [];
    return {
      task,
      title: "Zweite Meinung",
      system: ZWEITE_MEINUNG,
      text: `Frage:\n${String(params.question ?? "")}\n\nAntwort des lokalen Tutors:\n${String(params.answer ?? "")}\n\nQuellen:\n${sources.map((s) => `[${s.n}] ${s.label}\n${s.snippet}`).join("\n\n")}`,
      ref: null,
    };
  }
  const f = getFailure(Number(params.failureId));
  if (!f) throw new Error("Fehlversuch nicht gefunden");
  return {
    task: "diagnose",
    title: `Diagnose ${f.kind}`,
    system: DIAGNOSE,
    text: `Aufgabe: ${f.kind}\nModell: ${f.model ?? "?"}\nFehler: ${f.error ?? "?"}\n\n=== EINGABE ===\n${f.input}\n\n=== AUSGABE DES MODELLS ===\n${f.output}`,
    ref: String(f.id),
  };
}
