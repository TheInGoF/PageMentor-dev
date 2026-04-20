"""pm-qwen-tts — Qwen3-TTS-12Hz-1.7B-Base Voice-Clone Sidecar.

OpenAI-kompatible API, erweitert um Voice-Clone-Felder. Lädt beim ersten
Request das Qwen3-TTS-Base-Modell via das offizielle ``qwen-tts``-Package
(Alibaba), clonest aus einem 3-10 s Referenz-WAV eine Lesestimme und
generiert deutschen Text. Deterministisch dank `torch.manual_seed` vor
jedem Call.

Endpoints
---------

    GET  /health                      liveness (503 bis Modell ready)
    GET  /v1/audio/voices             leer — PageMentor-Backend pflegt
                                      den Voice-Katalog selbst
    POST /v1/audio/speech             Request-Body:
      {
        "input": "...",               zu sprechender Text
        "ref_audio_b64": "..."        base64(WAV), 3-10 s Referenz
        "ref_text": "...",            optional — Transkript der
                                      Referenz (erhöht Klon-Qualität)
        "language": "German",         optional, default "German"
        "seed": 12345,                optional, default 0
        "response_format": "mp3",     "mp3" | "wav" | "flac"
        "speed": 1.0
      }

Seed-Garantie: Der Caller schickt einen festen Seed pro „logischer Voice"
(PageMentor-Backend hält einen Seed pro hochgeladenem Sample in SQLite).
Der Sidecar setzt `torch.manual_seed(seed)` + `cuda.manual_seed_all(seed)`
+ `numpy.random.seed(seed)` vor dem Generate-Call. Gleiche Referenz + gleicher
Text + gleicher Seed = bit-identisches Audio.

Lizenz: Das TTS-Modell Qwen/Qwen3-TTS-12Hz-1.7B-Base ist © Alibaba,
Apache 2.0, und wird zur Laufzeit aus dem HuggingFace-Hub geladen
(nicht im Image gebundelt).
"""

from __future__ import annotations

import base64
import hashlib
import io
import logging
import os
import random
import threading
import time
from contextlib import asynccontextmanager
from typing import Any, Literal, Optional

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
log = logging.getLogger("qwen-tts")

MODEL_ID = os.environ.get("QWEN_TTS_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-Base")
# CustomVoice-Modell mit 9 Preset-Stimmen + Instruction-Control (Freitext-
# Prompt wie "Calm audiobook narrator, slow and clear pacing"). Wird
# lazy geladen beim ersten Request der einen `speaker`-Parameter setzt.
# Base und CustomVoice laufen co-resident (je ~4 GB in bf16; mit Ollama
# auf 24-GB-GPU knapp aber praktikabel wenn nicht alles gleichzeitig
# aktiv). Auf 0 setzen = CustomVoice-Pfad deaktiviert.
CUSTOMVOICE_MODEL_ID = os.environ.get(
    "QWEN_TTS_CUSTOMVOICE_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
)
# Audio-Tokenizer. Qwen hostet Base-Modell und Tokenizer als getrennte
# HF-Repos, der qwen-tts-Loader erwartet aber einen speech_tokenizer/-
# Unterordner im Base-Snapshot — wir laden beide und symlinken sie
# zusammen (siehe `_prepare_model_path`).
TOKENIZER_ID = os.environ.get(
    "QWEN_TTS_TOKENIZER_MODEL", "Qwen/Qwen3-TTS-Tokenizer-12Hz"
)

