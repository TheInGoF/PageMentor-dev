// Gemma lernt nur aus gelösten Befunden und hängt nur an: der Prompt verliert nie Text
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let reply = '{"neu": true, "regel": "Englische Fachbegriffe in deutscher Lautschrift schreiben, z. B. Workflow → Wörkflou."}';
const calls: string[] = [];
const llm = await import("../llm");
mock.module("../llm", () => ({
  ...llm,
  generate: async (p: { prompt: string }) => {
    calls.push(p.prompt);
    return { response: reply, doneReason: "stop" };
  },
}));
const extras = await import("../../engine/llmExtras");
mock.module("../../engine/llmExtras", () => ({ ...extras, installedModels: async () => ["gemma4:e4b"], isInstalled: () => false }));
// Prompts nur im Speicher: der Test schreibt nie in einen echten Datenordner
const realPrompts = await import("../prompts");
const store = new Map<string, string>();
mock.module("../prompts", () => ({
  ...realPrompts,
  getPrompt: (id: keyof typeof realPrompts.PROMPTS) => store.get(id) ?? realPrompts.PROMPTS[id],
  savePrompt: (id: string, text: string) => void store.set(id, text),
}));

const dir = mkdtempSync(join(tmpdir(), "pm-pronlearn-"));

beforeAll(async () => {
  const dbm = await import("../../db");
  dbm.useDatabaseFile(join(dir, "t.db"));
  dbm.initDb();
  const d = dbm.db();
  d.prepare("INSERT INTO documents (id, title, filename, stored_path, language) VALUES ('d1', 'Heft', 'a.pdf', '', 'de')").run();
  d.prepare("INSERT INTO chapters (id, document_id, number, title, kind, text) VALUES ('c1', 'd1', 1, 'A', 'content', 'x')").run();
  d.prepare("INSERT INTO pron_checks (id, document_id, chapter_id, created_at) VALUES ('k1', 'd1', 'c1', 1)").run();
  for (const id of ["i1", "i2", "i3"])
    d.prepare("INSERT INTO pron_issues (id, check_id, document_id, chapter_id, kind, expected, heard, start, end, prob, context) VALUES (?, 'k1', 'd1', 'c1', 'different', 'Workflow', 'Wörkflo', 1, 2, 0.7, 'der neue Workflow ist')").run(id);
});

const settle = async () => {
  const { learnQueue } = await import("./learn");
  for (let i = 0; i < 100 && (learnQueue().pending || learnQueue().current); i++) await new Promise((r) => setTimeout(r, 10));
};

describe("Gemma lernt aus Befunden", () => {
  test("anhängen: alter Text bleibt, Überschrift einmal, keine Dubletten", async () => {
    const { appendRule, learnedRules, LEARNED_HEADER } = await import("./learn");
    const base = "Regel A.\n\nRegel B.";
    const one = appendRule(base, "Abkürzungen wie z. B. ausschreiben.", "de");
    expect(one.startsWith(base)).toBe(true);
    const two = appendRule(one, "Zahlen mit Einheit ausschreiben, z. B. 5 km → fünf Kilometer.", "de");
    expect(two.startsWith(one.trimEnd())).toBe(true);
    expect(two.split(LEARNED_HEADER.de).length).toBe(2);
    expect(appendRule(two, "abkürzungen wie z.b. ausschreiben", "de")).toBe(two);
    expect(learnedRules(two, "de")).toHaveLength(2);
    expect(appendRule(two, "zu kurz", "de")).toBe(two);
  });

  test("nur gelöste Befunde, Regel landet im Hörbuch-Prompt", async () => {
    const { enqueueLearn } = await import("./learn");
    const { setIssueStatus, getIssue } = await import("./store");
    const { getPrompt, PROMPTS } = await import("../prompts");
    // offen: Gemma wird nicht gefragt
    enqueueLearn("i1");
    await settle();
    expect(calls).toHaveLength(0);
    setIssueStatus("i1", "resolved", "Workflow → Wörkflou");
    enqueueLearn("i1");
    await settle();
    expect(calls[0]).toContain("Lösung des Nutzers: Workflow → Wörkflou");
    const text = getPrompt("audio-chapter.de");
    expect(text.startsWith(PROMPTS["audio-chapter.de"].trimEnd())).toBe(true);
    expect(text).toContain("- Englische Fachbegriffe in deutscher Lautschrift");
    expect((getIssue("i1") as unknown as { learned: string }).learned).toContain("Englische Fachbegriffe");
  });

  test("nichts Neues: Prompt bleibt, Befund vermerkt", async () => {
    const { enqueueLearn } = await import("./learn");
    const { setIssueStatus, getIssue } = await import("./store");
    const { getPrompt } = await import("../prompts");
    const before = getPrompt("audio-chapter.de");
    reply = '{"neu": false, "regel": ""}';
    setIssueStatus("i2", "resolved");
    enqueueLearn("i2");
    await settle();
    expect(getPrompt("audio-chapter.de")).toBe(before);
    expect((getIssue("i2") as unknown as { learned: string }).learned).toBe("-");
  });
});
