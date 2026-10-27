// Hell, Dunkel oder wie Windows; Akzent-Palette. Gespeichert im Browser-Speicher des Fensters
export type ThemeMode = "system" | "light" | "dark";
export type Palette = "sky" | "sage" | "amber";

export const PALETTES: Palette[] = ["sky", "sage", "amber"];
const KEY = "pm-theme";

interface Prefs {
  mode: ThemeMode;
  palette: Palette;
}

export function themePrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<Prefs>;
    return { mode: p.mode ?? "system", palette: p.palette ?? "sky" };
  } catch {
    return { mode: "system", palette: "sky" };
  }
}

const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function applyTheme(prefs: Prefs = themePrefs()): void {
  const dark = prefs.mode === "dark" || (prefs.mode === "system" && media().matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.palette = prefs.palette;
  const bg = getComputedStyle(root).getPropertyValue("--bg").trim().replace(/ /g, ",");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", `rgb(${bg})`);
}

export function setThemePrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...themePrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ohne Speicher gilt die Wahl nur bis zum Neustart
  }
  applyTheme(next);
  return next;
}

// Beim Start setzen und Windows-Wechsel folgen
export function initTheme(): void {
  applyTheme();
  media().addEventListener("change", () => {
    if (themePrefs().mode === "system") applyTheme();
  });
}
