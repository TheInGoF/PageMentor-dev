// Log-Kontext pro Anfrage oder Job, folgt allen await-Ketten
import { AsyncLocalStorage } from "node:async_hooks";
import type { LogContext } from "./types";

const als = new AsyncLocalStorage<LogContext>();
let counter = 0;

// fn mit zusätzlichem Kontext ausführen, bestehender bleibt erhalten
export function withLogContext<T>(ctx: LogContext, fn: () => T): T {
  return als.run({ ...als.getStore(), ...ctx }, fn);
}

export function currentContext(): LogContext {
  return als.getStore() ?? {};
}

// Kurze, sortierbare ID: art-zeit-zähler
export function newId(kind: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${kind}-${Date.now().toString(36)}-${counter.toString(36)}`;
}
