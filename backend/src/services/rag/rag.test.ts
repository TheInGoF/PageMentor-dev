// Vektorindex, Volltext und Fusion mit erfundenen Abschnitten
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ftsQuery } from "./fts";
import { rrf } from "./hybrid";

type Mods = { db: typeof import("../../db"); vec: typeof import("./vec"); fts: typeof import("./fts") };
let x: Mods;
const v = (...a: number[]) => {
  const f = new Float32Array(4);
  a.forEach((n, i) => (f[i] = n));
  return f;
};
const blob = (f: Float32Array) => Buffer.from(f.buffer);

beforeAll(async () => {
  x = { db: await import("../../db"), vec: await import("./vec"), fts: await import("./fts") };
  x.db.useDatabaseFile(join(mkdtempSync(join(tmpdir(), "pm-rag-")), "t.db"));
  x.db.initDb();
  const d = x.db.db();
  d.prepare("INSERT INTO modules (id, name) VALUES ('m1', 'Eins'), ('m2', 'Zwei')").run();
  d.prepare("INSERT INTO documents (id, title, filename, stored_path, module_id) VALUES ('d1', 'Heft A', 'a.pdf', '', 'm1'), ('d2', 'Heft B', 'b.pdf', '', 'm2')").run();
  d.prepare("INSERT INTO chapters (id, document_id, number, title) VALUES ('c1', 'd1', 1, 'K1'), ('c2', 'd2', 1, 'K1')").run();
  const ins = d.prepare("INSERT INTO chunks (id, document_id, chapter_id, chunk_index, text, embedding) VALUES (?, ?, ?, ?, ?, ?)");
  ins.run("k1", "d1", "c1", 0, "Der Spannungsteiler teilt die Spannung im Verhältnis der Widerstände.", blob(v(1)));
  ins.run("k2", "d1", "c1", 1, "Die Leistung ist Spannung mal Strom.", blob(v(0, 1)));
  ins.run("k3", "d2", "c2", 0, "Fourier-Reihen zerlegen periodische Signale.", blob(v(0.9, 0.1)));
});

describe("Hilfen", () => {
  test("RRF bevorzugt, was in beiden Listen oben steht", () => {
    expect(rrf([[1, 2, 3], [2, 4]]).map((r) => r.rowid)).toEqual([2, 1, 4, 3]);
  });
  test("FTS-Abfrage nur aus Wörtern", () => {
    expect(ftsQuery("Was ist ein Spannungsteiler?")).toBe('"was"* OR "ist"* OR "ein"* OR "spannungsteiler"*');
    expect(ftsQuery('"); DROP TABLE x; --')).toBe('"drop"* OR "table"*');
    expect(ftsQuery("?!")).toBeNull();
  });
});

describe("Indizes", () => {
  test("sqlite-vec geladen", () => expect(x.vec.vecState.available).toBe(true));

  test("Volltext findet Wortanfang, Modulfilter greift", () => {
    const d = x.db.db();
    const all = x.fts.ftsSearch(d, "Spannung", 10, null).map((r) => r.rowid);
    expect(all.length).toBe(2);
    expect(x.fts.ftsSearch(d, "Spannung", 10, "m2")).toEqual([]);
    expect(x.fts.ftsSearch(d, "periodisch", 10, "m2").length).toBe(1);
  });

  test("Sync füllt den Vektorindex, Modulwechsel und Löschen werden nachgezogen", () => {
    const d = x.db.db();
    expect(x.vec.syncVectors(d)).toEqual({ added: 3, removed: 0, moved: 0 });
    expect(x.vec.vecSearch(d, v(1), 2, null).length).toBe(2);
    expect(x.vec.vecSearch(d, v(1), 5, "m1").length).toBe(2);
    d.prepare("UPDATE documents SET module_id = 'm1' WHERE id = 'd2'").run();
    expect(x.vec.syncVectors(d).moved).toBe(1);
    expect(x.vec.vecSearch(d, v(1), 5, "m1").length).toBe(3);
    d.prepare("DELETE FROM chunks WHERE id = 'k2'").run();
    expect(x.vec.syncVectors(d).removed).toBe(1);
    expect(x.fts.ftsSearch(d, "Leistung", 5, null)).toEqual([]);
  });

  test("neue Dimension baut den Index neu", () => {
    const d = x.db.db();
    d.prepare("UPDATE chunks SET embedding = ?").run(Buffer.from(new Float32Array(8).fill(0.1).buffer));
    const r = x.vec.syncVectors(d);
    expect(r.added).toBe(2);
    expect(x.vec.vecSearch(d, new Float32Array(8).fill(0.1), 5, null).length).toBe(2);
  });
});

describe("Prüffragen", () => {
  test("Trefferquote und MRR aus der Rangliste", async () => {
    const { addEval, runEval, isHit } = await import("./eval");
    const d = x.db.db();
    d.prepare("UPDATE chunks SET start_page = 3, end_page = 4").run();
    addEval({ question: "Spannungsteiler", module_id: null, expected_document_id: "d1", expected_page: 4 });
    addEval({ question: "Fourier", module_id: null, expected_document_id: "d1", expected_page: null });
    const rid = (id: string) => (d.prepare("SELECT rowid AS r FROM chunks WHERE id = ?").get(id) as { r: number }).r;
    const fake = async (q: string) => ({ rowids: q === "Spannungsteiler" ? [rid("k3"), rid("k1")] : [rid("k3")], mode: "hybrid" as const });
    const r = await runEval(12, fake);
    expect(r).toMatchObject({ questions: 2, recall: 0.5, mrr: 0.25, mode: "hybrid" });
    expect(isHit({ document_id: "d1", start_page: 3, end_page: 4 }, { expected_document_id: "d1", expected_page: 9 })).toBe(false);
  });
});

describe("Wissensgraph", () => {
  test("Kanten nur zwischen Dokumenten, ähnlichste zuerst, ohne Doppelte", async () => {
    const { edgesFor, centroid } = await import("./graph");
    const n = (id: string, doc: string, ...a: number[]) => ({ id, documentId: doc, vec: v(...a) });
    const edges = edgesFor([n("a", "d1", 1), n("b", "d1", 0.95, 0.05), n("c", "d2", 0.9, 0.1), n("d", "d2", 0, 1)]);
    expect(edges.map((e) => `${e.a}-${e.b}`).sort()).toEqual(["a-c", "b-c"]);
    expect(Array.from(centroid([v(1, 0), v(0, 1)]))).toEqual([0.5, 0.5, 0, 0]);
  });
});
