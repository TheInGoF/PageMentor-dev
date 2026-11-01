import { describe, expect, test } from "bun:test";
import { numberWord, spokenModel } from "./spokenModel";

describe("Modellname zum Sprechen", () => {
  test("Familie und Version als Zahlwort, ohne Größe", () => {
    expect(spokenModel("qwen3.6:27b")).toBe("Qwen drei Punkt sechs");
    expect(spokenModel("gemma4:e4b")).toBe("Gemma vier");
    expect(spokenModel("llama3.2:3b")).toBe("Llama drei Punkt zwei");
    expect(spokenModel("mistral")).toBe("Mistral");
  });
  test("Zahlwörter", () => {
    expect(numberWord(0)).toBe("null");
    expect(numberWord(11)).toBe("elf");
    expect(numberWord(21)).toBe("einundzwanzig");
    expect(numberWord(35)).toBe("fünfunddreißig");
    expect(numberWord(40)).toBe("vierzig");
    expect(numberWord(405)).toBe("vier null fünf");
  });
  test("ohne Modell: KI", () => {
    expect(spokenModel(null)).toBe("KI");
    expect(spokenModel("default")).toBe("KI");
    expect(spokenModel("")).toBe("KI");
  });
});
