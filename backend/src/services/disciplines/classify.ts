// Qwen ordnet Module einer Wissenschaft zu (Liste in taxonomy.ts). Läuft in der Wissenspflege für jedes Modul ohne
// Wissenschaft, also auch für neue. Von Hand gesetzte Wissenschaften fasst es nicht an; die Farbe folgt der
// Wissenschaft, außer der Nutzer hat eine eigene Farbe gewählt
import { db } from "../../db";
import { emitLog } from "../../log/logger";
import { generate } from "../llm";
import { withGemmaLock } from "../gemmaLock";
import { EXTRA_LLMS } from "../../engine/config";
import { installedModels, isInstalled } from "../../engine/llmExtras";
import { DISCIPLINES, FAMILIES, disciplineColor, isDiscipline } from "./taxonomy";

const PREFS = ["qwen3.6:27b", "gemma4:26b"];

export interface OpenModule {
  id: string;
  name: string;
  code: string | null;
  area: string | null;
  description: string | null;
}

export function openModules(): OpenModule[] {
  return db().prepare("SELECT id, name, code, area, description FROM modules WHERE discipline IS NULL ORDER BY study_semester, name").all() as OpenModule[];
}

// Wissenschaft setzen; Farbe mitziehen, solange sie nicht eigens gewählt ist
export function setDiscipline(moduleId: string, discipline: string | null, by: "ai" | "user" | null): void {
  const d = db();
  d.prepare("UPDATE modules SET discipline = ?, discipline_by = ? WHERE id = ?").run(discipline, discipline ? by : null, moduleId);
  const color = disciplineColor(discipline);
  if (color) d.prepare("UPDATE modules SET color = ? WHERE id = ? AND color_custom = 0").run(color, moduleId);
}

// Liste für die Anweisung, nach Familien
export function disciplineList(): string {
  return FAMILIES.map(
    (f) => `${f.name}:\n${DISCIPLINES.filter((d) => d.family === f.id).map((d) => `  ${d.id} = ${d.name} (z. B. ${d.hint})`).join("\n")}`
  ).join("\n");
}

const SYSTEM = `Du ordnest Studienmodule und Bücher einer Wissenschaft zu. Wähle genau eine ID aus dieser Liste:

${disciplineList()}

Regeln:
- Entscheidend ist der fachliche Inhalt, nicht der Studienbereich oder ob es Pflicht oder Wahlpflicht ist.
- Ein Labor gehört zum Fach, das es übt (Labor Steuerungstechnik → Steuerungs- und Automatisierungstechnik).
- Laboreingangsprüfungen und Teilmodule („Informatik Modul 3“, „Systeme 2“) gehören zu ihrem Fach.
- Romane und Erzählungen sind Belletristik.
- Nur wenn wirklich nichts passt: other.
Antworte nur mit JSON.`;

const SCHEMA = {
  type: "object",
  properties: { fach: { type: "string", enum: DISCIPLINES.map((d) => d.id) } },
  required: ["fach"],
};

async function model(): Promise<string | undefined> {
  const installed = (await installedModels()) ?? [];
  return PREFS.find((m) => m in EXTRA_LLMS && isInstalled(installed, m));
}

export function parseDiscipline(raw: string): string | null {
  try {
    const start = raw.indexOf("{");
    const fach = (JSON.parse(start >= 0 ? raw.slice(start, raw.lastIndexOf("}") + 1) : raw) as { fach?: unknown }).fach;
    return isDiscipline(fach) ? fach : null;
  } catch {
    return null;
  }
}

// Ein Modul einordnen; null, wenn das Sprachmodell nichts Brauchbares liefert (bleibt offen für den nächsten Lauf)
export async function classifyModule(m: OpenModule): Promise<string | null> {
  const docs = (db().prepare("SELECT COALESCE(doc_title, title) AS t FROM documents WHERE module_id = ? LIMIT 8").all(m.id) as Array<{ t: string }>).map((r) => r.t);
  const prompt = [
    `Modul: ${m.name}`,
    m.code ? `Kürzel: ${m.code}` : "",
    m.area ? `Studienbereich: ${m.area}` : "",
    m.description ? `Beschreibung: ${m.description.slice(0, 400)}` : "",
    docs.length ? `Hefte darin: ${docs.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const r = await withGemmaLock(`Wissenschaft ${m.name.slice(0, 30)}`, async () =>
    generate({ prompt, system: SYSTEM, model: await model(), format: SCHEMA, think: false, options: { temperature: 0, num_ctx: 4096, num_predict: 60 } })
  );
  const id = parseDiscipline(r.response);
  if (id) {
    // Nur übernehmen, wenn in der Zwischenzeit niemand von Hand gewählt hat
    const cur = db().prepare("SELECT discipline FROM modules WHERE id = ?").get(m.id) as { discipline: string | null } | undefined;
    if (cur && !cur.discipline) setDiscipline(m.id, id, "ai");
    emitLog("info", "maintenance", `Wissenschaft: „${m.name}“ → ${id} (${r.model})`);
  }
  return id;
}
