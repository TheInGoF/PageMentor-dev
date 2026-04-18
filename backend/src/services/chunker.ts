/**
 * Paragraph-aware Chunker für RAG.
 *
 * Input: ein Array von Kapitel-ähnlichen Sektionen.
 * Output: Chunks von ~targetTokens Größe mit overlapTokens Overlap
 * zum vorigen Chunk derselben Section.
 *
 * Bewusst einfach: Token-Schätzung via `chars / 4` (grobe Daumenregel
 * für deutsche Fließtexte). Das reicht für Chunk-Größen-Steuerung;
 * für präzise Einhaltung bräuchte es einen echten Tokenizer.
 *
 * Grenzen beim Schneiden:
 *   1. Nie mitten in einem Absatz schneiden (split auf `\n\n+`).
 *   2. Nie über Section-Grenzen hinweg einen Chunk bauen.
 *   3. Einzelne Absätze die größer als das Chunk-Target sind, werden
 *      hart am Zeichen-Limit zerlegt (seltener Extrem-Fall).
 */

const CHARS_PER_TOKEN = 4;

export interface ChunkSource {
  id: string;           // chapter id
  number: number;
  title: string;
  text: string;
  start_page: number;
  end_page: number;
  kind?: string;
}

export interface Chunk {
  text: string;
  chapter_id: string;
  chapter_number: number;
  chapter_title: string;
  chapter_kind?: string;
  start_page: number;
  end_page: number;
  chunk_index: number;  // global, 0-basiert über alle Sektionen
}

export interface ChunkOptions {
  targetTokens?: number;
  overlapTokens?: number;
}

export function chunkChapters(
  chapters: ChunkSource[],
  opts: ChunkOptions = {}
): Chunk[] {
  const targetChars = (opts.targetTokens ?? 800) * CHARS_PER_TOKEN;
  const overlapChars = (opts.overlapTokens ?? 100) * CHARS_PER_TOKEN;

  const out: Chunk[] = [];
  let globalIdx = 0;

  for (const chapter of chapters) {
    const paragraphs = chapter.text
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter(Boolean);

    let buf: string[] = [];
    let bufSize = 0;

    const emit = () => {
      if (buf.length === 0) return;
      out.push({
        text: buf.join("\n\n"),
        chapter_id: chapter.id,
        chapter_number: chapter.number,
        chapter_title: chapter.title,
        chapter_kind: chapter.kind,
        start_page: chapter.start_page,
        end_page: chapter.end_page,
        chunk_index: globalIdx++,
      });
      // Overlap: letzten Absatz behalten wenn er reinpasst, sonst
      // wir starten den nächsten Chunk leer.
      const tail = buf[buf.length - 1];
      if (overlapChars > 0 && tail && tail.length <= overlapChars && buf.length > 1) {
        buf = [tail];
        bufSize = tail.length;
      } else {
        buf = [];
        bufSize = 0;
      }
    };

    for (const p of paragraphs) {
      // Absatz so groß, dass er allein das Limit sprengt → harter Cut
      if (p.length > targetChars) {
        if (buf.length > 0) emit();
        for (let i = 0; i < p.length; i += targetChars) {
          out.push({
            text: p.slice(i, i + targetChars),
            chapter_id: chapter.id,
            chapter_number: chapter.number,
            chapter_title: chapter.title,
            chapter_kind: chapter.kind,
            start_page: chapter.start_page,
            end_page: chapter.end_page,
            chunk_index: globalIdx++,
          });
        }
        buf = [];
        bufSize = 0;
        continue;
      }

      if (bufSize + p.length + 2 > targetChars && buf.length > 0) {
        emit();
      }
      buf.push(p);
      bufSize += p.length + 2;
    }

    if (buf.length > 0) emit();
    buf = [];
    bufSize = 0;
  }

  return out;
}
