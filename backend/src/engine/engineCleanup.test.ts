import { describe, expect, test } from "bun:test";
import { dueForCleanup, nextOffState, UNUSED_DAYS } from "./engineCleanup";

const DAY = 24 * 3600_000;

describe("Aufräumen abgeschalteter Stimmen", () => {
  test("neu abgeschaltet startet die Uhr, eingeschaltet fällt raus", () => {
    const s = nextOffState({ qwen: { since: 5 } }, ["qwen"], 100);
    expect(s).toEqual({ f5: { since: 100 }, tada: { since: 100 } });
  });

  test("bestehende Uhr läuft weiter", () => {
    expect(nextOffState({ f5: { since: 5 } }, ["qwen", "tada"], 100)).toEqual({ f5: { since: 5 } });
  });

  test("erst nach 14 Tagen und nur einmal fällig", () => {
    const now = UNUSED_DAYS * DAY + 10;
    expect(dueForCleanup({ f5: { since: 11 }, tada: { since: 10 }, qwen: { since: 0, cleaned: true } }, now)).toEqual(["tada"]);
  });
});
