// Brücke zum App-Fenster: rahmenlos, Fensterbefehle, Maximiert-Zustand
type WindowCommand = "drag" | "min" | "max" | "close" | "state";

declare global {
  interface Window {
    __pmDesktop?: { frameless: boolean };
    __pmWin?: (cmd: WindowCommand) => Promise<boolean>;
    __pmMax?: (max: boolean) => void;
  }
}

export const TITLEBAR_H = 32;

export function isFrameless(): boolean {
  return !!window.__pmDesktop?.frameless && !!window.__pmWin;
}

export function windowCommand(cmd: WindowCommand): Promise<boolean> {
  return window.__pmWin ? window.__pmWin(cmd) : Promise.resolve(false);
}

// Leistenhöhe für Overlays, die sonst die Titelleiste verdecken
export function initDesktop(): void {
  if (!isFrameless()) return;
  document.documentElement.style.setProperty("--titlebar-h", `${TITLEBAR_H}px`);
  document.documentElement.dataset.frameless = "1";
}