# Die 9 Preset-Stimmen in CustomVoice. Kein DE-nativer Speaker — für DE
# empfiehlt die Model-Card `Ryan`/`Aiden` (EN-Speaker) + language="German";
# das Modell re-rendert die Stimme in der Zielsprache.
CUSTOMVOICE_PRESETS: list[str] = [
    "Vivian",     # ZH, junge Frau
    "Serena",     # ZH, warm
    "Uncle_Fu",   # ZH, reifer Mann
    "Dylan",      # ZH (Beijing)
    "Eric",       # ZH (Sichuan)
    "Ryan",       # EN, dynamisch — DE-Empfehlung
    "Aiden",      # EN, sonnig — DE-Empfehlung
    "Ono_Anna",   # JP, verspielt
    "Sohee",      # KR, warm
]
DEVICE = os.environ.get("QWEN_TTS_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
DTYPE_NAME = os.environ.get("QWEN_TTS_DTYPE", "bfloat16")
# flash_attention_2 ist ab v1.17.003 im Image vorinstalliert (prebuilt
# wheel, siehe Dockerfile). Auf älteren GPUs (Compute Capability < 8.0,
# z. B. RTX 20xx) `QWEN_TTS_ATTN_IMPL=sdpa` setzen — flash-attn unterstützt
# erst Ampere+.
ATTN_IMPL = os.environ.get("QWEN_TTS_ATTN_IMPL", "flash_attention_2")

# Voice-Clone-Qualitäts-Tuning (können per ENV übersteuert werden).
DEFAULT_LANGUAGE = os.environ.get("QWEN_TTS_DEFAULT_LANGUAGE", "German")
MAX_NEW_TOKENS = int(os.environ.get("QWEN_TTS_MAX_NEW_TOKENS", "4096"))

# Hard-Timeout pro Generate-Call. Zombie-Generationen (Modell-Loop, NaN,
# infinite-repeat) frieren sonst die GPU bis zum Container-Neustart ein.
# Bei Überschreitung: 504 an den Client + self-exit(1), damit Docker den
# Container neu hochfahren kann. Arbiter `restart: "no"` heißt: Arbiter
# entscheidet den Re-Start beim nächsten TTS-Call.
#
# 360 s = 6 min: reguläre Chunks auf einer 3090 laufen um die 4:30
# — 6 min gibt Puffer für den gelegentlich langsamen Chunk ohne
# direkt abzuschießen, aber ein echter Zombie (Infinite-Loop)
# braucht nicht mehr als 6 min zum Entdecken.
GENERATION_TIMEOUT_S = int(os.environ.get("QWEN_TTS_GENERATION_TIMEOUT", "360"))

# Heartbeat-Log-Intervall während aktiver Generation (nur in den Logs,
# nicht am Client). Hilft zu sehen, dass der Prozess nicht hängt.
HEARTBEAT_INTERVAL_S = float(os.environ.get("QWEN_TTS_HEARTBEAT_INTERVAL", "10"))
# Wenn `ref_text` leer bleibt, nutzt Qwen3-TTS-Base den x_vector-only-
# Mode — die Clone-Qualität ist dann leicht reduziert, dafür spart man
# sich die Transkription. Default: echter Clone mit ref_text wenn
# geliefert, sonst x_vector-only.
X_VECTOR_ONLY_FALLBACK = os.environ.get("QWEN_TTS_X_VECTOR_ONLY", "true").lower() in (
    "1", "true", "yes",
)


def _torch_dtype(name: str):
    return {
        "float16": torch.float16, "fp16": torch.float16, "half": torch.float16,
        "bfloat16": torch.bfloat16, "bf16": torch.bfloat16,
        "float32": torch.float32, "fp32": torch.float32,
    }.get(name.lower(), torch.bfloat16)


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------

_model = None
_load_error: Optional[str] = None

# CustomVoice wird lazy geladen (nicht im lifespan), damit Setups ohne
# Preset-Nutzung nicht die zusätzlichen ~4 GB VRAM reservieren. Beim
# ersten Request mit `speaker`-Param wird der Load angestoßen.
_custom_model = None
_custom_load_error: Optional[str] = None
_custom_load_lock = threading.Lock()


def _prepare_model_path() -> str:
    """Lädt Base-Modell und Audio-Tokenizer aus dem HF-Hub und verlinkt
    den Tokenizer als ``speech_tokenizer/``-Unterordner im Base-Snapshot.

    Qwen hat die beiden Modelle als getrennte HF-Repos veröffentlicht,
    aber der ``Qwen3TTSModel``-Loader erwartet sie zusammen. Der
    Symlink ist idempotent — bei Neustart auf bereits gecachtem Volume
    macht die Funktion nichts mehr.

    Gibt den lokalen Pfad des (jetzt vollständigen) Base-Snapshots zurück.
    """
    from huggingface_hub import snapshot_download  # noqa: WPS433

    log.info("resolving %s (base model)", MODEL_ID)
    base_dir = snapshot_download(repo_id=MODEL_ID)
    log.info("resolving %s (audio tokenizer)", TOKENIZER_ID)
    tokenizer_dir = snapshot_download(repo_id=TOKENIZER_ID)

    target = os.path.join(base_dir, "speech_tokenizer")

    if os.path.islink(target):
        # Bereits verlinkt — Link auf den erwarteten Snapshot zeigen
        # lassen (Repo-Update könnte Snapshot-Hash ändern).
        current = os.readlink(target)
        if os.path.realpath(current) != os.path.realpath(tokenizer_dir):
            log.info("updating stale tokenizer symlink %s → %s", target, tokenizer_dir)
            os.remove(target)
            os.symlink(tokenizer_dir, target, target_is_directory=True)
        return base_dir

    if os.path.isdir(target):
        # Vom Upstream bereits mitgeliefert (Repo-Struktur kann sich
        # später ändern). Nicht anfassen, erwartbarer Best-Case.
        log.info("speech_tokenizer/ already present in base snapshot")
        return base_dir

    log.info("symlinking %s → %s/speech_tokenizer", tokenizer_dir, base_dir)
    try:
        os.symlink(tokenizer_dir, target, target_is_directory=True)
    except OSError as e:
        # Fallback für FS ohne Symlink-Support (manche bind-mounts).
        log.warning("symlink failed (%r), falling back to copytree", e)
        import shutil  # noqa: WPS433
        shutil.copytree(tokenizer_dir, target)
    return base_dir


def _load_model() -> None:
    global _model, _load_error
    if _model is not None or _load_error is not None:
        return

    try:
        from qwen_tts import Qwen3TTSModel  # noqa: WPS433
    except Exception as e:  # noqa: BLE001
        _load_error = f"qwen-tts package nicht importierbar: {e!r}"
        log.error(_load_error)
        return

    log.info(
        "loading %s on %s (dtype=%s, attn=%s)",
        MODEL_ID, DEVICE, DTYPE_NAME, ATTN_IMPL,
    )
    t0 = time.time()
    try:
        model_path = _prepare_model_path()
        _model = Qwen3TTSModel.from_pretrained(
            model_path,
            device_map=DEVICE,
            dtype=_torch_dtype(DTYPE_NAME),
            attn_implementation=ATTN_IMPL,
        )
    except Exception as e:  # noqa: BLE001
        _load_error = f"Qwen3TTSModel.from_pretrained failed: {e!r}"
        log.exception("model load failed")
        return

    log.info("model ready in %.1fs", time.time() - t0)


def _load_customvoice_model() -> None:
    """Lazy-Load für das CustomVoice-Modell. Idempotent + thread-safe
    (mehrere parallele ``/v1/audio/speech``-Calls mit Preset können den
    Load gleichzeitig triggern, nur einer lädt tatsächlich).

    Nutzt kein Audio-Tokenizer-Symlink — CustomVoice-Repo enthält den
    speech_tokenizer/ bereits oder braucht ihn nicht (der qwen-tts-
    Loader holt ihn bei Bedarf). Falls der Load fehlschlägt, landet der
    Fehler in ``_custom_load_error`` und der Request kriegt 503.
    """
    global _custom_model, _custom_load_error
    if _custom_model is not None or _custom_load_error is not None:
        return

    with _custom_load_lock:
        # Double-check nach Lock-Acquire.
        if _custom_model is not None or _custom_load_error is not None:
            return

        try:
            from qwen_tts import Qwen3TTSModel  # noqa: WPS433
        except Exception as e:  # noqa: BLE001
            _custom_load_error = f"qwen-tts package nicht importierbar: {e!r}"
            log.error(_custom_load_error)
            return

        log.info(
            "loading %s on %s (dtype=%s, attn=%s) — lazy trigger",
            CUSTOMVOICE_MODEL_ID, DEVICE, DTYPE_NAME, ATTN_IMPL,
        )
        t0 = time.time()
        try:
            _custom_model = Qwen3TTSModel.from_pretrained(
                CUSTOMVOICE_MODEL_ID,
                device_map=DEVICE,
                dtype=_torch_dtype(DTYPE_NAME),
                attn_implementation=ATTN_IMPL,
            )
        except Exception as e:  # noqa: BLE001
            _custom_load_error = f"CustomVoice load failed: {e!r}"
            log.exception("customvoice load failed")
            return

        log.info("customvoice ready in %.1fs", time.time() - t0)


def _apply_seed(seed: int) -> None:
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    np.random.seed(seed)
    random.seed(seed)


# ---------------------------------------------------------------------------
# Audio helpers
# ---------------------------------------------------------------------------


# Decode-Cache für Referenz-Audio. Bei einem 100-Kapitel-Hörbuch mit
# immer demselben User-Sample sparen wir N-mal das base64-decode +
# soundfile-parse + mono-izen (~50-200 ms pro Chunk). Key = SHA-256 des
# Rohstrings; LRU-ähnliches Verhalten via OrderedDict + Max-Size.
from collections import OrderedDict  # noqa: E402

_REF_AUDIO_CACHE_MAX = int(os.environ.get("QWEN_TTS_REF_CACHE_SIZE", "16"))
_ref_audio_cache: OrderedDict[str, tuple[np.ndarray, int]] = OrderedDict()
_ref_audio_cache_lock = threading.Lock()


def _decode_ref_audio(b64: str) -> tuple[np.ndarray, int]:
    """base64 (WAV/MP3/FLAC) → (mono float32 numpy, sample_rate).

    Cached auf dem Roh-b64-String (SHA-256). Identischer Upload bei
    Chunk N+1 trifft den Cache und überspringt das Parsen komplett.
    """
    cache_key = hashlib.sha256(b64.encode("utf-8", errors="ignore")).hexdigest()
    with _ref_audio_cache_lock:
        cached = _ref_audio_cache.get(cache_key)
        if cached is not None:
            _ref_audio_cache.move_to_end(cache_key)
            return cached

    try:
        raw = base64.b64decode(b64)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"ref_audio_b64 not valid base64: {e}")

    # soundfile liest WAV/FLAC/OGG nativ. MP3 braucht libsndfile ≥ 1.1 ODER
    # pydub → wir gehen den pydub-Weg für MP3 damit's auch auf älteren
    # Hosts funktioniert.
    try:
        arr, sr = sf.read(io.BytesIO(raw), dtype="float32")
    except Exception:
        try:
            from pydub import AudioSegment  # noqa: WPS433
            seg = AudioSegment.from_file(io.BytesIO(raw))
            arr = np.array(seg.get_array_of_samples(), dtype=np.float32)
            if seg.channels > 1:
                arr = arr.reshape(-1, seg.channels).mean(axis=1)
            arr /= 2 ** (8 * seg.sample_width - 1)
            sr = seg.frame_rate
        except Exception as e:  # noqa: BLE001
            raise HTTPException(
                status_code=400,
                detail=f"ref_audio decode failed: {e}",
            )

    # Mono machen + shape (N,) erzwingen.
    arr = np.squeeze(arr)
    if arr.ndim > 1:
        arr = arr.mean(axis=1)
    if arr.size == 0:
        raise HTTPException(status_code=400, detail="ref_audio is empty")

    result = (arr.astype(np.float32), int(sr))
    with _ref_audio_cache_lock:
        _ref_audio_cache[cache_key] = result
        _ref_audio_cache.move_to_end(cache_key)
        while len(_ref_audio_cache) > _REF_AUDIO_CACHE_MAX:
            _ref_audio_cache.popitem(last=False)
    return result


