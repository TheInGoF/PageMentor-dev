// Gehirn-Ansicht: Auswahl der Begriffe, Farbe nach Modul, Verbindungen, Nachladen bei Aktivierung
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let dbm: typeof import("../../db");

beforeAll(async () => {
  dbm = await import("../../db");
  dbm.useDatabaseFile(join(mkdtempSync(join(tmpdir(), "pm-brain-")), "t.db"));
  dbm.initDb();
  const d = dbm.db();
  // m3 hat keine Begriffe und taucht in der Modulliste des Gehirns nicht auf
  d.prepare("INSERT INTO modules (id, name) VALUES ('m1', 'Informatik'), ('m2', 'Mathe'), ('m3', 'Leer')").run();
  d.prepare("INSERT INTO documents (id, title, filename, stored_path, module_id) VALUES ('d1', 'Info', 'a.pdf', '', 'm1'), ('d2', 'Stochastik', 'b.pdf', '', 'm2')").run();
  d.prepare("INSERT INTO chapters (id, document_id, number, title, kind, text) VALUES ('c1', 'd1', 1, 'Kanäle', 'content', 'x'), ('c2', 'd1', 2, 'Codes', 'content', 'x'), ('c3', 'd2', 1, 'Wahrscheinlichkeit', 'content', 'y')").run();
  const { saveChapterConcepts } = await import("./store");
  saveChapterConcepts("c1", "d1", [{ name: "Entropie", definition: "Info", explains: true, needs: ["Wahrscheinlichkeit"] }], "s");
  saveChapterConcepts("c2", "d1", [{ name: "Entropie", definition: "", explains: false, needs: [] }, { name: "Huffman-Code", definition: "", explains: true, needs: ["Entropie"] }], "s");
  saveChapterConcepts("c3", "d2", [{ name: "Wahrscheinlichkeit", definition: "P", explains: true, needs: [] }], "s");
});

describe("Gehirn", () => {
  test("alle Module: Begriffe, Farbe nach meisten Fundstellen, Verbindungen", async () => {
    const { brainGraph } = await import("./brain");
    const g = brainGraph();
    const byName = new Map(g.nodes.map((n) => [n.name, n]));
    expect(byName.get("Entropie")).toMatchObject({ mentions: 2, moduleId: "m1", explained: true });
    // Grundlagen zählen nicht als Fundstelle: Wahrscheinlichkeit steht nur in Mathe
    expect(byName.get("Wahrscheinlichkeit")).toMatchObject({ modules: 1, moduleId: "m2" });
    expect(g.edges.length).toBe(2);
    expect(g.edges.every((e) => e.sure)).toBe(true);
    expect(g.modules.map((m) => m.name)).toEqual(["Informatik", "Mathe"]);
    // Heimat-Heft: Entropie kommt zweimal in Info vor, Wahrscheinlichkeit nur in Stochastik
    expect(byName.get("Entropie")!.docId).toBe("d1");
    expect(byName.get("Wahrscheinlichkeit")!.docId).toBe("d2");
    expect(g.docs.map((d) => d.title)).toEqual(["Info", "Stochastik"]);
  });

  test("Schlagwortsuche über Name, Schreibweise und Erklärung", async () => {
    const { searchConcepts, brainGraph } = await import("./brain");
    const byName = new Map(brainGraph().nodes.map((n) => [n.name, n.id]));
    expect(searchConcepts("entropien")).toEqual([byName.get("Entropie")!]);
    expect(searchConcepts("info")).toEqual([byName.get("Entropie")!]);
    expect(searchConcepts("x")).toEqual([]);
  });

  test("ein Modul und Grenze", async () => {
    const { brainGraph } = await import("./brain");
    expect(brainGraph({ moduleId: "m2" }).nodes.map((n) => n.name)).toEqual(["Wahrscheinlichkeit"]);
    expect(brainGraph({ limit: 10 }).nodes.length).toBe(3);
    expect(brainGraph({ limit: 0 }).nodes.length).toBe(3);
  });

  test("Nachladen und Einzelansicht", async () => {
    const { brainGraph, brainExtend, conceptDetail } = await import("./brain");
    const all = brainGraph().nodes;
    const ent = all.find((n) => n.name === "Entropie")!;
    const rest = all.filter((n) => n.id !== ent.id).map((n) => n.id);
    const ext = brainExtend(rest, [ent.id, rest[0]]);
    expect(ext.nodes.map((n) => n.id)).toEqual([ent.id]);
    expect(ext.edges.length).toBe(2);
    const det = conceptDetail(ent.id)!;
    expect(det.places[0]).toMatchObject({ explains: true, chapter: "Kanäle", module: "Informatik" });
    expect(det.needs).toHaveLength(1);
    expect(det.neededBy).toHaveLength(1);
  });

  test("Export: Kapitel mit Begriffen, Rolle, Erklärung, Grundlagen und Auszug", async () => {
    const { brainExport } = await import("./export");
    const all = brainExport({ excerpt: 50 });
    expect(all.chapters).toBe(3);
    expect(all.markdown).toContain("### Informatik › Info");
    expect(all.markdown).toContain("- **Entropie** (erklärt): Info — baut auf: Wahrscheinlichkeit");
    expect(all.markdown).toContain("- **Huffman-Code** (erklärt): – — baut auf: Entropie");
    expect(all.markdown).toContain("> x");
    const mathe = brainExport({ moduleId: "m2", excerpt: 0 });
    expect(mathe.markdown).toContain("Modul „Mathe“");
    expect(mathe.markdown).not.toContain("Entropie");
    expect(mathe.markdown).not.toContain("> y");
  });
});
