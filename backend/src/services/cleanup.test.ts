// Aufräumen: nur Eigenes ohne Zuordnung löschen, Gültiges und Lernhörbücher bleiben
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { join } from "path";

process.env.PM_DATA_DIR ??= mkdtempSync(join(tmpdir(), "pm-cleanup-"));
const DOC = randomUUID();
const GHOST = randomUUID();
let DATA_DIR = "";
let EXPORT = "";

const touch = (p: string) => {
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, "x");
};

beforeAll(async () => {
  const dbm = await import("../db");
  dbm.useDatabaseFile(join(mkdtempSync(join(tmpdir(), "pm-cleanup-db-")), "t.db"));
  dbm.initDb();
  ({ DATA_DIR, AUDIOBOOK_EXPORT_DIR: EXPORT } = await import("../paths"));
  const d = dbm.db();
  d.prepare("INSERT INTO documents (id, title, filename, stored_path, thumb_page) VALUES (?, 'Heft', 'a.pdf', '', 2)").run(DOC);
  d.prepare("INSERT INTO chapters (id, document_id, number, title, kind, text) VALUES ('c1', ?, 1, 'Eins', 'content', 'x'), ('c2', ?, 2, 'Zwei', 'content', 'x')").run(DOC, DOC);
  d.prepare("INSERT INTO audio (id, chapter_id, stored_path, status) VALUES ('a1', 'c1', ?, 'done')").run(join("audio", DOC, "chapter-001-c1.mp3"));
  const a = join(DATA_DIR, "audio", DOC);
  touch(join(a, "chapter-001-c1.mp3")); // gültig
  touch(join(a, "chapter-005-old.mp3")); // ohne Eintrag
  touch(join(a, ".tmp-c1", "chunk-000.mp3")); // Kapitel fertig
  touch(join(a, ".tmp-c2", "chunk-000.mp3")); // Kapitel offen: Fortsetzungs-Vorrat
  touch(join(a, "book.m4b"));
  touch(join(a, "learn.m4b"));
  touch(join(a, "learn", "intro.mp3"));
  touch(join(DATA_DIR, "audio", GHOST, "chapter-001-x.mp3")); // Heft gelöscht
  touch(join(DATA_DIR, "covers", `${GHOST}-p1.jpg`));
  touch(join(DATA_DIR, "covers", `${DOC}-p1.jpg`)); // Seite nicht mehr gewählt
  touch(join(DATA_DIR, "covers", `${DOC}-p2.jpg`)); // gewählt
  touch(join(DATA_DIR, "covers", `${DOC}.jpg`)); // Vorschaubild der Bibliothek
  const { registerExport } = await import("./cleanup");
  touch(join(EXPORT, "Alter_Name.m4b"));
  registerExport(join(EXPORT, "Alter_Name.m4b"), DOC, "original");
  touch(join(EXPORT, "Fremd.m4b")); // nicht von PageMentor abgelegt
});

describe("Aufräumen", () => {
  test("Probelauf zählt, löscht nichts", async () => {
    const { cleanup } = await import("./cleanup");
    const r = await cleanup({ dry: true });
    expect(r.files).toBeGreaterThanOrEqual(5);
    expect(existsSync(join(DATA_DIR, "audio", GHOST))).toBe(true);
  });

  test("löscht Leichen, behält Gültiges, Lernhörbuch und Fremdes", async () => {
    const { cleanup } = await import("./cleanup");
    await cleanup();
    const a = join(DATA_DIR, "audio", DOC);
    expect(existsSync(join(DATA_DIR, "audio", GHOST))).toBe(false);
    expect(existsSync(join(a, "chapter-005-old.mp3"))).toBe(false);
    expect(existsSync(join(a, ".tmp-c1"))).toBe(false);
    expect(existsSync(join(DATA_DIR, "covers", `${GHOST}-p1.jpg`))).toBe(false);
    expect(existsSync(join(DATA_DIR, "covers", `${DOC}-p1.jpg`))).toBe(false);
    expect(existsSync(join(EXPORT, "Alter_Name.m4b"))).toBe(false);

    expect(existsSync(join(a, "chapter-001-c1.mp3"))).toBe(true);
    expect(existsSync(join(a, ".tmp-c2"))).toBe(true);
    expect(existsSync(join(a, "book.m4b"))).toBe(true);
    expect(existsSync(join(a, "learn.m4b"))).toBe(true);
    expect(existsSync(join(a, "learn", "intro.mp3"))).toBe(true);
    expect(existsSync(join(DATA_DIR, "covers", `${DOC}-p2.jpg`))).toBe(true);
    expect(existsSync(join(DATA_DIR, "covers", `${DOC}.jpg`))).toBe(true);
    expect(existsSync(join(EXPORT, "Fremd.m4b"))).toBe(true);
  });
});
