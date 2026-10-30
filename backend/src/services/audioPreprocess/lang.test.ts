import { describe, expect, test } from "bun:test";
import { heuristicTag } from "./lang";
import { splitLanguageRuns } from "../audiobook/synthChapter";

describe("Zweisprachige Bücher", () => {
  test("Markierungen werden zu Abschnitten mit Sprache", () => {
    const runs = splitLanguageRuns("[es]Me llamo[/es] bedeutet: ich heiße.\n\n[es]¡Hola! Buenos días.[/es]");
    expect(runs).toEqual([
      { lang: "es", text: "Me llamo" },
      { lang: null, text: " bedeutet: ich heiße.\n\n" },
      { lang: "es", text: "¡Hola! Buenos días." },
    ]);
  });
  test("ohne Markierung bleibt alles Hauptsprache", () => {
    expect(splitLanguageRuns("Nur Deutsch.")).toEqual([{ lang: null, text: "Nur Deutsch." }]);
  });
  test("Ersatz-Erkennung markiert spanische Zeilen, nicht deutsche", () => {
    expect(heuristicTag("¿Quién es?\nWer ist das?\nÉl mira la televisión.", "es")).toBe("[es]¿Quién es?[/es]\nWer ist das?\n[es]Él mira la televisión.[/es]");
  });
});
