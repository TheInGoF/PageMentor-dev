# pm-qwen-tts

Qwen3-TTS-Flash als self-hosted Sidecar mit OpenAI-kompatibler API.
Läuft hinter dem [`pm-gpu-arbiter`](../pm-gpu-arbiter/), teilt sich die
GPU mit Ollama, wird on-demand vom Arbiter gestartet und nach TTS-Jobs
wieder gestoppt.

- **Modell**: [Qwen/Qwen3-TTS-Flash](https://huggingface.co/Qwen/Qwen3-TTS-Flash)
  (Apache 2.0, multilingual — jede Built-in-Voice spricht Deutsch nativ)
- **API**: dieselbe Shape wie Kokoro-FastAPI / OpenAI (`/v1/audio/speech`)
- **Deterministisch**: pro Voice ist ein fester Seed konfiguriert. Gleicher
  Text + gleiche Voice → bit-identisches Audio
- **Kein Model-Bundle**: Weights kommen beim ersten Start aus dem HF-Hub
  (~5 GB), gecached im Volume. Image selbst nur ~2 GB (PyTorch-Base)

## Endpoints

| Endpoint | Zweck |
|---|---|
| `GET /health` | 200 wenn Modell geladen, 503 während Cold-Start |
| `GET /v1/audio/voices` | Voice-Katalog + discovered Qwen-Speakers |
| `POST /v1/audio/speech` | OpenAI-Shape: `{input, voice, response_format, speed, seed}` |
| `GET /v1/audio/voices/{id}/preview?text=…` | Kurz-Preview als MP3 |

## Environment

| Variable | Default | Zweck |
|---|---|---|
| `QWEN_TTS_MODEL` | `Qwen/Qwen3-TTS-Flash` | HuggingFace-Repo |
| `QWEN_TTS_DEVICE` | `cuda` (wenn verfügbar) | `cpu` für Debug |
| `QWEN_TTS_DTYPE` | `bfloat16` | `float16` wenn bf16 instabil |
| `QWEN_TTS_SAMPLE_RATE` | `24000` | 24 kHz passt zu Qwen |
| `QWEN_TTS_MAX_NEW_TOKENS` | `4096` | Obergrenze pro Generation |
| `QWEN_TTS_SPEAKER_F1` | `Cherry` | Preset → `de_f_anna` (Anna) |
| `QWEN_TTS_SPEAKER_F2` | `Jada` | Preset → `de_f_emma` (Emma) |
| `QWEN_TTS_SPEAKER_M1` | `Ethan` | Preset → `de_m_klaus` (Klaus) |
| `QWEN_TTS_SPEAKER_M2` | `Nofish` | Preset → `de_m_max` (Max) |

Wenn ein konfigurierter Preset-Name nicht im Modell existiert, fällt der
Sidecar sichtbar im Log auf den ersten verfügbaren Speaker zurück — der
Request scheitert nicht. Beim ersten Start auf die Log-Zeile
„discovered speakers: …" achten und ggf. die `QWEN_TTS_SPEAKER_*`-
Defaults überschreiben.

## Pre-built Image (empfohlen)

```bash
docker pull ghcr.io/lordvonbaum/pm-qwen-tts:latest
```

In der Compose:
```yaml
qwen-tts:
  image: ghcr.io/lordvonbaum/pm-qwen-tts:latest
  container_name: pm-qwen-tts
  restart: "no"                # Arbiter kontrolliert Start/Stop
  ports:
    - "8880:8880"
  volumes:
    - qwen-tts-hf:/root/.cache/huggingface
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: 1
            capabilities: [gpu]
```

## Lokal bauen (für Dev/Contrib)

```bash
docker build -t pm-qwen-tts:dev ./pm-qwen-tts
docker run --rm --gpus all -p 8880:8880 \
  -v qwen-tts-hf:/root/.cache/huggingface \
  pm-qwen-tts:dev
```

## curl-Beispiele

**Voice-Katalog**
```bash
curl -s http://localhost:8880/v1/audio/voices | jq
```

**Preview**
```bash
curl -o preview.mp3 \
  "http://localhost:8880/v1/audio/voices/de_f_anna/preview?text=Hallo,%20dies%20ist%20Anna."
```

**Synthese (OpenAI-Shape)**
```bash
curl -X POST http://localhost:8880/v1/audio/speech \
  -H "Content-Type: application/json" \
  -o speech.mp3 \
  -d '{
    "input": "Willkommen im lokalen Qwen-TTS-Sidecar.",
    "voice": "de_m_klaus",
    "response_format": "mp3",
    "speed": 1.0
  }'
```

## Troubleshooting

**Modell-Load hängt 3+ min beim ersten Start** — normal, Qwen3-TTS-Flash
wird ~5 GB aus dem HF-Hub gezogen. Cache bleibt im `qwen-tts-hf`-Volume,
zweiter Start ist in ~15 s warm.

**OOM beim Laden** — `QWEN_TTS_DTYPE=float16` setzen (spart VRAM ggü. bf16
auf manchen Karten). Oder den Arbiter davor setzen, der entlädt Ollama
automatisch bevor Qwen lädt.

**„speaker preset ... nicht im Modell"** im Log — Qwen-Revision hat die
Namen umbenannt. Log zeigt „discovered speakers" — passende Namen in
`QWEN_TTS_SPEAKER_*` eintragen.

**503 von `/health`** — Modell noch nicht geladen (Cold-Start). Der
Arbiter hält dafür `TTS_STARTUP_TIMEOUT=300` vor. Beim ersten Download
kann das knapp werden — dann auf 600 erhöhen.

## Lizenz + Attribution

Dieser Wrapper-Code: MIT (eigenes Repo).

Das TTS-Modell [Qwen/Qwen3-TTS-Flash](https://huggingface.co/Qwen/Qwen3-TTS-Flash)
© Alibaba, Apache 2.0. Das Modell wird zur Laufzeit aus dem HuggingFace-
Hub geladen und ist **nicht** Teil dieses Images. Die Apache-2.0-Lizenz
erlaubt Distribution, Modifikation und kommerzielle Nutzung bei
Bewahrung der Copyright- und Lizenz-Notice — siehe
[NOTICE](../NOTICE) im Repo-Root.
