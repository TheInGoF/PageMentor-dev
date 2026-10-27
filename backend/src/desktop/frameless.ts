// Rahmenloses Fenster im Stil von Windows 11
// Titelleiste weg, Ränder, Schatten und runde Ecken bleiben; läuft im Fenster-Thread
import { dlopen, FFIType, JSCallback, ptr, toArrayBuffer, type Pointer } from "bun:ffi";

const WM_SIZE = 0x0005;
const WM_NCCALCSIZE = 0x0083;
const WM_CLOSE = 0x0010;
const WM_NCLBUTTONDOWN = 0x00a1;
const HTCAPTION = 2;
const SIZE_MAXIMIZED = 2;
const SM_CYFRAME = 33;
const SM_CXPADDEDBORDER = 92;
const DWMWA_WINDOW_CORNER_PREFERENCE = 33;
const DWMWCP_ROUND = 2;

const user32 = dlopen("user32.dll", {
  ReleaseCapture: { args: [], returns: FFIType.i32 },
  PostMessageW: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  ShowWindow: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  IsZoomed: { args: [FFIType.ptr], returns: FFIType.i32 },
  GetCursorPos: { args: [FFIType.ptr], returns: FFIType.i32 },
  SetWindowPos: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.i32, FFIType.u32],
    returns: FFIType.i32,
  },
  GetDpiForWindow: { args: [FFIType.ptr], returns: FFIType.u32 },
  GetSystemMetricsForDpi: { args: [FFIType.i32, FFIType.u32], returns: FFIType.i32 },
}).symbols;

const comctl32 = dlopen("comctl32.dll", {
  SetWindowSubclass: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  DefSubclassProc: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
}).symbols;

const dwmapi = dlopen("dwmapi.dll", {
  DwmSetWindowAttribute: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
}).symbols;

const P = (n: number) => n as unknown as Pointer;

// Callback muss leben, solange das Fenster lebt
let proc: JSCallback | null = null;

function maximized(hwnd: Pointer): boolean {
  return user32.IsZoomed(hwnd) !== 0;
}

// Maximiert ragt das Fenster um den Rahmen über den Bildschirm hinaus
function frameThickness(hwnd: Pointer): number {
  const dpi = user32.GetDpiForWindow(hwnd) || 96;
  return user32.GetSystemMetricsForDpi(SM_CYFRAME, dpi) + user32.GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi);
}

export function makeFrameless(hwndNum: number, onMaximize: (max: boolean) => void): void {
  const hwnd = P(hwndNum);
  proc = new JSCallback(
    (h: Pointer, msg: number, wParam: Pointer, lParam: Pointer) => {
      if (msg === WM_NCCALCSIZE && wParam) {
        // Rand links, rechts, unten vom System, oben ohne Titelleiste
        const rect = new DataView(toArrayBuffer(lParam, 0, 16));
        const top = rect.getInt32(4, true);
        const r = comctl32.DefSubclassProc(h, msg, wParam, lParam);
        rect.setInt32(4, top + (maximized(h) ? frameThickness(h) : 0), true);
        return r ?? P(0);
      }
      if (msg === WM_SIZE) onMaximize(Number(wParam) === SIZE_MAXIMIZED);
      return comctl32.DefSubclassProc(h, msg, wParam, lParam) ?? P(0);
    },
    { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr }
  );
  if (!comctl32.SetWindowSubclass(hwnd, proc.ptr, P(1), P(0))) throw new Error("SetWindowSubclass fehlgeschlagen");
  const corner = new Int32Array([DWMWCP_ROUND]);
  dwmapi.DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ptr(corner), 4);
  // Rahmen neu berechnen lassen: SWP_FRAMECHANGED | NOMOVE | NOSIZE | NOZORDER | NOACTIVATE
  user32.SetWindowPos(hwnd, null, 0, 0, 0, 0, 0x20 | 0x2 | 0x1 | 0x4 | 0x10);
}

export type WindowCommand = "drag" | "min" | "max" | "close" | "state";

// Befehle aus der eigenen Titelleiste; Rückgabe: maximiert ja/nein
export function windowCommand(hwndNum: number, cmd: WindowCommand): boolean {
  const hwnd = P(hwndNum);
  switch (cmd) {
    case "drag": {
      // Wie ein Klick in die Titelleiste: Windows übernimmt Verschieben und Andocken
      const pt = new Int32Array(2);
      user32.GetCursorPos(ptr(pt));
      user32.ReleaseCapture();
      const lp = (((pt[1] & 0xffff) << 16) | (pt[0] & 0xffff)) >>> 0;
      user32.PostMessageW(hwnd, WM_NCLBUTTONDOWN, P(HTCAPTION), P(lp));
      break;
    }
    case "min":
      user32.ShowWindow(hwnd, 6); // SW_MINIMIZE
      break;
    case "max":
      user32.ShowWindow(hwnd, maximized(hwnd) ? 9 : 3); // SW_RESTORE : SW_MAXIMIZE
      break;
    case "close":
      user32.PostMessageW(hwnd, WM_CLOSE, P(0), P(0));
      break;
  }
  return maximized(hwnd);
}
