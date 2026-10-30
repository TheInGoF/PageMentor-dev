import { describe, expect, test, afterAll } from "bun:test";
import { getPrompt, promptInfo, resetPrompt, savePrompt, PROMPTS } from "./prompts";

describe("Gemma-Anweisungen", () => {
  afterAll(() => resetPrompt("cards.de"));
  test("ohne eigene Fassung gilt das Original", () => {
    resetPrompt("cards.de");
    expect(getPrompt("cards.de")).toBe(PROMPTS["cards.de"]);
    expect(promptInfo("cards.de").custom).toBe(false);
  });
  test("eigene Fassung gilt, zurücksetzen holt das Original", () => {
    savePrompt("cards.de", "Nur ein Test.");
    expect(getPrompt("cards.de")).toBe("Nur ein Test.");
    expect(promptInfo("cards.de")).toMatchObject({ custom: true, originalChanged: false });
    resetPrompt("cards.de");
    expect(getPrompt("cards.de")).toBe(PROMPTS["cards.de"]);
  });
});
