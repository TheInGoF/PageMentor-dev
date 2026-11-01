import { describe, expect, test } from "bun:test";
import { withMemoryReclaim } from "./memory";

describe(".wslconfig: Speicher zurückgeben", () => {
  test("neu angelegt", () => {
    expect(withMemoryReclaim("")).toBe("[experimental]\r\nautoMemoryReclaim=gradual\r\n");
  });
  test("vorhandene Abschnitte bleiben, Eintrag unter [experimental]", () => {
    const out = withMemoryReclaim("[wsl2]\nmemory=12GB\n\n[experimental]\nsparseVhd=true\n");
    expect(out).toContain("memory=12GB");
    expect(out).toContain("[experimental]\r\nautoMemoryReclaim=gradual\r\nsparseVhd=true");
  });
  test("eigene Wahl des Nutzers bleibt", () => {
    const own = "[experimental]\nautoMemoryReclaim=dropcache\n";
    expect(withMemoryReclaim(own)).toBe(own);
  });
});
