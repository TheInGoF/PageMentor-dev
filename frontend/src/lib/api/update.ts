// API: Update aus der App
import { request } from "./request";

export interface UpdateInfo {
  current: string;
  latest: string | null;
  newer: boolean;
  canInstall: boolean;
  releaseUrl: string | null;
  phase: "idle" | "downloading" | "installing" | "error";
  fraction: number | null;
  error: string | null;
}

export const updateApi = {
  update: {
    check: (force = false) => request<UpdateInfo>(`/api/update${force ? "?force=1" : ""}`),
    progress: () => request<UpdateInfo>("/api/update/progress"),
    install: () => request<UpdateInfo>("/api/update/install", { method: "POST" }),
  },
};
