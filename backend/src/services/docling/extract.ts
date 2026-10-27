// PDF über docling-serve extrahieren, nur asynchron: große PDFs dauern 30+ min
// Ablauf: Upload → Status per WebSocket oder Polling → Ergebnis holen
import { readFile } from "fs/promises";
import { basename } from "path";
import { pickLang, tLang } from "../../lib/i18n";
import type {
  AsyncTaskHandle,
  DoclingDocumentJson,
  DoclingExtraction,
  DoclingResponse,
  PollResponse,
} from "./types";
import { doclingFetch, numOr, pollUntilDone, subscribeViaWs } from "./client";
import { buildSections } from "./sections";

// Titel + Autor aus den Metadaten, null bei fehlenden oder Standard-Werten
function extractDocMetadata(
  doc: DoclingDocumentJson
): { title: string | null; author: string | null } {
  const meta = doc.meta ?? {};
  const cleanTitle = (s: unknown): string | null => {
    if (typeof s !== "string") return null;
    const t = s.trim();
    if (!t) return null;
    // Standard-Titel von PDF-Werkzeugen ignorieren
    if (/^(microsoft\s+word|untitled|document\d*|new document|adobe.*photoshop)/i.test(t))
      return null;
    if (t.length > 200) return null; // probably not a title
    return t;
  };
  const cleanAuthor = (s: unknown): string | null => {
    if (typeof s !== "string") return null;
    const a = s.trim();
    if (!a) return null;
    // Standard-Werte von Office ignorieren
    if (/^(unknown|admin|user|administrator|standard)$/i.test(a)) return null;
    if (a.length > 150) return null;
    return a;
  };
  // Titel: title → subject → null
  const title = cleanTitle(meta.title) ?? cleanTitle(meta.subject) ?? null;
  const author = cleanAuthor(meta.author);
  return { title, author };
}



export async function extractPdfViaDocling(params: {
  pdfPath: string;
  language?: string;
  // OCR erzwingen, auch mit Textebene: rettet kaputte CMaps, ~2x langsamer
  forceOcr?: boolean;
  signal?: AbortSignal;
  onProgress?: (message: string, fraction?: number) => void;
}): Promise<DoclingExtraction> {
  const { pdfPath, language = "de", forceOcr = false, signal, onProgress } = params;
  const lang = pickLang(language);

  // 1. Hochladen
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
  // OCR mit Tesseract statt RapidOCR: bessere Umlaute und Wortabstände
  // Deutsches Sprachpaket nur im Image pm-docling-de
  // Feld heißt ocr_preset, ocr_engine wird seit v1.16 ignoriert
  form.append("ocr_preset", "tesseract");
  // Tesseract-Codes dreistellig, mehrere mit +: "eng+deu"
  form.append("ocr_lang", language === "en" ? "eng" : "deu");
  form.append("do_ocr", "true");
  if (forceOcr) {
    // Textebene durch OCR ersetzen, ~2x langsamer, pro Upload wählbar
    form.append("force_ocr", "true");
  }
  form.append("table_mode", "fast");
  form.append("pdf_backend", "dlparse_v2");
  form.append("abort_on_error", "false");

  // Formel + Code: serverseitig aktiv, kein Flag nötig
  // Bildbeschreibung bewusst aus: bringt fürs Hörbuch nichts, 5-10x langsamer

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

  // 2. Warten: WebSocket bevorzugt, sonst Polling
  // Docling meldet kaum Zwischenstände, deshalb eigener Herzschlag alle 5 s
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

  // Herzschlag unabhängig von Docling-Events, endet im finally
  const heartbeat = setInterval(() => {
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    const sinceLastEventSec = Math.round((Date.now() - lastEventAt) / 1000);
    onProgress?.(
      `Docling: ${lastReportedState} · ${elapsedSec}s`,
      undefined
    );
    // Einmal pro Minute ins Log: langsam oder hängend?
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
      // Kein WebSocket: Polling
      console.log(
        `[docling] WS subscription not possible (${(wsErr as Error).message}), falling back to polling`
      );
      await pollUntilDone(task_id, signal, reportStatus);
    }
  } finally {
    clearInterval(heartbeat);
  }

  // 3. Ergebnis holen
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
