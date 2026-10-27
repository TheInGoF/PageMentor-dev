# Migrationsplan: pm-qwen-tts → vLLM-Omni

Stand: 2026-05-02 · Repo-Stand: v1.18.107

## TL;DR — ehrliche Empfehlung

**Migrier nicht jetzt.** Drei harte Blocker treffen den Audiobook-Workflow direkt.
Bau stattdessen Batching in den bestehenden Sidecar ein (Pfad B). Kürzer, sicherer,
keine Feature-Verluste. Falls Pfad C trotzdem gewünscht: vollständiger Plan unten.

## Was wir heute haben (pm-qwen-tts)

FastAPI-Sidecar (1478 Zeilen Python) mit **einem Endpoint** `POST /v1/audio/speech`,
Field-Dispatch für drei Modi:

| Modus | Trigger-Field | Verwendet für |
|---|---|---|
| Voice-Clone | `ref_audio_b64` | User-uploaded Voices (3-10s WAV/MP3) |
| VoiceDesign | `voice_description` + `seed` | Designed voices wie "Testi" (deterministisch via Seed) |
| Custom-Preset | `speaker` (z.B. "Vivian") | 9 eingebaute Stimmen |

Hart erkämpfte Custom-Features:

- **LoopDetector StoppingCriteria** (v1.18.095) — bricht ab bei Repetition
- **Ring-Buffer-Logs + `/diagnostics/recent-logs`** für Live-Log-Stream ins Backend
- **Per-Request Sampling** (temperature/top_p/top_k/repetition_penalty) inkl. Subtalker-Tunables
- **24kHz Reference-Audio Resampling** für Long-Form-Stabilität
- **Status-Endpoint** mit base_model + customvoice_loaded
- **Health-Endpoint** mit echter Modell-Bereitschaft

## Was vLLM-Omni anbietet (May 2026)

- **3 separate Modell-Varianten**: `Qwen3-TTS-12Hz-1.7B-{CustomVoice,VoiceDesign,Base}`.
  **3 Server gleichzeitig** für alle 3 Modi
- **Endpoints**: `/v1/audio/speech` (single, *nicht* für Concurrency optimiert),
  `/v1/audio/speech/batch` (eigentlicher Speedup), `/v1/audio/speech/stream` (WebSocket),
  `/v1/audio/voices` (Voice-Registry)
- **Voice-Upload als Multipart** an `/v1/audio/voices` — danach via `voice: "name"` selektierbar
- Continuous Batching: 6-10× Speedup im Batch-Endpoint
- Bekannte RTF 0.34, TTFP 131 ms (Q1 2026 Benchmarks)

## Gap-Analyse — Feature-Verlust beim Switch

| Feature heute | vLLM-Omni-Status | Auswirkung |
|---|---|---|
| Single Endpoint für 3 Modi | ❌ — 3 Server nötig | Architektur-Bruch: Compose, Routing, Cancel/Reset alles 3-fach |
| LoopDetector StoppingCriteria | ❌ kein HTTP-Hook | Sicherheitsnetz weg |
| VoiceDesign mit `seed` | ⚠ undokumentiert in HTTP-Schema | "Testi" deterministisch reproduzieren = unklar |
| Subtalker-Sampling | ⚠ undokumentiert (nur SamplingParams-Passthrough) | Long-Form-Tuning verlierst du oder wirkt by accident |
| Ring-Buffer-Logs / `/diagnostics` | ❌ nicht vorhanden | Live-Log-Stream im Logs-Tab bricht für TTS |
| `/admin/gpu/reset` Hot-Unload | ❌ nicht vorhanden | GPU-Sharing mit Ollama nur via Container-Restart |
| Per-Request `temperature/top_p/...` | ⚠ undokumentiert | Settings-UI evtl. wirkungslos |
| Voice-Cache für ref_audio | ✓ vorhanden | Win, gilt aber nur für Clone-Modus |
| Continuous Batching | ✓ via /batch | Der eigentliche Grund — 6-10× Speedup |
| WebSocket-Streaming | ✓ vorhanden | Nice-to-have, aktuell ungenutzt |

