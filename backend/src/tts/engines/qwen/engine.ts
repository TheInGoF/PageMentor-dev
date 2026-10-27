// Qwen3-TTS-Engine über den pm-gpu-arbiter
// Stimmen: Presets, Designs, eigene Samples mit festem Seed
// Gleicher Seed + gleiche Referenz + gleicher Text = gleiches Audio
import { writeFile, unlink } from "fs/promises";
import { effective } from "../../../services/llmConfig";
import { listVoiceSamples, recordChunkTiming } from "../../../services/voiceSamples";
import { listVoiceDesigns, recordDesignChunkTiming } from "../../../services/voiceDesigns";
import { applyAtempo } from "../../ffmpeg";
import { listPresetVoices, speakerForPresetId } from "../../presetVoices";
import type {
  TtsEngine,
  Voice,
  SynthesizeParams,
  SynthesizeResult,
  PreviewParams,
} from "../base";
import {
  parseRate,
  readDials,
  SYNTH_TIMEOUT_MS,
  PREVIEW_TIMEOUT_MS,
  type AdvancedDials,
} from "./config";
import { probe, maybeRefresh } from "./probe";
import { designToVoice, sampleToVoice, resolveDesign, resolveSample } from "./voices";
import { callSpeechClone, callSpeechCloneFromDesign, callSpeechPreset } from "./calls";
import { ensureDesignReference } from "./designRef";

