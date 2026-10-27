// SSE-Fortschritt
import { audioApi } from "./audio";
import type {
  ProgressEvent,
} from "./types";

// SSE-Fortschritt abonnieren, liefert Abmelde-Funktion
export function subscribeProgress(
  docId: string,
  onEvent: (ev: ProgressEvent) => void,
  onError?: (err: Event) => void
): () => void {
  const src = new EventSource(audioApi.audio.streamUrl(docId), { withCredentials: true });
  src.addEventListener("progress", (e) => {
    try {
      onEvent(JSON.parse((e as MessageEvent).data));
    } catch {
      // ignore
    }
  });
  if (onError) src.addEventListener("error", onError);
  return () => src.close();
}
