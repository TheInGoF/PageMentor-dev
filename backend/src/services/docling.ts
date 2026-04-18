/**
 * Docling-Serve-Client. Wir nutzen ausschließlich den asynchronen
 * Endpoint, weil eine 100-Seiten-PDF auf der Synology-CPU locker
 * 30+ Minuten dauert und der sync-Endpoint ohnehin nach 120 s aufgibt.
 *
 * Flow:
 *   1. POST /v1/convert/file/async → liefert { task_id }
 *   2. GET /v1/status/poll/{task_id} alle paar Sekunden, bis task_status
 *      "success" (oder "failure") ist.
 *   3. GET /v1/result/{task_id} → volles DoclingResponse-JSON.
 *
 * Ausgabe sind (a) das komplette Markdown und (b) eine aus dem
 * strukturierten JSON abgeleitete Kapitel-Liste. Kapitel-Erkennung
 * wählt den "richtigen" Heading-Level dynamisch: den kleinsten Level,
 * der mindestens dreimal auftritt — so passt sich das an Studienhefte
 * mit H1-Kapiteln genauso an wie an Scripte, die nur mit H2 gliedern.
 */

import { readFile } from "fs/promises";
import { basename } from "path";
import { setTimeout as sleep } from "timers/promises";

const DOCLING_URL = process.env.PM_DOCLING_URL || "http://docling:5001";
const DOCLING_API_KEY = process.env.PM_DOCLING_API_KEY || "";
const POLL_INTERVAL_MS = 4000;

export interface DoclingSection {
  number: number;        // 1-basiert
  title: string;
  startPage: number;
  endPage: number;
  text: string;          // Markdown-Absätze dieses Abschnitts
}

export interface DoclingExtraction {
  markdown: string;
  pageCount: number;
  sections: DoclingSection[];
}

interface DoclingTextItem {
  label?: string;
  text?: string;
  level?: number;
  prov?: Array<{ page_no?: number }>;
}

interface DoclingDocumentJson {
  pages?: Record<string, unknown>;
  texts?: DoclingTextItem[];
}

interface DoclingResponse {
  document?: {
    md_content?: string;
    json_content?: DoclingDocumentJson;
  };
  status?: string;
  errors?: Array<{ error_message?: string }>;
}

interface AsyncTaskHandle {
  task_id: string;
}

interface PollResponse {
  task_status?: string;
  task_progress?: number;
  task_meta?: Record<string, unknown>;
  /** Manche docling-serve-Versionen packen zusätzliche Felder rein
   *  (z. B. processed_pages, total_pages). Wir nehmen alles was wir
   *  kriegen und loggen's für die Debug-Sicht. */
  [key: string]: unknown;
}

/** Fallback-Polling wenn WS nicht geht. */
async function pollUntilDone(
  taskId: string,
  signal: AbortSignal | undefined,
  report: (s: PollResponse) => string
): Promise<void> {
  while (true) {
    if (signal?.aborted) throw new Error("canceled");
    try {
      await sleep(POLL_INTERVAL_MS, undefined, { signal });
    } catch {
      throw new Error("canceled");
    }
    const res = await doclingFetch(`/v1/status/poll/${taskId}`);
    if (!res.ok) throw new Error(`docling poll failed ${res.status}`);
    const status = (await res.json()) as PollResponse;
    const state = report(status);
    if (state === "success") return;
    if (state === "failure" || state === "error") {
      throw new Error(`docling task ${taskId} failed: ${JSON.stringify(status)}`);
    }
  }
}

/** WS-Subscription. Docling pusht Status-Updates ohne 4s-Poll-Lag,
 *  und wir füllen das Log nicht mit identischen „noch am laufen"-
 *  Zeilen zu. Bei Verbindungsfehler wirft die Promise und der
 *  Caller fällt auf Polling zurück. */
