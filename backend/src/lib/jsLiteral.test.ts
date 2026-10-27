import { describe, expect, test } from "bun:test";
import { extractConst, JsLiteralError, parseJsLiteral } from "./jsLiteral";

describe("parseJsLiteral", () => {
  test("Objekte mit bloßen Schlüsseln, einfache Anführungszeichen, Kommentare", () => {
    const src = `[ {g:'Gruppe A', items:[ ['Modul Eins','K',6,1,'MOD1'], // Kommentar
      ['Labor Zwei','L',0,3,''], ]}, /* block */ {g:"B", items:[]} ]`;
    expect(parseJsLiteral(src)).toEqual([
      { g: "Gruppe A", items: [["Modul Eins", "K", 6, 1, "MOD1"], ["Labor Zwei", "L", 0, 3, ""]] },
      { g: "B", items: [] },
    ]);
  });
  test("Escapes und Zahlen", () => {
    expect(parseJsLiteral(`['It\\'s', "a\\"b", -1.5, 2e3, true, null]`)).toEqual(["It's", 'a"b', -1.5, 2000, true, null]);
  });
  test("Code wird nicht ausgeführt", () => {
    expect(() => parseJsLiteral(`[alert(1)]`)).toThrow(JsLiteralError);
  });
});

describe("extractConst", () => {
  test("findet die Konstante zwischen anderem Code", () => {
    const html = `<script> const X = 1; const DATES = [ '2030-01-05', // a ]
      '2030-02-16' ]; function f(){ return "]"; } </script>`;
    expect(extractConst(html, "DATES")).toEqual(["2030-01-05", "2030-02-16"]);
    expect(extractConst(html, "FEHLT")).toBeUndefined();
  });
});