## Drei harte Blocker

### Blocker 1: Issue #1707 — Voice-Clone produziert Rauschen am Anfang

Reproduzibel auf RTX Pro 6000 mit vLLM-Omni 0.16.0. Tritt im Original-Torch+FastAPI-
Sidecar **NICHT** auf. Issue offen seit März 2026. Voice "Testi" ist VoiceDesign-
Variante intern via Clone-Mechanismus → **direkt betroffen**. Jedes Kapitel-Intro
hätte Rauschen.

→ <https://github.com/vllm-project/vllm-omni/issues/1707>

### Blocker 2: Issue #1403 — `task_type: voicedesign` Routing kaputt

Case-Sensitivity-Bug. Workaround: `task_type: "VoiceDesign"`. Aber zeigt: VoiceDesign
ist in vLLM-Omni weniger ausgereift als die anderen Modi.

→ <https://github.com/vllm-project/vllm-omni/issues/1403>

### Blocker 3: Single-Shot Endpoint nicht für Concurrency optimiert

README ausdrücklich: "Single request: Batch processing is not yet optimized for
online serving". Heißt: bestehender 1-Request-1-Chunk-Pattern bringt **null
Speedup**. Nur `/batch` skaliert. Nicht "Drop-in", **Backend-Refactor pflicht**.

## Wenn Pfad C trotzdem — 5 Phasen

### Phase 0: Compose-Erweiterung (~2h)

- 3 neue Services: `vllm-tts-customvoice`, `vllm-tts-voicedesign`, `vllm-tts-base`
  auf 8791/8792/8793
- Jeweils `--gpu-memory-utilization 0.3` (sonst passen 3 Modelle nicht in 24GB) —
  **Test nötig**, könnte sein dass nur 2 + Ollama gleichzeitig passen
