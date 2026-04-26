/**
 * Paragraph-aware chunker for RAG.
 *
 * Input: an array of chapter-like sections.
 * Output: chunks of ~targetTokens size with overlapTokens overlap
 * from the previous chunk in the same section.
 *
 * Deliberately simple: token estimation via `chars / 4` (rough rule
 * of thumb for German prose). That's enough for chunk size control;
 * precise adherence would need a real tokenizer.
 *
 * Cut boundaries:
 *   1. Never cut in the middle of a paragraph (split on `\n\n+`).
 *   2. Never build a chunk across section boundaries.
 *   3. Single paragraphs larger than the chunk target are hard-split
 *      at the character limit (rare edge case).
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
  chunk_index: number;  // global, 0-based across all sections
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
      // Overlap: keep the last paragraph if it fits, otherwise start
      // the next chunk empty.
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
      // Paragraph so big it exceeds the limit on its own → hard cut
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