async function subscribeViaWs(
  taskId: string,
  signal: AbortSignal | undefined,
  report: (s: PollResponse) => string
): Promise<void> {
  const wsBase = DOCLING_URL.replace(/^http:\/\//, "ws://").replace(/^https:\/\//, "wss://");
  const authQuery = DOCLING_API_KEY ? `?api_key=${encodeURIComponent(DOCLING_API_KEY)}` : "";
  const url = `${wsBase}/v1/status/ws/${taskId}${authQuery}`;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      reject(err);
      return;
    }

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* best effort */
      }
      fn();
    };

    // Wenn die Verbindung nicht binnen 5 s steht, werfen wir.
    const connectTimeout = setTimeout(() => {
      finish(() => reject(new Error("WS connect timeout")));
    }, 5000);

    ws.addEventListener("open", () => {
      clearTimeout(connectTimeout);
    });

    ws.addEventListener("message", (ev: MessageEvent) => {
      let payload: { message?: string; task?: PollResponse; error?: string };
      try {
        payload = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
      } catch {
        return;
      }
      if (payload.message === "error") {
        finish(() =>
          reject(new Error(`docling WS error: ${payload.error ?? "(no detail)"}`))
        );
        return;
      }
      const task = payload.task;
      if (!task) return;
      const state = report(task);
      if (state === "success") {
        finish(() => resolve());
      } else if (state === "failure" || state === "error") {
        finish(() =>
          reject(new Error(`docling task ${taskId} failed: ${JSON.stringify(task)}`))
        );
      }
    });

    ws.addEventListener("error", (ev: Event) => {
      clearTimeout(connectTimeout);
      finish(() =>
        reject(new Error(`WS error: ${(ev as unknown as { message?: string }).message ?? "unknown"}`))
      );
    });

    ws.addEventListener("close", () => {
      clearTimeout(connectTimeout);
      // Wenn WS zu schließt ohne dass wir ein "success" gesehen haben,
      // liefern wir das als Fehler — der Caller poll dann fallback.
      finish(() => reject(new Error("WS closed before task completion")));
    });

    signal?.addEventListener("abort", () => {
      finish(() => reject(new Error("canceled")));
    });
  });
}

function numOr(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

async function doclingFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (DOCLING_API_KEY) headers.set("X-Api-Key", DOCLING_API_KEY);
  return fetch(`${DOCLING_URL}${path}`, { ...init, headers });
}

/** Health-Check — wird beim Pipeline-Start kurz angerufen, damit wir
 *  einen sauberen Fehler werfen können falls docling-serve down ist. */
