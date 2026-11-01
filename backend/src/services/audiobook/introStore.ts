// Intro je Hörbuch-Art an einer Stelle: Original-Hörbuch, Lernhörbuch, Sprachlern-Hörbuch.
// Gleicher Ablauf für alle drei: Text (eigener oder Vorlage aus den Metadaten) → Gemma-Sprachfassung → MP3.
// Nur die Vorlage unterscheidet sich: die Lernhörbücher tragen den Zusatz im Titel und „nach dem Buch von …“
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { db } from "../../db";
import { DATA_DIR } from "../../paths";
import { introText } from "../learnbook/meta";
import { learnSettings, listUnits } from "../learnbook/store";
import { learnIntroPath } from "../learnbook/speak";

export type IntroVariant = "original" | "subject" | "language";

export function parseVariant(v: string | null | undefined): IntroVariant {
  return v === "subject" || v === "language" ? v : "original";
}

export interface IntroRecord {
  // Gesprochener Text: eigener, beim Lernhörbuch sonst die Vorlage
  text: string | null;
  custom: boolean;
  template: string | null;
  tts: string | null;
  ttsModel: string | null;
  ttsStamp: string | null;
  // Sprache des Intros (Gemma-Anweisung): Lernhörbücher erklären auf Deutsch
  language: string;
}

type DocRow = Record<string, string | null> & { title: string; doc_title: string | null; author: string | null; language: string };

// Vorlage der Lernhörbücher; das Original baut seine Vorlage in der Oberfläche (Stimme, Modell)
export function introTemplate(docId: string, v: IntroVariant): string | null {
  if (v === "original") return null;
  const doc = db().prepare("SELECT title, doc_title, author FROM documents WHERE id = ?").get(docId) as DocRow | undefined;
  if (!doc) return null;
  const units = listUnits(docId).filter((u) => !u.skip_reason).length;
  return introText({ kind: v, lang: learnSettings(docId).lang, title: doc.doc_title || doc.title, author: doc.author, units });
}

export function getIntro(docId: string, v: IntroVariant): IntroRecord | null {
  if (v === "original") {
    const r = db()
      .prepare("SELECT language, audio_intro_text, audio_intro_text_tts, audio_intro_text_tts_model, audio_intro_text_tts_stamp FROM documents WHERE id = ?")
      .get(docId) as DocRow | undefined;
    if (!r) return null;
    const text = r.audio_intro_text?.trim() || null;
    return { text, custom: !!text, template: null, tts: r.audio_intro_text_tts, ttsModel: r.audio_intro_text_tts_model, ttsStamp: r.audio_intro_text_tts_stamp, language: r.language };
  }
  const r = db()
    .prepare(`SELECT learn_intro_${v} AS t, learn_intro_${v}_tts AS tts, learn_intro_${v}_tts_model AS m, learn_intro_${v}_tts_stamp AS s FROM documents WHERE id = ?`)
    .get(docId) as { t: string | null; tts: string | null; m: string | null; s: string | null } | undefined;
  if (!r) return null;
  const template = introTemplate(docId, v);
  const custom = r.t?.trim() || null;
  return { text: custom ?? template, custom: !!custom, template, tts: r.tts, ttsModel: r.m, ttsStamp: r.s, language: "de" };
}

// Text ändern leert die Sprachfassung; beim Lernhörbuch heißt leer oder gleich der Vorlage: Vorlage
export function setIntroText(docId: string, v: IntroVariant, text: string | null): string | null {
  let value = text?.trim() || null;
  if (v === "original") {
    db().prepare("UPDATE documents SET audio_intro_text = ?, audio_intro_text_tts = NULL, audio_intro_text_tts_model = NULL WHERE id = ?").run(value, docId);
    return value;
  }
  if (value && value === introTemplate(docId, v)?.trim()) value = null;
  db()
    .prepare(`UPDATE documents SET learn_intro_${v} = ?, learn_intro_${v}_tts = NULL, learn_intro_${v}_tts_model = NULL, learn_intro_${v}_tts_stamp = NULL WHERE id = ?`)
    .run(value, docId);
  return getIntro(docId, v)?.text ?? null;
}

// Sprachfassung speichern (Gemma oder von Hand); null leert sie, der nächste Lauf fragt Gemma neu
export function setIntroTts(docId: string, v: IntroVariant, tts: string | null, model: string | null, stamp: string | null): void {
  if (v === "original") {
    db().prepare("UPDATE documents SET audio_intro_text_tts = ?, audio_intro_text_tts_model = ?, audio_intro_text_tts_stamp = ? WHERE id = ?").run(tts, model, stamp, docId);
    return;
  }
  db().prepare(`UPDATE documents SET learn_intro_${v}_tts = ?, learn_intro_${v}_tts_model = ?, learn_intro_${v}_tts_stamp = ? WHERE id = ?`).run(tts, model, stamp, docId);
}

export function introAudioPath(docId: string, v: IntroVariant): string {
  return v === "original" ? join(DATA_DIR, "audio", docId, "intro.mp3") : learnIntroPath(docId);
}

// Zum Abspielen; der Zeitstempel sorgt nach dem Neusprechen für die frische Datei
export function introAudioUrl(docId: string, v: IntroVariant): string | null {
  const p = introAudioPath(docId, v);
  if (!existsSync(p)) return null;
  const q = v === "original" ? "" : `v=${v}&`;
  return `/api/audio/intro/${docId}/file?${q}t=${Math.round(statSync(p).mtimeMs)}`;
}
