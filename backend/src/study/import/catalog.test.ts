import { describe, expect, test } from "bun:test";
import { splitCatalog } from "./catalog";

describe("splitCatalog", () => {
  test("Einträge nach Grep-ID, Kategorien aus Zwischenüberschriften", () => {
    const md = `# Formelsammlung — TEST1

## Grundlagen

### TEST1-F-H1-01 · Ohmsches Gesetz
U = R · I

Anwendung: Widerstand bestimmen.

### TEST1-F-H1-02 — Leistung
P = U · I (unsicher)

## Wechselstrom

**TEST1-F-H2-01** Scheinleistung
S = U · I
`;
    const items = splitCatalog(md, "TEST1", "formel");
    expect(items.map((i) => i.id)).toEqual(["TEST1-F-H1-01", "TEST1-F-H1-02", "TEST1-F-H2-01"]);
    expect(items[0].title).toBe("Ohmsches Gesetz");
    expect(items[0].body).toContain("Anwendung");
    expect(items[0].category).toBe("Grundlagen");
    expect(items[2].category).toBe("Wechselstrom");
    expect(items[1].body).toContain("unsicher");
  });
  test("ohne IDs ein Katalog-Eintrag", () => {
    const items = splitCatalog("# Merksätze\n\nEtwas Text.", "TEST2", "merksatz");
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("TEST2-M-KATALOG");
  });
  test("doppelte IDs gehen nicht verloren", () => {
    const items = splitCatalog("### TEST3-R-A1 x\na\n### TEST3-R-A1 y\nb", "TEST3", "rezept");
    expect(items.map((i) => i.id)).toEqual(["TEST3-R-A1", "TEST3-R-A1-2"]);
  });
});