export async function doclingAlive(): Promise<boolean> {
  try {
    const res = await doclingFetch("/health", { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function extractPdfViaDocling(params: {
  pdfPath: string;
  language?: string;
  signal?: AbortSignal;
  onProgress?: (message: string, fraction?: number) => void;
}): Promise<DoclingExtraction> {
  const { pdfPath, language = "de", signal, onProgress } = params;

  // ---- 1. Upload -----------------------------------------------------
  const fileBuf = await readFile(pdfPath);
  const form = new FormData();
  form.append(
    "files",
    new Blob([new Uint8Array(fileBuf)], { type: "application/pdf" }),
    basename(pdfPath)
  );
  form.append("to_formats", "md");
  form.append("to_formats", "json");
  form.append("from_formats", "pdf");
  form.append("ocr_lang", language === "en" ? "en" : "de");
  form.append("do_ocr", "true");
  form.append("table_mode", "fast");
  form.append("pdf_backend", "dlparse_v2");
  form.append("abort_on_error", "false");

  onProgress?.("Docling: Upload läuft …");
  const uploadRes = await doclingFetch("/v1/convert/file/async", {
    method: "POST",
    body: form,
    signal,
  });
  if (!uploadRes.ok) {
    const body = await uploadRes.text();
    throw new Error(`docling upload failed ${uploadRes.status}: ${body.slice(0, 300)}`);
  }
  const { task_id } = (await uploadRes.json()) as AsyncTaskHandle;
  if (!task_id) throw new Error("docling upload missing task_id");

  // ---- 2. Auf Fertigstellung warten ---------------------------------
  // Bevorzugt WebSocket (Push-basiert, keine Poll-Log-Flut). Fällt
  // automatisch auf Polling zurück falls die WS-Verbindung nicht
  // zustande kommt (älteres docling-serve, Proxy blockt, o. ä.).
  let lastLoggedState = "";
  const reportStatus = (status: PollResponse) => {
    const state = status.task_status?.toLowerCase() ?? "unknown";
    if (state !== lastLoggedState) {
      const extras: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(status)) {
        if (k !== "task_status") extras[k] = v;
      }
      console.log(
        `[docling] task=${task_id.slice(0, 8)} state=${state} ${JSON.stringify(extras)}`
      );
      lastLoggedState = state;
    }

    const meta = (status.task_meta ?? {}) as Record<string, unknown>;
    const processed =
      numOr((status as Record<string, unknown>).num_processed) ??
      numOr(meta.num_processed) ??
      numOr(meta.processed_pages) ??
      numOr(meta.current_page);
    const total =
      numOr((status as Record<string, unknown>).num_docs) ??
      numOr(meta.num_docs) ??
      numOr(meta.total_pages) ??
      numOr(meta.page_count);

    let fraction: number | undefined;
    if (processed != null && total && total > 0) {
      fraction = Math.max(0, Math.min(1, processed / total));
    } else if (typeof status.task_progress === "number") {
      fraction = status.task_progress;
    }

    const progressSuffix =
      processed != null && total
        ? ` · ${processed} / ${total}`
        : fraction != null
        ? ` · ${Math.round(fraction * 100)}%`
        : "";
    onProgress?.(`Docling: ${state}${progressSuffix}`, fraction);
    return state;
  };

  try {
    await subscribeViaWs(task_id, signal, reportStatus);
  } catch (wsErr) {
    // WS nicht verfügbar → Fallback aufs klassische Polling.
    console.log(
      `[docling] WS-Subscription nicht möglich (${(wsErr as Error).message}), falle auf Polling zurück`
    );
    await pollUntilDone(task_id, signal, reportStatus);
  }

  // ---- 3. Result abholen --------------------------------------------
  onProgress?.("Docling: Ergebnis abholen …");
  const resultRes = await doclingFetch(`/v1/result/${task_id}`);
  if (!resultRes.ok) {
    throw new Error(`docling result fetch failed ${resultRes.status}`);
  }
  const result = (await resultRes.json()) as DoclingResponse;
  if (result.status && result.status !== "success" && result.status !== "partial_success") {
    throw new Error(
      `docling conversion status=${result.status}: ${result.errors?.[0]?.error_message ?? "(no details)"}`
    );
  }

  const markdown = result.document?.md_content ?? "";
  const json = result.document?.json_content ?? {};
  const pageCount = Object.keys(json.pages ?? {}).length || 0;
  const sections = buildSections(json, pageCount, markdown);

  return { markdown, pageCount, sections };
}

/** Wählt den Heading-Level, auf dem die Kapitel-Grenzen gesetzt werden.
 *  Nimmt den kleinsten Level, der mindestens 3× im Dokument auftaucht. */
function pickChapterLevel(items: DoclingTextItem[]): number {
  const counts = new Map<number, number>();
  for (const it of items) {
    if (it.label === "section_header" || it.label === "title") {
      const lvl = typeof it.level === "number" && it.level > 0 ? it.level : 1;
      counts.set(lvl, (counts.get(lvl) ?? 0) + 1);
    }
  }
  const candidates = [...counts.entries()]
    .filter(([, n]) => n >= 3)
    .sort(([a], [b]) => a - b);
  return candidates[0]?.[0] ?? 1;
}

function buildSections(
  doc: DoclingDocumentJson,
  pageCount: number,
  fullMarkdown: string
): DoclingSection[] {
  const items = doc.texts ?? [];
  if (items.length === 0) {
    return [
      {
        number: 1,
        title: "Dokument",
        startPage: 1,
        endPage: Math.max(1, pageCount),
        text: fullMarkdown,
      },
    ];
  }

  const chapterLevel = pickChapterLevel(items);
  const sections: Array<{
    title: string;
    startPage: number;
    endPage: number;
    parts: string[];
  }> = [];
  let cur: (typeof sections)[number] | null = null;

  for (const item of items) {
    const page = item.prov?.[0]?.page_no;
    const isHeader =
      (item.label === "section_header" || item.label === "title") &&
      (typeof item.level === "number" ? item.level : 1) <= chapterLevel;

    if (isHeader) {
      if (cur) sections.push(cur);
      cur = {
        title: (item.text ?? "").trim(),
        startPage: page ?? (sections.at(-1)?.endPage ?? 1),
        endPage: page ?? (sections.at(-1)?.endPage ?? 1),
        parts: [],
      };
      continue;
    }

    if (!cur) continue; // vor dem ersten Header → verworfen (Titelseite, TOC)

    // Absätze / Sections / Listenpunkte / Captions werden von Docling
    // bereits mit Rollen versehen — Captions, Footer, Header, Page-
    // Numbers droppen wir, alles andere geht in den Kapiteltext.
    const label = item.label ?? "text";
    if (["page_footer", "page_header", "page_number", "caption", "furniture"].includes(label)) {
      continue;
    }
    const text = (item.text ?? "").trim();
    if (text) cur.parts.push(text);
    if (page && page > cur.endPage) cur.endPage = page;
  }
  if (cur) sections.push(cur);

  if (sections.length === 0) {
    return [
      {
        number: 1,
        title: "Dokument",
        startPage: 1,
        endPage: Math.max(1, pageCount),
        text: fullMarkdown,
      },
    ];
  }

  return sections.map((s, idx) => ({
    number: idx + 1,
    title: s.title || `Abschnitt ${idx + 1}`,
    startPage: s.startPage,
    endPage: Math.max(s.startPage, s.endPage),
    text: s.parts.join("\n\n"),
  }));
}