def _encode_audio(samples: np.ndarray, sample_rate: int, fmt: str) -> tuple[bytes, str]:
    fmt = fmt.lower()
    if fmt in ("wav", "wave"):
        buf = io.BytesIO()
        sf.write(buf, samples, sample_rate, format="WAV", subtype="PCM_16")
        return buf.getvalue(), "audio/wav"
    if fmt == "flac":
        buf = io.BytesIO()
        sf.write(buf, samples, sample_rate, format="FLAC")
        return buf.getvalue(), "audio/flac"
    if fmt == "mp3":
        from pydub import AudioSegment  # noqa: WPS433
        wav_buf = io.BytesIO()
        sf.write(wav_buf, samples, sample_rate, format="WAV", subtype="PCM_16")
        wav_buf.seek(0)
        seg = AudioSegment.from_wav(wav_buf)
        out_buf = io.BytesIO()
        seg.export(out_buf, format="mp3", bitrate="96k")
        return out_buf.getvalue(), "audio/mpeg"
    raise HTTPException(status_code=400, detail=f"unsupported response_format {fmt!r}")


def _normalize_samples(arr: np.ndarray) -> np.ndarray:
    arr = np.squeeze(arr)
    if arr.ndim > 1:
        arr = arr[0]
    peak = float(np.max(np.abs(arr))) if arr.size else 0.0
    if peak > 1.0:
        arr = arr / peak
    return arr.astype(np.float32)