- Pre-pull Models via `huggingface-cli download` (Bug #904)

### Phase 1: Backend-Routing-Layer (~6h)

- `qwen.ts` umbauen: drei Base-URLs statt einer
- `synthSample()` → vllm-base-Server, `synthDesign()` → vllm-voicedesign-Server,
  `synthPreset()` → vllm-customvoice-Server
- Request-Body-Mapping: `ref_audio_b64` → `ref_audio: "data:audio/wav;base64,..."`,
  `voice_description` → `instructions`, `speaker` → `voice`
- Cancel-Pfad für 3 Server
- Arbiter-Logik: wer triggert was wann?

### Phase 2: Voice-Registry (~4h)

- VoiceClone-Samples pre-registrieren via `POST /v1/audio/voices` beim Sidecar-Start
- Synchronisation: Sample-Delete in Settings → DELETE auf vLLM-Server
- VoiceDesign: vorher klären OB seed funktioniert. Falls nein: UI als
  "nicht-deterministisch" markieren

### Phase 3: Batching im Backend (~10h)

- `audiobook.ts`: chunks pro Kapitel sammeln, an `/v1/audio/speech/batch` senden
- Cache-Hash-Logik beibehalten (per-Chunk hash im Output-Filename)
- Progress-Events anpassen — "batch 1/4 done with 8 chunks" statt "chunk 5/30"
- Fehler-Handling: ein Item failed → andere 7 trotzdem speichern, das eine retry'en

### Phase 4: Loss-Mitigation (~4h, optional)

- Backend-seitige Loop-Detection auf gerendetes Audio (spektrale Repetition)
- Logging-Forwarder: vLLM-Logs aus Container in unseren Logs-Stream via Docker-Logs-Tail
- Health-Wrapper-Endpoint im Backend der die 3 vLLM-Servers aggregiert prüft

### Phase 5: Migration + Test + Rollback (~6h)

- Beide Sidecars parallel: pm-qwen-tts auf 8790, vLLM auf 8791/2/3
- Feature-Flag `PM_TTS_BACKEND=legacy|vllm` im LlmConfig
- 5-10 Test-Kapitel auf beiden Backends, A/B:
  - Audio-Qualität (Rauschen #1707?)
  - Long-Form-Stabilität (loops?)
  - Voice-Identität konsistent (Testi klingt wie Testi?)
- Pass: legacy default, vllm opt-in für 1 Woche
- Weiter pass: legacy entfernen

**Gesamt: ~32h ehrlicher Arbeit.** Plus 1-2 Tage Stabilisierung.

## Rollback-Strategie

Phase 5 Feature-Flag = Lebensversicherung. `PM_TTS_BACKEND=legacy` im Compose-ENV
→ alle Calls zurück an alten Sidecar. Bleibt dauerhaft im Repo. DB-Schema
unverändert (Voice-Samples + Designs kompatibel zu beiden).

## Risiken nach Wahrscheinlichkeit

1. **HOCH**: Rauschen am Audio-Anfang (#1707) — Workflow-Killer
2. **HOCH**: VoiceDesign-Seed nicht zuverlässig → "Testi" wird andere Stimme
3. **MITTEL**: 3 vLLM-Server + Ollama passen nicht in 24GB
4. **MITTEL**: Loop-Detection-Verlust → langer Chunk friert vLLM ein → kein Watchdog
5. **NIEDRIG**: Compose-Komplexität explodiert von 4 auf 7 Services

## Empfehlung: Pfad B statt C

**Alexandria-Pattern in pm-qwen-tts** — 2-3 Tage, kein Feature-Verlust, 3-5× Speedup:

1. `/v1/audio/speech/batch` Endpoint im pm-qwen-tts (~6h Python)
2. Backend Batch-Builder in audiobook.ts (~6h TS)
3. Loop-Detector greift weiterhin pro Item im Batch
4. Sampling, Voice-Modi, Logs — alles unverändert
5. Bei Stress fallback auf single-shot (existiert weiter)

80% Pfad-C-Gewinn, 30% Aufwand, 0% Migrations-Risiko. Issues #1707/#1403 betreffen
uns gar nicht.

## Alternativ: Warten

vLLM-Omni Q2-2026-Roadmap (#2115) adressiert weitere TTS-Features. #1707 ist offen.
Re-evaluieren wenn beides erledigt ist.

## Quellen

- [vLLM-Omni Qwen3-TTS Docs](https://docs.vllm.ai/projects/vllm-omni/en/stable/user_guide/examples/online_serving/qwen3_tts/)
- [vLLM-Omni Speech API](https://docs.vllm.ai/projects/vllm-omni/en/latest/serving/speech_api/)
- [vllm-project/vllm-omni README](https://github.com/vllm-project/vllm-omni)
- [Issue #1707 — Voice-Clone Rauschen](https://github.com/vllm-project/vllm-omni/issues/1707)
- [Issue #1403 — VoiceDesign Routing](https://github.com/vllm-project/vllm-omni/issues/1403)
- [Issue #904 — Pre-pull Models](https://github.com/vllm-project/vllm-omni/issues/904)
- [RFC #1347 — Abort Request](https://github.com/vllm-project/vllm-omni/issues/1347)
- [RFC #2115 — TTS Roadmap Q2 2026](https://github.com/vllm-project/vllm-omni/issues/2115)
- [batch_speech_client.py Reference](https://github.com/vllm-project/vllm-omni/blob/main/examples/online_serving/qwen3_tts/batch_speech_client.py)
- [Alexandria-Audiobook (Pfad B Referenz)](https://github.com/Finrandojin/alexandria-audiobook)
- [QwenLM/Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS)
- [LiteLLM #20078 — voice param mandatory](https://github.com/BerriAI/litellm/issues/20078)
