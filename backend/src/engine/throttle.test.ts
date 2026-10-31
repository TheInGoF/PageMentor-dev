import { describe, expect, test } from "bun:test";
import { limitFor, parseSamples, peakMbit, tcScript } from "./throttle";

describe("Download-Bremse", () => {
  test("Spitze des gleitenden 10-s-Mittels", () => {
    // 10 s Leerlauf, dann 20 s mit 100 Mbit/s (12,5 MB/s)
    const s = [];
    let bytes = 0;
    for (let t = 0; t <= 30; t++) {
      s.push({ t, bytes });
      bytes += t < 10 ? 1000 : 12_500_000;
    }
    expect(peakMbit(s)).toBe(100);
  });

  test("kurze Messung zählt als ein Fenster", () => {
    expect(peakMbit([{ t: 0, bytes: 0 }, { t: 4, bytes: 50_000_000 }])).toBe(100);
    expect(peakMbit([{ t: 0, bytes: 0 }])).toBe(0);
  });

  test("Messpunkte lesen", () => {
    expect(parseSamples("1.5 100\nmüll\n2.5 300\n")).toEqual([{ t: 1.5, bytes: 100 }, { t: 2.5, bytes: 300 }]);
  });

  test("Grenze aus Anteil", () => {
    expect(limitFor(300, 90)).toBe(270);
    expect(limitFor(300, 100)).toBeNull();
    expect(limitFor(null, 90)).toBeNull();
  });

  test("tc-Befehle", () => {
    const on = tcScript(270);
    expect(on).toContain("police rate 270000kbit burst 3375k");
    expect(on).toContain('match ip src "$GW"/32');
    expect(tcScript(null)).not.toContain("police");
  });
});
