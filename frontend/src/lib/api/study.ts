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
  assessments: ImportCount;
  time: ImportCount;
  material: ImportCount;
  trainers: ImportCount;
  examDates: ImportCount;
  warnings: string[];
  progress: { earnedCp: number; average: number | null };
}

export const studyApi = {
  study: {
    pickFolder: () => request<{ folder: string | null }>("/api/study/import/pick", { method: "POST" }),
    import: (folder: string, dryRun: boolean) =>
      request<StudyImportReport>("/api/study/import", { method: "POST", body: JSON.stringify({ folder, dryRun }) }),
  },
};
