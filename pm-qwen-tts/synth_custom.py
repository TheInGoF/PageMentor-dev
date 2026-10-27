"""Synthese mit CustomVoice-Presets."""

from __future__ import annotations

import hashlib
import numpy as np
import time
import torch
from fastapi import HTTPException
from typing import Any, Optional

from logs import log
from config import (
    CUSTOMVOICE_PRESETS,
    GENERATION_TIMEOUT_S,
    LOOP_MAX_UNIQUE,
    LOOP_WINDOW,
    MAX_NEW_TOKENS,
)
import models
from models import _load_customvoice_model
from sampling import _apply_seed, _build_stopping_criteria, _resolve_sampling
from audio_io import _normalize_samples
from runner import _run_with_heartbeat_and_timeout


def _synth_custom(
    text: str,
    speaker: str,
    instruct: Optional[str],
    language: str,
    seed: int,
    temperature: Optional[float] = None,
    top_p: Optional[float] = None,
    top_k: Optional[int] = None,
    repetition_penalty: Optional[float] = None,
    max_new_tokens_override: Optional[int] = None,
) -> tuple[np.ndarray, int]:
    """Synthese mit CustomVoice: speaker = Preset, instruct = Freitext.

    Niedrige temperature hält die Sprache stabil.
    """
    if speaker not in CUSTOMVOICE_PRESETS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"unknown speaker {speaker!r}; erlaubte Presets: "
                f"{', '.join(CUSTOMVOICE_PRESETS)}"
            ),
        )

    _load_customvoice_model()
    if models._custom_model is None:
        raise HTTPException(
            status_code=503,
            detail=f"customvoice not loaded ({models._custom_load_error or 'still initializing'})",
        )

    _apply_seed(seed)

    effective_max = (
        max_new_tokens_override
        if max_new_tokens_override and max_new_tokens_override > 0
        else MAX_NEW_TOKENS
    )
    stopping_criteria, loop_detector = _build_stopping_criteria()
    gen_kwargs: dict[str, Any] = {
        "text": text,
        "language": language,
        "speaker": speaker,
        "max_new_tokens": effective_max,
        **_resolve_sampling(temperature, top_p, top_k, repetition_penalty),
    }
    if stopping_criteria is not None:
        gen_kwargs["stopping_criteria"] = stopping_criteria
    if instruct and instruct.strip():
        gen_kwargs["instruct"] = instruct.strip()

    req_hash = hashlib.sha256(
        f"{text}|{seed}|{speaker}|{instruct or ''}".encode("utf-8")
    ).hexdigest()[:8]
    log.info(
        "customvoice start [%s] seed=%d speaker=%s lang=%s text[0:60]=%r instruct[0:80]=%r kwargs=%s",
        req_hash, seed, speaker, language,
        text[:60], (instruct or "")[:80],
        sorted(gen_kwargs.keys()),
    )
    t0 = time.time()

    def run() -> tuple[Any, Any]:
        try:
            with torch.inference_mode():
                wavs, sr = models._custom_model.generate_custom_voice(**gen_kwargs)
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
    if loop_detector is not None and loop_detector.triggered:
        log.warning(
            "customvoice [%s] LOOP DETECTED at token %d (unique=%d ≤ %d in last %d) — abort after %.1fs",
            req_hash,
            loop_detector.trigger_at_token,
            loop_detector.trigger_unique,
            LOOP_MAX_UNIQUE,
            LOOP_WINDOW,
            elapsed,
        )
        raise HTTPException(
            status_code=503,
            detail=(
                f"loop_detected: AR decoder cycled through "
                f"{loop_detector.trigger_unique} tokens in the last "
                f"{LOOP_WINDOW} (threshold {LOOP_MAX_UNIQUE}) — "
                f"retry with a different seed"
            ),
        )
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
