// API: Studium (Import aus dem Studium Maker; Plan und Leistungen folgen)
import { request } from "./request";

export interface ImportCount {
  created: number;
  updated: number;
  skipped: number;
}

export interface StudyImportReport {
  dryRun: boolean;
  folder: string;
  modules: ImportCount;
  prefixes: ImportCount;
  assessments: ImportCount;
  time: ImportCount;
  material: ImportCount;
  trainers: ImportCount;
  examDates: ImportCount;
  warnings: string[];
  progress: { earnedCp: number; average: number | null };
}

export interface ModulePrefix {
  prefix: string;
  module_id: string;
  confirmed: number;
  evidence: string | null;
}

export const studyApi = {
  study: {
    prefixes: (moduleId: string) => request<{ prefixes: ModulePrefix[] }>(`/api/study/prefixes?module=${encodeURIComponent(moduleId)}`),
    setPrefixes: (moduleId: string, items: Array<{ prefix: string; confirmed: boolean; evidence?: string | null }>) =>
      request<{ prefixes: ModulePrefix[] }>(`/api/study/prefixes/${moduleId}`, { method: "PUT", body: JSON.stringify({ items }) }),
    assign: (docId: string, moduleId: string | null) =>
      request<{ updated: boolean }>(`/api/study/assign/${docId}`, { method: "POST", body: JSON.stringify({ moduleId }) }),
    pickFolder: () => request<{ folder: string | null }>("/api/study/import/pick", { method: "POST" }),
    import: (folder: string, dryRun: boolean) =>
      request<StudyImportReport>("/api/study/import", { method: "POST", body: JSON.stringify({ folder, dryRun }) }),
  },
};
