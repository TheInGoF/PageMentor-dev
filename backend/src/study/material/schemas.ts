// JSON-Schemas der Extraktion; Ollama erzwingt sie grammatisch (Felder wie im Studium Maker)
const STR = { type: "string" };
const BOOL = { type: "boolean" };
const NNUM = { type: ["number", "null"] };
const arr = (items: object) => ({ type: "array", items });
const obj = (properties: Record<string, object>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });

export const MERKSATZ_CATEGORIES = ["definition", "regel", "trick", "warnung", "zusammenhang"] as const;

export const SCHEMA_MERKSAETZE = obj(
  {
    merksaetze: arr(
      obj(
        {
          titel: STR,
          kategorie: { type: "string", enum: [...MERKSATZ_CATEGORIES] },
          merksatz: STR,
          erklaerung: STR,
          eselsbruecke: STR,
          verweis: STR,
          unsicher: BOOL,
        },
        ["titel", "kategorie", "merksatz", "unsicher"]
      )
    ),
  },
  ["merksaetze"]
);

export const SCHEMA_FORMELN = obj(
  {
    formeln: arr(
      obj(
        {
          name: STR,
          formel: STR,
          symbole: arr(obj({ symbol: STR, bedeutung: STR, einheit: STR }, ["symbol", "bedeutung"])),
          anwendungsfall: STR,
          stolperfalle: STR,
          verweis: STR,
          umgestellt: BOOL,
          unsicher: BOOL,
        },
        ["name", "formel", "unsicher"]
      )
    ),
  },
  ["formeln"]
);

export const SCHEMA_AUFGABEN = obj(
  {
    aufgaben: arr(
      obj(
        {
          nummer: STR,
          titel: STR,
          punkte: NNUM,
          teilaufgaben: arr(
            obj(
              {
                nummer: STR,
                punkte: NNUM,
                typ_erkennen: STR,
                gegeben: arr(STR),
                gesucht: STR,
                formeln: arr(STR),
                schritte: arr(STR),
                checkliste: arr(STR),
                stolperfalle: STR,
                verweis: STR,
                unsicher: BOOL,
              },
              ["nummer", "typ_erkennen", "gesucht", "unsicher"]
            )
          ),
        },
        ["nummer", "titel", "teilaufgaben"]
      )
    ),
  },
  ["aufgaben"]
);

export const SCHEMA_REZEPTE = obj(
  {
    aufgabentypen: arr(
      obj(
        {
          code: STR,
          titel: STR,
          kapitel: STR,
          worum_gehts: STR,
          erkennen: STR,
          groessen: arr(obj({ symbol: STR, bedeutung: STR }, ["symbol", "bedeutung"])),
          formeln: arr(obj({ formel: STR, erklaerung: STR }, ["formel"])),
          vorgehen: arr(STR),
          stolperfalle: STR,
          unsicher: BOOL,
        },
        ["code", "titel", "worum_gehts", "erkennen", "vorgehen", "stolperfalle"]
      )
    ),
  },
  ["aufgabentypen"]
);
