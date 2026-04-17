/**
 * Aufgaben-Extraktion aus Kapiteltext.
 *
 * Erkennt Marker wie "Aufgabe 3:", "Frage 1)", "Exercise 2.", sammelt
 * den Text bis zum nächsten Marker und versucht, zugehörige Lösungen
 * anhand der Nummer zuzuordnen. Wenn keine Nummer verfügbar ist, wird
 * die nächste Lösung in Leserichtung genommen.
 */

export interface ExtractedCard {
  question: string;
  answer: string;
  difficulty?: "easy" | "medium" | "hard";
}

const TASK_RE =
  /(?:^|\n)\s*(?:Aufgabe|Übung|Exercise|Problem|Frage|Question)\s+(\d+(?:\.\d+)?)\s*[:.)\-–]?\s*/gi;
const SOL_RE =
  /(?:^|\n)\s*(?:Lösung|Lösungen|Musterlösung|Solution|Answer)(?:\s+(?:zu\s+)?(?:Aufgabe\s+)?(\d+(?:\.\d+)?))?\s*[:.)\-–]?\s*/gi;

interface Marker {
  type: "task" | "solution";
  num?: string;
  start: number;
  end: number;
}

export function extractCards(text: string): ExtractedCard[] {
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

  interface Block extends Marker {
    content: string;
  }
  const blocks: Block[] = markers.map((mk, idx) => {
    const next = markers[idx + 1];
    const content = text.slice(mk.end, next ? next.start : text.length).trim();
    return { ...mk, content };
  });

  const tasks = blocks.filter((b) => b.type === "task");
  const solutions = blocks.filter((b) => b.type === "solution");
  const usedSolutions = new Set<number>();

  const out: ExtractedCard[] = [];
  for (const task of tasks) {
    if (!task.content || task.content.length < 8) continue;

    let sol: Block | undefined;
    if (task.num) {
      const solIdx = solutions.findIndex(
        (s, i) => !usedSolutions.has(i) && s.num === task.num
      );
      if (solIdx !== -1) {
        sol = solutions[solIdx];
        usedSolutions.add(solIdx);
      }
    }
    if (!sol) {
      const fallbackIdx = solutions.findIndex((_, i) => !usedSolutions.has(i));
      if (fallbackIdx !== -1) {
        sol = solutions[fallbackIdx];
        usedSolutions.add(fallbackIdx);
      }
    }

    out.push({
      question: task.content.replace(/\s+/g, " ").trim(),
      answer: sol?.content?.replace(/\s+/g, " ").trim() ?? "",
    });
  }

  return out;
}
