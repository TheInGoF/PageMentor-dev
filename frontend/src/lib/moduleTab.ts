// Modul an einem bestimmten Reiter öffnen (z. B. von der Startseite direkt ins Material)
export type ModuleTab = "overview" | "documents" | "material" | "practice" | "graph" | "audio" | "summaries";

let pending: ModuleTab | null = null;

export function openModuleAt(moduleId: string, tab: ModuleTab, open: (id: string) => void): void {
  pending = tab;
  open(moduleId);
}

// Einmalig abholen: beim nächsten Öffnen gilt wieder die Übersicht
export function takeModuleTab(): ModuleTab | null {
  const tab = pending;
  pending = null;
  return tab;
}
