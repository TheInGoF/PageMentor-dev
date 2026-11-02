// Seitenverhältnis der Cover: Audiobookshelf stellt es je Bibliothek ein (1 = quadratisch, sonst Buch 1,6:1).
// Zehn Minuten gemerkt; ohne Audiobookshelf oder bei Fehlern das Buchformat
import { absBaseUrl, absHeaders } from "../audiobookshelf";
import { absEnabled, effective } from "../llmConfig";
import type { CoverAspect } from "./templates";

let cache: { at: number; value: CoverAspect } | null = null;

export async function libraryCoverAspect(): Promise<CoverAspect> {
  const url = absBaseUrl();
  const libraryId = effective("absLibraryId", "PM_ABS_LIBRARY_ID");
  if (!absEnabled() || !url || !libraryId) return "book";
  if (cache && Date.now() - cache.at < 600_000) return cache.value;
  let value: CoverAspect = cache?.value ?? "book";
  try {
    const res = await fetch(`${url}/api/libraries/${libraryId}`, { headers: absHeaders(), signal: AbortSignal.timeout(5_000) });
    if (res.ok) {
      const data = (await res.json()) as { library?: { settings?: { coverAspectRatio?: number } }; settings?: { coverAspectRatio?: number } };
      const ratio = data.library?.settings?.coverAspectRatio ?? data.settings?.coverAspectRatio;
      if (ratio !== undefined) value = ratio === 1 ? "square" : "book";
    }
  } catch {
    // Bibliothek nicht erreichbar: letzter Wert oder Buchformat
  }
  cache = { at: Date.now(), value };
  return value;
}
