/**
 * Exercise extraction from chapter text.
 *
 * Detects markers like "Aufgabe 3:", "Frage 1)", "Exercise 2.",
 * collects the text up to the next marker and tries to match
 * corresponding solutions by number.
 *
 * Two matching modes:
 *  - `extractCards(text)`            — single chapter; solution must
 *    sit in the same chapter (old API, kept for backward compat).
 *  - `extractCardsFromDoc(chapters)` — doc-wide; pulls exercises from
 *    content chapters and additionally uses `kind='solutions'`
 *    chapters as the solution pool (typical appendix). Matched by
 *    exercise number.
 */

export interface ExtractedCard {
  question: string;
  answer: string;
  difficulty?: "easy" | "medium" | "hard";
}

export interface ExtractedCardWithSource extends ExtractedCard {
  chapterId: string;
  sourcePage: number;
}

export interface UnmatchedTask {
  question: string;
  chapterId: string;
  sourcePage: number;
}

interface ChapterInput {
  id: string;
  kind?: string | null;
  number: number;
  text: string;
  start_page: number;
}

// Pattern tolerates Markdown bold/italic wrapping: "**Aufgabe 1.1:**",
// "*Frage 3*" etc. Docling often emits exercise markers as bold in
// the newer output. Plus optional "Selbstüberprüfung",
// "Übungsaufgabe" as synonyms.
const TASK_RE =
  /(?:^|\n)\s*[*_]{0,2}\s*(?:Aufgabe|Übung|Übungsaufgabe|Selbstüberprüfung|Selbsttest|Exercise|Problem|Frage|Question)\s+(\d+(?:\.\d+)?)\s*[:.)\-–]?\s*[*_]{0,2}\s*/gi;
const SOL_RE =
  /(?:^|\n)\s*[*_]{0,2}\s*(?:Lösung|Lösungen|Musterlösung|Solution|Answer)(?:\s+(?:zu\s+)?(?:Aufgabe\s+)?(\d+(?:\.\d+)?))?\s*[:.)\-–]?\s*[*_]{0,2}\s*/gi;

interface Marker {
  type: "task" | "solution";
  num?: string;
  start: number;
  end: number;
}

interface Block extends Marker {
  content: string;
}

function scanMarkers(text: string): Block[] {
  if (!text || text.length < 30) return [];
  const markers: Marker[] = [];
  let m: RegExpExecArray | null;

  TASK_RE.lastIndex = 0;
  while ((m = TASK_RE.exec(text)) !== null) {
    markers.push({ type: "task", num: m[1], start: m.index, end: TASK_RE.lastIndex });
  }
  SOL_RE.lastIndex = 0;
  while ((m = SOL_RE.exec(text)) !== null) {
    markers.push({ type: "solution", num: m[1], start: m.index, end: SOL_RE.lastIndex });
  }
  if (markers.length === 0) return [];
  markers.sort((a, b) => a.start - b.start);

  return markers.map((mk, idx) => {
    const next = markers[idx + 1];
    const content = text.slice(mk.end, next ? next.start : text.length).trim();
    return { ...mk, content };
  });
}

/** Single-chapter extraction — solution must be in the same text. */
export function extractCards(text: string): ExtractedCard[] {
  const blocks = scanMarkers(text);
  if (blocks.length === 0) return [];

  const tasks = blocks.filter((b) => b.type === "task");
  const solutions = blocks.filter((b) => b.type === "solution");
  const used = new Set<number>();

  const out: ExtractedCard[] = [];
  for (const task of tasks) {
    if (!task.content || task.content.length < 8) continue;

    let sol: Block | undefined;
    if (task.num) {
      const idx = solutions.findIndex(
        (s, i) => !used.has(i) && s.num === task.num
      );
      if (idx !== -1) {
        sol = solutions[idx];
        used.add(idx);
      }
    }
    if (!sol) {
      const idx = solutions.findIndex((_, i) => !used.has(i));
      if (idx !== -1) {
        sol = solutions[idx];
        used.add(idx);
      }
    }

    out.push({
      question: task.content.replace(/\s+/g, " ").trim(),
      answer: sol?.content?.replace(/\s+/g, " ").trim() ?? "",
    });
  }

  return out;
}

