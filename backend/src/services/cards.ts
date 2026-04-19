/**
 * Aufgaben-Extraktion aus Kapiteltext.
 *
 * Erkennt Marker wie "Aufgabe 3:", "Frage 1)", "Exercise 2.", sammelt
 * den Text bis zum nächsten Marker und versucht, zugehörige Lösungen
 * anhand der Nummer zuzuordnen.
 *
 * Zwei Zuordnungs-Modi:
 *  - `extractCards(text)`            — single-chapter, Lösung muss im
 *    selben Kapitel stehen (alte API, für Abwärtskompatibilität).
 *  - `extractCardsFromDoc(chapters)` — doc-weit, zieht Aufgaben aus
 *    content-Kapiteln, nutzt zusätzlich `kind='solutions'`-Kapitel als
 *    Musterlösungs-Pool (typischer Anhang). Matching via Aufgaben-Nummer.
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

// Pattern toleriert Markdown-Bold/Italic-Wrapping: "**Aufgabe 1.1:**",
// "*Frage 3*" etc. Docling liefert Aufgaben-Marker im neueren Output
// häufig als Bold. Plus optional "Selbstüberprüfung", "Übungsaufgabe"
// als Synonyme.
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

/** Single-chapter Extraktion — Lösung muss im selben Text stehen. */
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

/** Doc-weite Extraktion mit Cross-Chapter-Matching.
 *
 *  Ablauf:
 *   1. Aufgaben aus `content`-Kapiteln sammeln. Lösungen werden aus
 *      ALLEN Kapiteln gesammelt — also auch dem Anhang (`solutions`).
 *   2. Erst Nummern-Match (Aufgabe 3.2 → Lösung 3.2), dann ungenutzte
 *      Lösungen in Doc-Reihenfolge auf noch unmatchte Aufgaben im
 *      gleichen Kapitel zurückfallen lassen (konservativ — kein
 *      Cross-Chapter-Fallback ohne Nummer, das wäre Raten).
 *   3. Unmatchte Aufgaben kommen als `unmatched` zurück, damit Stage B
 *      (RAG-LLM) sie behandeln kann.
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
    order: number; // stable Reihenfolge für Fallback
  }

  const tasks: TaskEntry[] = [];
  const solutions: SolutionEntry[] = [];
  let solOrder = 0;

  for (const ch of chapters) {
    const kind = ch.kind || "content";
    const blocks = scanMarkers(ch.text);
    if (blocks.length === 0) continue;

    // Aus solutions-Kapiteln ziehen wir nur Lösungen, keine Aufgaben.
    // Der Anhang listet häufig nochmal alle Aufgaben-Überschriften
    // ("Aufgabe 3.1") als Struktur-Marker, aber inhaltlich sind das
    // Lösungen — sonst würden wir Doppelt-Karten mit leerer Antwort
    // erzeugen.
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

    // Im solutions-Anhang wird oft jeder "Aufgabe X.Y"-Marker als task
    // geparst, weil Docling ihn als Überschrift liefert. Wir kippen das
    // hier noch einmal um und interpretieren diese "Pseudo-Tasks" als
    // nummerierte Solution-Marker — sonst haben wir eine
    // "Aufgabe 3.1"-Aufgabe im Anhang ohne Lösung.
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
      // Bevorzuge Lösung mit derselben Nummer aus einem solutions-
      // Kapitel, dann aus irgendeinem Kapitel.
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
      // Kein Nummer-Match → im gleichen Kapitel nach der nächsten
      // freien Lösung in Doc-Reihenfolge schauen. Kein Cross-Chapter-
      // Fallback ohne Nummer — das wäre raten und die Zuordnung würde
      // auseinanderdriften, sobald ein einzelner Marker fehlt.
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
