/**
 * Docling-serve client. We exclusively use the asynchronous endpoint
 * because a 100-page PDF on the Synology CPU easily takes 30+ minutes
 * and the sync endpoint gives up after 120 s anyway.
 *
 * Flow:
 *   1. POST /v1/convert/file/async → returns { task_id }
 *   2. GET /v1/status/poll/{task_id} every few seconds until
 *      task_status is "success" (or "failure").
 *   3. GET /v1/result/{task_id} → full DoclingResponse JSON.
 *
 * Output is (a) the full Markdown and (b) a chapter list derived from
 * the structured JSON. Chapter detection picks the "right" heading
 * level dynamically: the smallest level that occurs at least three
 * times — that way it adapts to course booklets with H1 chapters as
 * well as scripts that only structure with H2.
 */

import { readFile } from "fs/promises";
import { basename } from "path";
import { setTimeout as sleep } from "timers/promises";
import { pickLang, tLang } from "../lib/i18n";

const DOCLING_URL = process.env.PM_DOCLING_URL || "http://docling:5001";
const DOCLING_API_KEY = process.env.PM_DOCLING_API_KEY || "";
const POLL_INTERVAL_MS = 4000;

/** Classification of a detected section. Drives which features use
 *  the section:
 *    - content:       real study text — goes into audiobook, cards, summary.
 *    - example:       examples — go into cards, NOT into the audiobook.
 *    - exercise:      exercises/problems — exam pool, not into audiobook.
 *    - summary:       summary at chapter end — good audiobook material.
 *    - self_check:    self-check exercises.
 *    - solutions:     solutions to exercises / self-check.
 *    - index:         TOC, glossary, subject index, fig./tab. index.
 *    - references:    bibliography, internet links.
 *    - meta:          preface, imprint, submission task, front matter.
 *    - other:         unclear classification — default.
 */
export type ChapterKind =
  | "content"
  | "example"
  | "exercise"
  | "summary"
  | "self_check"
  | "solutions"
  | "index"
  | "references"
  | "meta"
  | "other";

export interface DoclingSection {
  number: number;        // 1-based
  title: string;
  startPage: number;
  endPage: number;
  text: string;          // Markdown paragraphs of this section
  kind: ChapterKind;
}

export interface DoclingExtraction {
  markdown: string;
  pageCount: number;
  sections: DoclingSection[];
  /** Metadata extracted from the Docling document JSON. Both fields
   *  may be null if the PDF has no metadata fields (typical for
   *  scanned or self-published scripts). */
  metadata: {
    title: string | null;
    author: string | null;
  };
  /** Raw DoclingDocument JSON — for artifact dump to disk and later
   *  processing (table structure, image bounding boxes, …). Can be
   *  null if docling returned nothing. */
  docJson: unknown | null;
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
  /** PDF metadata via PyMuPDF / pypdfium. All fields optional;
   *  depending on the PDF source either one or the other is filled.
   *  Some course booklets carry the title in subject, others in title. */
  meta?: {
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    [key: string]: unknown;
  };
}

/** Pulls title + author from the Docling metadata. When the PDF has
 *  no or junk metadata (default "Microsoft Word — …" as title etc.),
 *  returns null; the caller then keeps the filename title and
 *  author stays empty. */
function extractDocMetadata(
  doc: DoclingDocumentJson
): { title: string | null; author: string | null } {
  const meta = doc.meta ?? {};
  const cleanTitle = (s: unknown): string | null => {
    if (typeof s !== "string") return null;
    const t = s.trim();
    if (!t) return null;
    // Filter out boilerplate titles PDF tools write by default.
    if (/^(microsoft\s+word|untitled|document\d*|new document|adobe.*photoshop)/i.test(t))
      return null;
    if (t.length > 200) return null; // probably not a title
    return t;
  };
  const cleanAuthor = (s: unknown): string | null => {
    if (typeof s !== "string") return null;
    const a = s.trim();
    if (!a) return null;
    // Default values from office suites no one cares about.
    if (/^(unknown|admin|user|administrator|standard)$/i.test(a)) return null;
    if (a.length > 150) return null;
    return a;
  };
  // Title fallback chain: title → subject → null. With PDFs from
  // Acrobat/InDesign, subject often holds the real book title when
  // the title field just repeats the filename.
  const title = cleanTitle(meta.title) ?? cleanTitle(meta.subject) ?? null;
  const author = cleanAuthor(meta.author);
  return { title, author };
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
  /** Some docling-serve versions add extra fields
   *  (e.g. processed_pages, total_pages). We accept everything we
   *  get and log it for debug visibility. */
  [key: string]: unknown;
}

