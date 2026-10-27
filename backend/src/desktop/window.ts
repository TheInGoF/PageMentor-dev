// App-Fenster (WebView2) in eigenem Thread; blockiert bis das Fenster zu ist
import { SizeHint, Webview } from "webview-bun";
import { lib } from "webview-bun/src/ffi";
import { setWindowIcon } from "./win32";

declare const self: Worker;

export interface WindowStart {
  url: string;
  exePath: string;
  // Für CI: nach dem Laden sofort wieder schließen
  test?: boolean;
}

export type WindowEvent = { type: "open"; hwnd: number } | { type: "ready" } | { type: "closed" } | { type: "error"; message: string };

const send = (ev: WindowEvent) => self.postMessage(ev);

self.onmessage = (e: MessageEvent<WindowStart>) => {
  const { url, exePath, test } = e.data;
  try {
    const view = new Webview(false, { width: 1360, height: 880, hint: SizeHint.NONE });
    view.title = "PageMentor";
    const hwnd = Number(view.unsafeWindowHandle);
    try {
      setWindowIcon(hwnd, exePath);
    } catch {
      // Ohne Icon geht es auch
    }
    view.bind("__pmReady", () => {
      send({ type: "ready" });
      // Schleife beenden, run() kehrt dann zurück
      if (test) lib.symbols.webview_terminate(view.unsafeHandle);
    });
    view.init("addEventListener('DOMContentLoaded', () => window.__pmReady && window.__pmReady())");
    send({ type: "open", hwnd });
    view.navigate(url);
    view.run();
    send({ type: "closed" });
  } catch (err) {
    send({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
