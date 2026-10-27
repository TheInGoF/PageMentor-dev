// Win32-Hilfen über FFI: Fenster nach vorne holen, Icon setzen
import { dlopen, FFIType, ptr, type Pointer } from "bun:ffi";

let user32: ReturnType<typeof openUser32> | null = null;
let shell32: ReturnType<typeof openShell32> | null = null;

function openUser32() {
  return dlopen("user32.dll", {
    ShowWindow: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    SetForegroundWindow: { args: [FFIType.ptr], returns: FFIType.i32 },
    IsWindow: { args: [FFIType.ptr], returns: FFIType.i32 },
    SendMessageW: { args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.ptr], returns: FFIType.ptr },
  });
}

function openShell32() {
  return dlopen("shell32.dll", {
    ExtractIconW: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.ptr },
  });
}

const u32 = () => (user32 ??= openUser32()).symbols;

const wide = (s: string) => ptr(Buffer.from(s + "\0", "utf16le"));

// Fenster wiederherstellen und in den Vordergrund holen
export function focusWindow(hwnd: number): boolean {
  const h = hwnd as unknown as Pointer;
  if (!u32().IsWindow(h)) return false;
  u32().ShowWindow(h, 9); // SW_RESTORE
  u32().SetForegroundWindow(h);
  return true;
}

// Icon der Exe auch für Fenster und Taskleiste
export function setWindowIcon(hwnd: number, exePath: string): void {
  const icon = (shell32 ??= openShell32()).symbols.ExtractIconW(null, wide(exePath), 0);
  if (!icon) return;
  const h = hwnd as unknown as Pointer;
  u32().SendMessageW(h, 0x80, 1n, icon); // WM_SETICON, groß
  u32().SendMessageW(h, 0x80, 0n, icon); // klein
}