# ---------------------------------------------------------------------------
# Synthesis
# ---------------------------------------------------------------------------


def _schedule_self_exit(reason: str, delay_s: float = 1.5) -> None:
    """Plant ``os._exit(1)`` nach kurzer Wartezeit ein.

    Zwingende Last Resort wenn die CUDA-Generation hängt: der Thread
    lässt sich in Python nicht sauber killen, also killt der Prozess
    sich selbst. Docker sieht den Exit, der Arbiter started den
    Container beim nächsten TTS-Call neu. Die Wartezeit gibt uvicorn
    Zeit, den aktuellen 504-Response noch zu senden.
    """

    def kick() -> None:
        time.sleep(delay_s)
        log.error("self-exit triggered: %s — container needs restart", reason)
        os._exit(1)

    threading.Thread(target=kick, daemon=True).start()


def _run_with_heartbeat_and_timeout(
    func: Any,
    *,
    label: str,
    timeout_s: int,
) -> Any:
    """Führt ``func()`` in einem Thread aus, loggt alle
    ``HEARTBEAT_INTERVAL_S`` einen Heartbeat, und bricht nach
    ``timeout_s`` ab (HTTP 504 + geplanter Self-Exit)."""
    result: dict[str, Any] = {}
    done = threading.Event()

    def worker() -> None:
        try:
            result["value"] = func()
        except BaseException as e:  # noqa: BLE001
            result["error"] = e
        finally:
            done.set()

    t_start = time.time()
    th = threading.Thread(target=worker, daemon=True)
    th.start()

    while not done.wait(HEARTBEAT_INTERVAL_S):
        elapsed = time.time() - t_start
        if elapsed >= timeout_s:
            log.error(
                "%s timed out after %.0fs (limit=%ds) — zombie generation, self-exit geplant",
                label, elapsed, timeout_s,
            )
            _schedule_self_exit(f"{label} timeout ({elapsed:.0f}s)")
            raise HTTPException(
                status_code=504,
                detail=(
                    f"TTS-Generation hing nach {elapsed:.0f}s fest. Der Sidecar "
                    f"startet gleich neu — bitte Request wiederholen."
                ),
            )
        log.info(
            "%s :: still running, elapsed %.0fs (timeout in %.0fs)",
            label, elapsed, timeout_s - elapsed,
        )

    if "error" in result:
        raise result["error"]
    return result.get("value")


