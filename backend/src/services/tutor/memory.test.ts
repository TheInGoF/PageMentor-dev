import { describe, expect, test } from "bun:test";
import { lastUsageRatio, planWindow } from "./memory";
import type { ChatMessageRow } from "./types";

// n Runden aus Frage und Antwort, Zeitstempel aufsteigend
function rounds(n: number, usage?: { promptTokens: number; outputTokens: number; ctx: number }): ChatMessageRow[] {
  const out: ChatMessageRow[] = [];
  for (let i = 0; i < n; i++) {
    const ts = (k: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, i * 2 + k)).toISOString();
    out.push({ id: `u${i}`, session_id: "s", role: "user", content: `Frage ${i}`, created_at: ts(0) });
    out.push({ id: `a${i}`, session_id: "s", role: "assistant", content: JSON.stringify({ shortAnswer: `A${i}`, reasoning: "", sources: [], model: "m", usage: usage && { ...usage, memoryTurns: 0, compacted: false } }), created_at: ts(1) });
  }
  return out;
}

describe("Gesprächsgedächtnis", () => {
  test("innerhalb des Fensters wird nichts verdichtet", () => {
    const h = rounds(5);
    expect(planWindow(h, null, 5, 0.3)).toEqual({ fold: [], keep: h });
  });

  test("erst ab drei Runden außerhalb wird gebündelt verdichtet, nichts geht verloren", () => {
    expect(planWindow(rounds(7), null, 5, 0.3).fold).toEqual([]);
    const p = planWindow(rounds(8), null, 5, 0.3);
    expect(p.fold.map((m) => m.id)).toEqual(["u0", "a0", "u1", "a1", "u2", "a2"]);
    expect(p.keep).toHaveLength(10);
  });

  test("volles Fenster verdichtet sofort bis auf die letzten zwei Runden", () => {
    const p = planWindow(rounds(4), null, 5, 0.85);
    expect(p.fold).toHaveLength(4);
    expect(p.keep.map((m) => m.id)).toEqual(["u2", "a2", "u3", "a3"]);
  });

  test("schon Verdichtetes zählt nicht mehr", () => {
    const h = rounds(8);
    const upto = h[5].created_at; // drei Runden schon im Gedächtnis
    expect(planWindow(h, upto, 5, 0.3)).toEqual({ fold: [], keep: h.slice(6) });
  });

  test("Auslastung aus der letzten Antwort", () => {
    expect(lastUsageRatio(rounds(2, { promptTokens: 6000, outputTokens: 2000, ctx: 16000 }))).toBe(0.5);
    expect(lastUsageRatio(rounds(1))).toBe(0);
  });
});
