import { describe, expect, test } from "bun:test";
import { kokoroPackVoice } from "./config";

describe("Kokoro-Sprachpaket", () => {
  test("Stimmname wird zu Sprache, Name und Geschlecht", () => {
    expect(kokoroPackVoice("es:ef_dora")).toMatchObject({ label: "Dora", gender: "female", language: "es", locale: "es-ES" });
    expect(kokoroPackVoice("en-gb:bm_george")).toMatchObject({ label: "George", gender: "male", language: "en", locale: "en-GB" });
  });
  test("deutsche Stimmen und Unbekanntes sind kein Paket", () => {
    expect(kokoroPackVoice("martin")).toBeNull();
    expect(kokoroPackVoice("xx:af_a")).toBeNull();
  });
});
