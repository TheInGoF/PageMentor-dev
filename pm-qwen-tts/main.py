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
import io
import logging
import os
import random
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
# Audio-Tokenizer. Qwen hostet Base-Modell und Tokenizer als getrennte
# HF-Repos, der qwen-tts-Loader erwartet aber einen speech_tokenizer/-
# Unterordner im Base-Snapshot — wir laden beide und symlinken sie
# zusammen (siehe `_prepare_model_path`).
TOKENIZER_ID = os.environ.get(
    "QWEN_TTS_TOKENIZER_MODEL", "Qwen/Qwen3-TTS-Tokenizer-12Hz"
)
DEVICE = os.environ.get("QWEN_TTS_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
DTYPE_NAME = os.environ.get("QWEN_TTS_DTYPE", "bfloat16")
# sdpa reicht für den Anfang; flash-attn-2 bringt 10-20% Speed aber
# kostet Minuten Build-Zeit (C++-Compile) — wer das will setzt die ENV
# und baut flash-attn im eigenen Downstream-Dockerfile.
ATTN_IMPL = os.environ.get("QWEN_TTS_ATTN_IMPL", "sdpa")

# Voice-Clone-Qualitäts-Tuning (können per ENV übersteuert werden).
DEFAULT_LANGUAGE = os.environ.get("QWEN_TTS_DEFAULT_LANGUAGE", "German")
MAX_NEW_TOKENS = int(os.environ.get("QWEN_TTS_MAX_NEW_TOKENS", "4096"))
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


def _apply_seed(seed: int) -> None:
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    np.random.seed(seed)
    random.seed(seed)


# ---------------------------------------------------------------------------
# Audio helpers
# ---------------------------------------------------------------------------


def _decode_ref_audio(b64: str) -> tuple[np.ndarray, int]:
    """base64 (WAV/MP3/FLAC) → (mono float32 numpy, sample_rate)."""
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
    return arr.astype(np.float32), int(sr)


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

    # Qwen3TTSModel.generate_voice_clone akzeptiert:
    #   text (str|list), language, ref_audio (tuple/url/path/base64),
    #   ref_text (optional), x_vector_only_mode (optional bool),
    #   + alle generate()-Kwargs (max_new_tokens, top_p, …).
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
    # `speed` lassen wir aus — das API-Shape akzeptiert's in VoiceDesign,
    # aber generate_voice_clone verschluckt sich bei unbekannten Kwargs.
    # Falls der Caller Tempo-Kontrolle braucht, machen wir das später per
    # Post-Resample.
    _ = speed  # explicit ignore

    try:
        with torch.inference_mode():
            wavs, sr = _model.generate_voice_clone(**gen_kwargs)
    except Exception as e:  # noqa: BLE001
        log.exception("generate_voice_clone failed")
        raise HTTPException(status_code=500, detail=f"generation failed: {e}")

    if wavs is None or len(wavs) == 0:
        raise HTTPException(status_code=500, detail="model returned empty waveform")
    return _normalize_samples(np.asarray(wavs[0])), int(sr)


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
    if _model is None:
        return JSONResponse(
            status_code=503,
            content={
                "ok": False,
                "reason": _load_error or "model_not_loaded",
                "model": MODEL_ID,
            },
        )
    return {"ok": True, "model": MODEL_ID}


@app.get("/v1/audio/voices")
async def list_voices():
    # Keine Built-in-Voices mehr — die Voice-Verwaltung sitzt im
    # PageMentor-Backend (Uploads + DB). Hier geben wir nur Metadaten
    # zurück, damit man den Sidecar auch solo prüfen kann.
    return {
        "model": MODEL_ID,
        "voices": [],
        "accepts_voice_clone": True,
        "required_fields": ["input", "ref_audio_b64"],
    }


class SpeechRequest(BaseModel):
    # OpenAI-kompat-Felder (werden teilweise ignoriert):
    model: Optional[str] = None
    input: str = Field(..., min_length=1)
    voice: Optional[str] = None          # nur Logging/Diagnose
    response_format: Literal["mp3", "wav", "flac"] = "mp3"
    speed: float = 1.0

    # Voice-Clone-Felder:
    ref_audio_b64: str = Field(..., min_length=1)
    ref_text: Optional[str] = None
    language: str = DEFAULT_LANGUAGE
    seed: int = 0


@app.post("/v1/audio/speech")
async def speech(req: SpeechRequest):
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
