import type { Segment } from "./segment";

/**
 * Baut vollständiges SSML für einen Chunk. MsEdgeTTS.rawToStream nimmt
 * das SSML 1:1 entgegen, ohne zu wrappen. Wir nutzen <break>-Tags, um
 * natürliche Pausen zwischen Absätzen und am Kapitelanfang zu erzeugen.
 *
 * Pausen-Strategie (laut PLAN.md):
 *   - 300ms zwischen Sätzen (wird von Azure automatisch gesetzt, kein Tag nötig)
 *   - 600ms zwischen Absätzen
 *   - 1200ms vor Kapitelansage
 *   - 2500ms zwischen Kapiteln (nur relevant beim späteren M4B-Concat)
 */

export interface BuildOptions {
  voice: string;
  locale: string;
  rate?: string;   // e.g. "+0%", "-10%", "+15%"
  pitch?: string;  // e.g. "+0Hz"
  /** Optional kapitelansage, wird als erstes mit break gesprochen */
  announce?: string;
}

export function buildSsml(segment: Segment, opts: BuildOptions): string {
  // Minimal-SSML für Edge: nur <speak>+<voice>+Text.
  //
  // Frühere Versionen hatten <prosody rate/pitch>, <break>-Tags und
  // <emphasis> im Template — Azure rejectet das dann für die
  // Multilingual-Voices silent mit 0 Bytes, während Preview (kurzer
  // Plain-Text) durchging. Das hier ist die Form, die msedge-tts
  // intern auch für `toStream()` baut. Der Server akzeptiert sie
  // zuverlässig.
  //
  // Nebenwirkung: Rate-/Pitch-Kontrolle fällt weg (müsste als
  // msedge-tts-Option übergeben werden, nicht per SSML). Pausen
  // zwischen Absätzen ergeben sich aus Satzzeichen + Leerzeilen.
  void opts.rate;
  void opts.pitch;

  // Multilingual-Voices (z. B. de-DE-SeraphinaMultilingualNeural) machen
  // ihre eigene per-Phrase-Spracherkennung und ignorieren das
  // Top-Level xml:lang im <speak>. Ergebnis: deutsche Lehnwörter wie
  // "Vorwort" oder "Zusammenfassung" werden englisch ausgesprochen
  // ("worword", "zissemenfassing"), weil die Voice das Wort isoliert
  // klassifiziert. Das Azure-Override-Element dafür ist <lang> auf der
  // <voice>-Ebene — damit zwingen wir die Sprache pro Block fest.
  // Eine zweite, getrennte <lang>-Hülle um die Ansage hilft zusätzlich
  // weil Edge sonst nach dem Doppelpunkt erneut detektiert.
  const parts: string[] = [];
  if (opts.announce) {
    parts.push(`<lang xml:lang="${opts.locale}">${escapeXml(opts.announce)}.</lang>`);
  }
  const body = segment.paragraphs.map(escapeXml).join("\n\n");
  parts.push(`<lang xml:lang="${opts.locale}">${body}</lang>`);

  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${opts.locale}"><voice name="${opts.voice}">${parts.join("\n\n")}</voice></speak>`;
}

export function escapeXml(s: string): string {
  return s
    // XML-1.0-invalide Steuerzeichen safety-net — eigentlich schon in
    // cleanForReading() entfernt, aber falls ein Editor-Pfad drumherum
    // führt (Kapitel manuell gepatcht), fangen wir es hier nochmal.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
