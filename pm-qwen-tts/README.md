# pm-qwen-tts

Voice-Clone-TTS-Sidecar auf Basis von
[Qwen3-TTS-12Hz-1.7B-Base](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base)
(Apache 2.0). Klont aus einem 3-10 s Referenz-Audio eine Lesestimme
und spricht beliebigen Text in dieser Stimme — deterministisch wenn
derselbe Seed + dieselbe Referenz verwendet werden.

Läuft hinter dem [`pm-gpu-arbiter`](../pm-gpu-arbiter/), teilt sich die
GPU mit Ollama, wird vom Arbiter on-demand gestartet und nach TTS-Jobs
wieder gestoppt.

## Endpoints

| Endpoint | Zweck |
|---|---|
| `GET /health` | 200 wenn Modell geladen, 503 mit Grund im Body |
| `GET /v1/audio/voices` | Metadaten — Voice-Verwaltung sitzt im PageMentor-Backend |
| `POST /v1/audio/speech` | Voice-Clone: Text + Referenz-Audio (base64) → Audio-Bytes |

## POST /v1/audio/speech

```json
{
  "input": "Guten Tag, hier spricht Anna.",
  "ref_audio_b64": "<base64 eines 3-10 s WAV/MP3/FLAC>",
  "ref_text": "Das ist ein Testsatz zur Referenz.",
  "language": "German",
  "seed": 12345,
  "response_format": "mp3"
}
```

- **`input`**: der zu sprechende Text
- **`ref_audio_b64`**: Base64-Codierung eines 3-10 s Audioclips der Zielstimme
  (WAV/MP3/FLAC akzeptiert)
- **`ref_text`** (optional): Transkript der Referenz — wenn gesetzt, nutzt
  das Modell den vollen Voice-Clone-Pfad (beste Qualität). Wenn leer, geht
  es in den `x_vector_only_mode` (Stimmprofil ohne Transkript) — schneller,
  Qualität leicht reduziert
- **`language`**: `German` / `English` / `Chinese` / … (10 Sprachen, siehe
  [Qwen3-TTS Doku](https://github.com/QwenLM/Qwen3-TTS)). Default `German`
- **`seed`**: Integer, wird vor der Generation als `torch.manual_seed`
  gesetzt — gleicher Seed + gleiche Referenz + gleicher Text = identisches
  Audio
- **`response_format`**: `mp3` | `wav` | `flac`

## Environment

| Variable | Default | Zweck |
|---|---|---|
| `QWEN_TTS_MODEL` | `Qwen/Qwen3-TTS-12Hz-1.7B-Base` | HF-Repo |
| `QWEN_TTS_DEVICE` | `cuda` (wenn verfügbar) | `cpu` zum Debug |
| `QWEN_TTS_DTYPE` | `bfloat16` | `float16` falls bf16 instabil |
| `QWEN_TTS_ATTN_IMPL` | `sdpa` | `flash_attention_2` für -10 bis -20% VRAM (extra build) |
| `QWEN_TTS_DEFAULT_LANGUAGE` | `German` | wenn Request kein `language` mitsendet |
| `QWEN_TTS_MAX_NEW_TOKENS` | `4096` | Obergrenze pro Generation |
| `QWEN_TTS_X_VECTOR_ONLY` | `true` | Fallback wenn kein `ref_text` im Request |

## Pre-built Image (empfohlen)

```bash
docker pull ghcr.io/lordvonbaum/pm-qwen-tts:latest
```

In der Compose:

```yaml
qwen-tts:
  image: ghcr.io/lordvonbaum/pm-qwen-tts:latest
  container_name: pm-qwen-tts
  restart: "no"              # Arbiter kontrolliert Start/Stop
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

## Lokal bauen (Dev/Contrib)

```bash
docker build -t pm-qwen-tts:dev ./pm-qwen-tts
docker run --rm --gpus all -p 8880:8880 \
  -v qwen-tts-hf:/root/.cache/huggingface \
  pm-qwen-tts:dev
```

## curl-Beispiel (standalone test)

```bash
# 3 s WAV-Sample als base64 kodieren
REF_B64=$(base64 -w0 alice-3s.wav)

curl -X POST http://localhost:8880/v1/audio/speech \
  -H "Content-Type: application/json" \
  -o spoken.mp3 \
  -d "{
    \"input\": \"Hallo Welt, dies ist ein Test.\",
    \"ref_audio_b64\": \"$REF_B64\",
    \"ref_text\": \"This is the transcript of the reference audio.\",
    \"language\": \"German\",
    \"seed\": 42,
    \"response_format\": \"mp3\"
  }"
```

## Troubleshooting

**503 von `/health`** — Modell noch nicht geladen oder Load-Error. Response-
Body (`{"reason":"..."}`) zeigt den Grund. Typisch: HF-Download läuft
(~3-4 GB einmalig), dauert beim ersten Start 2-5 min.

**OOM beim Generate** — `QWEN_TTS_DTYPE=float16` setzen oder
`QWEN_TTS_ATTN_IMPL=flash_attention_2` (braucht Downstream-Rebuild).

**Klone klingt brüchig** — schlechtes Referenzsample. Qwen will klare,
ruhige 3-10 s ohne Musik/Hintergrundlärm. `ref_text` mitsenden verbessert
die Qualität spürbar.

## Lizenz + Attribution

Wrapper-Code: MIT.

Die Qwen3-TTS-Modelle (`Qwen/Qwen3-TTS-12Hz-*`) sind © Alibaba, Apache 2.0.
Das Modell wird zur Laufzeit aus dem HuggingFace-Hub geladen und ist
**nicht** Teil dieses Images. Siehe [NOTICE](../NOTICE) im Repo-Root.
