import { describe, expect, test } from "bun:test";
import type { Voice } from "../base";
import { germanFirst } from "./voices";

const v = (id: string, language: string, flagship = false): Voice =>
  ({ id, label: id, language, locale: language, gender: "male", engine: "qwen", flagship }) as Voice;

describe("germanFirst", () => {
  test("deutsche Stimmprobe steht vorn und ist Standard statt Ryan", () => {
    const out = germanFirst([v("preset:ryan", "de", true)], [], [v("custom:a", "de"), v("custom:b", "de")]);
    expect(out.map((x) => x.id)).toEqual(["custom:a", "custom:b", "preset:ryan"]);
    expect(out.filter((x) => x.flagship).map((x) => x.id)).toEqual(["custom:a"]);
  });

  test("ohne deutsche Proben bleibt die Reihenfolge", () => {
    const out = germanFirst([v("preset:ryan", "de", true)], [], [v("custom:e", "en")]);
    expect(out.map((x) => x.id)).toEqual(["preset:ryan", "custom:e"]);
    expect(out[0].flagship).toBe(true);
    expect(out[1].flagship).toBe(true);
  });
});
