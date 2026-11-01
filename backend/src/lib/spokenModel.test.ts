import { describe, expect, test } from "bun:test";
import { spokenModel } from "./spokenModel";

describe("Modellname zum Sprechen", () => {
  test("Familie und Version, ohne Größe", () => {
    expect(spokenModel("qwen3.6:27b")).toBe("Qwen 3.6");
    expect(spokenModel("gemma4:e4b")).toBe("Gemma 4");
    expect(spokenModel("llama3.2:3b")).toBe("Llama 3.2");
    expect(spokenModel("mistral")).toBe("Mistral");
  });
  test("ohne Modell: KI", () => {
    expect(spokenModel(null)).toBe("KI");
    expect(spokenModel("default")).toBe("KI");
    expect(spokenModel("")).toBe("KI");
  });
});
