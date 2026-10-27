import { describe, expect, test } from "bun:test";
import { latexToSpeech, markdownToSpeech } from "./speech";

describe("latexToSpeech", () => {
  test("einfache Formeln", () => {
    expect(latexToSpeech("U = R \\cdot I")).toBe("U gleich R mal I");
    expect(latexToSpeech("P = I^2 \\cdot R")).toBe("P gleich I Quadrat mal R");
  });
  test("Brüche, Indizes, Wurzel, griechisch", () => {
    expect(latexToSpeech("U_2 = U \\cdot \\frac{R_2}{R_1 + R_2}")).toBe("U 2 gleich U mal (R 2) durch (R 1 plus R 2)");
    expect(latexToSpeech("\\omega = 2\\pi f")).toBe("Omega gleich 2 Pi f");
    expect(latexToSpeech("x = \\sqrt{a}")).toBe("x gleich Wurzel aus a");
    expect(latexToSpeech("R = 1{,}5\\,\\mathrm{k}\\Omega")).toBe("R gleich 1,5 k Ohm");
  });
});

describe("markdownToSpeech", () => {
  test("Formelblock, Fett und Listen", () => {
    expect(markdownToSpeech("$$U = R \\cdot I$$\n\n- $U$: Spannung\n\n**Wann:** immer")).toBe("U gleich R mal I.\n\nU: Spannung\n\nWann: immer");
  });
});
