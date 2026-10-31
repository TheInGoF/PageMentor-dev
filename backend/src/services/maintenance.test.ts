import { describe, expect, test } from "bun:test";
import { decide } from "./maintenance";

describe("Wissenspflege entscheidet", () => {
  test("offene Arbeit und freie Grafikkarte: Countdown von einer Minute", () => {
    expect(decide({ status: "idle" }, 1000, true, false)).toEqual({ status: "countdown", until: 61000, start: false });
  });
  test("nichts offen: bleibt ruhig; belegt: wartet ohne Countdown", () => {
    expect(decide({ status: "idle" }, 0, false, false)).toEqual({ status: "idle", start: false });
    expect(decide({ status: "idle" }, 0, true, true)).toEqual({ status: "idle", start: false });
  });
  test("Countdown abgelaufen und frei: startet; belegt: Ankündigung bleibt stehen", () => {
    expect(decide({ status: "countdown", until: 5000 }, 6000, true, false)).toEqual({ status: "running", start: true });
    expect(decide({ status: "countdown", until: 5000 }, 6000, true, true)).toEqual({ status: "countdown", until: 5000, start: false });
    expect(decide({ status: "countdown", until: 5000 }, 4000, true, false)).toEqual({ status: "countdown", until: 5000, start: false });
  });
  test("nach Abbruch Ruhe bis zum Ende, dann wieder normal", () => {
    expect(decide({ status: "snoozed", until: 10000 }, 9000, true, false)).toEqual({ status: "snoozed", until: 10000, start: false });
    expect(decide({ status: "snoozed", until: 10000 }, 11000, true, false).status).toBe("countdown");
  });
  test("läuft: nichts dazwischen", () => {
    expect(decide({ status: "running" }, 0, true, true)).toEqual({ status: "running", until: undefined, start: false });
  });
});
