// App-Version aus VERSION (Repo-Wurzel), sonst package.json
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

export const APP_VERSION = ((): string => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const path of [join(here, "..", "..", "VERSION"), join(here, "..", "VERSION")]) {
    try {
      const v = readFileSync(path, "utf-8").trim();
      if (v) return v;
    } catch {
      // nächster Kandidat
    }
  }
  try {
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf-8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();