def _synth_clone(
    text: str,
    ref_audio: tuple[np.ndarray, int],
    ref_text: Optional[str],
    language: str,
    seed: int,
    speed: float,
) -> tuple[np.ndarray, int]:
    if _model is None:
        raise HTTPException(
            status_code=503,
            detail=f"model not loaded ({_load_error or 'still initializing'})",
        )

    _apply_seed(seed)

    gen_kwargs: dict[str, Any] = {
        "text": text,
        "language": language,
        "ref_audio": ref_audio,
        "max_new_tokens": MAX_NEW_TOKENS,
    }
    if ref_text and ref_text.strip():
        gen_kwargs["ref_text"] = ref_text.strip()
    elif X_VECTOR_ONLY_FALLBACK:
        gen_kwargs["x_vector_only_mode"] = True
    _ = speed  # speed lässt sich über diesen Pfad nicht setzen (siehe alter Kommentar)

    # Request-Identifier fürs Log-Grepping: 8-stelliger Hash aus Text +
    # Seed + ref_audio-Shape. Macht es einfach, in einem zusammenhängenden
    # Hörbuch-Run den Chunk zu identifizieren der hängt.
    req_hash = hashlib.sha256(
        f"{text}|{seed}|{len(ref_audio[0])}".encode("utf-8")
    ).hexdigest()[:8]
    log.info(
        "synth start [%s] text_len=%d seed=%d lang=%s ref_text=%s",
        req_hash, len(text), seed, language, "yes" if ref_text else "no",
    )
    t0 = time.time()

    def run() -> tuple[Any, Any]:
        try:
            with torch.inference_mode():
                wavs, sr = _model.generate_voice_clone(**gen_kwargs)
            return wavs, sr
        except Exception as e:  # noqa: BLE001
            log.exception("generate_voice_clone [%s] failed", req_hash)
            raise HTTPException(
                status_code=500, detail=f"generation failed: {e}"
            ) from e

    wavs, sr = _run_with_heartbeat_and_timeout(
        run, label=f"synth [{req_hash}]", timeout_s=GENERATION_TIMEOUT_S
    )

    elapsed = time.time() - t0
    if wavs is None or len(wavs) == 0:
        log.error("synth [%s] returned empty waveform after %.1fs", req_hash, elapsed)
        raise HTTPException(status_code=500, detail="model returned empty waveform")

    samples = _normalize_samples(np.asarray(wavs[0]))
    audio_s = samples.shape[0] / float(sr) if sr else 0.0
    log.info(
        "synth done  [%s] in %.1fs (audio=%.1fs, rt=%.2fx)",
        req_hash, elapsed, audio_s, elapsed / audio_s if audio_s > 0 else 0.0,
    )
    return samples, int(sr)


