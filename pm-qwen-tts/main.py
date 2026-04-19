"""pm-qwen-tts — lokaler Qwen3-TTS-Flash Sidecar mit OpenAI-kompatibler API.

Endpoints
---------

    GET  /health                                   → liveness (503 bis Modell ready)
    GET  /v1/audio/voices                          → kuratierter Voice-Katalog
    POST /v1/audio/speech                          → Audio-Bytes (WAV/MP3/FLAC)
    GET  /v1/audio/voices/{voice_id}/preview?text= → Kurz-Preview

Request-Shape (OpenAI-kompatibel):

    {
      "input": "Text ...",
      "voice": "de_f_anna",
      "response_format": "mp3",    // optional (default mp3)
      "speed": 1.0,                // optional
      "seed": 101                  // optional — Override für den
                                   //            Per-Voice-Default-Seed
    }

Determinismus
-------------

Jede der 4 kuratierten Voices hat einen festen Integer-Seed
(``VOICES_CONFIG`` unten). Vor jeder Generation wird ``torch.manual_seed``
+ ``cuda.manual_seed_all`` + ``numpy.random.seed`` gesetzt — gleiche Voice
+ gleicher Text → bit-identisches Audio. Der User kann den Seed pro
Request überschreiben, wenn er bewusst Variation will.

Robuster Modell-Loader
----------------------

Qwen3-TTS-Flash ist neu (Sept 2025); die konkrete Auto-Klasse kann je
nach transformers-Revision unterschiedlich heißen. Der Loader probiert
drei Varianten der Reihe nach:

    1. Qwen3TTSForConditionalGeneration (modell-spezifisch)
    2. AutoModelForTextToSpeech (generisch)
    3. AutoModel (Fallback)

Welche gewonnen hat, steht im Startup-Log. Gleiches Spiel für das
Speaker-Kwarg: Qwen-TTS-Modelle nehmen je nach Version ``speaker`` oder
``voice`` entgegen — wir probieren beide.

Lizenz-Notice
-------------

Qwen/Qwen3-TTS-Flash © Alibaba, Apache 2.0. Das Modell wird zur
Laufzeit aus https://huggingface.co/Qwen/Qwen3-TTS-Flash geladen und
NICHT mit diesem Image distribuiert.
"""

from __future__ import annotations

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
from fastapi import FastAPI, HTTPException, Query
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

