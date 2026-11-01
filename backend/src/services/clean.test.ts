import { describe, expect, test } from "bun:test";
import { cleanForReading as fn } from "./clean";

describe("Silbentrennung am Zeilenende", () => {
  test("echte Trennung wird zusammengefügt", () => {
    expect(fn("die Verän-\nderung kommt")).toContain("Veränderung");
  });
  test("Ergänzungsstrich vor „und“, „oder“ bleibt", () => {
    expect(fn("der digitalen Signal-\nund Informationsverarbeitung")).toContain("Signal- und Informationsverarbeitung");
    expect(fn("Ein-\noder Ausgang")).toContain("Ein- oder Ausgang");
  });
  test("Wort, das mit „und“ beginnt, wird trotzdem zusammengefügt", () => {
    expect(fn("ganz-\nundurchsichtig")).toContain("ganzundurchsichtig");
  });
});
