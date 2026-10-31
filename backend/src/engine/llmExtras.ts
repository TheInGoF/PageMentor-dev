// Zusätzliche Sprachmodelle: Auswahl, Stand bei Ollama, Entfernen beim Abwählen
import { ENGINE_HOST, EXTRA_LLMS } from "./config";
import { getLlmConfig, setLlmConfig } from "../services/llmConfig";

export function enabledLlmExtras(): string[] {
  return (getLlmConfig().llmExtras ?? "").split(",").map((s) => s.trim()).filter((s) => s in EXTRA_LLMS);
}

// Bei Ollama vorhandene Modelle; null, wenn nicht erreichbar
export async function installedModels(): Promise<string[] | null> {
  try {
    const res = await fetch(`http://${ENGINE_HOST}:8790/api/tags`, { signal: AbortSignal.timeout(5000) });
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return null;
  }
}

export const isInstalled = (names: string[], m: string) => names.some((n) => n === m || n === `${m}:latest`);

// Auswahl speichern; abgewählte Modelle gibt Ollama sofort frei (je fast 20 GB)
export async function setLlmExtras(wanted: string[], tutorModel?: string): Promise<void> {
  const before = enabledLlmExtras();
  const next = wanted.filter((m) => m in EXTRA_LLMS);
  const tutor = tutorModel !== undefined ? tutorModel : getLlmConfig().tutorModel ?? "";
  setLlmConfig({ llmExtras: next.join(","), tutorModel: tutor && !next.includes(tutor) ? "" : tutor });
  for (const m of before.filter((b) => !next.includes(b))) {
    await fetch(`http://${ENGINE_HOST}:8790/api/delete`, { method: "DELETE", body: JSON.stringify({ name: m }), signal: AbortSignal.timeout(30_000) }).catch(() => undefined);
  }
}
