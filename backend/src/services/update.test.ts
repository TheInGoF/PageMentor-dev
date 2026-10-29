import { describe, expect, test } from "bun:test";
import { isNewer } from "./update";

describe("Versionsvergleich für Updates", () => {
  test("Zahlen statt Text vergleichen", () => {
    expect(isNewer("1.21.10", "1.21.9")).toBe(true);
    expect(isNewer("1.22.0", "1.21.4")).toBe(true);
    expect(isNewer("1.21.4", "1.21.4")).toBe(false);
    expect(isNewer("1.20.9", "1.21.0")).toBe(false);
  });
});
