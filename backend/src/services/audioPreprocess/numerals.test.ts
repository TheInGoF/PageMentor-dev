import { describe, expect, test } from "bun:test";
import { fixGermanNumeralBleed } from "./numerals";

describe("Zahlwörter reparieren", () => {
  test("verdrehte Zehner und Einer werden umgestellt", () => {
    expect(fixGermanNumeralBleed("blieben achtzigvier Prozent übrig").text).toBe("blieben vierundachtzig Prozent übrig");
    expect(fixGermanNumeralBleed("Achtzigeins Seiten, hundertsiebzigfünf Meter").text).toBe("Einundachtzig Seiten, hundertfünfundsiebzig Meter");
  });

  test("richtige Zahlwörter bleiben unverändert", () => {
    const s = "vierundachtzig Prozent, achtzig Jahre, zwanzig Kilometer, dreißig Sekunden, Vierziger";
    expect(fixGermanNumeralBleed(s).text).toBe(s);
  });

  test("Abschnittsverweise, Jahre, ff. und Wortbrei wie bisher", () => {
    const r = fixGermanNumeralBleed("Beispiel zwei Punkt fünf aus zweitausendachtzehn, Seite 104 ff. Dann zwehaufachtzig.");
    expect(r.text).toBe("Beispiel 2.5 aus 2018, Seite 104 und folgende. Dann zwehaufachtzig.");
    expect(r.rejected).toEqual(["zwehaufachtzig"]);
  });
});
