// Wissenschaften der Module (Liste und Farben vom Server), einmal geladen und geteilt
import { useEffect, useState } from "react";
import { api, type DisciplineTaxonomy } from "./api";

let cache: Promise<DisciplineTaxonomy> | null = null;

export function useDisciplines(): DisciplineTaxonomy | null {
  const [tax, setTax] = useState<DisciplineTaxonomy | null>(null);
  useEffect(() => {
    cache ??= api.modules.disciplines().catch((err) => {
      cache = null;
      throw err;
    });
    let stop = false;
    void cache.then((r) => !stop && setTax(r)).catch(() => undefined);
    return () => {
      stop = true;
    };
  }, []);
  return tax;
}
