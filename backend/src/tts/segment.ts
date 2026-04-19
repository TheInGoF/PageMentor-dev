/**
 * Text-Segmentierung für TTS.
 *
 * Wir schneiden den Kapiteltext in Chunks von max ~1500 Zeichen —
 * bevorzugt an Absatz-, sekundär an Satzgrenzen. 1500 ist ein Kompromiss
 * für Qwen3-TTS:
 *   - kurz genug, um einen hängenden Chunk schnell zu bemerken (~2-3 min
 *     auf der 3090 statt 4-6 min bei 2500-Zeichen-Chunks)
 *   - groß genug, dass die Qwen-Prosodie kohärent bleibt (bei zu kurzen
 *     Chunks wird das Tempo weniger stabil; siehe Intro-"überhastet"-
 *     Symptom)
 *   - Cache-Granularität: ein fehlgeschlagener Chunk bedeutet kleineren
 *     Retry-Verlust.
 *
 * Override per ENV `PM_TTS_MAX_CHUNK` — akzeptiert 500-5000.
 */

const MAX_CHUNK = (() => {
  const raw = parseInt(process.env.PM_TTS_MAX_CHUNK ?? "", 10);
  if (!Number.isFinite(raw) || raw < 500 || raw > 5000) return 1500;
  return raw;
})();

export interface Segment {
  /** Absätze innerhalb dieses Segments (mit Satz-Trennungen) */
  paragraphs: string[];
}

export function segmentText(text: string): Segment[] {
  const paragraphs = splitParagraphs(text);
  const segments: Segment[] = [];
  let buf: string[] = [];
  let size = 0;

  for (const p of paragraphs) {
    // Ein einzelner Absatz ist zu lang → hart an Satzgrenzen splitten
    if (p.length > MAX_CHUNK) {
      if (buf.length) {
        segments.push({ paragraphs: buf });
        buf = [];
        size = 0;
      }
      for (const sub of splitLongParagraph(p, MAX_CHUNK)) {
        segments.push({ paragraphs: [sub] });
      }
      continue;
    }

    if (size + p.length + 2 > MAX_CHUNK && buf.length) {
      segments.push({ paragraphs: buf });
      buf = [];
      size = 0;
    }
    buf.push(p);
    size += p.length + 2;
  }

  if (buf.length) segments.push({ paragraphs: buf });
  return segments;
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function splitLongParagraph(p: string, max: number): string[] {
  const sentences = p.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [p];
  const out: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if ((buf + s).length > max && buf) {
      out.push(buf.trim());
      buf = "";
    }
    if (s.length > max) {
      // Satz selbst zu lang (unwahrscheinlich bei normalen Texten): harter Cut.
      for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max).trim());
    } else {
      buf += s;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
