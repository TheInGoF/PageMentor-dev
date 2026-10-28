// Prozesse starten, Ausgabe lesen, alles ins engine.log
import { spawn } from "child_process";
import { appendEngine } from "../log/files";
import { emitLog } from "../log/logger";
import { DISTRO } from "./config";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface ExecOptions {
  timeoutMs?: number;
  // Zeilenweise Ausgabe, z. B. für Fortschritt
  onLine?: (line: string) => void;
  // Nicht ins engine.log, z. B. für häufige Statusabfragen
  quiet?: boolean;
}

// wsl.exe schreibt UTF-16LE, Linux-Programme UTF-8
export function decodeOutput(buf: Buffer): string {
  if (buf.length >= 2 && buf.includes(0)) {
    const zeros = buf.filter((b, i) => i % 2 === 1 && b === 0).length;
    if (zeros > buf.length / 4) return buf.toString("utf16le").replace(/^﻿/, "");
  }
  return buf.toString("utf8");
}

export function run(cmd: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  const t0 = Date.now();
  const label = `${cmd} ${args.join(" ")}`.slice(0, 300);
  if (!opts.quiet) appendEngine(`$ ${label}`);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true, env: { ...process.env, WSL_UTF8: "1" } });
    } catch (err) {
      resolve({ code: -1, stdout: "", stderr: String(err), durationMs: 0 });
      return;
    }
    const out: Buffer[] = [];
    const errOut: Buffer[] = [];
    let pending = "";
    const feed = (b: Buffer) => {
      if (!opts.onLine) return;
      pending += decodeOutput(b);
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) opts.onLine(l);
    };
    child.stdout?.on("data", (b: Buffer) => {
      out.push(b);
      feed(b);
    });
    child.stderr?.on("data", (b: Buffer) => {
      errOut.push(b);
      feed(b);
    });
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          errOut.push(Buffer.from(`\nZeitüberschreitung nach ${opts.timeoutMs} ms`));
          child.kill();
        }, opts.timeoutMs)
      : null;
    const finish = (code: number) => {
      if (timer) clearTimeout(timer);
      if (pending.trim() && opts.onLine) opts.onLine(pending);
      const result: ExecResult = {
        code,
        stdout: decodeOutput(Buffer.concat(out)),
        stderr: decodeOutput(Buffer.concat(errOut)),
        durationMs: Date.now() - t0,
      };
      if (!opts.quiet) {
        appendEngine(`exit ${code} nach ${result.durationMs} ms`);
        const tail = (result.stdout + "\n" + result.stderr).trim().split("\n").slice(-40).join("\n");
        if (tail) appendEngine(tail);
      }
      resolve(result);
    };
    child.on("error", (err) => {
      errOut.push(Buffer.from(String(err)));
      finish(-1);
    });
    child.on("close", (code) => finish(code ?? -1));
  });
}

export function wsl(args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  return run("wsl.exe", args, opts);
}

// Befehl in der Engine-Umgebung als root
// --exec statt --: sonst wertet WSL das Skript vorab in einer Shell aus und ersetzt $(…) und $var zu früh
export function inDistro(script: string, opts: ExecOptions = {}): Promise<ExecResult> {
  return wsl(["-d", DISTRO, "-u", "root", "--exec", "bash", "-lc", script], opts);
}

// Kurzbeschreibung eines Fehlschlags für Meldungen
export function failText(r: ExecResult): string {
  const text = (r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ").slice(0, 400);
  return text || `Exit-Code ${r.code}`;
}

export function logEngine(level: "info" | "warn" | "error", msg: string, err?: unknown): void {
  appendEngine(`${level.toUpperCase()} ${msg}`);
  emitLog(level, "engine", msg, { err });
}
