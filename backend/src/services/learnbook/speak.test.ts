import { describe, expect, test } from "bun:test";
import { audioStamp, introScript, parseScript } from "./speak";
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

  test("Denkzeit: Pause zwischen Frage und „Antwort:“ dauert mindestens sechs Sekunden", () => {
    const parts = parseScript(
      "Was bedeutet das? Es heißt viel.\n[PAUSE 2]\nFrage eins: Warum sinkt die Entropie?\n[PAUSE 3]\nAntwort: Weil das Gedächtnis die Unsicherheit verringert.\n[PAUSE 2]\nWie sagst du: Kaffee?\n[PAUSE 4]\n[es]café[/es]\n[PAUSE 1]\nNoch eine Rechenfrage?\n[PAUSE 8]\nAntwort: ja."
    );
    expect(parts.filter((p) => p.kind === "pause").map((p) => p.ms)).toEqual([2000, 6000, 2000, 4000, 1000, 8000]);
  });

  test("[langsam] gilt für die Stücke darin, auch über eine Pause hinweg und bei falscher Verschachtelung", () => {
    const parts = parseScript("Hör zu.\n[langsam][es]Uno.[/es]\n[PAUSE 2]\n[es]Dos.[/es][/langsam]\n[es][langsam]Tres.[/langsam][/es] Normal: [es]Cuatro.[/es]");
    expect(parts).toEqual([
      { kind: "speech", lang: null, text: "Hör zu." },
      { kind: "speech", lang: "es", text: "Uno.", slow: true },
      { kind: "pause", ms: 2000 },
      { kind: "speech", lang: "es", text: "Dos.", slow: true },
      { kind: "speech", lang: "es", text: "Tres.", slow: true },
      { kind: "speech", lang: null, text: "Normal:" },
      { kind: "speech", lang: "es", text: "Cuatro." },
    ]);
  });

  test("Intro: jede Zeile mit einer halben Sekunde Pause, auch an Leerzeilen", () => {
    const script = introScript("Modul.\nLernhörbuch: Heft.\n\nNach dem Buch von X.\n \n\nErstellt mit PageMentor.\n");
    expect(script).toBe("Modul.\n[PAUSE 0.5]\nLernhörbuch: Heft.\n[PAUSE 0.5]\nNach dem Buch von X.\n[PAUSE 0.5]\nErstellt mit PageMentor.");
    expect(parseScript(script).filter((p) => p.kind === "pause")).toEqual([1, 2, 3].map(() => ({ kind: "pause", ms: 500 })));
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
