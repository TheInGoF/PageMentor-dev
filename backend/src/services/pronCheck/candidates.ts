// Kandidaten aus der Bereinigung: Wörter, die Gemma im bereinigten Kapiteltext anders schreibt als im Original,
// also Lautschriften für Anglizismen, Namen und Abkürzungen. Erst deterministisch aus dem Vergleich beider Texte,
// dann bestätigt Gemma, welche Paare wirklich Aussprache-Schreibweisen sind (keine Übersetzungen). Die Paare kommen
// offen in die Ausspracheliste; die Wortprüfung hört sie ab
import { createHash } from "node:crypto";
import { db } from "../../db";
import { emitLog } from "../../log/logger";
import { pronunciationList, savePronunciation } from "../pronunciation";
import { confirmRespellings } from "../pronunciationSuggest";
import { alignWords, norm, tokens } from "./align";

const CHUNK = 1500;
const strip = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
// Ein Wort, das eine Lautschrift verdient: groß geschrieben, mindestens drei Buchstaben
const worthy = (w: string) => /^\p{Lu}/u.test(w) && w.replace(/[^\p{L}]/gu, "").length >= 3;

// Paare „Original → bereinigt“ an Stellen, an denen ein Wort durch ein anderes ersetzt wurde
export function respellings(original: string, cleaned: string): Array<{ from: string; to: string }> {
  const e = tokens(original).map(strip).filter(Boolean);
  const h = tokens(cleaned).map(strip).filter(Boolean);
  const en = e.map(norm);
  const hn = h.map(norm);
  const out = new Map<string, string>();
  // Fensterweise wie in der Ausspracheprüfung: beide Texte halten die Reihenfolge
  for (let e0 = 0, h0 = 0; e0 < en.length || h0 < hn.length; ) {
    const eEnd = Math.min(en.length, e0 + CHUNK);
    const hEnd = eEnd >= en.length ? hn.length : Math.min(hn.length, h0 + Math.round((eEnd - e0) * (hn.length / Math.max(1, en.length))));
    for (const op of alignWords(en.slice(e0, eEnd), hn.slice(h0, hEnd))) {
      if (op.t !== "sub") continue;
      const from = e[op.e + e0];
      const to = h[op.h + h0];
      if (!worthy(from) || !to || norm(from) === norm(to) || !/^[\p{L}-]+$/u.test(to)) continue;
      if (!out.has(from)) out.set(from, to);
    }
    e0 = eEnd;
    h0 = hEnd;
  }
  return [...out].map(([from, to]) => ({ from, to }));
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

// Noch nicht durchgesehene deutsche Kapitel mit bereinigtem Text
export function unscannedChapters(): Array<{ id: string; text: string; audio_text: string }> {
  const rows = db()
    .prepare("SELECT c.id, c.text, c.audio_text, c.pron_scan FROM chapters c JOIN documents d ON d.id = c.document_id WHERE c.audio_text IS NOT NULL AND d.language = 'de' ORDER BY c.document_id, c.sort_order, c.number")
    .all() as Array<{ id: string; text: string; audio_text: string; pron_scan: string | null }>;
  return rows.filter((r) => r.pron_scan !== hash(r.audio_text));
}

// Kandidaten sammeln, von Gemma bestätigen lassen, als offene Einträge in die Liste; durchgesehene Kapitel merken
export async function collectFromCleanup(limit = 20): Promise<number> {
  const chapters = unscannedChapters().slice(0, limit);
  if (!chapters.length) return 0;
  const known = new Set(pronunciationList().entries.map((e) => e.from.toLowerCase()));
  const pairs = new Map<string, string>();
  for (const ch of chapters) {
    for (const p of respellings(ch.text, ch.audio_text)) {
      if (!known.has(p.from.toLowerCase()) && !pairs.has(p.from)) pairs.set(p.from, p.to);
    }
  }
  let added = 0;
  if (pairs.size) {
    const confirmed = await confirmRespellings([...pairs].map(([from, to]) => ({ from, to })));
    if (confirmed.length) {
      savePronunciation([...pronunciationList().entries, ...confirmed.map((e) => ({ from: e.from, to: e.to }))]);
      added = confirmed.length;
      emitLog("info", "proncheck", `Aus der Bereinigung in die Ausspracheliste (offen): ${confirmed.map((e) => `${e.from} → ${e.to}`).join(", ")}`);
    }
  }
  const mark = db().prepare("UPDATE chapters SET pron_scan = ? WHERE id = ?");
  for (const ch of chapters) mark.run(hash(ch.audio_text), ch.id);
  return added;
}
