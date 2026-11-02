import { describe, expect, test } from "bun:test";
import { cpuPercent, parseNvidiaSmi } from "./monitor";

describe("Leistungsanzeige", () => {
  test("CPU-Anteil aus zwei Messungen", () => {
    expect(cpuPercent({ idle: 100, total: 200 }, { idle: 150, total: 400 })).toBe(75);
    expect(cpuPercent({ idle: 100, total: 200 }, { idle: 100, total: 200 })).toBe(0);
  });

  test("nvidia-smi-Zeile, auch ohne Leistungswerte", () => {
    expect(parseNvidiaSmi("NVIDIA GeForce RTX 3090, 87, 21504, 24576, 71, 312.45, 350.00")).toEqual({
      name: "NVIDIA GeForce RTX 3090",
      gpu: 87,
      vramUsed: 21504 * 1024 * 1024,
      vramTotal: 24576 * 1024 * 1024,
      temp: 71,
      power: 312.45,
      powerLimit: 350,
    });
    expect(parseNvidiaSmi("RTX, 5, 100, 200, 40, [N/A], [N/A]")).toMatchObject({ gpu: 5, power: null, powerLimit: null });
    expect(parseNvidiaSmi("")).toBeNull();
  });
});