def _synth_custom(
    text: str,
    speaker: str,
    instruct: Optional[str],
    language: str,
    seed: int,
) -> tuple[np.ndarray, int]:
    """Synthese über das CustomVoice-Modell. `speaker` muss einer der
    9 Presets sein; `instruct` ist Freitext ("Calm narrator, slow pace")
    oder leer. Keine Stil-Drift zwischen Chunks weil die Preset-Stimme
    im Modell verankert ist (Base-Voice-Clone ist das nicht — dort
    drifted sie wegen autoregressiver Sampling-Pfade)."""
    if speaker not in CUSTOMVOICE_PRESETS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"unknown speaker {speaker!r}; erlaubte Presets: "
                f"{', '.join(CUSTOMVOICE_PRESETS)}"
            ),
        )

    _load_customvoice_model()
    if _custom_model is None:
        raise HTTPException(
            status_code=503,
            detail=f"customvoice not loaded ({_custom_load_error or 'still initializing'})",
        )

    _apply_seed(seed)

    gen_kwargs: dict[str, Any] = {
        "text": text,
        "language": language,
        "speaker": speaker,
        "max_new_tokens": MAX_NEW_TOKENS,
    }
    if instruct and instruct.strip():
        gen_kwargs["instruct"] = instruct.strip()

    req_hash = hashlib.sha256(
        f"{text}|{seed}|{speaker}|{instruct or ''}".encode("utf-8")
    ).hexdigest()[:8]
    log.info(
        "customvoice start [%s] text_len=%d seed=%d speaker=%s lang=%s instruct=%s",
        req_hash, len(text), seed, speaker, language,
        "yes" if instruct else "no",
    )
    t0 = time.time()

    def run() -> tuple[Any, Any]:
        try:
            with torch.inference_mode():
                wavs, sr = _custom_model.generate_custom_voice(**gen_kwargs)
            return wavs, sr
        except Exception as e:  # noqa: BLE001
            log.exception("generate_custom_voice [%s] failed", req_hash)
            raise HTTPException(
                status_code=500, detail=f"generation failed: {e}"
            ) from e

    wavs, sr = _run_with_heartbeat_and_timeout(
        run, label=f"customvoice [{req_hash}]", timeout_s=GENERATION_TIMEOUT_S
    )

    elapsed = time.time() - t0
    if wavs is None or len(wavs) == 0:
        log.error(
            "customvoice [%s] returned empty waveform after %.1fs",
            req_hash, elapsed,
        )
        raise HTTPException(status_code=500, detail="model returned empty waveform")

    samples = _normalize_samples(np.asarray(wavs[0]))
    audio_s = samples.shape[0] / float(sr) if sr else 0.0
    log.info(
        "customvoice done  [%s] in %.1fs (audio=%.1fs, rt=%.2fx)",
        req_hash, elapsed, audio_s,
        elapsed / audio_s if audio_s > 0 else 0.0,
    )
    return samples, int(sr)


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    _load_model()  # blockiert Startup bis Modell (oder Load-Error) da ist
    yield


