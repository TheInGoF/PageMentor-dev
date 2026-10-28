import { describe, expect, test } from "bun:test";
import { migratedEngines } from "./extraEngines";

describe("Umstellung auf Kokoro als Standard", () => {
  test("bestehende Installation behält Qwen, Kokoro fällt aus der Liste", () => {
    expect(migratedEngines("kokoro,f5", true)).toBe("qwen,f5");
    expect(migratedEngines(undefined, true)).toBe("qwen");
  });
  test("neue Installation startet nur mit Kokoro", () => {
    expect(migratedEngines(undefined, false)).toBe("");
  });
  test("Unbekanntes fällt weg, Qwen nicht doppelt", () => {
    expect(migratedEngines("qwen, tada ,quatsch", true)).toBe("qwen,tada");
  });
});