export const qwenEngine: TtsEngine = {
  id: "qwen",

  isAvailable: () => {
    maybeRefresh();
    // Verfügbar auch ohne Samples, dann ist die Liste leer
    return probe.alive;
  },

  listVoices: () => {
    maybeRefresh();
    // Preset-Stimmen immer anbieten
    const presets = listPresetVoices();
    let designs: Voice[] = [];
    try {
      designs = listVoiceDesigns().map(designToVoice);
    } catch (err) {
      console.warn(`[qwen-tts] listVoiceDesigns failed:`, err);
    }
    try {
      const customs = listVoiceSamples().map(sampleToVoice);
      return [...presets, ...designs, ...customs];
    } catch (err) {
      console.warn(`[qwen-tts] listVoiceSamples failed:`, err);
      return [...presets, ...designs];
    }
  },

  async synthesize(params: SynthesizeParams): Promise<SynthesizeResult> {
    // Text vom Aufrufer unverändert nutzen: enthält Ansage und Schlusspunkt
    const text =
      params.text ||
      (params.announce ? `${params.announce}.\n\n` : "") +
        params.segment.paragraphs.join("\n\n");
    const speed = parseRate(params.rate);
    const t0 = Date.now();

    const presetSpeaker = speakerForPresetId(params.voice.id);
    const design = resolveDesign(params.voice.id);
    let buf: Buffer;

    if (design) {
      // Design über Referenz klonen: gleiche Stimme in jedem Chunk
      const ready = await ensureDesignReference(design, SYNTH_TIMEOUT_MS);
      const dials = readDials();
      console.log(
        `[qwen-tts] synth design=${ready.id} (${ready.label}) via clone text=${text.length}c rate=${params.rate} seed=${ready.seed} ` +
          `temp=${dials.temperature ?? "def"} top_p=${dials.topP ?? "def"} ` +
          `top_k=${dials.topK ?? "def"} rep_pen=${dials.repetitionPenalty ?? "def"}`
      );
      buf = await callSpeechCloneFromDesign({
        text,
        design: ready,
        timeoutMs: SYNTH_TIMEOUT_MS,
        dials,
        signal: params.signal,
      });
    } else if (presetSpeaker) {
      const instruct = effective("qwenTtsInstruction", "PM_QWEN_TTS_INSTRUCTION");
      const dials = readDials();
      console.log(
        `[qwen-tts] synth preset=${presetSpeaker} text=${text.length}c rate=${params.rate} ` +
          `instruct=${instruct ? "yes" : "no"} temp=${dials.temperature ?? "def"} ` +
          `top_p=${dials.topP ?? "def"} top_k=${dials.topK ?? "def"} ` +
          `rep_pen=${dials.repetitionPenalty ?? "def"}`
      );
      buf = await callSpeechPreset({
        text,
        speaker: presetSpeaker,
        instruct,
        language: params.voice.language,
        timeoutMs: SYNTH_TIMEOUT_MS,
        dials,
        signal: params.signal,
      });
    } else {
      const sample = resolveSample(params.voice.id);
      if (!sample) {
        throw new Error(
          `Qwen-TTS voice sample ${params.voice.id} not found in DB`
        );
      }
      // Base kennt kein speed: Tempo danach per ffmpeg atempo
      const dials = readDials();
      console.log(
        `[qwen-tts] synth clone voice=${params.voice.id} text=${text.length}c rate=${params.rate} ` +
          `temp=${dials.temperature ?? "def"} top_p=${dials.topP ?? "def"} ` +
          `top_k=${dials.topK ?? "def"} rep_pen=${dials.repetitionPenalty ?? "def"}`
      );
      buf = await callSpeechClone({
        text,
        sample,
        speed: 1.0, // info for the sidecar log, effectively ignored
        timeoutMs: SYNTH_TIMEOUT_MS,
        dials,
        signal: params.signal,
      });
    }
    console.log(
      `[qwen-tts] synth response voice=${params.voice.id} bytes=${buf.length} took=${((Date.now() - t0) / 1000).toFixed(1)}s`
    );

    if (buf.length === 0) {
      throw new Error(
        `Qwen-TTS returned empty audio for voice=${params.voice.id}`
      );
    }

    if (Math.abs(speed - 1.0) < 1e-3) {
      await writeFile(params.outPath, buf);
    } else {
      const rawPath = `${params.outPath}.raw.mp3`;
      await writeFile(rawPath, buf);
      try {
        await applyAtempo(rawPath, params.outPath, speed);
      } finally {
        try {
          await unlink(rawPath);
        } catch {
          /* best effort */
        }
      }
      console.log(
        `[qwen-tts] applied atempo=${speed.toFixed(3)} → ${params.outPath}`
      );
    }

    // Laufzeit-Statistik für Restzeit, Presets haben keine DB-Zeile
    if (design) {
      try {
        recordDesignChunkTiming(design.id, text.length, Date.now() - t0);
      } catch (e) {
        console.warn("[qwen-tts] design benchmark update failed:", e);
      }
    } else if (!presetSpeaker) {
      const sample = resolveSample(params.voice.id);
      if (sample) {
        try {
          recordChunkTiming(sample.id, text.length, Date.now() - t0);
        } catch (e) {
          console.warn("[qwen-tts] benchmark update failed:", e);
        }
      }
    }

    return { path: params.outPath, bytes: buf.length };
  },

  async preview(params: PreviewParams): Promise<Buffer> {
    const design = resolveDesign(params.voice.id);
    if (design) {
      // Gespeichertes Design: Vorschau über Klon, wie im Hörbuch
      const ready = await ensureDesignReference(design, PREVIEW_TIMEOUT_MS);
      const buf = await callSpeechCloneFromDesign({
        text: params.text,
        design: ready,
        timeoutMs: PREVIEW_TIMEOUT_MS,
        dials: readDials(),
      });
      if (buf.length === 0) {
        throw new Error(
          `Qwen-TTS preview returned empty audio for voice=${params.voice.id}`
        );
      }
      return buf;
    }

    const presetSpeaker = speakerForPresetId(params.voice.id);
    if (presetSpeaker) {
      const instruct =
        params.instructOverride !== undefined
          ? params.instructOverride
          : effective("qwenTtsInstruction", "PM_QWEN_TTS_INSTRUCTION");
      // Gleiche Regler wie die Synthese, Tester-Werte haben Vorrang
      const base = readDials();
      const dials: AdvancedDials = {
        temperature:
          params.temperatureOverride !== undefined
            ? params.temperatureOverride
            : base.temperature,
        topP:
          params.topPOverride !== undefined
            ? params.topPOverride
            : base.topP,
        topK:
          params.topKOverride !== undefined
            ? params.topKOverride
            : base.topK,
        repetitionPenalty:
          params.repetitionPenaltyOverride !== undefined
            ? params.repetitionPenaltyOverride
            : base.repetitionPenalty,
      };
      const buf = await callSpeechPreset({
        text: params.text,
        speaker: presetSpeaker,
        instruct,
        language: params.voice.language,
        timeoutMs: PREVIEW_TIMEOUT_MS,
        dials,
      });
      if (buf.length === 0) {
        throw new Error(
          `Qwen-TTS preview returned empty audio for voice=${params.voice.id}`
        );
      }
      return buf;
    }

    const sample = resolveSample(params.voice.id);
    if (!sample) {
      throw new Error(
        `Qwen-TTS voice sample ${params.voice.id} not found in DB`
      );
    }
    const base = readDials();
    const dials: AdvancedDials = {
      temperature:
        params.temperatureOverride !== undefined
          ? params.temperatureOverride
          : base.temperature,
      topP:
        params.topPOverride !== undefined ? params.topPOverride : base.topP,
      topK:
        params.topKOverride !== undefined ? params.topKOverride : base.topK,
      repetitionPenalty:
        params.repetitionPenaltyOverride !== undefined
          ? params.repetitionPenaltyOverride
          : base.repetitionPenalty,
    };
    const buf = await callSpeechClone({
      text: params.text,
      sample,
      speed: 1.0,
      timeoutMs: PREVIEW_TIMEOUT_MS,
      dials,
    });
    if (buf.length === 0) {
      throw new Error(
        `Qwen-TTS preview returned empty audio for voice=${params.voice.id}`
      );
    }
    return buf;
  },
};
