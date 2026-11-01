// Gemma lernt nur aus gelösten Befunden, und zwar in die Ausspracheliste (ungeprüft); der Hörbuch-Prompt bleibt
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const asked: string[][] = [];
let reply = [{ from: "Workflow", to: "Wörkflou" }];
const realSuggest = await import("../pronunciationSuggest");
mock.module("../pronunciationSuggest", () => ({
  ...realSuggest,
  suggestFor: async (words: string[]) => {
    asked.push(words);
    return reply;
  },
}));
let list: Array<{ from: string; to: string; checked?: boolean }> = [{ from: "Update", to: "Apdejt", checked: true }];
const realPron = await import("../pronunciation");
mock.module("../pronunciation", () => ({
  ...realPron,
  pronunciationList: () => ({ entries: list, custom: true }),
  savePronunciation: (e: typeof list) => void (list = e),
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
    d.prepare("INSERT INTO pron_issues (id, check_id, document_id, chapter_id, kind, expected, heard, start, end, prob, context) VALUES (?, 'k1', 'd1', 'c1', 'different', 'Workflow,', 'Wörkflo', 1, 2, 0.7, 'der neue Workflow ist')").run(id);
});

const settle = async () => {
  const { learnQueue } = await import("./learn");
  for (let i = 0; i < 500 && (learnQueue().pending || learnQueue().current); i++) await new Promise((r) => setTimeout(r, 10));
};

describe("Gemma lernt aus Befunden", () => {
  test("früher angehängter Prompt-Abschnitt wird entfernt, der Rest bleibt", async () => {
    const { withoutLearnedSection, LEARNED_HEADER } = await import("./learn");
    expect(withoutLearnedSection(`Regel A.\n\n${LEARNED_HEADER.de}\n- alt\n`)).toBe("Regel A.\n");
    expect(withoutLearnedSection("Regel A.\n")).toBe("Regel A.\n");
  });

  test("nur gelöste Befunde; Vorschlag kommt ungeprüft in die Ausspracheliste", async () => {
    const { enqueueLearn } = await import("./learn");
    const { setIssueStatus, getIssue } = await import("./store");
    const { getPrompt, PROMPTS } = await import("../prompts");
    enqueueLearn("i1");
    await settle();
    expect(asked).toHaveLength(0);
    setIssueStatus("i1", "resolved");
    enqueueLearn("i1");
    await settle();
    expect(asked[0]).toEqual(["Workflow"]);
    expect(list).toEqual([{ from: "Update", to: "Apdejt", checked: true }, { from: "Workflow", to: "Wörkflou" }]);
    expect((getIssue("i1") as unknown as { learned: string }).learned).toBe("Workflow → Wörkflou");
    // Hörbuch-Prompt unverändert
    expect(getPrompt("audio-chapter.de")).toBe(PROMPTS["audio-chapter.de"]);
  });

  test("schon von Hand übernommen oder nichts vorgeschlagen", async () => {
    const { enqueueLearn } = await import("./learn");
    const { setIssueStatus, getIssue } = await import("./store");
    asked.length = 0;
    setIssueStatus("i2", "resolved", "Workflow → Wörkflou");
    enqueueLearn("i2");
    await settle();
    expect(asked).toHaveLength(0);
    reply = [];
    setIssueStatus("i3", "resolved");
    enqueueLearn("i3");
    await settle();
    expect((getIssue("i3") as unknown as { learned: string }).learned).toBe("-");
  });
});
