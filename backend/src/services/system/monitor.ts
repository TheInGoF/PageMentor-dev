// Leistungsanzeige (Diagnose → Leistung): CPU, Arbeitsspeicher, Grafikkarte und Platte alle 2 s, die letzten 5 Minuten.
// Misst nur, solange jemand zuschaut (Abfrage in der letzten Minute), damit im Leerlauf nichts mitläuft.
// Grafikkarte über nvidia-smi des Rechners; CPU-Temperatur gibt Windows ohne Adminrechte nicht her
import { cpus, freemem, totalmem } from "node:os";
import { statfsSync } from "node:fs";
import { DATA_DIR, IS_WINDOWS } from "../../paths";

export interface Sample {
  t: number;
  cpu: number;
  ramUsed: number;
  gpu: number | null;
  vramUsed: number | null;
  gpuTemp: number | null;
  power: number | null;
}
export interface SystemInfo {
  cpuModel: string;
  cores: number;
  ramTotal: number;
  gpuName: string | null;
  vramTotal: number | null;
  powerLimit: number | null;
  diskFree: number | null;
  diskTotal: number | null;
}

const INTERVAL_MS = 2000;
const KEEP = 150;
const IDLE_STOP_MS = 60_000;

const samples: Sample[] = [];
const info: SystemInfo = { cpuModel: cpus()[0]?.model?.trim() ?? "", cores: cpus().length, ramTotal: totalmem(), gpuName: null, vramTotal: null, powerLimit: null, diskFree: null, diskTotal: null };
let timer: ReturnType<typeof setInterval> | null = null;
let lastRequest = 0;
let prevCpu = cpuTimes();
let noGpu = false;

function cpuTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const c of cpus()) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

// Anteil belegter CPU-Zeit seit der letzten Messung
export function cpuPercent(prev: { idle: number; total: number }, cur: { idle: number; total: number }): number {
  const dt = cur.total - prev.total;
  if (dt <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - (cur.idle - prev.idle) / dt) * 1000) / 10));
}

// Eine Zeile von nvidia-smi: Name, Last %, Speicher belegt/gesamt MiB, Temperatur °C, Leistung W, Grenze W
export function parseNvidiaSmi(line: string): { name: string; gpu: number; vramUsed: number; vramTotal: number; temp: number | null; power: number | null; powerLimit: number | null } | null {
  const p = line.split(",").map((s) => s.trim());
  if (p.length < 5) return null;
  const num = (s: string | undefined) => {
    const n = Number(s);
    return s && Number.isFinite(n) ? n : null;
  };
  const gpu = num(p[1]), used = num(p[2]), total = num(p[3]);
  if (gpu === null || used === null || total === null) return null;
  return { name: p[0], gpu, vramUsed: used * 1024 * 1024, vramTotal: total * 1024 * 1024, temp: num(p[4]), power: num(p[5]), powerLimit: num(p[6]) };
}

async function readGpu(): Promise<ReturnType<typeof parseNvidiaSmi>> {
  if (noGpu) return null;
  try {
    const proc = Bun.spawn(
      ["nvidia-smi", "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit", "--format=csv,noheader,nounits"],
      { stdout: "pipe", stderr: "ignore", ...(IS_WINDOWS ? { windowsHide: true } : {}) }
    );
    const kill = setTimeout(() => proc.kill(), 3000);
    const out = await new Response(proc.stdout).text();
    clearTimeout(kill);
    return parseNvidiaSmi(out.split("\n")[0] ?? "");
  } catch {
    // Kein nvidia-smi auf diesem Rechner: nicht alle 2 s erneut versuchen
    noGpu = true;
    return null;
  }
}

function readDisk(): void {
  try {
    const s = statfsSync(IS_WINDOWS ? DATA_DIR.slice(0, 3) : DATA_DIR);
    info.diskFree = s.bavail * s.bsize;
    info.diskTotal = s.blocks * s.bsize;
  } catch {
    // ohne Plattenangabe
  }
}

async function tick(): Promise<void> {
  if (Date.now() - lastRequest > IDLE_STOP_MS) {
    if (timer) clearInterval(timer);
    timer = null;
    return;
  }
  const cur = cpuTimes();
  const cpu = cpuPercent(prevCpu, cur);
  prevCpu = cur;
  const g = await readGpu();
  if (g) Object.assign(info, { gpuName: g.name, vramTotal: g.vramTotal, powerLimit: g.powerLimit });
  if (samples.length % 15 === 0) readDisk();
  samples.push({ t: Date.now(), cpu, ramUsed: totalmem() - freemem(), gpu: g?.gpu ?? null, vramUsed: g?.vramUsed ?? null, gpuTemp: g?.temp ?? null, power: g?.power ?? null });
  if (samples.length > KEEP) samples.splice(0, samples.length - KEEP);
}

// Abfrage der Anzeige: startet die Messung bei Bedarf und liefert den Verlauf
export function systemStats(): { info: SystemInfo; samples: Sample[]; intervalMs: number } {
  lastRequest = Date.now();
  if (!timer) {
    prevCpu = cpuTimes();
    readDisk();
    timer = setInterval(() => void tick(), INTERVAL_MS);
    timer.unref?.();
    void tick();
  }
  return { info, samples, intervalMs: INTERVAL_MS };
}
