"""Referenz-Audio dekodieren, Ausgabe kodieren."""

from __future__ import annotations

import base64
import hashlib
import io
import os
import threading
from collections import OrderedDict
from dataclasses import dataclass
from math import gcd

import numpy as np
import soundfile as sf
from fastapi import HTTPException

_CACHE_MAX = int(os.environ.get("TTS_REF_CACHE_SIZE", "16"))
_cache: OrderedDict[str, np.ndarray] = OrderedDict()
_lock = threading.Lock()


@dataclass
class Ref:
    """Referenz-Stimme: Mono-float32 mit sr, Transkript, Schlüssel für Caches."""

    samples: np.ndarray
    sr: int
    text: str | None
    key: str


def resample(arr: np.ndarray, src: int, dst: int) -> np.ndarray:
    if src == dst:
        return arr.astype(np.float32, copy=False)
    from scipy.signal import resample_poly

    g = gcd(src, dst)
    return resample_poly(arr.astype(np.float32), dst // g, src // g).astype(np.float32)


def _read_any(raw: bytes) -> tuple[np.ndarray, int]:
    try:
        arr, sr = sf.read(io.BytesIO(raw), dtype="float32")
        return arr, int(sr)
    except Exception:
        # MP3 über pydub, läuft auch mit altem libsndfile
        from pydub import AudioSegment

        seg = AudioSegment.from_file(io.BytesIO(raw))
        arr = np.array(seg.get_array_of_samples(), dtype=np.float32)
        if seg.channels > 1:
            arr = arr.reshape(-1, seg.channels).mean(axis=1)
        return arr / 2 ** (8 * seg.sample_width - 1), seg.frame_rate


def decode_ref(b64: str, text: str | None, target_sr: int) -> Ref:
    """base64 (WAV/MP3/FLAC) → Mono mit target_sr, gecacht."""
    key = hashlib.sha256(f"{target_sr}:{b64}".encode("utf-8", errors="ignore")).hexdigest()
    with _lock:
        cached = _cache.get(key)
        if cached is not None:
            _cache.move_to_end(key)
            return Ref(cached, target_sr, text, key)
    try:
        raw = base64.b64decode(b64)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"ref_audio_b64 not valid base64: {e}")
    try:
        arr, sr = _read_any(raw)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"ref_audio decode failed: {e}")
    arr = np.squeeze(arr)
    if arr.ndim > 1:
        arr = arr.mean(axis=1)
    if arr.size == 0:
        raise HTTPException(status_code=400, detail="ref_audio is empty")
    arr = resample(arr, sr, target_sr)
    with _lock:
        _cache[key] = arr
        while len(_cache) > _CACHE_MAX:
            _cache.popitem(last=False)
    return Ref(arr, target_sr, text, key)


def normalize(arr: np.ndarray) -> np.ndarray:
    arr = np.squeeze(np.asarray(arr, dtype=np.float32))
    if arr.ndim > 1:
        arr = arr[0]
    peak = float(np.max(np.abs(arr))) if arr.size else 0.0
    return arr / peak if peak > 1.0 else arr


def encode(samples: np.ndarray, sr: int, fmt: str) -> tuple[bytes, str]:
    fmt = fmt.lower()
    buf = io.BytesIO()
    if fmt in ("wav", "wave"):
        sf.write(buf, samples, sr, format="WAV", subtype="PCM_16")
        return buf.getvalue(), "audio/wav"
    if fmt == "flac":
        sf.write(buf, samples, sr, format="FLAC")
        return buf.getvalue(), "audio/flac"
    if fmt == "mp3":
        from pydub import AudioSegment

        sf.write(buf, samples, sr, format="WAV", subtype="PCM_16")
        buf.seek(0)
        out = io.BytesIO()
        AudioSegment.from_wav(buf).export(out, format="mp3", bitrate="96k")
        return out.getvalue(), "audio/mpeg"
    raise HTTPException(status_code=400, detail=f"unsupported response_format {fmt!r}")