/** Fallback polling when WS doesn't work. */
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

/** WS subscription. Docling pushes status updates without the 4s
 *  poll lag, and we don't flood the log with identical
 *  "still running" lines. On connection error the promise rejects
 *  and the caller falls back to polling. */
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

    // If the connection isn't up within 5 s, throw.
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
      // If WS closes without our seeing a "success", report it as
      // an error — the caller then falls back to polling.
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

/** Health check — called briefly at pipeline start so we can throw
 *  a clean error if docling-serve is down. */
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
  /** Re-run OCR over the rasterised pages even when the PDF carries
   *  extractable text. Useful for PDFs with broken font CMaps where
   *  /gNN glyph names leak into the text layer. Roughly 2x slower. */
  forceOcr?: boolean;
  signal?: AbortSignal;
  onProgress?: (message: string, fraction?: number) => void;
}): Promise<DoclingExtraction> {
  const { pdfPath, language = "de", forceOcr = false, signal, onProgress } = params;
  const lang = pickLang(language);

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
  if (forceOcr) {
    // Replaces extractable text with OCR-derived text. Saves PDFs with
    // broken CMaps where the text layer is /gNN glyph soup. Costs
    // roughly 2x extraction time, so opt-in per upload.
    form.append("force_ocr", "true");
  }
  form.append("table_mode", "fast");
  form.append("pdf_backend", "dlparse_v2");
  form.append("abort_on_error", "false");

  // Enrichment-Strategie:
  //
  // - FORMULA + CODE: server-seitig als Default eingeschaltet (via
  //   DOCLING_SERVE_OPTIONS_DO_FORMULA_ENRICHMENT=true und _CODE_=true
  //   im docling-Container). Läuft automatisch bei jedem convert-Call,
  //   wir senden keinen Flag.
  //
  // - PICTURE-DESCRIPTION: server-seitig PRELOADED (Modell ist
  //   geladen) aber NICHT als Default aktiviert. doc_storage opt-int
  //   per Call (do_picture_description=true). PageMentor sendet
  //   bewusst NICHTS dazu — der Audiobook-Workflow hat keinen Nutzen
  //   von Bildbeschreibungen und der Latenz-Hit pro Bild ist
  //   beträchtlich. Falls jemand hier do_picture_description=true
  //   einfügt, würden alle PageMentor-Uploads 5-10x länger dauern.
  //
  // Wir tried per-call form-field für formula in v1.18.171 — silent
  // "failure" responses weil CodeFormula mid-request lazy-laden musste
  // und crashte. Server-side preload + per-call opt-in (für Picture)
  // löst beide Klassen.

  onProgress?.(tLang(lang, "msg.doclingUploading"));
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

  // ---- 2. Wait for completion ---------------------------------------
  // Prefer WebSocket (push-based, no poll log flood). Automatically
  // falls back to polling if the WS connection can't be established
  // (older docling-serve, proxy blocks, etc.).
  //
  // docling-serve sends practically no status updates during
  // processing — the state stays "started" for the whole run with no
  // intermediate messages. So we run an INDEPENDENT interval-driven
  // heartbeat (not event-coupled) that emits a "Docling läuft … (Ns)"
  // progress event every 5 s. Without this the UI's progress card
  // freezes on the initial message and the user has no signal that
  // anything's happening.
  const HEARTBEAT_MS = 5_000;
  const startedAt = Date.now();
  let lastLoggedState = "";
  let lastReportedState = "started";
  let lastEventAt = Date.now();
  const reportStatus = (status: PollResponse) => {
    const state = status.task_status?.toLowerCase() ?? "unknown";
    const now = Date.now();
    lastEventAt = now;
    lastReportedState = state;
    const stateChanged = state !== lastLoggedState;

    if (stateChanged) {
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

  // Independent heartbeat: ticks every HEARTBEAT_MS regardless of
  // whether docling pushed an event. Emits an elapsed-seconds counter
  // so the user sees the run is alive. Cleared in finally{} so it
  // never leaks past task completion.
  const heartbeat = setInterval(() => {
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    const sinceLastEventSec = Math.round((Date.now() - lastEventAt) / 1000);
    onProgress?.(
      `Docling: ${lastReportedState} · ${elapsedSec}s`,
      undefined
    );
    // Also log a server-side heartbeat once a minute so the operator
    // can tell from logs whether docling is just slow or genuinely
    // stuck (no events in 60+ s).
    if (sinceLastEventSec >= 60 && elapsedSec % 60 < 5) {
      console.log(
        `[docling] task=${task_id.slice(0, 8)} alive (${elapsedSec}s elapsed, no event for ${sinceLastEventSec}s)`
      );
    }
  }, HEARTBEAT_MS);

  try {
    try {
      await subscribeViaWs(task_id, signal, reportStatus);
    } catch (wsErr) {
      // WS unavailable → fall back to classic polling.
      console.log(
        `[docling] WS subscription not possible (${(wsErr as Error).message}), falling back to polling`
      );
      await pollUntilDone(task_id, signal, reportStatus);
    }
  } finally {
    clearInterval(heartbeat);
  }

  // ---- 3. Fetch result ----------------------------------------------
  onProgress?.(tLang(lang, "msg.doclingFetchResult"));
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
  const metadata = extractDocMetadata(json);

  return {
    markdown,
    pageCount,
    sections,
    metadata,
    docJson: result.document?.json_content ?? null,
  };
}

/** Detects a numbered chapter heading ("1 Einleitung",
 *  "1.1 Grundlagen", "2.3.4 Detail"). Returns the depth (number of
 *  components) so we only take top-level chapters as boundaries. */
function numberedHeadingDepth(title: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)*)\s+\S/.exec(title);
  if (!m) return null;
  return m[1].split(".").length;
}

