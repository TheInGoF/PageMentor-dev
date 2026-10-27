import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { markdownSections } from "./markdown";

const TMP = mkdtempSync(join(tmpdir(), "pm-batch-"));
type Mods = { db: typeof import("../../db"); q: typeof import("./queue") };
let x: Mods;

beforeAll(async () => {
  x = { db: await import("../../db"), q: await import("./queue") };
  x.db.useDatabaseFile(join(TMP, "t.db"));
  x.db.initDb();
  mkdirSync(join(TMP, "in", "unter"), { recursive: true });
  mkdirSync(join(TMP, "md"), { recursive: true });
  writeFileSync(join(TMP, "in", "heft1.pdf"), "%PDF-1 eins");
  writeFileSync(join(TMP, "in", "unter", "heft2.pdf"), "%PDF-1 zwei");
  writeFileSync(join(TMP, "in", "notiz.txt"), "x");
  writeFileSync(join(TMP, "md", "HEFT1.md"), "# 1 Grundlagen\ntext");
});

describe("markdownSections", () => {
  test("nummerierte Hauptkapitel, Seiten aus Umbrüchen, Verzeichnisse erkannt", () => {
    const md = "Titelseite\n# Inhaltsverzeichnis\n1 ... 2\n<!-- page_break -->\n# 1 Grundlagen\nA\n## 1.1 Teil\nB\n<!-- page_break -->\n# 2 Anwendung\nC\n# 3 Vertiefung\nD\n<!-- page_break -->\n# Literatur\nE";
    const s = markdownSections(md, 4);
    expect(s.map((x) => [x.title, x.kind, x.startPage])).toEqual([
      ["Inhaltsverzeichnis", "index", 1],
      ["1 Grundlagen", "content", 2],
      ["2 Anwendung", "content", 3],
      ["3 Vertiefung", "content", 3],
      ["Literatur", "references", 4],
    ]);
    expect(s[0].text).toContain("Titelseite");
    expect(s[1].text).toContain("1.1 Teil");
    expect(s.some((x) => x.text.includes("page_break"))).toBe(false);
  });
  test("ohne Überschriften ein Kapitel", () => {
    expect(markdownSections("nur Text", 3)).toEqual([{ number: 1, title: "Dokument", startPage: 1, endPage: 3, text: "nur Text", kind: "content" }]);
  });
});

describe("Warteschlange", () => {
  test("Ordner rekursiv, Markdown per Dateiname, keine Dubletten", () => {
    expect(x.q.enqueueFolder(join(TMP, "in"), { mdFolder: join(TMP, "md"), docType: "literatur" })).toEqual({ added: 2, skipped: 0, withMarkdown: 1 });
    expect(x.q.enqueueFolder(join(TMP, "in")).added).toBe(0);
    expect(x.q.queueStatus()).toMatchObject({ waiting: 2, done: 0 });
  });
  test("Verarbeitung nacheinander, Fehler werden gemeldet, Restzeit aus Mittelwert", async () => {
    let n = 0;
    const proc = async (id: string) => {
      n++;
      x.db.db().prepare("UPDATE documents SET ocr_status = ? WHERE id = ?").run(n === 1 ? "done" : "failed", id);
    };
    await x.q.runQueue(proc, 10, join(TMP, "daten"));
    const s = x.q.queueStatus();
    expect(s).toMatchObject({ waiting: 0, done: 1, failed: 1 });
    expect(s.failures[0].error).toContain("failed");
    const doc = x.db.db().prepare("SELECT type, source_md FROM documents WHERE filename = 'heft1.pdf'").get() as any;
    expect(doc.type).toBe("literatur");
    expect(doc.source_md).toContain("HEFT1.md");
    expect(x.q.retryFailed()).toBe(1);
  });
  test("Pause hält an, Nachtzeit", async () => {
    x.q.setQueueFlags({ paused: true });
    expect(await Promise.race([x.q.runQueue(async () => {}, 10_000, join(TMP, "daten")).then(() => "fertig"), new Promise((r) => setTimeout(() => r("wartet"), 50))])).toBe("wartet");
    x.q.setQueueFlags({ paused: false });
    expect(x.q.isNight(new Date(2030, 0, 1, 23))).toBe(true);
    expect(x.q.isNight(new Date(2030, 0, 1, 12))).toBe(false);
  });
});
