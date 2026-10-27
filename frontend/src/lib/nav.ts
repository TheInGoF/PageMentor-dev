// Hauptnavigation als Kontext: jede Seite zeigt dieselben fünf Bereiche, ohne Props durchzureichen
import { createContext, useContext } from "react";

export type MainView = "dashboard" | "plan" | "modules" | "library" | "tutor";

export const MAIN_VIEWS: Array<{ id: MainView; key: string }> = [
  { id: "dashboard", key: "nav.home" },
  { id: "plan", key: "nav.plan" },
  { id: "modules", key: "nav.modules" },
  { id: "library", key: "nav.library" },
  { id: "tutor", key: "nav.tutor" },
];

export const NavContext = createContext<{ view: string; go: (v: MainView) => void } | null>(null);

export function useNav() {
  return useContext(NavContext);
}
