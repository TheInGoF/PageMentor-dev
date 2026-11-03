import { describe, expect, test } from "bun:test";
import { intToGerman, verbalizeNumbers } from "./spokenNumbers";

describe("intToGerman", () => {
  test("Grundzahlen", () => {
    expect(intToGerman(1)).toBe("eins");
    expect(intToGerman(21)).toBe("einundzwanzig");
    expect(intToGerman(101)).toBe("einhunderteins");
    expect(intToGerman(1001)).toBe("eintausend eins");
    expect(intToGerman(21000)).toBe("einundzwanzigtausend");
    expect(intToGerman(250000)).toBe("zweihundertfünfzigtausend");
  });
  test("Millionen und Milliarden", () => {
    expect(intToGerman(1000000)).toBe("eine Million");
    expect(intToGerman(1234567)).toBe("eine Million zweihundertvierunddreißigtausend fünfhundertsiebenundsechzig");
    expect(intToGerman(3500000)).toBe("drei Millionen fünfhunderttausend");
    expect(intToGerman(2000000001)).toBe("zwei Milliarden eins");
  });
});

describe("verbalizeNumbers", () => {
  test("Kommazahlen Ziffer für Ziffer nach dem Komma", () => {
    expect(verbalizeNumbers("p ist 0,318.")).toBe("p ist null Komma drei eins acht.");
    expect(verbalizeNumbers("rund 2,5 Prozent")).toBe("rund zwei Komma fünf Prozent");
    expect(verbalizeNumbers("1.234,56 Euro")).toBe("eintausend zweihundertvierunddreißig Komma fünf sechs Euro");
  });
  test("große Zahlen mit und ohne Trenner", () => {
    expect(verbalizeNumbers("1.250.000 Einwohner")).toBe("eine Million zweihundertfünfzigtausend Einwohner");
    expect(verbalizeNumbers("250 000 Bit")).toBe("zweihundertfünfzigtausend Bit");
    expect(verbalizeNumbers("genau 123456 Fälle")).toBe("genau einhundertdreiundzwanzigtausend vierhundertsechsundfünfzig Fälle");
  });
  test("kleine Zahlen, Jahre und Nummern bleiben", () => {
    const keep = "Im Jahr 2018 kamen 1.000 Leute, Beispiel 2.1, Seite 104, Werte 1,2,3 und 4.500 Euro.";
    expect(verbalizeNumbers(keep)).toBe(keep);
    expect(verbalizeNumbers("am 1.10.2020")).toBe("am 1.10.2020");
  });
  test("sehr lange Ziffernfolgen Ziffer für Ziffer", () => {
    expect(verbalizeNumbers("ISBN 9783161484100")).toBe("ISBN neun sieben acht drei eins sechs eins vier acht vier eins null null");
  });
});
