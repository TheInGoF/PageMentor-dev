import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "fs";
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
  test("Ordner rekursiv, Markdown per Dateiname, gleiche Datei nur einmal", async () => {
    writeFileSync(join(TMP, "in", "unter", "heft1-kopie.pdf"), "%PDF-1 eins");
    const r = await x.q.enqueueFolder(join(TMP, "in"), { mdFolder: join(TMP, "md"), docType: "literatur" });
    expect(r).toMatchObject({ added: 2, skipped: 0, withMarkdown: 1 });
    expect(r.duplicates.map((d) => d.name)).toEqual(["heft1-kopie.pdf"]);
    expect((await x.q.enqueueFolder(join(TMP, "in"))).added).toBe(0);
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
  test("Import-Ordner: Erledigtes und Dubletten werden weggeräumt, nicht erneut eingelesen", async () => {
    const daten = join(TMP, "daten");
    const imp = join(daten, "Import");
    mkdirSync(join(imp, "Semester"), { recursive: true });
    writeFileSync(join(imp, "Semester", "neu.pdf"), "%PDF-1 neu");
    // gleicher Inhalt wie heft1.pdf, das schon in der Bibliothek ist
    writeFileSync(join(imp, "doppelt.pdf"), "%PDF-1 eins");
    const r = await x.q.scanImportFolder({}, daten, 0);
    expect(r!.added).toBe(1);
    expect(r!.duplicates[0].reason).toContain("heft1");
    expect(existsSync(join(imp, "Dubletten", "doppelt.pdf"))).toBe(true);
    await x.q.runQueue(async (id) => void x.db.db().prepare("UPDATE documents SET ocr_status = 'done' WHERE id = ?").run(id), 10, daten);
    expect(existsSync(join(imp, "Erledigt", "Semester", "neu.pdf"))).toBe(true);
    expect(existsSync(join(imp, "Semester", "neu.pdf"))).toBe(false);
    expect(await x.q.scanImportFolder({}, daten, 0)).toBeNull();
  });
  test("Import-Ordner: frisch kopierte Datei wartet, gleichzeitige Durchläufe werden geteilt", async () => {
    const daten = join(TMP, "daten");
    writeFileSync(join(daten, "Import", "frisch.pdf"), "%PDF-1 frisch");
    const a = x.q.scanImportFolder({}, daten);
    expect(x.q.scanImportFolder({}, daten)).toBe(a);
    expect((await a)!.added).toBe(0);
    expect((await x.q.scanImportFolder({}, daten, 0))!.added).toBe(1);
    expect((await x.q.scanImportFolder({}, daten, 0))!.skipped).toBe(1);
    x.db.db().prepare("DELETE FROM import_queue WHERE path LIKE '%frisch.pdf'").run();
    require("fs").unlinkSync(join(daten, "Import", "frisch.pdf"));
  });
  test("Dublette erst nach der Texterkennung: Dokument wird wieder entfernt", async () => {
    const daten = join(TMP, "daten");
    writeFileSync(join(daten, "Import", "scan.pdf"), "%PDF-1 scan");
    await x.q.scanImportFolder({}, daten, 0);
    const before = (x.db.db().prepare("SELECT COUNT(*) AS n FROM documents").get() as any).n;
    await x.q.runQueue(async (id) => void x.db.db().prepare("UPDATE documents SET ocr_status = 'duplicate', duplicate_of = (SELECT id FROM documents WHERE filename = 'heft1.pdf') WHERE id = ?").run(id), 10, daten);
    expect((x.db.db().prepare("SELECT COUNT(*) AS n FROM documents").get() as any).n).toBe(before);
    expect(x.q.queueStatus().duplicates).toBe(1);
    expect(existsSync(join(daten, "Import", "Dubletten", "scan.pdf"))).toBe(true);
  });
  test("Pause hält an, Nachtzeit", async () => {
    writeFileSync(join(TMP, "in", "heft3.pdf"), "%PDF-1 drei");
    await x.q.enqueueFolder(join(TMP, "in"));
    x.q.setQueueFlags({ paused: true });
    expect(await Promise.race([x.q.runQueue(async () => {}, 10_000, join(TMP, "daten")).then(() => "fertig"), new Promise((r) => setTimeout(() => r("wartet"), 50))])).toBe("wartet");
    x.q.setQueueFlags({ paused: false });
    expect(x.q.isNight(new Date(2030, 0, 1, 23))).toBe(true);
    expect(x.q.isNight(new Date(2030, 0, 1, 12))).toBe(false);
  });
});

describe("Wissensdatenbank-Ordner", () => {
  test("Markdown mit Kopfdaten, Bilder als Dateien, übernommene Bilder mitkopiert, Löschen räumt auf", async () => {
    const kf = await import("./knowledgeFolder");
    const root = join(TMP, "wissen");
    const id = (x.db.db().prepare("SELECT id FROM documents WHERE filename = 'heft1.pdf'").get() as any).id;
    // Studium-Maker-Ablage: md/<stem>.md und assets/<stem>/bild.png
    mkdirSync(join(TMP, "sm", "md"), { recursive: true });
    mkdirSync(join(TMP, "sm", "assets", "HEFT1"), { recursive: true });
    writeFileSync(join(TMP, "sm", "assets", "HEFT1", "alt.png"), "png");
    writeFileSync(join(TMP, "sm", "md", "HEFT1.md"), "x");
    const md = "# 1 Grundlagen\n$$U = R \\cdot I$$\n![Schaltung](bilder/bild_001_abc.png)\n![Alt](C:/temp/irgendwo/alt.png)\n![weg](fehlt.png)";
    const dir = kf.writeKnowledgeFolder(id, md, [{ name: "bild_001_abc.png", data: Buffer.from("neu") }], join(TMP, "sm", "md", "HEFT1.md"), root);
    expect(dir.endsWith(`heft1__${id.slice(0, 8)}`)).toBe(true);
    const text = require("fs").readFileSync(join(dir, "heft1.md"), "utf8");
    expect(text).toStartWith("---\ntitel: \"heft1\"");
    expect(text).toContain("$$U = R \\cdot I$$");
    expect(text).toContain("![Alt](bilder/alt.png)");
    expect(text).not.toContain("fehlt.png");
    expect(existsSync(join(dir, "bilder", "bild_001_abc.png"))).toBe(true);
    expect(existsSync(join(dir, "bilder", "alt.png"))).toBe(true);
    // Neu schreiben ersetzt, kein zweiter Ordner
    kf.writeKnowledgeFolder(id, "neu", [], null, root);
    expect(require("fs").readdirSync(root).length).toBe(1);
    kf.removeKnowledgeFolder(id, root);
    expect(kf.findKnowledgeFolder(id, root)).toBeNull();
  });
});

