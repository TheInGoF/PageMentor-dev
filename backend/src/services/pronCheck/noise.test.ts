import { describe, expect, test } from "bun:test";
import { isNoise } from "./noise";

const d = (expected: string, heard: string) => ({ kind: "different", expected, heard });
describe("Ausspracheprüfung: Rauschen herausfiltern", () => {
  test("kein Aussprachefehler", () => {
    for (const [e, h] of [
      ["eins", "1"], ["Null Komma fünf", "0 ,5"], ["Erstens,", "1."], ["fünfzig Prozent", "50 %"], ["zwei Komma drei zwei ein neun minus zwei Komma eins fünf sieben fünf.", "2 ,3219 -2 ,1575."],
      ["zum Beispiel", "z .B."], ["das heißt", "d .h."], ["beziehungsweise", "bzw."], ["Rausch Verhältnis und so weiter.", "Rauschverhältnis usw."],
      ["Deh Ess Peh,", "DSP,"], ["Ess Enn Err", "SNR"], ["Peh Zeh", "PC"], ["Geh Peh Ess", "GPS"],
      ["nichtquantisierte", "nicht quantisierte"], ["Signal Rausch Verhältnis", "Signalrauschverhältnis"], ["Internetserver", "Internet -Server"], ["Deltafunktion.", "Delta -Funktion."],
      ["codiert", "kodiert"], ["Information.", "Informationen."], ["wider:", "wieder."], ["infrage.", "in Frage."], ["Signalund", "Signal - und"],
      ["z", "10s"], ["q,", "k,"], ["P_s", "Pys"], ["H A", "HA"], ["B 1 gegeben A 1 und B 2", "B1"],
    ])
      expect(isNoise(d(e, h))).toBe(true);
    expect(isNoise({ kind: "unsure", expected: "Die", heard: "Die" })).toBe(true);
    expect(isNoise({ kind: "extra", expected: "", heard: "-" })).toBe(true);
    expect(isNoise({ kind: "missing", expected: "t", heard: "" })).toBe(true);
  });

  test("echte Fehler bleiben", () => {
    for (const [e, h] of [
      ["Empfang", "Empfangfang"], ["Hauptkapitel", "Hauptkattel"], ["Kehrwert", "Care -Wert"], ["Signalanteile", "Signallandteile"],
      ["Qualitätsvergleich", "Qualität -Hates -Vergleich"], ["Logarithmus", "Logarith. Humus"], ["bedingte", "Ding der"], ["Empfangsantenne,", "Empfangsandne,"],
    ])
      expect(isNoise(d(e, h))).toBe(false);
    expect(isNoise({ kind: "missing", expected: "Wovon hängt die übertragbare Informationsmenge ab?", heard: "" })).toBe(false);
    expect(isNoise({ kind: "extra", expected: "", heard: "Bis zum nächsten Mal." })).toBe(false);
  });
});
