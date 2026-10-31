// Schreiben, Prüfen, Korrigieren mit einem nachgestellten Modell
import { describe, expect, mock, test } from "bun:test";

const answers: string[] = [];
const prompts: string[] = [];
mock.module("../llm", () => ({
  generate: async (p: { prompt: string }) => {
    prompts.push(p.prompt);
    return { response: answers.shift() ?? "", model: "test", provider: "test", totalMs: 0 };
  },
}));

const { writeUnit } = await import("./script");
const base = { lang: "es", docTitle: "Heft", idx: 0, total: 3, unit: { source: "Vorlage", start_page: 9, end_page: 12 }, review: [], ctx: 8192 };
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

  test("zu kurze Antwort ist ein Fehler, kein leeres Skript", async () => {
    answers.push(JSON.stringify({ titel: "x", skript: "kurz", merkpunkte: [] }));
    await expect(writeUnit({ ...base, kind: "language" })).rejects.toThrow("Skript zu kurz");
  });
});
