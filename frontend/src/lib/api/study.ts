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

export type MaterialKind = "aufgabe" | "rezept" | "merksatz" | "formel";

export interface MaterialItem {
  id: string;
  module_id: string | null;
  kind: MaterialKind;
  title: string;
  body_md: string;
  category: string | null;
  source_document_id: string | null;
  source_ref: string | null;
  uncertain: number;
  sort_order: number;
  checked_at?: string | null;
}

export type MaterialCounts = Record<MaterialKind | "uncertain", number>;

export interface Trainer {
  id: string;
  module_id: string | null;
  file: string;
  title: string;
  enabled: number;
  global_name: string | null;
  colors_name: string | null;
}

export interface TrainerCheck {
  ok: boolean;
  generators: number;
  runs: number;
  problems: string[];
}

export const studyApi = {
  study: {
    prefixes: (moduleId: string) => request<{ prefixes: ModulePrefix[] }>(`/api/study/prefixes?module=${encodeURIComponent(moduleId)}`),
    setPrefixes: (moduleId: string, items: Array<{ prefix: string; confirmed: boolean; evidence?: string | null }>) =>
      request<{ prefixes: ModulePrefix[] }>(`/api/study/prefixes/${moduleId}`, { method: "PUT", body: JSON.stringify({ items }) }),
    assign: (docId: string, moduleId: string | null) =>
      request<{ updated: boolean }>(`/api/study/assign/${docId}`, { method: "POST", body: JSON.stringify({ moduleId }) }),
    material: (moduleId: string) => request<{ items: MaterialItem[]; counts: MaterialCounts }>(`/api/study/material/${moduleId}`),
    setChecked: (id: string, checked: boolean) =>
      request<{ updated: boolean }>(`/api/study/material/item/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ uncertain: !checked }) }),
    extract: (documentId: string) =>
      request<{ started: boolean }>("/api/study/material/extract", { method: "POST", body: JSON.stringify({ documentId }) }),
    recipes: (moduleId: string) => request<{ started: boolean }>(`/api/study/material/recipes/${moduleId}`, { method: "POST" }),
    trainers: (moduleId: string) => request<{ trainers: Trainer[] }>(`/api/study/trainers?module=${encodeURIComponent(moduleId)}`),
    trainerSource: async (id: string) => {
      const res = await fetch(`/api/study/trainers/${id}/source`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
      return res.text();
    },
    trainerCheck: (id: string) => request<TrainerCheck>(`/api/study/trainers/${id}/check`),
    addTime: (body: { date: string; module_id: string | null; kind: string; minutes: number; origin?: "auto" | "manual"; note?: string }) =>
      request<unknown>("/api/study/time", { method: "POST", body: JSON.stringify(body) }),
    pickFolder: () => request<{ folder: string | null }>("/api/study/import/pick", { method: "POST" }),
    import: (folder: string, dryRun: boolean) =>
      request<StudyImportReport>("/api/study/import", { method: "POST", body: JSON.stringify({ folder, dryRun }) }),
  },
};
