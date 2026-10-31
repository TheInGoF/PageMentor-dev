// Einheit wirklich zusammensetzen: Testton statt Stimme, echte Stille, ffmpeg wie im Betrieb
import { afterAll, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";

process.env.PM_DATA_DIR = mkdtempSync(join(tmpdir(), "pm-learn-audio-"));
// Eigene ID je Lauf: im Gesamtlauf steht der Datenordner schon fest, alte Stücke dürfen nicht stören
const DOC = `test-${randomUUID()}`;
const calls: Array<{ text: string; voice: string }> = [];
const actual = await import("../../tts/synth");
mock.module("../../tts/synth", () => ({
  ...actual,
  maxChunkFor: () => 250,
  synthesizeChunk: async (p: { text: string; voice: { id: string }; outPath: string }) => {
    calls.push({ text: p.text, voice: p.voice.id });
    spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=24000:duration=1", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "96k", p.outPath]);
    return { path: p.outPath, bytes: 1, engineId: "f5" };
  },
}));

const { speakUnit } = await import("./speak");
const { DATA_DIR } = await import("../../paths");
afterAll(() => rmSync(join(DATA_DIR, "audio", DOC), { recursive: true, force: true }));
const de = { id: "f5:de", locale: "de-DE", engine: "f5" } as never;
const es = { id: "f5:es", locale: "es-ES", engine: "f5" } as never;

describe("Einheit sprechen", () => {
  test("zwei Stimmen, Pausen als Stille, Dauer stimmt ungefähr", async () => {
    const r = await speakUnit({ docId: DOC, idx: 0, title: "Im Café", album: "Test", script: "Wie sagst du: Kaffee?\n[PAUSE 3]\n[es]un café[/es]", main: de, second: es, rate: "+0%", isCanceled: () => false });
    expect(calls.map((c) => c.voice)).toEqual(["f5:de", "f5:es"]);
    expect(calls[0].text.endsWith("?")).toBe(true);
    // 0,8 s Vorlauf + 1 s Ton + 3 s Pause + 1 s Ton + 1,5 s Nachlauf ≈ 7,3 s
    expect(r.durationMs).toBeGreaterThan(6500);
    expect(r.durationMs).toBeLessThan(8200);
  }, 30000);

  test("Abbruch stoppt vor dem nächsten Stück", async () => {
    await expect(speakUnit({ docId: DOC, idx: 1, title: "x", album: "Test", script: "Eins. [PAUSE 1] Zwei.", main: de, second: null, rate: "+0%", isCanceled: () => true })).rejects.toThrow("abgebrochen");
  });
});
