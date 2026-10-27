// Trainer-Selbsttest (wie 15_trainer_test des Studium Makers): Struktur, Fuzz, Klausur-Vektoren
// Läuft in einem eigenen VM-Kontext ohne Zugriff auf Dateien oder Netz
import { runInNewContext } from "vm";

export interface TrainerCheck {
  ok: boolean;
  generators: number;
  runs: number;
  problems: string[];
}

// Marker kaputter Zahlen; der Gedankenstrich ist normale Prosa
const FORBIDDEN = ["NaN", "undefined", "Infinity"];
export const FUZZ_RUNS = 200;

type Step = { label?: string; warum?: string; body?: string; rechnung?: Array<{ tex?: string; note?: string }>; falle?: string; heft?: unknown };

function stepText(steps: Step[]): string {
  const refs = (h: unknown) => (Array.isArray(h) ? h : h ? [h] : []) as Array<Record<string, string>>;
  return steps
    .map((s) => [s.label, s.warum, s.body, s.falle, ...(s.rechnung ?? []).flatMap((r) => [r.tex, r.note]), ...refs(s.heft).flatMap((h) => [h.heft, h.kap, h.titel, h.gl, h.tex, h.hinweis])].join(" "))
    .join(" ");
}

// Kontrakt v2: jede Rechenzeile mit Notiz; ein Heft-Verweis braucht Heft und Kapitel, sonst läuft der Sprung ins Leere
function contractProblems(steps: Step[]): string[] {
  const out: string[] = [];
  steps.forEach((s, i) => {
    if (!s.label) out.push(`Schritt ${i}: label fehlt`);
    if (!s.rechnung && !s.body) out.push(`Schritt ${i}: weder rechnung noch body`);
    for (const r of s.rechnung ?? []) if (!r.tex || !r.note) out.push(`Schritt ${i}: Zeile ohne tex oder note`);
    const refs = Array.isArray(s.heft) ? s.heft : s.heft ? [s.heft] : [];
    if (refs.some((h: any) => !h?.heft || !h?.kap)) out.push(`Schritt ${i}: Heft-Verweis ohne heft/kap`);
  });
  return out;
}

export function checkTrainer(source: string, globalName: string, colorsName: string | null, runs = FUZZ_RUNS): TrainerCheck {
  const problems: string[] = [];
  const sandbox: Record<string, unknown> = { Math, JSON, console: { log() {}, warn() {}, error() {} } };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  try {
    runInNewContext(source, sandbox, { timeout: 5000 });
  } catch (err) {
    return { ok: false, generators: 0, runs: 0, problems: [`Laden fehlgeschlagen: ${err instanceof Error ? err.message : err}`] };
  }
  const gens = sandbox[globalName] as Array<{ id: string; fn: (p?: unknown) => any; topic?: string; klausur?: Array<{ quelle?: string; params?: unknown; erwartet?: Record<string, number> }> }> | undefined;
  if (!Array.isArray(gens) || !gens.length) return { ok: false, generators: 0, runs: 0, problems: [`${globalName} fehlt oder ist leer`] };
  const colors = colorsName ? (sandbox[colorsName] as Record<string, string> | undefined) : undefined;

  const ids = gens.map((g) => g.id);
  if (new Set(ids).size !== ids.length) problems.push("Doppelte Generator-IDs");
  if (colors) for (const g of gens) if (g.topic && !colors[g.topic]) problems.push(`${g.id}: Thema ${g.topic} ohne Farbe`);

  let total = 0;
  const check = (g: (typeof gens)[number], params: unknown, label: string): any => {
    total++;
    let task: any;
    try {
      task = g.fn(params);
    } catch (err) {
      problems.push(`${g.id} ${label}: Ausnahme ${err instanceof Error ? err.message : err}`);
      return null;
    }
    if (!task?.title || !task?.prompt || !Array.isArray(task.steps) || !task.steps.length) {
      problems.push(`${g.id} ${label}: Struktur kaputt`);
      return null;
    }
    const text = `${task.title} ${task.prompt} ${stepText(task.steps)}`;
    const bad = FORBIDDEN.find((b) => text.includes(b));
    if (bad) problems.push(`${g.id} ${label}: „${bad}“ im Text`);
    return task;
  };

  for (const g of gens) {
    const before = problems.length;
    for (let i = 0; i < runs && problems.length === before; i++) {
      const task = check(g, undefined, `Lauf ${i + 1}`);
      if (task && i === 0) contractProblems(task.steps).slice(0, 3).forEach((p) => problems.push(`${g.id}: ${p}`));
    }
    // Klausur-Vektoren: mit Original-Parametern; „erwartet“ wird gegen _test verglichen
    for (const k of g.klausur ?? []) {
      const task = check(g, k.params, k.quelle ?? "Klausur");
      for (const [key, want] of Object.entries(k.erwartet ?? {})) {
        const got = task?._test?.[key];
        if (typeof got !== "number" || Math.abs(got - want) > Math.max(1e-9, Math.abs(want) * 0.005)) problems.push(`${g.id} ${k.quelle}: ${key} = ${got}, erwartet ${want}`);
      }
    }
  }
  return { ok: problems.length === 0, generators: gens.length, runs: total, problems: problems.slice(0, 50) };
}
