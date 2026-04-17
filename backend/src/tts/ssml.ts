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
  const rate = opts.rate ?? "+0%";
  const pitch = opts.pitch ?? "+0Hz";

  const inner: string[] = [];
  if (opts.announce) {
    // Kapitelansage als normaler Satz — <emphasis> wird von Multilingual-
    // Stimmen (Seraphina/Florian) inkonsistent unterstützt und triggert
    // gerne silent-reject (Server liefert 0 Bytes statt Fehler).
    inner.push(`${escapeXml(opts.announce)}.<break time="1200ms"/>`);
  }
  for (let i = 0; i < segment.paragraphs.length; i++) {
    if (i > 0) inner.push(`<break time="600ms"/>`);
    inner.push(escapeXml(segment.paragraphs[i]));
  }

  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${opts.locale}">
    <voice name="${opts.voice}">
      <prosody rate="${rate}" pitch="${pitch}">
        ${inner.join("")}
      </prosody>
    </voice>
  </speak>`;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
