"""FastAPI-App für einen TTS-Sidecar.

Endpunkte wie pm-qwen-tts:
    GET  /health                    503, bis das Modell geladen ist
    GET  /diagnostics/recent-logs   Log-Ring für das Backend
    GET  /v1/audio/voices           Stimmen und Pflichtfelder
    POST /v1/audio/speech           input, ref_audio_b64, ref_text, voice,
                                    language, seed, speed, response_format
"""

from __future__ import annotations

import threading
import time
from contextlib import asynccontextmanager
from typing import Literal, Optional, Protocol

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from .audio_io import Ref, decode_ref, encode, normalize
from .logs import get_logger, ring

log = get_logger("tts")


class SpeechRequest(BaseModel):
    model: Optional[str] = None
    input: str = Field(..., min_length=1)
    voice: Optional[str] = None
    response_format: Literal["mp3", "wav", "flac"] = "mp3"
    speed: float = 1.0
    ref_audio_b64: Optional[str] = None
    ref_text: Optional[str] = None
    language: str = "German"
    seed: int = 0


class Engine(Protocol):
    name: str
    model_id: str
    sample_rate: int
    # Klont aus ref_audio_b64; sonst feste Stimmen
    clones: bool
    voices: list[str]

    def load(self) -> None: ...

    def synth(self, text: str, ref: Ref | None, req: SpeechRequest) -> np.ndarray: ...


class _Status:
    ready = False
    error: str | None = None
    load_s: float | None = None


def _load_in_background(engine: Engine, st: _Status) -> None:
    def run() -> None:
        t0 = time.time()
        try:
            engine.load()
            st.ready = True
            st.load_s = round(time.time() - t0, 1)
            log.info("%s ready after %.1fs (%s)", engine.name, st.load_s, engine.model_id)
        except Exception as e:  # noqa: BLE001
            st.error = repr(e)
            log.exception("%s failed to load", engine.name)

    threading.Thread(target=run, name="model-load", daemon=True).start()


def create_app(engine: Engine) -> FastAPI:
    st = _Status()
    # Eine Synthese zur Zeit, die Modelle sind nicht threadsicher
    synth_lock = threading.Lock()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        log.info("pm-%s-tts starting, model %s", engine.name, engine.model_id)
        _load_in_background(engine, st)
        yield

    app = FastAPI(title=f"pm-{engine.name}-tts", lifespan=lifespan)

    @app.get("/health")
    async def health():
        if not st.ready:
            return JSONResponse(
                status_code=503,
                content={"ok": False, "reason": st.error or "model_loading", "model": engine.model_id},
            )
        return {"ok": True, "engine": engine.name, "model": engine.model_id, "sample_rate": engine.sample_rate, "load_s": st.load_s}

    @app.get("/diagnostics/recent-logs")
    async def recent_logs(since: int = 0):
        return {"source": f"{engine.name}-tts", "lines": ring.snapshot(since_ts=since)}

    @app.get("/v1/audio/voices")
    async def voices():
        return {
            "engine": engine.name,
            "model": engine.model_id,
            "voices": engine.voices,
            "accepts_voice_clone": engine.clones,
            "required_fields_clone": ["input", "ref_audio_b64", "ref_text"] if engine.clones else [],
        }

    # def statt async def: Synthese blockiert, /health bleibt erreichbar
    @app.post("/v1/audio/speech")
    def speech(req: SpeechRequest):
        if not st.ready:
            raise HTTPException(status_code=503, detail=st.error or "model_loading")
        ref = None
        if engine.clones:
            if not req.ref_audio_b64:
                raise HTTPException(status_code=400, detail="ref_audio_b64 fehlt, diese Engine klont nur")
            ref = decode_ref(req.ref_audio_b64, (req.ref_text or "").strip() or None, engine.sample_rate)
        t0 = time.time()
        with synth_lock:
            samples = normalize(engine.synth(req.input, ref, req))
        dur = samples.size / engine.sample_rate
        log.info(
            "%s: %d chars → %.1fs audio in %.1fs (seed %d)",
            engine.name, len(req.input), dur, time.time() - t0, req.seed,
        )
        body, ctype = encode(samples, engine.sample_rate, req.response_format)
        return Response(content=body, media_type=ctype)

    return app
