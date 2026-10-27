"""Referenz-Audio dekodieren, Ausgabe kodieren."""

from __future__ import annotations

import base64
import hashlib
import io
import numpy as np
import os
import soundfile as sf
import threading
from collections import OrderedDict
from fastapi import HTTPException

from logs import log


# Cache für dekodierte Referenz-Audios, Schlüssel SHA-256 des base64

_REF_AUDIO_CACHE_MAX = int(os.environ.get("QWEN_TTS_REF_CACHE_SIZE", "16"))
_ref_audio_cache: OrderedDict[str, tuple[np.ndarray, int]] = OrderedDict()
_ref_audio_cache_lock = threading.Lock()


REF_TARGET_SR = 24_000


def _resample_to_24khz(arr: np.ndarray, src_sr: int) -> np.ndarray:
    """Mono-float32 auf 24 kHz bringen.

    Der Speaker-Encoder erwartet 24 kHz; falsche Rate führt zu Schleifen.
    """
    if src_sr == REF_TARGET_SR:
        return arr.astype(np.float32, copy=False)
    from scipy.signal import resample_poly  # noqa: WPS433
    from math import gcd

    g = gcd(REF_TARGET_SR, src_sr)
    up = REF_TARGET_SR // g
    down = src_sr // g
    out = resample_poly(arr.astype(np.float32), up, down)
    return out.astype(np.float32, copy=False)


def _decode_ref_audio(b64: str) -> tuple[np.ndarray, int]:
    """base64 (WAV/MP3/FLAC) → (mono float32 mit 24 kHz, 24000), gecacht."""
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

    # MP3 über pydub, läuft auch mit altem libsndfile
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

    # Mono, Form (N,)
    arr = np.squeeze(arr)
    if arr.ndim > 1:
        arr = arr.mean(axis=1)
    if arr.size == 0:
        raise HTTPException(status_code=400, detail="ref_audio is empty")

    src_sr = int(sr)
    if src_sr != REF_TARGET_SR:
        log.info(
            "ref_audio resampling %d Hz → %d Hz (samples %d → estimate %d)",
            src_sr, REF_TARGET_SR, arr.size,
            int(arr.size * REF_TARGET_SR / src_sr),
        )
        arr = _resample_to_24khz(arr.astype(np.float32, copy=False), src_sr)

    result = (arr.astype(np.float32), REF_TARGET_SR)
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