/** Titles that count as their own chapter in a course booklet even
 *  without numbering — they bring their classification along. */
const KNOWN_SECTION_TITLES: Array<{ pattern: RegExp; kind: ChapterKind }> = [
  { pattern: /^vorwort$/i, kind: "meta" },
  { pattern: /^einleitung$/i, kind: "meta" },
  { pattern: /^inhaltsverzeichnis$/i, kind: "index" },
  { pattern: /^(abbildungs|tabellen|sachwort|stichwort)verzeichnis$/i, kind: "index" },
  { pattern: /^glossar$/i, kind: "index" },
  { pattern: /^(literaturverzeichnis|literatur|bibliografie|quellen)$/i, kind: "references" },
  { pattern: /^(verwendete|empfohlene)\s+literatur$/i, kind: "references" },
  { pattern: /^internet[\s-]?links$/i, kind: "references" },
  { pattern: /^zusammenfassung$/i, kind: "summary" },
  { pattern: /^aufgaben\s+zur\s+selbst(überprüfung|kontrolle)$/i, kind: "self_check" },
  { pattern: /^lösungen\s+der\s+übungen/i, kind: "solutions" },
  { pattern: /^lösungen\s+der\s+aufgaben/i, kind: "solutions" },
  // Einsendeaufgaben — auch mit ESA-Suffix oder Heft-Nummer-Präfix
  // ("Einsendeaufgaben (ESA)", "ESA — Heft 3", "Einsendeaufgabenblatt").
  { pattern: /einsendeaufgabe/i, kind: "self_check" },
  { pattern: /\besa\s*\d|^\s*esa\b/i, kind: "self_check" },
  // Generic indexes — short titles ending in "Verzeichnis".
  { pattern: /\bverzeichnis$/i, kind: "index" },
];

/** Checks whether a heading is INLINE stuff (Beispiel, Übung, Tab.,
 *  Abb.) — i.e. should fold into the current section rather than be
 *  its own section. */
function isInlineMarker(title: string): boolean {
  return /^(beispiel|übung|aufgabe|tab\.|tabelle|abb\.|abbildung|fig\.|figure|tab|merksatz|hinweis|tipp)\s*\d/i.test(
    title.trim()
  );
}

/** Classifies a section by its title. */
function classifyKind(title: string, numberedDepth: number | null): ChapterKind {
  const t = title.trim();
  for (const { pattern, kind } of KNOWN_SECTION_TITLES) {
    if (pattern.test(t)) return kind;
  }
  // Numbered chapters are study content by default.
  if (numberedDepth != null) return "content";
  return "other";
}

