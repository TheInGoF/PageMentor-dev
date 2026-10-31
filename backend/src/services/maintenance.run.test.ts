// Ganzer Lauf mit nachgestelltem Embedding-Dienst: alle offenen Abschnitte werden erschlossen
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const actualEmb = await import("./embeddings");
mock.module("./embeddings", () => ({
  ...actualEmb,
  resolveEmbedder: async () => ({ url: "http://x", model: "tei:test" }),
  embedText: async () => new Float32Array([1, 0, 0, 0]),
}));
const actualLlm = await import("./llm");
mock.module("./llm", () => ({ ...actualLlm, isAvailable: async () => false }));

let dbm: typeof import("../db");
beforeAll(async () => {
  dbm = await import("../db");
  dbm.useDatabaseFile(join(mkdtempSync(join(tmpdir(), "pm-maint-")), "t.db"));
  dbm.initDb();
  const d = dbm.db();
  d.prepare("INSERT INTO documents (id, title, filename, stored_path) VALUES ('d1', 'Heft A', 'a.pdf', '')").run();
  d.prepare("INSERT INTO chapters (id, document_id, number, title, kind, text) VALUES ('c1', 'd1', 1, 'K1', 'content', 'x')").run();
  const ins = d.prepare("INSERT INTO chunks (id, document_id, chapter_id, chunk_index, text, embedding, embedding_model) VALUES (?, 'd1', 'c1', ?, ?, ?, ?)");
  ins.run("k1", 0, "eins", null, null);
  ins.run("k2", 1, "zwei", Buffer.from(new Float32Array([0, 1, 0, 0]).buffer), "tei:alt");
  ins.run("k3", 2, "drei", Buffer.from(new Float32Array([0, 0, 1, 0]).buffer), "tei:test");
});

describe("Wissenspflege-Lauf", () => {
  test("fehlende und veraltete Embeddings werden nachgeholt, danach nichts mehr offen", async () => {
    const m = await import("./maintenance");
    const before = await m.startNow();
    expect(before.open.chunks).toBe(2);
    for (let i = 0; i < 50 && m.maintenanceState().status === "running"; i++) await new Promise((r) => setTimeout(r, 20));
    const after = m.maintenanceState();
    expect(after.status).toBe("idle");
    expect(after.open.chunks).toBe(0);
    const rows = dbm.db().prepare("SELECT embedding_model FROM chunks ORDER BY chunk_index").all() as Array<{ embedding_model: string }>;
    expect(rows.every((r) => r.embedding_model === "tei:test")).toBe(true);
  });

  test("Abbrechen setzt Ruhe", async () => {
    const m = await import("./maintenance");
    expect(m.cancelMaintenance().status).toBe("snoozed");
  });
});
