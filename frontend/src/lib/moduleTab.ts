// Modul an einem bestimmten Reiter öffnen (z. B. von der Startseite direkt ins Material)
// Vier Reiter, Lernen und Üben haben Unterbereiche; ein Ziel kann auch ein Heft vorwählen
export type ModuleView = "overview" | "learn" | "practice" | "audio";
export type LearnPart = "docs" | "summaries" | "material" | "graph";
export type PracticePart = "trainer" | "cards" | "exams";
export type ModuleTab = ModuleView | LearnPart | PracticePart | "documents";

export interface ModuleTarget {
  view: ModuleView;
  learn?: LearnPart;
  practice?: PracticePart;
  docId?: string;
}

export function resolveModuleTab(tab: ModuleTab, docId?: string): ModuleTarget {
  switch (tab) {
    case "documents":
    case "docs":
      return { view: "learn", learn: "docs", docId };
    case "summaries":
    case "material":
    case "graph":
      return { view: "learn", learn: tab, docId };
    case "trainer":
    case "cards":
    case "exams":
      return { view: "practice", practice: tab, docId };
    default:
      return { view: tab, docId };
  }
}

let pending: ModuleTarget | null = null;

export function openModuleAt(moduleId: string, tab: ModuleTab, open: (id: string) => void, docId?: string): void {
  pending = resolveModuleTab(tab, docId);
  open(moduleId);
}

// Einmalig abholen: beim nächsten Öffnen gilt wieder die Übersicht
export function takeModuleTab(): ModuleTarget | null {
  const target = pending;
  pending = null;
  return target;
}
