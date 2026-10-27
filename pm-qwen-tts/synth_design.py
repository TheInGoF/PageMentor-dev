"""Synthese mit VoiceDesign."""

from __future__ import annotations

import hashlib
import numpy as np
import time
import torch
from fastapi import HTTPException
from typing import Any, Optional

from logs import log
from config import (
    DEVICE,
    GENERATION_TIMEOUT_S,
    LOOP_MAX_UNIQUE,
    LOOP_WINDOW,
    MAX_NEW_TOKENS,
)
import models
from models import _load_voicedesign_model
from sampling import _apply_seed, _build_stopping_criteria, _resolve_sampling
from audio_io import _normalize_samples
from runner import _run_with_heartbeat_and_timeout


def _synth_design(
    text: str,
    voice_description: str,
    language: str,
    seed: int,
    temperature: Optional[float] = None,
    top_p: Optional[float] = None,
    top_k: Optional[int] = None,
    repetition_penalty: Optional[float] = None,
    max_new_tokens_override: Optional[int] = None,
) -> tuple[np.ndarray, int]:
    """Synthese mit VoiceDesign: Beschreibung als instruct.

    Seed vorher setzen: reproduziert die Stimme meistens.
    """
    if not voice_description or not voice_description.strip():
        raise HTTPException(
            status_code=400,
            detail="voice_description must not be empty (VoiceDesign path)",
        )

    _load_voicedesign_model()
    if models._design_model is None:
        raise HTTPException(
            status_code=503,
            detail=f"voicedesign not loaded ({models._design_load_error or 'still initializing'})",
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
        "instruct": voice_description.strip(),
        "max_new_tokens": effective_max,
        **_resolve_sampling(temperature, top_p, top_k, repetition_penalty),
    }
    if stopping_criteria is not None:
        gen_kwargs["stopping_criteria"] = stopping_criteria

    req_hash = hashlib.sha256(
        f"{text}|{seed}|{voice_description}".encode("utf-8")
    ).hexdigest()[:8]
    log.info(
        "voicedesign start [%s] seed=%d lang=%s text[0:60]=%r description[0:120]=%r kwargs=%s",
        req_hash, seed, language,
        text[:60], voice_description[:120],
        sorted(gen_kwargs.keys()),
    )
    t0 = time.time()

    def run() -> tuple[Any, Any]:
        # Seed im Worker-Thread nochmal setzen
        _apply_seed(seed)
        # Zusätzlich eigener Generator, falls akzeptiert
        final_kwargs = dict(gen_kwargs)
        try:
            gen_device = DEVICE if DEVICE.startswith("cuda") else "cpu"
            final_kwargs["generator"] = torch.Generator(
                device=gen_device
            ).manual_seed(seed)
        except Exception as e:  # noqa: BLE001
            log.warning(
                "voicedesign [%s]: could not create generator (%r), " +
                "continuing with manual_seed only", req_hash, e,
            )

        try:
            with torch.inference_mode():
                try:
                    wavs, sr = models._design_model.generate_voice_design(**final_kwargs)
                except TypeError as e:
                    # generator nicht akzeptiert: ohne wiederholen
                    if "generator" in final_kwargs and "generator" in str(e):
                        log.warning(
                            "voicedesign [%s]: generator-kwarg rejected (%s), retrying without",
                            req_hash, e,
                        )
                        final_kwargs.pop("generator", None)
                        _apply_seed(seed)  # re-seed before retry
                        wavs, sr = models._design_model.generate_voice_design(**final_kwargs)
                    else:
                        raise
            return wavs, sr
        except HTTPException:
            raise
        except Exception as e:  # noqa: BLE001
            log.exception("generate_voice_design [%s] failed", req_hash)
            raise HTTPException(
                status_code=500, detail=f"generation failed: {e}"
            ) from e

    wavs, sr = _run_with_heartbeat_and_timeout(
        run, label=f"voicedesign [{req_hash}]", timeout_s=GENERATION_TIMEOUT_S
    )

    elapsed = time.time() - t0
    if loop_detector is not None and loop_detector.triggered:
        log.warning(
            "voicedesign [%s] LOOP DETECTED at token %d (unique=%d ≤ %d in last %d) — abort after %.1fs",
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
            "voicedesign [%s] returned empty waveform after %.1fs",
            req_hash, elapsed,
        )
        raise HTTPException(status_code=500, detail="model returned empty waveform")

    samples = _normalize_samples(np.asarray(wavs[0]))
    audio_s = samples.shape[0] / float(sr) if sr else 0.0
    log.info(
        "voicedesign done  [%s] in %.1fs (audio=%.1fs, rt=%.2fx)",
        req_hash, elapsed, audio_s,
        elapsed / audio_s if audio_s > 0 else 0.0,
    )
    return samples, int(sr)
