/**
 * Audiobookshelf-API-Integration.
 *
 * REST-Client für einen lokal laufenden Audiobookshelf-Server. User
 * konfiguriert URL + API-Token in Settings, wir nutzen die ABS-API
 * zum direkten Hochladen gebauter M4Bs samt Metadaten — umgeht
 * komplett die iTunes-Atom-Mapping-Probleme in FFMETADATA.
 *
 * Auth: Bearer-Token (in ABS generierbar unter User → API-Keys).
 *
 * API-Referenz: https://api.audiobookshelf.org/
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { db } from "../db";
import { effective } from "./llmConfig";
import { ensureCover } from "./covers";

const DATA_DIR = process.env.PM_DATA_DIR || "./data";

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

/** Grundlegende Ping-/Auth-Probe. Liefert Server-Info wenn OK,
 *  sonst die Fehler-Message. Wird vom Frontend für den „Verbindung
 *  testen"-Button genutzt. */
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
    // /api/me verifiziert Token und liefert gleichzeitig User-Info.
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
    // Server-Version separat über /status abfragen (öffentlicher Endpoint).
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
  module_name: string | null;
}

/** Lädt eine fertige M4B (plus Cover) in die konfigurierte Library
 *  hoch und setzt danach die Metadaten sauber via PATCH. Gibt die
 *  neue Library-Item-ID zurück. */
export async function uploadBook(docId: string): Promise<UploadResult> {
  const url = absBaseUrl();
  if (!url) throw new Error("ABS-URL nicht konfiguriert");
  if (!absApiKey()) throw new Error("ABS-API-Key nicht konfiguriert");
  const libraryId = effective("absLibraryId", "PM_ABS_LIBRARY_ID");
  if (!libraryId) throw new Error("Keine ABS-Library ausgewählt");

  const doc = db()
    .prepare(
      `SELECT d.id, d.title, d.doc_title, d.author, d.short_code,
              m.name AS module_name
       FROM documents d
       LEFT JOIN modules m ON m.id = d.module_id
       WHERE d.id = ?`
    )
    .get(docId) as DocumentMeta | undefined;
  if (!doc) throw new Error(`Document ${docId} not found`);

  const m4bPath = join(DATA_DIR, "audio", docId, "book.m4b");
  if (!existsSync(m4bPath)) {
    throw new Error(
      "book.m4b existiert nicht — zuerst Kapitel generieren + M4B bauen"
    );
  }

  const bookTitle = doc.doc_title?.trim() || doc.title;
  const authorName = doc.author?.trim() || "Unknown";
  const seriesName = doc.module_name?.trim() || "";

  // Cover lazy rendern falls nicht vorhanden — damit der Upload immer
  // ein Titelbild mitbringt.
  const coverPath = await ensureCover(docId);

  // === Upload ===
  // POST /api/upload akzeptiert multipart/form-data:
  //   - library: libraryId
  //   - folder:  folder ID innerhalb der Library (wir nehmen den
  //              ersten root folder, siehe unten)
  //   - title, author, series: primäre Metadaten für den Directory-
  //     Namen den ABS anlegt
  //   - Dateien als indexed fields "0", "1", ... (file + optional cover)
  //
  // Erstmal den ersten Folder der Library holen — ABS-Libraries haben
  // in der Regel genau einen Root-Folder; wenn mehrere, nehmen wir
  // den ersten (User kann später manuell verschieben).
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
    // Fallback: /api/libraries (Liste) liefert oft die Folders mit.
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
      `[abs] keine Folders in Library-Response — raw keys: ${Object.keys(
        libData
      ).join(",")}`
    );
    throw new Error(
      `ABS-Library ${libraryId} hat keinen Ordner — in ABS-Settings hinzufügen`
    );
  }
  const folderId = folders[0].id;

  const form = new FormData();
  form.append("library", libraryId);
  form.append("folder", folderId);
  form.append("title", bookTitle);
  form.append("author", authorName);
  if (seriesName) form.append("series", seriesName);
  // Datei(en) als indexed fields
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
        `[abs] upload response kein JSON (${uploadRes.status}): ${uploadText.slice(0, 200)}`
      );
    }
  } else {
    console.log(
      `[abs] upload response leer (${uploadRes.status}) — Scan triggert Import`
    );
  }

  // === Library-Scan triggern ===
  // ABS indexiert Uploads normalerweise automatisch, aber ein expliziter
  // Scan beschleunigt es und ist idempotent.
  try {
    await fetch(`${url}/api/libraries/${libraryId}/scan`, {
      method: "POST",
      headers: absHeaders(),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (e) {
    console.warn(`[abs] scan trigger fehlgeschlagen:`, e);
  }

  // === Metadaten-PATCH (optional, wenn wir eine ItemId haben) ===
  // ABS /api/upload erzeugt das LibraryItem aus den Upload-Metadaten
  // und den M4B-Tags. Wenn wir die ItemId bekommen, können wir sauber
  // via PATCH die Felder setzen die wir präzise haben wollen (Subtitle,
  // Series-Reihenfolge, Description etc.) — umgeht iTunes-Atom-Mapping
  // komplett.
  if (uploadData.libraryItemId && (doc.short_code || seriesName)) {
    try {
      const metaBody: Record<string, unknown> = {
        metadata: {
          title: bookTitle,
          subtitle: doc.short_code?.trim() || undefined,
          authors: authorName ? [{ name: authorName }] : undefined,
          series: seriesName ? [{ name: seriesName }] : undefined,
          genres: ["Audiobook"],
          language: "de",
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
        console.warn(
          `[abs] metadata PATCH fehlgeschlagen ${patchRes.status}: ${patchRes.statusText}`
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
