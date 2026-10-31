// Stimm-Extraktor: Video ablegen, Wellenform, genauer Schnitt mit Stille an beiden Enden
import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cut, dropSource, peaks, peaksFromPcm, saveSource } from "./voiceExtract";
import { probeDurationMs } from "../tts/ffmpeg";

const dir = mkdtempSync(join(tmpdir(), "pm-extract-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("Stimm-Extraktor", () => {
  test("Ausschläge je Abschnitt", () => {
    const pcm = Buffer.alloc(8);
    pcm.writeInt16LE(16384, 2);
    pcm.writeInt16LE(-32768, 6);
    expect(peaksFromPcm(pcm, 2)).toEqual([0.5, 1]);
    expect(peaksFromPcm(Buffer.alloc(0), 3)).toEqual([0, 0, 0]);
  });

  test("Video: 3 s Stille, 2 s Ton; Schnitt 3,0–4,5 s plus je 0,5 s Stille", async () => {
    const video = join(dir, "clip.mp4");
    execFileSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=5",
      "-f", "lavfi", "-i", "aevalsrc='if(gte(t,3),0.8*sin(2*PI*440*t),0)':s=44100:d=5",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", video,
    ]);
    const { id, durationSec } = await saveSource(new Blob([readFileSync(video)]), "clip.mp4");
    expect(durationSec).toBeGreaterThan(4.8);

    const p = await peaks(id, 0, 5, 50);
    expect(p).toHaveLength(50);
    expect(Math.max(...p.slice(0, 25))).toBeLessThan(0.05);
    expect(Math.max(...p.slice(35))).toBeGreaterThan(0.5);

    const wav = await cut(id, 3, 4.5);
    const out = join(dir, "cut.wav");
    writeFileSync(out, wav);
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    const ms = await probeDurationMs(out);
    expect(Math.abs(ms - 2500)).toBeLessThan(40);
    // Standardkopf, danach 0,5 s Stille (24 kHz Mono 16 Bit)
    expect(wav.subarray(36, 40).toString()).toBe("data");
    const lead = wav.subarray(44, 44 + 24000);
    expect(Math.max(...peaksFromPcm(lead, 1))).toBeLessThan(0.01);

    await expect(cut(id, 4, 3)).rejects.toThrow();
    dropSource(id);
    await expect(peaks(id, 0, 1, 10)).rejects.toThrow();
  });
});
