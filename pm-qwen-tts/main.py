"""pm-qwen-tts: Qwen3-TTS-Sidecar mit OpenAI-ähnlicher API.

Endpunkte:
    GET  /health                      503, bis das Modell bereit ist
    GET  /diagnostics/recent-logs     Log-Ring für das Backend
    GET  /v1/audio/voices             leer, Stimmen verwaltet das Backend
    POST /v1/audio/speech             input, ref_audio_b64, ref_text, speaker,
                                      voice_description, language, seed,
                                      response_format, Sampling-Regler

Gleiche Referenz + gleicher Text + gleicher Seed = gleiches Audio.

Lizenz: Qwen3-TTS-Modelle © Alibaba, Apache 2.0, zur Laufzeit von
Hugging Face geladen, nicht im Image enthalten.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from typing import Literal, Optional

from logs import _log_ring, log
from config import (
    ATTN_IMPL,
    CUSTOMVOICE_MODEL_ID,
    CUSTOMVOICE_PRESETS,
    DEFAULT_LANGUAGE,
    DEFAULT_REPETITION_PENALTY,
    DEFAULT_SUBTALKER_DOSAMPLE,
    DEFAULT_SUBTALKER_TEMPERATURE,
    DEFAULT_SUBTALKER_TOP_K,
    DEFAULT_SUBTALKER_TOP_P,
    DEFAULT_TEMPERATURE,
    DEFAULT_TOP_K,
    DEFAULT_TOP_P,
    DEVICE,
    DTYPE_NAME,
    GENERATION_TIMEOUT_S,
    LOOP_DETECTION_ENABLED,
    LOOP_MAX_UNIQUE,
    LOOP_MIN_TOKENS,
    LOOP_WINDOW,
    MAX_NEW_TOKENS,
    MODEL_ID,
    VOICEDESIGN_MODEL_ID,
)
import models
from models import _load_model
from audio_io import _REF_AUDIO_CACHE_MAX, _decode_ref_audio, _encode_audio
from synth_clone import _synth_clone
from synth_custom import _synth_custom
from synth_design import _synth_design


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("=" * 64)
    log.info("pm-qwen-tts starting up")
    log.info("  base-slot model     : %s", MODEL_ID)
    log.info("  customvoice model   : %s (lazy)", CUSTOMVOICE_MODEL_ID)
    log.info("  voicedesign model   : %s (lazy)", VOICEDESIGN_MODEL_ID)
    log.info("  device=%s dtype=%s attn=%s", DEVICE, DTYPE_NAME, ATTN_IMPL)
    log.info(
        "  generation_timeout=%ds ref_cache=%d",
        GENERATION_TIMEOUT_S, _REF_AUDIO_CACHE_MAX,
    )
    if MODEL_ID == CUSTOMVOICE_MODEL_ID:
        log.warning(
            "MODEL_ID == CUSTOMVOICE_MODEL_ID — "
            "you're loading CustomVoice into both slots. The voice "
            "clone path (ref_audio_b64) will then run against the "
            "CustomVoice weights and may fail unexpectedly. If you "
            "only use presets, that's OK; if you also upload your own "
            "samples, set "
            "QWEN_TTS_MODEL=Qwen/Qwen3-TTS-12Hz-1.7B-Base (or unset)."
        )
    log.info("=" * 64)
    _load_model()  # blocks startup until model (or load error) is ready
    yield


app = FastAPI(title="pm-qwen-tts", lifespan=lifespan)


@app.get("/health")
async def health():
    # Bereit, wenn das Basismodell geladen ist; CustomVoice ist lazy
    if models._model is None:
        return JSONResponse(
            status_code=503,
            content={
                "ok": False,
                "reason": models._load_error or "model_not_loaded",
                "model": MODEL_ID,
            },
        )
    return {
        "ok": True,
        "base_model": MODEL_ID,
        "customvoice_model": CUSTOMVOICE_MODEL_ID,
        "customvoice_loaded": models._custom_model is not None,
        "customvoice_error": models._custom_load_error,
        "voicedesign_model": VOICEDESIGN_MODEL_ID,
        "voicedesign_loaded": models._design_model is not None,
        "voicedesign_error": models._design_load_error,
        "max_new_tokens": MAX_NEW_TOKENS,
        "generation_timeout_s": GENERATION_TIMEOUT_S,
        "sampling_defaults": {
            "do_sample": True,
            "temperature": DEFAULT_TEMPERATURE,
            "top_p": DEFAULT_TOP_P,
            "top_k": DEFAULT_TOP_K,
            "repetition_penalty": DEFAULT_REPETITION_PENALTY,
            "subtalker_dosample": DEFAULT_SUBTALKER_DOSAMPLE,
            "subtalker_temperature": DEFAULT_SUBTALKER_TEMPERATURE,
            "subtalker_top_p": DEFAULT_SUBTALKER_TOP_P,
            "subtalker_top_k": DEFAULT_SUBTALKER_TOP_K,
        },
        "loop_detection": {
            "enabled": LOOP_DETECTION_ENABLED,
            "window": LOOP_WINDOW,
            "max_unique": LOOP_MAX_UNIQUE,
            "min_tokens": LOOP_MIN_TOKENS,
        },
    }


@app.get("/diagnostics/recent-logs")
async def recent_logs(since: int = 0):
    """Log-Ring für den Backend-Log-Pump, nur Einträge neuer als since (ms)."""
    return {
        "source": "qwen-tts",
        "lines": _log_ring.snapshot(since_ts=since),
    }


@app.get("/v1/audio/voices")
async def list_voices():
    # Stimmen verwaltet das Backend, hier nur Metadaten
    return {
        "base_model": MODEL_ID,
        "customvoice_model": CUSTOMVOICE_MODEL_ID,
        "voicedesign_model": VOICEDESIGN_MODEL_ID,
        "customvoice_presets": CUSTOMVOICE_PRESETS,
        "voices": [],
        "accepts_voice_clone": True,
        "accepts_customvoice": True,
        "accepts_voicedesign": True,
        "required_fields_clone": ["input", "ref_audio_b64"],
        "required_fields_preset": ["input", "speaker"],
        "required_fields_design": ["input", "voice_description"],
    }


class SpeechRequest(BaseModel):
    # OpenAI-Felder, teils ignoriert
    model: Optional[str] = None
    input: str = Field(..., min_length=1)
    voice: Optional[str] = None          # logging/diagnostics only
    response_format: Literal["mp3", "wav", "flac"] = "mp3"
    speed: float = 1.0

    # Genau ein Pfad: speaker → CustomVoice, sonst Klon über ref_audio_b64

    # Klon
    ref_audio_b64: Optional[str] = None
    ref_text: Optional[str] = None

    # CustomVoice
    speaker: Optional[str] = None
    instruct: Optional[str] = None

    # VoiceDesign: hat Vorrang, Beschreibung = Stil
    voice_description: Optional[str] = None

    language: str = DEFAULT_LANGUAGE
    seed: int = 0

    # Sampling, None = ENV-Standard
    # niedrige temperature, top_p 0.7-0.85, repetition_penalty > 1.0
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    top_k: Optional[int] = None
    repetition_penalty: Optional[float] = None
    max_new_tokens_override: Optional[int] = None


# def statt async def: Synthese blockiert minutenlang
# FastAPI nutzt dann den Threadpool, /health bleibt erreichbar
@app.post("/v1/audio/speech")
def speech(req: SpeechRequest):
    use_design = bool(req.voice_description and req.voice_description.strip())
    use_custom = bool(req.speaker and req.speaker.strip())
    if use_design:
        samples, sr = _synth_design(
            text=req.input,
            voice_description=req.voice_description,  # type: ignore[arg-type]
            language=req.language,
            seed=req.seed,
            temperature=req.temperature,
            top_p=req.top_p,
            top_k=req.top_k,
            repetition_penalty=req.repetition_penalty,
            max_new_tokens_override=req.max_new_tokens_override,
        )
    elif use_custom:
        samples, sr = _synth_custom(
            text=req.input,
            speaker=req.speaker.strip(),  # type: ignore[union-attr]
            instruct=req.instruct,
            language=req.language,
            seed=req.seed,
            temperature=req.temperature,
            top_p=req.top_p,
            top_k=req.top_k,
            repetition_penalty=req.repetition_penalty,
            max_new_tokens_override=req.max_new_tokens_override,
        )
    else:
        if not req.ref_audio_b64 or not req.ref_audio_b64.strip():
            raise HTTPException(
                status_code=400,
                detail=(
                    "request must contain either `speaker` (CustomVoice "
                    "preset) or `ref_audio_b64` (voice clone)."
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
            temperature=req.temperature,
            top_p=req.top_p,
            top_k=req.top_k,
            repetition_penalty=req.repetition_penalty,
            max_new_tokens_override=req.max_new_tokens_override,
            instruct=req.instruct,
        )
    body, ctype = _encode_audio(samples, sr, req.response_format)
    return Response(content=body, media_type=ctype)
