# pm-gpu-arbiter

Transparenter Reverse-Proxy vor **Ollama** und mehreren **TTS-Sidecars**
(Qwen, F5, TADA auf der GPU, Kokoro auf der CPU). Immer nur ein Modell im
VRAM, Zugriffe per `asyncio.Lock` in einer Schlange, nichts wird verworfen.

- `/api/*`                    → Ollama (vorher alle GPU-TTS-Container stoppen)
- `/tts/<engine>/v1/audio/*`  → diese Engine (vorher Ollama entladen, andere
  Engines stoppen, Engine starten; danach Linger, dann Stopp)
- `/v1/audio/*`               → wie oben mit `TTS_DEFAULT_ENGINE`
- CPU-Engines (`|cpu`) laufen dauerhaft und werden nur durchgereicht

Module: `config.py` (Umgebung, Engine-Liste), `containers.py` (Docker),
`ollama.py`, `gpu.py` (GPU-Besitz), `main.py` (Routen), `proxy.py`.
Test mit Attrappen: `python tests/test_arbiter.py`.
- `/status`      → aktueller Owner, Queue-Tiefe, Container-Status
- `/health`      → simpler Liveness-Check (kein GPU-Switch)

Der Proxy streamt NDJSON/SSE/Binär — Ollama-Chat mit `stream:true`
funktioniert transparent.

## Environment

| Variable | Default | Zweck |
|---|---|---|
| `OLLAMA_URL` | `http://ollama:11434` | Ollama-Upstream |
| `TTS_ENGINES` | *(leer)* | `name=url\|container[\|cpu]`, durch Komma getrennt |
| `TTS_DEFAULT_ENGINE` | erste Engine | Ziel für `/v1/audio/*` ohne Präfix |
| `TTS_UPSTREAM_URL` | `http://qwen-tts:8880` | nur ohne `TTS_ENGINES`: einzelne Engine `qwen` |
| `TTS_CONTAINER` | `pm-qwen-tts` | nur ohne `TTS_ENGINES` |
| `TTS_API_KEY` | *(leer)* | wird als `X-API-Key` weitergereicht |
| `TTS_STARTUP_TIMEOUT` | `180` | Sek. Warten auf `/health` — Qwen braucht beim Cold-Start bis zu 3 min |
| `TTS_IDLE_LINGER_SECONDS` | `60` | Sek. die der TTS-Container nach einem Call am Leben bleibt. Kommt in der Zeit ein weiterer TTS-Call → kein Restart nötig. LLM-Call killt trotzdem sofort. `0` = altes Verhalten (Stop nach jedem Call). |
| `PROXY_REQUEST_TIMEOUT` | `1800` | Sek. für lange Synth-Jobs (30 min) |

Alte `VIBEVOICE_*`-Variablen werden als Fallback weiter akzeptiert,
neue Deployments aber bitte auf `TTS_*` umstellen.

## Start (als Teil des PageMentor-Compose-Stacks)

```bash
docker compose up -d --build pm-gpu-arbiter
curl http://localhost:8790/health
curl http://localhost:8790/status | jq
```

> **Wichtig:** Der TTS-Container braucht `restart: "no"`, sonst fährt
> Docker ihn nach dem Arbiter-Stop ungewollt neu hoch.

## curl-Beispiele

**Status:**
```bash
curl -s http://localhost:8790/status | jq
# {"owner":"idle", "since_seconds":12.4, "queue_depth":0, "tts_container":"exited", ...}
```

**LLM-Call (streaming):**
```bash
curl -N http://localhost:8790/api/generate -d '{
  "model":"gemma3:27b",
  "prompt":"Sag hallo.",
  "stream":true
}'
```

**TTS-Call (OpenAI-Shape):** triggert automatisch Unload + TTS-Start.
```bash
curl -X POST http://localhost:8790/v1/audio/speech \
  -H "Content-Type: application/json" \
  -o speech.mp3 \
  -d '{
    "input":"Hallo, dies ist ein Test.",
    "voice":"de_m_klaus",
    "response_format":"mp3"
  }'
```

## Troubleshooting

**`docker.errors.PermissionDenied`** — Socket-Mount fehlt:
```bash
docker compose exec pm-gpu-arbiter ls -la /var/run/docker.sock
```

**`tts_startup_timeout`** — erster Modell-Load zieht ~4 GB aus dem
HuggingFace-Hub. `TTS_STARTUP_TIMEOUT=300` wenn die Leitung langsam ist,
danach kommt der Cache aus dem Volume und zweiter Start ist schnell.

**Ollama entlädt nicht** — `/api/ps` leer? Dann ist nichts zu entladen.
Bei unerreichbarem Ollama wartet der Unload pro Modell bis zu 30 s.

**Sicherheit** — der Docker-Socket gibt dem Arbiter Root auf den Host.
Für rein interne Nutzung OK. Für exponiertes Deployment
`tecnativa/docker-socket-proxy` mit `CONTAINERS=1` + `POST=1`
davorschalten.
