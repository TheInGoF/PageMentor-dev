// API: Studienplan (Leistungen, Termine, Fortschritt, Lernzeit)
import { request } from "./request";

export type AssessmentKind = "K" | "B" | "L" | "S" | "P" | "A" | "M" | "X" | "H";
export type AssessmentStatus = "geplant" | "in_arbeit" | "angemeldet" | "bestanden" | "nicht_bestanden" | "abgemeldet";

export interface Assessment {
  id: string;
  module_id: string | null;
  kind: AssessmentKind;
  title: string;
  date: string | null;
  status: AssessmentStatus;
  attempt: number;
  cp: number;
  grade: number | null;
  note: string | null;
}

export interface StudyProgress {
  earnedCp: number;
  totalCp: number | null;
  average: number | null;
  passedModules: number;
  openModules: number;
  nextExam: (Assessment & { module_code: string | null; days: number }) | null;
}

export interface ExamSlot {
  date: string;
  estimate: boolean;
}

export interface ShiftPlan {
  steps: Array<{ id: string; title: string; from: string; to: string; estimate: boolean }>;
  warnings: string[];
}

export interface StudyTimeInfo {
  perDay: Array<{ date: string; minutes: number }>;
  perModule: Array<{ module_id: string | null; minutes: number }>;
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const planApi = {
  plan: {
    progress: () => request<StudyProgress>("/api/study/progress"),
    list: () => request<{ assessments: Assessment[] }>("/api/study/assessments"),
    create: (a: Partial<Assessment> & { title: string }) => request<Assessment>("/api/study/assessments", json("POST", a)),
    update: (id: string, patch: Partial<Assessment>) => request<Assessment>(`/api/study/assessments/${id}`, json("PATCH", patch)),
    remove: (id: string) => request<{ deleted: boolean }>(`/api/study/assessments/${id}`, json("DELETE")),
    retry: (id: string) => request<Assessment>(`/api/study/assessments/${id}/retry`, json("POST")),
    shift: (id: string, apply: boolean) => request<ShiftPlan>(`/api/study/assessments/${id}/shift${apply ? "?apply=1" : ""}`, json("POST")),
    slots: () => request<{ slots: ExamSlot[] }>("/api/study/exam-dates"),
    time: (from: string, to: string) => request<StudyTimeInfo>(`/api/study/time?from=${from}&to=${to}`),
  },
};
