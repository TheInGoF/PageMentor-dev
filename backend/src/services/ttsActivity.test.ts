import { describe, expect, test } from "bun:test";
import { pickActivity } from "./ttsActivity";

describe("Ladeanzeige Stimm-Engines", () => {
  test("Download vor Laden vor Start, sonst nichts", () => {
    expect(pickActivity({ engines: { f5: { activity: null } } })).toBeNull();
    expect(pickActivity({ starting: { engine: "qwen", seconds: 4 }, engines: {} })).toEqual({ engine: "qwen", phase: "start", seconds: 4 });
    const a = pickActivity({
      starting: { engine: "f5", seconds: 30 },
      engines: { qwen: { activity: { phase: "load", model: "Qwen", seconds: 2 } }, f5: { activity: { phase: "download", model: "F5 Spanish", seconds: 9, bytes: 5, total: 10 } } },
    });
    expect(a).toMatchObject({ engine: "f5", phase: "download", bytes: 5, total: 10 });
  });
});
