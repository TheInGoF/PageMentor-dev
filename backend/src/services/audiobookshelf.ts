/**
 * Audiobookshelf API integration.
 *
 * REST client for a locally running Audiobookshelf server. User
 * configures URL + API token in Settings; we use the ABS API to
 * directly upload built M4Bs with metadata — fully bypassing the
 * iTunes-atom-mapping issues in FFMETADATA.
 *
 * Auth: bearer token (generated in ABS under User → API Keys).
 *
 * API reference: https://api.audiobookshelf.org/
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { db } from "../db";
import { effective } from "./llmConfig";
import { ensureCover } from "./covers";
import { pickLang, tLang } from "../lib/i18n";
import { DATA_DIR } from "../paths";


function absBaseUrl(): string | null {
  const url = effective("absUrl", "PM_ABS_URL");
  if (!url) return null;
  return url.replace(/\/+$/, "");
}

function absApiKey(): string | null {
  return effective("absApiKey", "PM_ABS_API_KEY") ?? null;
}

function absHeaders(): Record<string, string> {
  const key = absApiKey();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/** Basic ping / auth probe. Returns server info if OK, otherwise the
 *  error message. Used by the frontend for the "test connection"
 *  button. */
export async function testConnection(): Promise<{
  ok: boolean;
  url?: string;
  username?: string;
  serverVersion?: string;
  message?: string;
}> {
  const url = absBaseUrl();
  if (!url) return { ok: false, message: "no ABS URL configured" };
  const key = absApiKey();
  if (!key) return { ok: false, message: "no ABS API key configured" };
  try {
    // /api/me verifies the token and returns user info at the same time.
    const res = await fetch(`${url}/api/me`, {
      headers: absHeaders(),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      return {
        ok: false,
        url,
        message: `ABS ${res.status} ${res.statusText}`,
      };
    }
    const data = (await res.json()) as { username?: string };
    // Fetch server version separately via /status (public endpoint).
    let serverVersion: string | undefined;
    try {
      const v = await fetch(`${url}/status`, {
        signal: AbortSignal.timeout(4_000),
      });
      if (v.ok) {
        const vdata = (await v.json()) as { serverVersion?: string };
        serverVersion = vdata.serverVersion;
      }
    } catch {
      // best effort
    }
    return { ok: true, url, username: data.username, serverVersion };
  } catch (e) {
    return { ok: false, url, message: (e as Error).message };
  }
}

export interface AbsLibrary {
  id: string;
  name: string;
  mediaType: string;
}

export async function listLibraries(): Promise<AbsLibrary[]> {
  const url = absBaseUrl();
  if (!url) throw new Error("no ABS URL configured");
  const res = await fetch(`${url}/api/libraries`, {
    headers: absHeaders(),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    throw new Error(`ABS libraries ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as {
    libraries?: Array<{ id: string; name: string; mediaType: string }>;
  };
  return (data.libraries ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    mediaType: l.mediaType,
  }));
}

export interface UploadResult {
  libraryItemId?: string;
  uploadedBytes: number;
  url?: string;
  message?: string;
}

interface DocumentMeta {
  id: string;
  title: string;
  doc_title: string | null;
  author: string | null;
  short_code: string | null;
  series_sequence: string | null;
  module_name: string | null;
  language: string;
}

/** Uploads a finished M4B (plus cover) into the configured library
 *  and afterwards sets the metadata cleanly via PATCH. Returns the
 *  new library-item ID. */
export async function uploadBook(docId: string): Promise<UploadResult> {
  // Pre-load doc.language so error messages can be localised.
  const langRow = db()
    .prepare("SELECT language FROM documents WHERE id = ?")
    .get(docId) as { language: string } | undefined;
  const lang = pickLang(langRow?.language);

  const url = absBaseUrl();
  if (!url) throw new Error(tLang(lang, "err.absUrlMissing"));
  if (!absApiKey()) throw new Error(tLang(lang, "err.absKeyMissing"));
  const libraryId = effective("absLibraryId", "PM_ABS_LIBRARY_ID");
  if (!libraryId) throw new Error(tLang(lang, "err.absLibraryMissing"));

  const doc = db()
    .prepare(
      `SELECT d.id, d.title, d.doc_title, d.author, d.short_code, d.series_sequence, d.language,
              m.name AS module_name
       FROM documents d
       LEFT JOIN modules m ON m.id = d.module_id
       WHERE d.id = ?`
    )
    .get(docId) as DocumentMeta | undefined;
  if (!doc) throw new Error(`Document ${docId} not found`);

  const m4bPath = join(DATA_DIR, "audio", docId, "book.m4b");
  if (!existsSync(m4bPath)) {
    throw new Error(tLang(lang, "err.absM4bMissing"));
  }

  // User-Titel aus PageMentor zuerst (was auch immer im UI gezeigt
  // wird), doc_title (PDF-Metadaten) nur als Fallback wenn doc.title
  // leer ist. Frueher umgekehrt — fuehrte dazu dass ABS einen Titel
  // aus den PDF-Metadaten zeigte den der User in PageMentor nicht
  // einstellen konnte.
  const bookTitle = doc.title?.trim() || doc.doc_title?.trim() || "";
  const authorName = doc.author?.trim() || "Unknown";
  const seriesName = doc.module_name?.trim() || "";

  // Render the cover lazily if missing — so the upload always
  // includes a cover.
  const coverPath = await ensureCover(docId);

  // === Upload ===
  // POST /api/upload accepts multipart/form-data:
  //   - library: libraryId
  //   - folder:  folder ID inside the library (we use the first
  //              root folder, see below)
  //   - title, author, series: primary metadata for the directory
  //     name ABS creates
  //   - files as indexed fields "0", "1", ... (file + optional cover)
  //
  // First fetch the first folder of the library — ABS libraries
  // usually have exactly one root folder; with multiple we take the
  // first (user can move it manually later).
  const folderRes = await fetch(
    `${url}/api/libraries/${libraryId}?include=folders`,
    {
      headers: absHeaders(),
      signal: AbortSignal.timeout(8_000),
    }
  );
  if (!folderRes.ok) {
    throw new Error(
      `ABS library fetch ${folderRes.status} ${folderRes.statusText}`
    );
  }
  const libData = (await folderRes.json()) as {
    library?: { folders?: Array<{ id: string }> };
    folders?: Array<{ id: string }>;
  };
  let folders = libData.library?.folders ?? libData.folders ?? [];
  if (folders.length === 0) {
    // Fallback: /api/libraries (list) often includes the folders.
    try {
      const listRes = await fetch(`${url}/api/libraries`, {
        headers: absHeaders(),
        signal: AbortSignal.timeout(8_000),
      });
      if (listRes.ok) {
        const listData = (await listRes.json()) as {
          libraries?: Array<{ id: string; folders?: Array<{ id: string }> }>;
        };
        const hit = (listData.libraries ?? []).find((l) => l.id === libraryId);
        folders = hit?.folders ?? [];
      }
    } catch {
      // best effort
    }
  }
  if (folders.length === 0) {
    console.warn(
      `[abs] no folders in library response — raw keys: ${Object.keys(
        libData
      ).join(",")}`
    );
    throw new Error(tLang(lang, "err.absLibraryNoFolder", { libraryId }));
  }
  const folderId = folders[0].id;

  const form = new FormData();
  form.append("library", libraryId);
  form.append("folder", folderId);
  form.append("title", bookTitle);
  form.append("author", authorName);
  if (seriesName) form.append("series", seriesName);
  // file(s) as indexed fields
  const m4bBytes = readFileSync(m4bPath);
  form.append(
    "0",
    new Blob([new Uint8Array(m4bBytes)], { type: "audio/mp4" }),
    basename(m4bPath)
  );
  if (coverPath && existsSync(coverPath)) {
    const coverBytes = readFileSync(coverPath);
    form.append(
      "1",
      new Blob([new Uint8Array(coverBytes)], { type: "image/jpeg" }),
      basename(coverPath)
    );
  }

  console.log(
    `[abs] upload docId=${docId} title=${JSON.stringify(bookTitle)} ` +
      `author=${JSON.stringify(authorName)} series=${JSON.stringify(seriesName)} ` +
      `m4b=${(m4bBytes.length / 1024 / 1024).toFixed(1)}MB ` +
      `cover=${coverPath ? "yes" : "no"} library=${libraryId}`
  );
  const uploadRes = await fetch(`${url}/api/upload`, {
    method: "POST",
    headers: absHeaders(),
    body: form,
    signal: AbortSignal.timeout(10 * 60_000),
  });
  const uploadText = await uploadRes.text().catch(() => "");
  if (!uploadRes.ok) {
    throw new Error(
      `ABS upload ${uploadRes.status}: ${uploadText.slice(0, 400)}`
    );
  }
  let uploadData: { libraryItemId?: string; success?: boolean } = {};
  if (uploadText.trim()) {
    try {
      uploadData = JSON.parse(uploadText);
    } catch {
      console.warn(
        `[abs] upload response not JSON (${uploadRes.status}): ${uploadText.slice(0, 200)}`
      );
    }
  } else {
    console.log(
      `[abs] upload response empty (${uploadRes.status}) — scan triggers import`
    );
  }

  // === Trigger library scan ===
  // ABS normally indexes uploads automatically, but an explicit scan
  // speeds it up and is idempotent.
  try {
    await fetch(`${url}/api/libraries/${libraryId}/scan`, {
      method: "POST",
      headers: absHeaders(),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (e) {
    console.warn(`[abs] scan trigger failed:`, e);
  }

  // === Resolve library-item ID ===
  // /api/upload doesn't return an ItemId in current ABS versions.
  // To make the follow-up metadata PATCH work, we search the
  // freshly scanned item via /search (title + author as query) and
  // poll up to 8 seconds — for single-file uploads the scan is
  // practically instant.
  if (!uploadData.libraryItemId) {
    const searchUrl = `${url}/api/libraries/${libraryId}/search?q=${encodeURIComponent(
      bookTitle
    )}&limit=5`;
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const sr = await fetch(searchUrl, {
          headers: absHeaders(),
          signal: AbortSignal.timeout(5_000),
        });
        if (!sr.ok) continue;
        const sdata = (await sr.json()) as {
          book?: Array<{
            libraryItem?: {
              id?: string;
              media?: { metadata?: { title?: string } };
            };
          }>;
        };
        const hit = (sdata.book ?? []).find(
          (b) =>
            b.libraryItem?.media?.metadata?.title?.trim().toLowerCase() ===
            bookTitle.trim().toLowerCase()
        );
        if (hit?.libraryItem?.id) {
          uploadData.libraryItemId = hit.libraryItem.id;
          console.log(
            `[abs] item found after scan: ${uploadData.libraryItemId} (attempt ${i + 1})`
          );
          break;
        }
      } catch (e) {
        console.warn(`[abs] search attempt ${i + 1} failed:`, e);
      }
    }
    if (!uploadData.libraryItemId) {
      console.warn(
        `[abs] could not find library item after upload — metadata PATCH skipped`
      );
    }
  }

  // === Metadata PATCH ===
  // ABS /api/upload creates the LibraryItem from upload metadata and
  // the M4B tags. With the ItemId we can cleanly set the fields we
  // want exactly via PATCH (subtitle, series) — bypasses
  // iTunes-atom mapping entirely.
  if (uploadData.libraryItemId) {
    try {
      // explicitly clear description — ABS sometimes parses
      // grouping/©grp from the M4B into the description, and the
      // shortcode should land exclusively in subtitle.
      const seriesSequence = doc.series_sequence?.trim();
      const metaBody: Record<string, unknown> = {
        metadata: {
          title: bookTitle,
          subtitle: doc.short_code?.trim() || "",
          description: "",
          authors: authorName ? [{ name: authorName }] : undefined,
          series: seriesName
            ? [
                {
                  name: seriesName,
                  // sequence ist optional; ABS akzeptiert String (auch
                  // "1.5" / "1a" moeglich). NULL/leer wird weggelassen.
                  ...(seriesSequence ? { sequence: seriesSequence } : {}),
                },
              ]
            : undefined,
          genres: ["Audiobook"],
          language: doc.language || "de",
        },
      };
      const patchRes = await fetch(
        `${url}/api/items/${uploadData.libraryItemId}/media`,
        {
          method: "PATCH",
          headers: {
            ...absHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(metaBody),
          signal: AbortSignal.timeout(8_000),
        }
      );
      if (!patchRes.ok) {
        const pt = await patchRes.text().catch(() => "");
        console.warn(
          `[abs] metadata PATCH failed ${patchRes.status}: ${pt.slice(0, 300)}`
        );
      } else {
        console.log(
          `[abs] metadata PATCH ok — series=${JSON.stringify(seriesName)} sequence=${JSON.stringify(doc.series_sequence ?? "")} subtitle=${JSON.stringify(doc.short_code ?? "")}`
        );
      }
    } catch (e) {
      console.warn(`[abs] metadata PATCH threw:`, e);
    }
  }

  return {
    libraryItemId: uploadData.libraryItemId,
    uploadedBytes: m4bBytes.length + (coverPath ? 1 : 0),
    url: uploadData.libraryItemId
      ? `${url}/item/${uploadData.libraryItemId}`
      : undefined,
  };
}
