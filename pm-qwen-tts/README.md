# pm-qwen-tts

Voice-clone TTS sidecar built on
[Qwen3-TTS-12Hz-1.7B-Base](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base)
(Apache 2.0). Clones a reading voice from a 3-10 s reference clip and
speaks arbitrary text in that voice — deterministic when the same seed
and the same reference are used.

Runs behind [`pm-gpu-arbiter`](../pm-gpu-arbiter/), shares the GPU with
Ollama, is started on demand by the arbiter and stopped again after
each TTS job.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | 200 when the model is loaded, 503 with reason in the body |
| `GET /v1/audio/voices` | Metadata — voice management lives in the PageMentor backend |
| `POST /v1/audio/speech` | Voice clone: text + reference audio (base64) → audio bytes |

## POST /v1/audio/speech

```json
{
  "input": "Guten Tag, hier spricht Anna.",
  "ref_audio_b64": "<base64 of a 3-10 s WAV/MP3/FLAC>",
  "ref_text": "This is a sample sentence used as the reference.",
  "language": "German",
  "seed": 12345,
  "response_format": "mp3"
}
```

- **`input`**: the text to be spoken
- **`ref_audio_b64`**: base64 encoding of a 3-10 s clip of the target voice
  (WAV/MP3/FLAC accepted)
- **`ref_text`** (optional): transcript of the reference. When set, the model
  uses the full voice-clone path (best quality). When empty it falls back to
  `x_vector_only_mode` (voice profile without transcript) — faster but
  slightly lower quality
- **`language`**: `German` / `English` / `Chinese` / … (10 languages, see
  [Qwen3-TTS docs](https://github.com/QwenLM/Qwen3-TTS)). Default `German`
- **`seed`**: integer, applied as `torch.manual_seed` before generation —
  same seed + same reference + same text = identical audio
- **`response_format`**: `mp3` | `wav` | `flac`

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `QWEN_TTS_MODEL` | `Qwen/Qwen3-TTS-12Hz-1.7B-Base` | HF repo |
| `QWEN_TTS_DEVICE` | `cuda` (when available) | `cpu` for debugging |
| `QWEN_TTS_DTYPE` | `bfloat16` | `float16` if bf16 is unstable |
| `QWEN_TTS_ATTN_IMPL` | `flash_attention_2` | Image is built with flash-attn 2. On Turing or older (RTX 20xx) set this to `sdpa` — flash-attn 2 needs Ampere+. |
| `QWEN_TTS_DEFAULT_LANGUAGE` | `German` | Used when a request omits `language` |
| `QWEN_TTS_MAX_NEW_TOKENS` | `4096` | Hard ceiling per generation |
| `QWEN_TTS_X_VECTOR_ONLY` | `true` | Fallback when no `ref_text` is provided |

## Pre-built image (recommended)

```bash
docker pull ghcr.io/theingof/pm-qwen-tts:latest
```

In compose:

```yaml
qwen-tts:
  image: ghcr.io/theingof/pm-qwen-tts:latest
  container_name: pm-qwen-tts
  restart: "no"              # arbiter controls start/stop
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

## Build locally (dev / contrib)

```bash
docker build -t pm-qwen-tts:dev ./pm-qwen-tts
docker run --rm --gpus all -p 8880:8880 \
  -v qwen-tts-hf:/root/.cache/huggingface \
  pm-qwen-tts:dev
```

## curl example (standalone test)

```bash
# encode a 3 s WAV sample as base64
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

**503 from `/health`** — model not yet loaded or load error. Response body
(`{"reason":"..."}`) shows the cause. Typical: HF download in progress
(~3-4 GB one-off), takes 2-5 min on the first start.

**OOM during generate** — set `QWEN_TTS_DTYPE=float16` or
`QWEN_TTS_ATTN_IMPL=flash_attention_2` (needs a downstream rebuild).

**Clone sounds brittle** — bad reference sample. Qwen wants a clean,
quiet 3-10 s clip without music or background noise. Sending `ref_text`
along noticeably improves quality.

## License + attribution

Wrapper code: MIT.

The Qwen3-TTS models (`Qwen/Qwen3-TTS-12Hz-*`) are © Alibaba, Apache 2.0.
The model is loaded from the HuggingFace Hub at runtime and is **not**
part of this image. See [NOTICE](../NOTICE) at the repo root.