MODEL_ID = os.environ.get("QWEN_TTS_MODEL", "Qwen/Qwen3-TTS-Flash")
DEVICE = os.environ.get("QWEN_TTS_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
DTYPE_NAME = os.environ.get("QWEN_TTS_DTYPE", "bfloat16")
SAMPLE_RATE = int(os.environ.get("QWEN_TTS_SAMPLE_RATE", "24000"))
MAX_NEW_TOKENS = int(os.environ.get("QWEN_TTS_MAX_NEW_TOKENS", "4096"))


def _torch_dtype(name: str):
    name = name.lower()
    return {
        "float16": torch.float16, "fp16": torch.float16, "half": torch.float16,
        "bfloat16": torch.bfloat16, "bf16": torch.bfloat16,
        "float32": torch.float32, "fp32": torch.float32,
    }.get(name, torch.bfloat16)


# ---------------------------------------------------------------------------
# Voice-Katalog: (id, label, gender, default qwen_speaker, seed)
#
# Preset-Namen können via ENV überschrieben werden, wenn eine neue Qwen-
# Revision die Namen umbenennt. Beim ersten Start loggt der Sidecar
# "discovered speakers" — wenn einer deiner Default-Namen da nicht
# drinsteht, auf den echten Namen per ENV umleiten.
# ---------------------------------------------------------------------------

VOICES_CONFIG: list[tuple[str, str, str, str, int]] = [
    ("de_f_anna",  "Anna",  "female", os.environ.get("QWEN_TTS_SPEAKER_F1", "Cherry"), 101),
    ("de_f_emma",  "Emma",  "female", os.environ.get("QWEN_TTS_SPEAKER_F2", "Jada"),   102),
    ("de_m_klaus", "Klaus", "male",   os.environ.get("QWEN_TTS_SPEAKER_M1", "Ethan"),  201),
    ("de_m_max",   "Max",   "male",   os.environ.get("QWEN_TTS_SPEAKER_M2", "Nofish"), 202),
]

VOICE_BY_ID = {v[0]: v for v in VOICES_CONFIG}


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------

_model = None
_processor = None
_available_speakers: list[str] = []
# Welches Speaker-Kwarg das Processor verträgt ("speaker" oder "voice").
_speaker_kwarg: str = "speaker"


def _load_model() -> None:
    global _model, _processor, _available_speakers, _speaker_kwarg

    if _model is not None:
        return

    from transformers import AutoProcessor  # noqa: WPS433

    log.info("loading %s on %s (dtype=%s)", MODEL_ID, DEVICE, DTYPE_NAME)
    t0 = time.time()
    dtype = _torch_dtype(DTYPE_NAME)

    processor = AutoProcessor.from_pretrained(MODEL_ID, trust_remote_code=True)

    # Loader-Varianten durchprobieren — gewinnt die erste die durchläuft.
    model = None
    attempts: list[tuple[str, str]] = []

    # 1) modell-spezifische Klasse
    try:
        from transformers import Qwen3TTSForConditionalGeneration  # type: ignore[attr-defined]
        model = Qwen3TTSForConditionalGeneration.from_pretrained(
            MODEL_ID, torch_dtype=dtype, trust_remote_code=True
        )
        log.info("loaded via Qwen3TTSForConditionalGeneration")
    except Exception as e:  # noqa: BLE001
        attempts.append(("Qwen3TTSForConditionalGeneration", repr(e)))

    # 2) generische TTS-Auto-Klasse
    if model is None:
        try:
            from transformers import AutoModelForTextToSpeech  # type: ignore[attr-defined]
            model = AutoModelForTextToSpeech.from_pretrained(
                MODEL_ID, torch_dtype=dtype, trust_remote_code=True
            )
            log.info("loaded via AutoModelForTextToSpeech")
        except Exception as e:  # noqa: BLE001
            attempts.append(("AutoModelForTextToSpeech", repr(e)))

    # 3) nacktes AutoModel als letzter Fallback
    if model is None:
        try:
            from transformers import AutoModel
            model = AutoModel.from_pretrained(
                MODEL_ID, torch_dtype=dtype, trust_remote_code=True
            )
            log.info("loaded via AutoModel (fallback)")
        except Exception as e:  # noqa: BLE001
            attempts.append(("AutoModel", repr(e)))

    if model is None:
        detail = "; ".join(f"{cls}: {err}" for cls, err in attempts)
        raise RuntimeError(f"konnte Qwen-TTS nicht laden: {detail}")

    model = model.to(DEVICE).eval()

    # Verfügbare Speaker aus dem Processor ziehen (best-effort — Attribut-
    # name variiert je nach Modell-Version).
    speakers: list[str] = []
    for attr in ("speakers", "speaker_list", "speaker_ids", "available_speakers"):
        val = getattr(processor, attr, None)
        if val:
            try:
                speakers = list(val)
                break
            except Exception:  # noqa: BLE001
                continue
    if not speakers:
        cfg_speakers = getattr(getattr(model, "config", None), "speakers", None)
        if cfg_speakers:
            try:
                speakers = list(cfg_speakers)
            except Exception:  # noqa: BLE001
                pass

    # Welches Kwarg verträgt der Processor? Wir probieren einen Dry-Call
    # mit ganz kurzem Text. Unerwartete Kwargs werfen TypeError.
    test_text = "Test."
    test_speaker = speakers[0] if speakers else VOICES_CONFIG[0][3]
    for kwarg in ("speaker", "voice"):
        try:
            processor(text=test_text, return_tensors="pt", **{kwarg: test_speaker})
            _speaker_kwarg = kwarg
            log.info("processor accepts speaker via kwarg=%r", kwarg)
            break
        except TypeError:
            continue
        except Exception:
            # Andere Fehler (z. B. unbekannter Speaker) bedeuten nicht,
            # dass das Kwarg falsch ist — nur dass der Test-Speaker nicht
            # passt. Das Kwarg akzeptieren wir dann trotzdem.
            _speaker_kwarg = kwarg
            break

    _model = model
    _processor = processor
    _available_speakers = speakers

    log.info(
        "model ready in %.1fs (speaker_kwarg=%s, speakers_discovered=%d)",
        time.time() - t0, _speaker_kwarg, len(speakers),
    )
    if speakers:
        log.info(
            "discovered speakers: %s%s",
            ", ".join(speakers[:12]),
            " …" if len(speakers) > 12 else "",
        )
    # Voreingestellte Preset-Namen gegen die Discovery abgleichen.
    for (vid, _label, _gender, preset, _seed) in VOICES_CONFIG:
        if speakers and preset not in speakers:
            log.warning(
                "voice %s: preset %r nicht im Modell — fällt zur Laufzeit auf ersten "
                "verfügbaren Speaker zurück. ENV QWEN_TTS_SPEAKER_* anpassen oder "
                "Voice-Katalog in VOICES_CONFIG erweitern.",
                vid, preset,
            )


def _resolve_speaker(voice_id: str) -> tuple[str, int]:
    """Voice-ID → (Qwen-Speaker-Name, Seed). Unbekannte IDs: ID als
    Speaker-Name durchreichen, Seed aus String-Hash."""
    if voice_id in VOICE_BY_ID:
        _, _, _, preset, seed = VOICE_BY_ID[voice_id]
        if _available_speakers and preset not in _available_speakers:
            preset = _available_speakers[0]
        return preset, seed
    # Externer Call mit direktem Qwen-Speaker-Namen.
    h = 0
    for ch in voice_id:
        h = (h * 31 + ord(ch)) & 0x7FFFFFFF
    return voice_id, h


def _apply_seed(seed: int) -> None:
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    np.random.seed(seed)
    random.seed(seed)


# ---------------------------------------------------------------------------
# Synthesis
# ---------------------------------------------------------------------------


def _extract_audio_tensor(output: Any) -> torch.Tensor:
    """Holt das Audio-Tensor aus der Modell-Rückgabe. Qwen-Varianten liefern
    entweder ein Tensor oder ein Dict/Objekt mit einem von mehreren möglichen
    Keys."""
    if isinstance(output, torch.Tensor):
        return output
    if isinstance(output, dict):
        for key in ("waveform", "audio_values", "audios", "audio", "speech"):
            if key in output and output[key] is not None:
                return output[key]
    for attr in ("waveform", "audio_values", "audios", "audio", "speech"):
        val = getattr(output, attr, None)
        if val is not None:
            return val
    raise RuntimeError(
        f"Qwen-TTS Output-Format nicht erkannt: {type(output).__name__}"
    )


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
    raise ValueError(f"unsupported response_format {fmt!r}")


def _synth(text: str, voice_id: str, speed: float, seed: Optional[int]) -> np.ndarray:
    _load_model()
    assert _model is not None and _processor is not None

    speaker, voice_seed = _resolve_speaker(voice_id)
    _apply_seed(seed if seed is not None else voice_seed)

    processor_kwargs: dict[str, Any] = {
        "text": text,
        "return_tensors": "pt",
        _speaker_kwarg: speaker,
    }
    inputs = _processor(**processor_kwargs).to(DEVICE)

    gen_kwargs: dict[str, Any] = {"max_new_tokens": MAX_NEW_TOKENS}
    if speed and abs(speed - 1.0) > 1e-3:
        # Qwen3-TTS akzeptiert je nach Revision unterschiedliche Felder
        # (`speed`, `rate`). Unbekannte Kwargs werden meist ignoriert.
        gen_kwargs["speed"] = float(speed)

    with torch.inference_mode():
        output = _model.generate(**inputs, **gen_kwargs)

    audio = _extract_audio_tensor(output)
    arr = audio.detach().to(torch.float32).cpu().numpy()
    arr = np.squeeze(arr)
    if arr.ndim > 1:
        arr = arr[0]  # Mehrkanal → ersten Kanal
    peak = float(np.max(np.abs(arr))) if arr.size else 0.0
    if peak > 1.0:
        arr = arr / peak
    return arr.astype(np.float32)


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        _load_model()
    except Exception as e:  # noqa: BLE001
        # App startet auch bei Model-Load-Fehler, /health meldet dann 503.
        # Verhindert, dass ein Arbiter-Start-Poll in die endgültige
        # TimeoutError läuft ohne verwertbares Log — Grund steht ja hier.
        log.exception("initial model load failed: %r", e)
    yield


app = FastAPI(title="pm-qwen-tts", lifespan=lifespan)


@app.get("/health")
async def health():
    if _model is None:
        return JSONResponse(
            status_code=503,
            content={"ok": False, "reason": "model_not_loaded"},
        )
    return {"ok": True}


@app.get("/v1/audio/voices")
async def list_voices():
    return {
        "model": MODEL_ID,
        "sample_rate": SAMPLE_RATE,
        "speaker_kwarg": _speaker_kwarg,
        "available_qwen_speakers": _available_speakers,
        "voices": [
            {
                "id": vid,
                "label": label,
                "language": "de",
                "locale": "de-DE",
                "gender": gender,
                "qwen_speaker": preset,
                "seed": seed,
            }
            for (vid, label, gender, preset, seed) in VOICES_CONFIG
        ],
    }


class SpeechRequest(BaseModel):
    model: Optional[str] = None      # OpenAI-kompat, wir ignorieren
    input: str = Field(..., min_length=1)
    voice: str
    response_format: Literal["mp3", "wav", "flac"] = "mp3"
    speed: float = 1.0
    seed: Optional[int] = None


@app.post("/v1/audio/speech")
async def speech(req: SpeechRequest):
    try:
        samples = _synth(req.input, req.voice, req.speed, req.seed)
    except Exception as e:  # noqa: BLE001
        log.exception("synth failed for voice=%s len=%d: %r", req.voice, len(req.input), e)
        raise HTTPException(status_code=500, detail=str(e))
    body, ctype = _encode_audio(samples, SAMPLE_RATE, req.response_format)
    return Response(content=body, media_type=ctype)


@app.get("/v1/audio/voices/{voice_id}/preview")
async def preview(
    voice_id: str,
    text: str = Query("Hallo, dies ist eine kurze Sprachprobe."),
    response_format: Literal["mp3", "wav", "flac"] = "mp3",
):
    try:
        samples = _synth(text, voice_id, speed=1.0, seed=None)
    except Exception as e:  # noqa: BLE001
        log.exception("preview failed for voice=%s: %r", voice_id, e)
        raise HTTPException(status_code=500, detail=str(e))
    body, ctype = _encode_audio(samples, SAMPLE_RATE, response_format)
    return Response(content=body, media_type=ctype)
