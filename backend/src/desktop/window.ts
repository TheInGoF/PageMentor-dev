// App-Fenster (WebView2) in eigenem Thread; blockiert bis das Fenster zu ist
import { SizeHint, Webview } from "webview-bun";
import { makeFrameless, windowCommand, type WindowCommand } from "./frameless";
import { setWindowIcon } from "./win32";

declare const self: Worker;

export interface WindowStart {
  url: string;
  exePath: string;
  // Für CI: nach dem Laden kurz offen lassen, dann über die eigene Leiste schließen
  test?: boolean;
}

export type WindowEvent =
  | { type: "open"; hwnd: number }
  | { type: "frameless"; ok: boolean; error?: string }
  | { type: "ready" }
  | { type: "closed" }
  | { type: "error"; message: string };

const send = (ev: WindowEvent) => self.postMessage(ev);

const TEST_CLOSE_MS = 8000;

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

    // Ohne Titelleiste; schlägt es fehl, bleibt der normale Rahmen
    let frameless = false;
    try {
      makeFrameless(hwnd, (max) => view.eval(`window.__pmMax && window.__pmMax(${max})`));
      frameless = true;
      send({ type: "frameless", ok: true });
    } catch (err) {
      send({ type: "frameless", ok: false, error: err instanceof Error ? err.message : String(err) });
    }

    view.bind("__pmWin", (cmd: WindowCommand) => windowCommand(hwnd, cmd));
    view.bind("__pmReady", () => send({ type: "ready" }));
    view.init(
      `window.__pmDesktop = { frameless: ${frameless} };` +
        "addEventListener('DOMContentLoaded', () => window.__pmReady && window.__pmReady());" +
        (test ? `setTimeout(() => window.__pmWin('close'), ${TEST_CLOSE_MS});` : "")
    );
    send({ type: "open", hwnd });
    view.navigate(url);
    view.run();
    send({ type: "closed" });
  } catch (err) {
    send({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
