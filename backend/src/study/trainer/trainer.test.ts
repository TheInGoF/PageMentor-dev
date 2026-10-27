// Trainer-Selbsttest mit einem erfundenen Mini-Trainer
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { checkTrainer } from "./check";
import { selfTest, trainerSource } from "./store";

const GOOD = `(function (global) {
  function genOhm(p) {
    p = p || {};
    const R = p.R || [100, 220, 470][Math.floor(Math.random() * 3)];
    const I = p.I || 0.01;
    const U = R * I;
    return {
      title: "Spannung am Widerstand",
      prompt: "Gegeben R = " + R + " Ohm und I = " + I + " A. Gesucht U.",
      steps: [
        { label: "0 · Orientierung", warum: "Ohmsches Gesetz.", rechnung: [{ tex: "U = R \\\\cdot I", note: "Grundgleichung" }] },
        { label: "1 · Einsetzen", warum: "Werte einsetzen.", rechnung: [{ tex: "U = " + U.toFixed(2), note: "Ergebnis", ergebnis: true }],
          heft: { heft: "TH01", kap: "1.2" } },
      ],
      _test: { U: U },
    };
  }
  const G = [{ id: "ohm", name: "Ohm", fn: genOhm, topic: "Grundlagen", klausur: [{ quelle: "Probe", params: { R: 100, I: 0.02 }, erwartet: { U: 2 } }] }];
  global.T_GEN = G;
  global.T_COL = { Grundlagen: "#a8d8f0" };
})(typeof window !== 'undefined' ? window : globalThis);`;

describe("checkTrainer", () => {
  test("sauberer Trainer besteht", () => {
    const r = checkTrainer(GOOD, "T_GEN", "T_COL", 50);
    expect(r.problems).toEqual([]);
    expect(r).toMatchObject({ ok: true, generators: 1, runs: 51 });
  });
  test("falscher Erwartungswert fällt auf", () => {
    const r = checkTrainer(GOOD.replace("erwartet: { U: 2 }", "erwartet: { U: 3 }"), "T_GEN", "T_COL", 5);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain("erwartet 3");
  });
  test("NaN, fehlender Heft-Verweis und Ausnahmen", () => {
    const nan = checkTrainer(GOOD.replace("const U = R * I;", "const U = NaN;"), "T_GEN", null, 3);
    expect(nan.problems.some((p) => p.includes("NaN"))).toBe(true);
    const noRef = checkTrainer(GOOD.replace(`heft: { heft: "TH01", kap: "1.2" }`, `heft: { heft: "TH01" }`), "T_GEN", null, 3);
    expect(noRef.problems.some((p) => p.includes("Heft-Verweis"))).toBe(true);
    const boom = checkTrainer(GOOD.replace("const I = p.I || 0.01;", "throw new Error('kaputt');"), "T_GEN", null, 3);
    expect(boom.problems[0]).toContain("kaputt");
  });
  test("kein Zugriff auf Node", () => {
    const r = checkTrainer("require('fs'); global.X = [];", "X", null, 1);
    expect(r.ok).toBe(false);
  });
  test("Datei nur aus dem Trainer-Ordner", () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-trainer-"));
    mkdirSync(join(dir, "trainer"));
    writeFileSync(join(dir, "trainer", "t.js"), GOOD);
    writeFileSync(join(dir, "geheim.txt"), "x");
    const row = { id: "1", module_id: null, file: "trainer/t.js", title: "T", enabled: 1, global_name: "T_GEN", colors_name: "T_COL" };
    expect(selfTest(row, dir, 5).ok).toBe(true);
    expect(trainerSource({ ...row, file: "trainer/../geheim.txt" }, dir)).toBeNull();
  });
});