/** Doc-wide extraction with cross-chapter matching.
 *
 *  Flow:
 *   1. Collect exercises from `content` chapters. Solutions are
 *      collected from ALL chapters — including the appendix
 *      (`solutions`).
 *   2. Number match first (Aufgabe 3.2 → Lösung 3.2), then fall back
 *      to unused solutions in doc order against still-unmatched
 *      exercises in the same chapter (conservative — no cross-chapter
 *      fallback without a number, that would be guessing).
 *   3. Unmatched exercises are returned as `unmatched` so stage B
 *      (RAG+LLM) can handle them.
 */
export function extractCardsFromDoc(chapters: ChapterInput[]): {
  cards: ExtractedCardWithSource[];
  unmatched: UnmatchedTask[];
} {
  interface TaskEntry {
    chapterId: string;
    sourcePage: number;
    num?: string;
    content: string;
  }
  interface SolutionEntry {
    chapterId: string;
    num?: string;
    content: string;
    order: number; // stable order for fallback
  }

  const tasks: TaskEntry[] = [];
  const solutions: SolutionEntry[] = [];
  let solOrder = 0;

  for (const ch of chapters) {
    const kind = ch.kind || "content";
    const blocks = scanMarkers(ch.text);
    if (blocks.length === 0) continue;

    // From solutions chapters we pull only solutions, no exercises.
    // The appendix often lists all exercise headings ("Aufgabe 3.1")
    // as structure markers, but content-wise those are solutions —
    // otherwise we'd produce duplicate cards with empty answers.
    const takeTasks = kind !== "solutions";

    for (const b of blocks) {
      if (b.type === "task" && takeTasks) {
        if (!b.content || b.content.length < 8) continue;
        tasks.push({
          chapterId: ch.id,
          sourcePage: ch.start_page,
          num: b.num,
          content: b.content.replace(/\s+/g, " ").trim(),
        });
      } else if (b.type === "solution") {
        if (!b.content || b.content.length < 4) continue;
        solutions.push({
          chapterId: ch.id,
          num: b.num,
          content: b.content.replace(/\s+/g, " ").trim(),
          order: solOrder++,
        });
      }
    }

    // In the solutions appendix every "Aufgabe X.Y" marker is often
    // parsed as a task because Docling emits it as a heading. We
    // flip that here and interpret these "pseudo-tasks" as numbered
    // solution markers — otherwise we'd have an "Aufgabe 3.1"
    // exercise in the appendix without a solution.
    if (kind === "solutions") {
      for (const b of blocks) {
        if (b.type === "task" && b.num && b.content && b.content.length >= 4) {
          solutions.push({
            chapterId: ch.id,
            num: b.num,
            content: b.content.replace(/\s+/g, " ").trim(),
            order: solOrder++,
          });
        }
      }
    }
  }

  const used = new Set<number>();
  const cards: ExtractedCardWithSource[] = [];
  const unmatched: UnmatchedTask[] = [];

  for (const task of tasks) {
    let sol: SolutionEntry | undefined;

    if (task.num) {
      // Prefer solution with the same number from a solutions
      // chapter, then from any chapter.
      const inAppendix = solutions.findIndex(
        (s, i) =>
          !used.has(i) &&
          s.num === task.num &&
          chapters.find((ch) => ch.id === s.chapterId)?.kind === "solutions"
      );
      if (inAppendix !== -1) {
        sol = solutions[inAppendix];
        used.add(inAppendix);
      } else {
        const anywhere = solutions.findIndex(
          (s, i) => !used.has(i) && s.num === task.num
        );
        if (anywhere !== -1) {
          sol = solutions[anywhere];
          used.add(anywhere);
        }
      }
    }

    if (!sol) {
      // No number match → look in the same chapter for the next free
      // solution in doc order. No cross-chapter fallback without a
      // number — that would be guessing, and the mapping would drift
      // apart as soon as a single marker is missing.
      const sameChapter = solutions.findIndex(
        (s, i) => !used.has(i) && !s.num && s.chapterId === task.chapterId
      );
      if (sameChapter !== -1) {
        sol = solutions[sameChapter];
        used.add(sameChapter);
      }
    }

    if (sol) {
      cards.push({
        question: task.content,
        answer: sol.content,
        chapterId: task.chapterId,
        sourcePage: task.sourcePage,
      });
    } else {
      cards.push({
        question: task.content,
        answer: "",
        chapterId: task.chapterId,
        sourcePage: task.sourcePage,
      });
      unmatched.push({
        question: task.content,
        chapterId: task.chapterId,
        sourcePage: task.sourcePage,
      });
    }
  }

  return { cards, unmatched };
}
