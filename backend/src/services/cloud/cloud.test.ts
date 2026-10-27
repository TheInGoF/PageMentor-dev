// Zustimmung vor dem Versand; der Cloud-Aufruf ist ersetzt, es geht nichts raus
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const sent: Array<{ system: string; text: string }> = [];
mock.module("./client", () => ({
  cloudEnabled: () => (globalThis as any).__cloudOn === true,
  cloudTargets: () => ((globalThis as any).__cloudKey ? [{ provider: "anthropic", model: "claude-opus-5-5", label: "Claude" }] : []),
  cloudGenerate: async (_t: unknown, system: string, text: string) => {
    sent.push({ system, text });
    return '{"korrigiert_md": "$$U = R \\\\cdot I$$", "hinweise": ["Malpunkt ergänzt"], "sicher": true}';
  },
}));

type Mods = { db: typeof import("../../db"); c: typeof import("./consent"); f: typeof import("./failures") };
let x: Mods;

beforeAll(async () => {
  x = { db: await import("../../db"), c: await import("./consent"), f: await import("./failures") };
  x.db.useDatabaseFile(join(mkdtempSync(join(tmpdir(), "pm-cloud-")), "t.db"));
  x.db.initDb();
  x.db.db().prepare("INSERT INTO material_items (id, kind, title, body_md, uncertain) VALUES ('T-F-1', 'formel', 'Ohm', '$$U = R I$$', 1)").run();
});

describe("Cloud-Hilfe", () => {
  test("aus: nichts geht, ohne Schlüssel: nichts geht", () => {
    expect(() => x.c.preview("lektorat", undefined, { itemId: "T-F-1" })).toThrow("ausgeschaltet");
    (globalThis as any).__cloudOn = true;
    expect(() => x.c.preview("lektorat", undefined, { itemId: "T-F-1" })).toThrow("Schlüssel");
  });

  test("Vorschau zeigt genau den Text, gesendet wird genau dieser, einmal", async () => {
    (globalThis as any).__cloudKey = true;
    const p = x.c.preview("lektorat", undefined, { itemId: "T-F-1" });
    expect(p.text).toContain("$$U = R I$$");
    expect(sent).toHaveLength(0);
    const r = await x.c.send(p.id);
    expect(sent).toEqual([{ system: p.system, text: p.text }]);
    expect(r.answer).toContain("korrigiert_md");
    await expect(x.c.send(p.id)).rejects.toThrow("abgelaufen");
    expect(x.c.cloudLog()[0]).toMatchObject({ task: "lektorat", provider: "anthropic", ok: 1 });
  });

  test("Fehlversuche werden gekürzt gespeichert, Diagnose nutzt sie", () => {
    x.f.recordFailure("material:formel", "gemma", "x".repeat(30_000), "kaputt", "Kein JSON");
    const [f] = x.f.listFailures();
    expect(f.inputChars).toBe(20_000);
    const p = x.c.preview("diagnose", undefined, { failureId: f.id });
    expect(p.text).toContain("=== AUSGABE DES MODELLS ===\nkaputt");
  });
});