app = FastAPI(title="pm-qwen-tts", lifespan=lifespan)


@app.get("/health")
async def health():
    # Base-Modell ist beim Startup-Gate (lifespan) geladen — wenn es
    # da nicht durchkommt, ist der Sidecar komplett kaputt. CustomVoice
    # wird lazy geladen, fehlt hier also absichtlich in der Ready-
    # Condition (wäre sonst "healthy=false" bis jemand ein Preset nutzt).
    if _model is None:
        return JSONResponse(
            status_code=503,
            content={
                "ok": False,
                "reason": _load_error or "model_not_loaded",
                "model": MODEL_ID,
            },
        )
    return {
        "ok": True,
        "base_model": MODEL_ID,
        "customvoice_model": CUSTOMVOICE_MODEL_ID,
        "customvoice_loaded": _custom_model is not None,
        "customvoice_error": _custom_load_error,
    }


@app.get("/v1/audio/voices")
async def list_voices():
    # Keine Built-in-Voices mehr — die Voice-Verwaltung sitzt im
    # PageMentor-Backend (Uploads + DB). Hier geben wir nur Metadaten
    # zurück, damit man den Sidecar auch solo prüfen kann.
    return {
        "base_model": MODEL_ID,
        "customvoice_model": CUSTOMVOICE_MODEL_ID,
        "customvoice_presets": CUSTOMVOICE_PRESETS,
        "voices": [],
        "accepts_voice_clone": True,
        "accepts_customvoice": True,
        "required_fields_clone": ["input", "ref_audio_b64"],
        "required_fields_preset": ["input", "speaker"],
    }


class SpeechRequest(BaseModel):
    # OpenAI-kompat-Felder (werden teilweise ignoriert):
    model: Optional[str] = None
    input: str = Field(..., min_length=1)
    voice: Optional[str] = None          # nur Logging/Diagnose
    response_format: Literal["mp3", "wav", "flac"] = "mp3"
    speed: float = 1.0

    # Dispatch: genau EINER der folgenden Pfade muss gesetzt sein.
    # Wenn `speaker` gesetzt → CustomVoice-Pfad (Preset + Instruction).
    # Sonst → Voice-Clone-Pfad über `ref_audio_b64` + optional `ref_text`.

    # Voice-Clone-Felder (optional, wenn speaker gesetzt):
    ref_audio_b64: Optional[str] = None
    ref_text: Optional[str] = None

    # CustomVoice-Felder (optional, wenn ref_audio_b64 gesetzt):
    speaker: Optional[str] = None
    instruct: Optional[str] = None

    language: str = DEFAULT_LANGUAGE
    seed: int = 0


# WICHTIG: `def` statt `async def`. Der Synth-Call blockiert Minuten-
# lang (threading.Event.wait im Heartbeat-Wrapper). Ein `async def`-
# Handler würde den asyncio-Event-Loop blockieren, bis die Generation
# fertig ist → Docker-Healthcheck auf /health kriegt keine Antwort und
# markiert den Container als unhealthy. FastAPI führt `def`-Handler
# automatisch im Threadpool aus; Event-Loop bleibt responsiv.
@app.post("/v1/audio/speech")
def speech(req: SpeechRequest):
    use_custom = bool(req.speaker and req.speaker.strip())
    if use_custom:
        samples, sr = _synth_custom(
            text=req.input,
            speaker=req.speaker.strip(),  # type: ignore[union-attr]
            instruct=req.instruct,
            language=req.language,
            seed=req.seed,
        )
    else:
        if not req.ref_audio_b64 or not req.ref_audio_b64.strip():
            raise HTTPException(
                status_code=400,
                detail=(
                    "Request muss entweder `speaker` (CustomVoice-Preset) "
                    "oder `ref_audio_b64` (Voice-Clone) enthalten."
                ),
            )
        ref_audio = _decode_ref_audio(req.ref_audio_b64)
        samples, sr = _synth_clone(
            text=req.input,
            ref_audio=ref_audio,
            ref_text=req.ref_text,
            language=req.language,
            seed=req.seed,
            speed=req.speed,
        )
    body, ctype = _encode_audio(samples, sr, req.response_format)
    return Response(content=body, media_type=ctype)
