// Zustimmung vor jedem Versand: Vorschau zeigt den genauen Text, gesendet wird nur genau dieser
import { randomUUID } from "crypto";
import { db } from "../../db";
import { emitLog } from "../../log/logger";
import { cloudEnabled, cloudGenerate, cloudTargets, type CloudProvider } from "./client";
import { buildTask, type BuiltTask, type CloudTask } from "./tasks";

interface Pending extends BuiltTask {
  id: string;
  provider: CloudProvider;
  model: string;
  created: number;
}

const TTL_MS = 15 * 60_000;
const pending = new Map<string, Pending>();

function prune(): void {
  for (const [id, p] of pending) if (Date.now() - p.created > TTL_MS) pending.delete(id);
}

export interface Preview {
  id: string;
  task: CloudTask;
  title: string;
  provider: CloudProvider;
  model: string;
  system: string;
  text: string;
  chars: number;
}

export function preview(task: CloudTask, provider: CloudProvider | undefined, params: Record<string, unknown>): Preview {
  if (!cloudEnabled()) throw new Error("Cloud-Hilfe ist ausgeschaltet");
  const target = cloudTargets().find((t) => !provider || t.provider === provider);
  if (!target) throw new Error("Kein Schlüssel für die Cloud-KI hinterlegt");
  prune();
  const built = buildTask(task, params);
  const p: Pending = { ...built, id: randomUUID(), provider: target.provider, model: target.model, created: Date.now() };
  pending.set(p.id, p);
  return { id: p.id, task: p.task, title: p.title, provider: p.provider, model: p.model, system: p.system, text: p.text, chars: p.system.length + p.text.length };
}

export async function send(id: string): Promise<{ task: CloudTask; ref: string | null; answer: string }> {
  prune();
  const p = pending.get(id);
  if (!p) throw new Error("Vorschau abgelaufen, bitte neu öffnen");
  pending.delete(id);
  const target = cloudTargets().find((t) => t.provider === p.provider);
  if (!target || !cloudEnabled()) throw new Error("Cloud-Hilfe nicht verfügbar");
  const log = db().prepare("INSERT INTO cloud_log (task, provider, model, chars, ok) VALUES (?, ?, ?, ?, ?)");
  try {
    const answer = await cloudGenerate(target, p.system, p.text);
    log.run(p.task, p.provider, p.model, p.system.length + p.text.length, 1);
    emitLog("info", "cloud", `Cloud-Hilfe ${p.task} an ${p.provider} (${p.model}), ${p.text.length} Zeichen`);
    return { task: p.task, ref: p.ref, answer };
  } catch (err) {
    log.run(p.task, p.provider, p.model, p.system.length + p.text.length, 0);
    throw err;
  }
}

export function cloudLog(limit = 20): Array<{ task: string; provider: string; model: string; chars: number; ok: number; sent_at: string }> {
  return db().prepare("SELECT task, provider, model, chars, ok, sent_at FROM cloud_log ORDER BY id DESC LIMIT ?").all(limit) as Array<{ task: string; provider: string; model: string; chars: number; ok: number; sent_at: string }>;
}
