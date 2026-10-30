// API: Dokumente, Kapitel, Suche, Dashboard, Module
import { request } from "./request";
import type {
  Document,
  Chapter,
  SearchResult,
  Module,
  ModuleListItem,
  ModuleDetail,
  DashboardData,
} from "./types";

export const libraryApi = {
  health: () =>
    request<{ status: string; version: string }>("/api/health"),
  documents: {
    list: () => request<Document[]>("/api/documents"),
    get: (id: string) => request<Document>(`/api/documents/${id}`),
    upload: (form: FormData) =>
      request<{ id: string; title: string; filename: string }>(
        "/api/documents/upload",
        { method: "POST", body: form }
      ),
    remove: (id: string) =>
      request<{ status: string }>(`/api/documents/${id}`, { method: "DELETE" }),
    patch: (
      id: string,
      body: Partial<Pick<Document, "title" | "type" | "tags">> & {
        module_id?: string | null;
        thumb_page?: number;
        author?: string | null;
        short_code?: string | null;
        series_sequence?: string | null;
        second_language?: string | null;
        voice2?: string | null;
      }
    ) =>
      request<Document>(`/api/documents/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    reprocess: (id: string, opts?: { forceOcr?: boolean }) => {
      // force_ocr wird vor der Extraktion gespeichert
      const qs =
        opts?.forceOcr === undefined
          ? ""
          : `?force_ocr=${opts.forceOcr ? "true" : "false"}`;
      return request<{ status: string }>(
        `/api/documents/${id}/reprocess${qs}`,
        { method: "POST" }
      );
    },
    cancelExtract: (id: string) =>
      request<{ status: string }>(`/api/documents/${id}/extract/cancel`, { method: "POST" }),
    doclingStatus: () =>
      request<{ alive: boolean }>("/api/documents/docling/status"),
    tags: () => request<Array<{ label: string; usage: number }>>("/api/documents/tags/all"),
  },
  chapters: {
    list: (docId: string) => request<Chapter[]>(`/api/chapters/${docId}`),
    detect: (docId: string) =>
      request<{ status: string; chapters: number }>(`/api/chapters/detect/${docId}`, {
        method: "POST",
      }),
    patch: (id: string, body: Partial<Chapter>) =>
      request<Chapter>(`/api/chapters/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    remove: (id: string) =>
      request<{ status: string }>(`/api/chapters/${id}`, { method: "DELETE" }),
    merge: (chapterIds: string[]) =>
      request<{ status: string; kept: string }>(`/api/chapters/merge`, {
        method: "POST",
        body: JSON.stringify({ chapter_ids: chapterIds }),
      }),
  },
  search: {
    query: (q: string, limit = 10) =>
      request<SearchResult>(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`),
    status: () => request<{ enabled: boolean }>("/api/search/status"),
  },
  dashboard: {
    get: () => request<DashboardData>("/api/dashboard"),
  },
  modules: {
    list: () => request<ModuleListItem[]>("/api/modules"),
    get: (id: string) => request<ModuleDetail>(`/api/modules/${id}`),
    create: (body: Partial<Module>) =>
      request<{ id: string }>("/api/modules", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    patch: (id: string, body: Partial<Module>) =>
      request<{ status: string }>(`/api/modules/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    remove: (id: string) =>
      request<{ status: string }>(`/api/modules/${id}`, { method: "DELETE" }),
  },
};