/** Picks the chapter-boundary heuristic mode based on the available
 *  heading structure. Preferred: numbered top-level headings
 *  (depth=1), because in course booklets those are the real
 *  chapters. Fallback: heading level from Docling.
 */
function analyzeHeadings(items: DoclingTextItem[]): {
  useNumbered: boolean;
  numberedDepthCutoff: number;   // only relevant when useNumbered
  fallbackLevel: number;
} {
  let numberedDepth1 = 0;
  const levelCounts = new Map<number, number>();
  for (const it of items) {
    if (it.label !== "section_header" && it.label !== "title") continue;
    const title = (it.text ?? "").trim();
    if (!title || isInlineMarker(title)) continue;
    const depth = numberedHeadingDepth(title);
    if (depth === 1) numberedDepth1++;
    const lvl = typeof it.level === "number" && it.level > 0 ? it.level : 1;
    levelCounts.set(lvl, (levelCounts.get(lvl) ?? 0) + 1);
  }
  const useNumbered = numberedDepth1 >= 3;
  const fallbackLevel =
    [...levelCounts.entries()]
      .filter(([, n]) => n >= 3)
      .sort(([a], [b]) => a - b)[0]?.[0] ?? 1;
  return { useNumbered, numberedDepthCutoff: 1, fallbackLevel };
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
        kind: "content",
      },
    ];
  }

  const heur = analyzeHeadings(items);
  const sections: Array<{
    title: string;
    startPage: number;
    endPage: number;
    parts: string[];
    kind: ChapterKind;
  }> = [];
  let cur: (typeof sections)[number] | null = null;

  /** Decides whether an item triggers a new chapter start. */
  const isChapterBoundary = (item: DoclingTextItem): boolean => {
    if (item.label !== "section_header" && item.label !== "title") return false;
    const title = (item.text ?? "").trim();
    if (!title) return false;
    // Inline markers (Beispiel/Übung/Tab.) never become their own chapter.
    if (isInlineMarker(title)) return false;

    // Known special titles (glossary, references, summary…) always
    // count as a chapter boundary.
    if (KNOWN_SECTION_TITLES.some((k) => k.pattern.test(title))) return true;

    if (heur.useNumbered) {
      // Only numbered top-level headings ("1 ", "2 ", …).
      const depth = numberedHeadingDepth(title);
      return depth !== null && depth <= heur.numberedDepthCutoff;
    }

    // Fallback: Docling level ≤ chosen cutoff.
    const lvl = typeof item.level === "number" && item.level > 0 ? item.level : 1;
    return lvl <= heur.fallbackLevel;
  };

  for (const item of items) {
    const page = item.prov?.[0]?.page_no;

    if (isChapterBoundary(item)) {
      if (cur) sections.push(cur);
      const title = (item.text ?? "").trim();
      const numberedDepth = numberedHeadingDepth(title);
      cur = {
        title,
        startPage: page ?? (sections.at(-1)?.endPage ?? 1),
        endPage: page ?? (sections.at(-1)?.endPage ?? 1),
        parts: [],
        kind: classifyKind(title, numberedDepth),
      };
      continue;
    }

    if (!cur) continue; // before the first chapter → title page, drop

    const label = item.label ?? "text";
    if (["page_footer", "page_header", "page_number", "caption", "furniture"].includes(label)) {
      continue;
    }
    const text = (item.text ?? "").trim();
    if (!text) continue;

    // Inline markers (Beispiel 1.2:, Übung 3.4:) embedded as a bold
    // Markdown block in the chapter text — nothing is lost, but they
    // don't get their own row in the chapter panel.
    if (item.label === "section_header" || item.label === "title") {
      if (isInlineMarker(text)) {
        cur.parts.push(`**${text}**`);
      } else {
        // Sub-heading inside a chapter — emit as ## below.
        cur.parts.push(`\n## ${text}\n`);
      }
    } else {
      cur.parts.push(text);
    }
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
        kind: "content",
      },
    ];
  }

  return sections.map((s, idx) => ({
    number: idx + 1,
    title: s.title || `Abschnitt ${idx + 1}`,
    startPage: s.startPage,
    endPage: Math.max(s.startPage, s.endPage),
    text: s.parts.join("\n\n"),
    kind: s.kind,
  }));
}
