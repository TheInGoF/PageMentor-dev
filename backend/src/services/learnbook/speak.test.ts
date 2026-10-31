import { describe, expect, test } from "bun:test";
import { audioStamp, parseScript } from "./speak";
import type { Voice } from "../../tts/engines/base";

describe("Lernhörbuch-Skript sprechen", () => {
  test("Pausen, Sprachwechsel und deutsche Teile in richtiger Reihenfolge", () => {
    const parts = parseScript("Wie sagst du: Ich hätte gern einen Kaffee?\n[PAUSE 4]\n[es]Quisiera un café, por favor.[/es]\n[PAUSE 3]\nGut.");
    expect(parts).toEqual([
      { kind: "speech", lang: null, text: "Wie sagst du: Ich hätte gern einen Kaffee?" },
      { kind: "pause", ms: 4000 },
      { kind: "speech", lang: "es", text: "Quisiera un café, por favor." },
      { kind: "pause", ms: 3000 },
      { kind: "speech", lang: null, text: "Gut." },
    ]);
  });

  test("Pausen werden begrenzt, Komma und kleine Schreibweise gehen", () => {
    expect(parseScript("A [pause 30] B [PAUSE 0,2] C [PAUSE 2.5s] D").filter((p) => p.kind === "pause")).toEqual([
      { kind: "pause", ms: 10000 },
      { kind: "pause", ms: 500 },
      { kind: "pause", ms: 2500 },
    ]);
  });

  test("leere Stücke zwischen Pausen fallen weg", () => {
    expect(parseScript("[PAUSE 2]\n\n[PAUSE 2]").every((p) => p.kind === "pause")).toBe(true);
  });

  test("Audio-Stempel hängt an Skript, Stimmen und Tempo", () => {
    const v = (id: string) => ({ id }) as Voice;
    const a = audioStamp("x", [v("f5:a"), v("f5:b")], "+0%");
    expect(audioStamp("x", [v("f5:a"), v("f5:b")], "+0%")).toBe(a);
    expect(audioStamp("x", [v("f5:a")], "+0%")).not.toBe(a);
    expect(audioStamp("x", [v("f5:a"), v("f5:b")], "-10%")).not.toBe(a);
  });
});
