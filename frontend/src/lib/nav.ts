// Hauptnavigation als Kontext: jede Seite zeigt dieselben fünf Bereiche, ohne Props durchzureichen
import { createContext, useContext } from "react";

export type MainView = "dashboard" | "plan" | "modules" | "library" | "tutor";

export const MAIN_VIEWS: Array<{ id: MainView; key: string; icon: string }> = [
  { id: "dashboard", key: "nav.home", icon: "⌂" },
  { id: "plan", key: "nav.plan", icon: "▦" },
  { id: "modules", key: "nav.modules", icon: "◫" },
  { id: "library", key: "nav.library", icon: "▤" },
  { id: "tutor", key: "nav.tutor", icon: "✦" },
];

export const NavContext = createContext<{ view: string; go: (v: MainView) => void } | null>(null);

export function useNav() {
  return useContext(NavContext);
}
