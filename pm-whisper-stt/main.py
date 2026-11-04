"""pm-whisper-stt: Spracherkennung für die Ausspracheprüfung (faster-whisper, large-v3-turbo).

Hört ein fertiges Hörbuch-Stück ab und liefert Wörter mit Zeitmarken und Sicherheit. Läuft hinter dem GPU-Arbiter
wie eine Stimm-Engine (/tts/stt/v1/audio/transcriptions), also nie gleichzeitig mit Gemma oder einer Stimme.

    GET  /health                       503, bis das Modell geladen ist (mit activity für die Ladeanzeige)
    POST /v1/audio/transcriptions      multipart: file, language (de/en/es …), prompt (optional)
    POST /v1/audio/phonemes            multipart: file → Laute, die wirklich gesprochen wurden (Lautschrift)
    POST /v1/audio/phonemize           JSON text, language → Soll-Lautschrift je Wort (espeak-ng)
"""

from __future__ import annotations

import os
import subprocess
import tempfile
import threading
import time
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import phonemes

from tts_common.activity import activity, remote_size, snapshot
from tts_common.logs import get_logger, ring

log = get_logger("stt")

MODEL = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
REPO = os.environ.get("WHISPER_REPO", "mobiuslabsgmbh/faster-whisper-large-v3-turbo")
COMPUTE = os.environ.get("WHISPER_COMPUTE", "float16")
DEVICE = os.environ.get("WHISPER_DEVICE", "cuda")


class _State:
    model = None
    error: str | None = None
    load_s: float | None = None


st = _State()
lock = threading.Lock()


def _load() -> None:
    t0 = time.time()
    try:
        from faster_whisper import WhisperModel
        from huggingface_hub import snapshot_download

        with activity("load", "Whisper"):
            try:
                path = snapshot_download(REPO, local_files_only=True)
            except Exception:  # noqa: BLE001
                log.info("lade %s aus dem Netz", REPO)
                with activity("download", REPO, repo=REPO, total=remote_size(REPO, "model.bin")):
                    path = snapshot_download(REPO)
            st.model = WhisperModel(path, device=DEVICE, compute_type=COMPUTE)
        st.load_s = round(time.time() - t0, 1)
        log.info("whisper ready after %.1fs (%s)", st.load_s, MODEL)
    except Exception as e:  # noqa: BLE001
        st.error = repr(e)
        log.exception("whisper failed to load")


def _decode(path: str) -> np.ndarray:
    """Audio über ffmpeg zu 16 kHz Mono; unabhängig von der PyAV-Version in faster-whisper."""
    r = subprocess.run(
        ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
        capture_output=True,
        check=False,
    )
    if r.returncode != 0:
        raise HTTPException(status_code=400, detail=f"Audio nicht lesbar: {r.stderr.decode(errors='ignore')[-300:]}")
    return np.frombuffer(r.stdout, dtype=np.int16).astype(np.float32) / 32768.0


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("pm-whisper-stt starting, model %s", REPO)
    threading.Thread(target=_load, name="model-load", daemon=True).start()
    yield


app = FastAPI(title="pm-whisper-stt", lifespan=lifespan)


@app.get("/health")
async def health():
    if st.model is None:
        return JSONResponse(status_code=503, content={"ok": False, "reason": st.error or "model_loading", "model": REPO, "activity": snapshot()})
    return {"ok": True, "engine": "stt", "model": REPO, "load_s": st.load_s, "phonemes": phonemes.status(), "activity": snapshot()}


@app.get("/diagnostics/recent-logs")
async def recent_logs(since: int = 0):
    return {"source": "whisper-stt", "lines": ring.snapshot(since_ts=since)}


# def statt async def: Erkennung blockiert, /health bleibt erreichbar
@app.post("/v1/audio/transcriptions")
def transcribe(file: UploadFile = File(...), language: str = Form("de"), prompt: str = Form("")):
    if st.model is None:
        raise HTTPException(status_code=503, detail=st.error or "model_loading")
    suffix = os.path.splitext(file.filename or "")[1] or ".mp3"
    with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
        tmp.write(file.file.read())
        tmp.flush()
        t0 = time.time()
        with lock:
            # Ohne Bezug auf den vorigen Text: sonst wiederholt Whisper sich bei Pausen; ohne VAD, Pausen gehören dazu
            segments, info = st.model.transcribe(
                _decode(tmp.name),
                language=language or None,
                beam_size=5,
                temperature=0.0,
                word_timestamps=True,
                condition_on_previous_text=False,
                vad_filter=False,
                initial_prompt=prompt or None,
            )
            words = []
            text = []
            for s in segments:
                text.append(s.text)
                for w in s.words or []:
                    words.append({"word": w.word.strip(), "start": round(w.start, 2), "end": round(w.end, 2), "prob": round(w.probability, 3)})
    log.info("stt: %.1fs Audio in %.1fs, %d Wörter", info.duration, time.time() - t0, len(words))
    return {"text": "".join(text).strip(), "language": info.language, "duration": round(info.duration, 2), "words": words}


# Lautschrift des Gesprochenen: ohne Wörterbuch, darum auch falsch Gesprochenes so, wie es klingt
@app.post("/v1/audio/phonemes")
def audio_phonemes(file: UploadFile = File(...)):
    suffix = os.path.splitext(file.filename or "")[1] or ".mp3"
    with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
        tmp.write(file.file.read())
        tmp.flush()
        audio = _decode(tmp.name)
    t0 = time.time()
    try:
        phones = phonemes.recognize(audio)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"Lautschrift-Modell nicht verfügbar: {e}") from e
    log.info("phonemes: %.1fs Audio in %.1fs, %d Laute", len(audio) / 16000, time.time() - t0, len(phones))
    return {"phonemes": phones, "duration": round(len(audio) / 16000, 2)}


class PhonemizeRequest(BaseModel):
    text: str
    language: str = "de"


# Soll-Lautschrift: wie ein Text in dieser Sprache klingen soll
@app.post("/v1/audio/phonemize")
def text_phonemize(req: PhonemizeRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="leerer Text")
    try:
        words = phonemes.phonemize(req.text, req.language)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"espeak-ng fehlgeschlagen: {e}") from e
    return {"words": words, "phonemes": [p for w in words for p in w]}
