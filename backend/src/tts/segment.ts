/**
 * Text-Segmentierung für TTS.
 *
 * Die Azure-WebSocket-API hat einen harten Längen- und Laufzeit-Limit
 * pro SSML-Request. Wir schneiden daher den Kapiteltext in Chunks von
 * max ~2500 Zeichen — bevorzugt an Absatz-, sekundär an Satzgrenzen.
 *
 * Die Segmente behalten Absatz-Struktur: ein Segment kann mehrere Absätze
 * enthalten, die beim SSML-Build mit <break/> getrennt werden.
 */

const MAX_CHUNK = 2500;

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
