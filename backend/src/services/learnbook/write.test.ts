// Schreiben, Prüfen, Korrigieren mit einem nachgestellten Modell
import { describe, expect, mock, test } from "bun:test";

const answers: string[] = [];
const prompts: string[] = [];
const thinks: Array<boolean | undefined> = [];
mock.module("../llm", () => ({
  generate: async (p: { prompt: string; think?: boolean }) => {
    prompts.push(p.prompt);
    thinks.push(p.think);
    return { response: answers.shift() ?? "", model: "test", provider: "test", totalMs: 0 };
  },
}));

const { writeUnit, SkipUnit, learnableChars } = await import("./script");
const source = "## 1.1 Me llamo\n\nMe llamo Pedro. Soy de Madrid. ".repeat(6);
const base = { lang: "es", docTitle: "Heft", idx: 0, total: 3, unit: { source, start_page: 9, end_page: 12 }, review: [], ctx: 8192 };
const script = (s: string) => JSON.stringify({ titel: "Entropie", skript: s.repeat(60), merkpunkte: ["H = mittlerer Informationsgehalt"] });

describe("Einheit schreiben", () => {
  test("Fachheft: Abweichung gefunden, korrigiertes Skript gewinnt, Notiz nennt den Fehler", async () => {
    answers.push(script("falsch "), JSON.stringify({ abweichungen: [{ stelle: "Basis zehn", problem: "Logarithmus zur Basis 2", korrektur: "Basis zwei" }] }), script("richtig "));
    const out = await writeUnit({ ...base, kind: "subject" });
    expect(out.script.startsWith("richtig")).toBe(true);
    expect(out.checkNote).toContain("korrigiert");
    expect(prompts[2]).toContain("Basis zwei");
  });

  test("Fachheft ohne Abweichung: erster Entwurf bleibt", async () => {
    answers.push(script("gut "), JSON.stringify({ abweichungen: [] }));
    const out = await writeUnit({ ...base, kind: "subject" });
    expect(out.script.startsWith("gut")).toBe(true);
    expect(out.checkNote).toBe("geprüft, keine Abweichung");
  });

  test("Sprachkurs: ohne Prüfung, Zielsprache und erste Einheit stehen im Auftrag", async () => {
    prompts.length = 0;
    answers.push(script("[es]hola[/es] "));
    const out = await writeUnit({ ...base, kind: "language" });
    expect(out.checkNote).toBeNull();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Spanisch, Markierung [es]");
    expect(prompts[0]).toContain("noch nichts");
  });

  test("zweimal leere Antwort: Einheit wird markiert (nicht endgültig), kein Abbruch des Laufs", async () => {
    answers.push("", JSON.stringify({ ueberspringen: false, titel: "x", skript: "kurz", merkpunkte: [] }));
    const err = await writeUnit({ ...base, kind: "language" }).catch((e) => e);
    expect(err).toBeInstanceOf(SkipUnit);
    expect(err.final).toBe(false);
    expect(err.message).toContain("kein Skript bekommen");
  });

  test("ohne Denkmodus, für jedes Modell", async () => {
    thinks.length = 0;
    answers.push(script("gut "));
    await writeUnit({ ...base, kind: "language", model: "gemma4:26b" });
    expect(thinks).toEqual([false]);
  });

  test("leere Vorlage: endgültig übersprungen, ohne das Modell zu fragen", async () => {
    prompts.length = 0;
    const err = await writeUnit({ ...base, kind: "language", unit: { source: "## G GRAMÁTICA\n\n## LSA01Z\n\n12", start_page: 1, end_page: 2 } }).catch((e) => e);
    expect(err).toBeInstanceOf(SkipUnit);
    expect(err.final).toBe(true);
    expect(prompts).toHaveLength(0);
    expect(learnableChars("## Titel\n\n17\n\nAbc def.")).toBe(6);
  });

  test("Modell meldet keinen Lerninhalt: endgültig übersprungen", async () => {
    answers.push(JSON.stringify({ ueberspringen: true, titel: "", skript: "", merkpunkte: [] }));
    const err = await writeUnit({ ...base, kind: "subject" }).catch((e) => e);
    expect(err).toBeInstanceOf(SkipUnit);
    expect(err.final).toBe(true);
  });
});
