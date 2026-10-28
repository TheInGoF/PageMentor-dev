// Zusätzliche TTS-Engines: welche an sind, .env für Compose-Profile
import { db } from "../db";
import { getLlmConfig, setLlmConfig } from "../services/llmConfig";
import { failText, inDistro } from "./exec";

// Kokoro gehört fest dazu (Standardstimme), diese hier wählt man in den Engines
export const EXTRA_SERVICES = {
  qwen: { service: "qwen-tts", alwaysOn: false, title: "Qwen3-TTS", sizeGb: 12 },
  f5: { service: "f5-tts", alwaysOn: false, title: "F5-TTS", sizeGb: 9 },
  tada: { service: "tada-tts", alwaysOn: false, title: "TADA", sizeGb: 10 },
} as const;

export type ExtraEngine = keyof typeof EXTRA_SERVICES;

export function enabledExtras(): ExtraEngine[] {
  const raw = getLlmConfig().ttsEngines ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is ExtraEngine => s in EXTRA_SERVICES);
}

// Dienste für docker compose up: dauerhaft an bzw. nur angelegt
export function extraServices(): { up: string[]; create: string[]; off: string[] } {
  const enabled = enabledExtras();
  const on = enabled.map((e) => EXTRA_SERVICES[e]);
  return {
    up: on.filter((s) => s.alwaysOn).map((s) => s.service),
    create: on.filter((s) => !s.alwaysOn).map((s) => s.service),
    off: (Object.keys(EXTRA_SERVICES) as ExtraEngine[]).filter((e) => !enabled.includes(e)).map((e) => `pm-${EXTRA_SERVICES[e].service}`),
  };
}

// .env neben der compose.yaml: Profile und HF-Token
export async function writeEngineEnv(): Promise<void> {
  const lines = [`COMPOSE_PROFILES=${enabledExtras().join(",")}`];
  const token = getLlmConfig().hfToken;
  if (token) lines.push(`HF_TOKEN=${token}`);
  const b64 = Buffer.from(lines.join("\n") + "\n").toString("base64");
  const r = await inDistro(`mkdir -p /opt/pagementor && echo '${b64}' | base64 -d > /opt/pagementor/.env && chmod 600 /opt/pagementor/.env`, {
    timeoutMs: 30_000,
    quiet: true,
  });
  if (r.code !== 0) throw new Error(`.env schreiben fehlgeschlagen: ${failText(r)}`);
}

// Seit v1.21 ist Kokoro Standard und Qwen eine Zusatz-Engine. Bestehende Installationen
// behalten Qwen, sonst verschwänden ihre Stimmen und Designs; neue starten nur mit Kokoro
export function migrateTtsEngines(): void {
  const cfg = getLlmConfig();
  if (cfg.ttsEnginesV2 === "1") return;
  const count = (table: string) => {
    try {
      return (db().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    } catch {
      return 0;
    }
  };
  const existing = cfg.ttsEngines !== undefined || count("documents") + count("voice_samples") + count("voice_designs") > 0;
  setLlmConfig({ ttsEngines: migratedEngines(cfg.ttsEngines, existing), ttsEnginesV2: "1" });
}

// Kokoro fällt aus der Liste (immer dabei), bestehende Installationen bekommen Qwen dazu
export function migratedEngines(before: string | undefined, existing: boolean): string {
  const next = (before ?? "").split(",").map((s) => s.trim()).filter((e) => e in EXTRA_SERVICES && e !== "qwen");
  if (existing) next.unshift("qwen");
  return next.join(",");
}
