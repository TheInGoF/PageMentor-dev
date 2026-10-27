// Zusätzliche TTS-Engines: welche an sind, .env für Compose-Profile
import { getLlmConfig } from "../services/llmConfig";
import { failText, inDistro } from "./exec";

export const EXTRA_SERVICES = {
  kokoro: { service: "kokoro-tts", alwaysOn: true, title: "Kokoro", sizeGb: 1 },
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
