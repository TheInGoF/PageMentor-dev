// Messung der Vektorsuche mit Zufallsdaten: bun scripts/rag-bench.ts [Anzahl] [Dimension] [Ordner]
// Vergleicht sqlite-vec (float32 und int8) mit dem Durchlauf in JS
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getLoadablePath } from "sqlite-vec";

const N = Number(process.argv[2] ?? 300_000);
const DIM = Number(process.argv[3] ?? 1024);
const dir = process.argv[4] ?? mkdtempSync(join(tmpdir(), "pm-bench-"));
const file = join(dir, "bench.db");
const db = new Database(file);
db.loadExtension(getLoadablePath());
db.exec("PRAGMA journal_mode = WAL");
db.exec(`CREATE VIRTUAL TABLE v USING vec0(embedding float[${DIM}])`);
db.exec(`CREATE VIRTUAL TABLE q USING vec0(embedding int8[${DIM}])`);

const rnd = () => {
  const a = new Float32Array(DIM);
  let n = 0;
  for (let i = 0; i < DIM; i++) n += (a[i] = Math.random() - 0.5) ** 2;
  n = Math.sqrt(n);
  for (let i = 0; i < DIM; i++) a[i] /= n;
  return a;
};

let t = performance.now();
const ins = db.prepare("INSERT INTO v (rowid, embedding) VALUES (?, ?)");
const insQ = db.prepare("INSERT INTO q (rowid, embedding) VALUES (?, vec_quantize_int8(?, 'unit'))");
const BATCH = 5000;
for (let s = 0; s < N; s += BATCH) {
  db.transaction(() => {
    for (let i = s; i < Math.min(N, s + BATCH); i++) {
      const e = rnd();
      ins.run(i + 1, new Uint8Array(e.buffer));
      insQ.run(i + 1, new Uint8Array(e.buffer));
    }
  })();
}
const fill = (performance.now() - t) / 1000;
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");

const query = (sql: string) => {
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const e = rnd();
    const t0 = performance.now();
    db.prepare(sql).all(new Uint8Array(e.buffer));
    times.push(performance.now() - t0);
  }
  return Math.round(times.sort((a, b) => a - b)[2]);
};
const f32 = query("SELECT rowid, distance FROM v WHERE embedding MATCH ? AND k = 50");
const i8 = query("SELECT rowid, distance FROM q WHERE embedding MATCH vec_quantize_int8(?, 'unit') AND k = 50");

// Zum Vergleich: alle Vektoren lesen und in JS vergleichen (heutiger Weg)
const t1 = performance.now();
const qv = rnd();
let best = -1;
for (const r of db.prepare("SELECT embedding FROM v").iterate() as Iterable<{ embedding: Uint8Array }>) {
  const v = new Float32Array(r.embedding.buffer, r.embedding.byteOffset, DIM);
  let s = 0;
  for (let i = 0; i < DIM; i++) s += v[i] * qv[i];
  if (s > best) best = s;
}
const js = Math.round(performance.now() - t1);

console.log(JSON.stringify({ n: N, dim: DIM, fillSec: Math.round(fill), dbMB: Math.round(statSync(file).size / 1e6), float32Ms: f32, int8Ms: i8, jsScanMs: js }));
db.close();
if (!process.argv[4]) rmSync(dir, { recursive: true, force: true });
