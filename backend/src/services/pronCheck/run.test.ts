// Ausspracheprüfung von Anfang bis Ende: Whisper simuliert, Befunde landen in der Datenbank, Status lässt sich setzen
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const dir = mkdtempSync(join(tmpdir(), "pm-pron-"));
mock.module("./stt", () => ({
  sttAvailable: () => true,
  transcribe: async () => ({
    duration: 5,
    words: "Kapitel: Abläufe. Der neue Wörkflo ist schnell.".split(" ").map((w, i) => ({ word: w, start: i, end: i + 0.8, prob: 0.9 })),
  }),
}));

beforeAll(async () => {
  const dbm = await import("../../db");
  dbm.useDatabaseFile(join(dir, "t.db"));
  dbm.initDb();
  const d = dbm.db();
  d.prepare("INSERT INTO documents (id, title, filename, stored_path, language) VALUES ('d1', 'Heft', 'a.pdf', '', 'de')").run();
  d.prepare("INSERT INTO chapters (id, document_id, number, title, kind, text) VALUES ('c1', 'd1', 1, 'Abläufe', 'content', 'Der neue Workflow ist schnell.')").run();
  writeFileSync(join(dir, "c1.mp3"), "x");
  d.prepare("INSERT INTO audio (id, chapter_id, stored_path, status) VALUES ('a1', 'c1', ?, 'done')").run(join(dir, "c1.mp3"));
});

describe("Ausspracheprüfung: Lauf", () => {
  test("Soll-Text mit Kapitelansage, ohne Sprachmarken", async () => {
    const { expectedText } = await import("./run");
    expect(expectedText({ number: 2, title: "Wege", text: "Hola [es]amigo[/es].", audio_text: null }, "de")).toBe("Kapitel: Wege. Hola  amigo .");
    expect(expectedText({ number: 3, title: null, text: "x", audio_text: "y" }, "en")).toBe("Chapter 3. y");
  });

  test("Befund wird gespeichert, gelöst bleibt beim nächsten Lauf weg", async () => {
    const { startPronCheck, pronRunState } = await import("./run");
    const { listIssues, setIssueStatus } = await import("./store");
    startPronCheck("d1", ["c1"]);
    for (let i = 0; i < 50 && pronRunState()?.running; i++) await new Promise((r) => setTimeout(r, 20));
    const issues = listIssues("d1");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "different", expected: "Workflow", heard: "Wörkflo", status: "open", chapter_title: "Abläufe" });
    setIssueStatus(issues[0].id, "resolved", "Workflow → Wörkflou");
    startPronCheck("d1", ["c1"]);
    for (let i = 0; i < 50 && pronRunState()?.running; i++) await new Promise((r) => setTimeout(r, 20));
    const after = listIssues("d1");
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ status: "resolved", note: "Workflow → Wörkflou" });
  });
});
