"""Synthese per Stimmklon mit gecachtem Klon-Prompt."""

from __future__ import annotations

import hashlib
import numpy as np
import os
import threading
import time
import torch
from collections import OrderedDict
from fastapi import HTTPException
from typing import Any, Optional

from logs import log
from config import (
    GENERATION_TIMEOUT_S,
    LOOP_MAX_UNIQUE,
    LOOP_WINDOW,
    MAX_NEW_TOKENS,
    X_VECTOR_ONLY_FALLBACK,
)
import models
from sampling import _apply_seed, _build_stopping_criteria, _resolve_sampling
from audio_io import _normalize_samples
from runner import _run_with_heartbeat_and_timeout


# Klon-Prompt einmal pro Stimme erzeugen, in jedem Chunk wiederverwenden
# Gleicher Speaker-Vektor: gleiche Stimmfarbe
_CLONE_PROMPT_CACHE_MAX = int(os.environ.get("QWEN_TTS_CLONE_PROMPT_CACHE_SIZE", "8"))
_clone_prompt_cache: OrderedDict[str, Any] = OrderedDict()
_clone_prompt_cache_lock = threading.Lock()


def _clone_prompt_key(ref_audio: tuple[np.ndarray, int], ref_text: Optional[str]) -> str:
    arr, sr = ref_audio
    h = hashlib.sha256()
    # Audio, Rate und Transkript bestimmen den Prompt
    h.update(arr.tobytes())
    h.update(str(sr).encode())
    h.update((ref_text or "").encode("utf-8"))
    return h.hexdigest()


def _get_clone_prompt(
    ref_audio: tuple[np.ndarray, int],
    ref_text: Optional[str],
) -> Any:
    key = _clone_prompt_key(ref_audio, ref_text)
    with _clone_prompt_cache_lock:
        cached = _clone_prompt_cache.get(key)
        if cached is not None:
            _clone_prompt_cache.move_to_end(key)
            return cached

    if models._model is None:
        raise HTTPException(status_code=503, detail="base model not loaded")

    build_kwargs: dict[str, Any] = {"ref_audio": ref_audio}
    if ref_text and ref_text.strip():
        build_kwargs["ref_text"] = ref_text.strip()
    elif X_VECTOR_ONLY_FALLBACK:
        build_kwargs["x_vector_only_mode"] = True

    log.info(
        "clone-prompt compile: ref_samples=%d sr=%d ref_text_len=%d key=%s",
        len(ref_audio[0]), ref_audio[1], len(ref_text or ""), key[:8],
    )
    t0 = time.time()
    with torch.inference_mode():
        prompt = models._model.create_voice_clone_prompt(**build_kwargs)
    log.info(
        "clone-prompt compile done in %.2fs (key=%s)",
        time.time() - t0, key[:8],
    )

    with _clone_prompt_cache_lock:
        _clone_prompt_cache[key] = prompt
        _clone_prompt_cache.move_to_end(key)
        while len(_clone_prompt_cache) > _CLONE_PROMPT_CACHE_MAX:
            _clone_prompt_cache.popitem(last=False)
    return prompt


def _synth_clone(
    text: str,
    ref_audio: tuple[np.ndarray, int],
    ref_text: Optional[str],
    language: str,
    seed: int,
    speed: float,
    max_new_tokens_override: Optional[int] = None,
    temperature: Optional[float] = None,
    top_p: Optional[float] = None,
    top_k: Optional[int] = None,
    repetition_penalty: Optional[float] = None,
    instruct: Optional[str] = None,
) -> tuple[np.ndarray, int]:
    if models._model is None:
        raise HTTPException(
            status_code=503,
            detail=f"model not loaded ({models._load_error or 'still initializing'})",
        )

    _apply_seed(seed)

    # Gecachten Klon-Prompt holen, gleich für alle Chunks einer Stimme
    clone_prompt = _get_clone_prompt(ref_audio, ref_text)

    effective_max = (
        max_new_tokens_override
        if max_new_tokens_override and max_new_tokens_override > 0
        else MAX_NEW_TOKENS
    )

    stopping_criteria, loop_detector = _build_stopping_criteria()
    gen_kwargs: dict[str, Any] = {
        "text": text,
        "language": language,
        "voice_clone_prompt": clone_prompt,
        "max_new_tokens": effective_max,
        **_resolve_sampling(temperature, top_p, top_k, repetition_penalty),
    }
    if stopping_criteria is not None:
        gen_kwargs["stopping_criteria"] = stopping_criteria
    # Sprechstil gegen Tempo-Drift; TypeError → ohne instruct wiederholen
    if instruct and instruct.strip():
        gen_kwargs["instruct"] = instruct.strip()
    _ = speed  # speed cannot be set via this path (see older comment)

    # Kurz-ID für die Log-Suche
    req_hash = hashlib.sha256(
        f"{text}|{seed}|{len(ref_audio[0])}".encode("utf-8")
    ).hexdigest()[:8]
    log.info(
        "clone start [%s] seed=%d lang=%s text[0:60]=%r ref_text[0:60]=%r ref_audio_samples=%d instruct[0:80]=%r kwargs=%s",
        req_hash, seed, language,
        text[:60], (ref_text or "")[:60], len(ref_audio[0]),
        (instruct or "")[:80],
        sorted(gen_kwargs.keys()),
    )
    t0 = time.time()

    def run() -> tuple[Any, Any]:
        try:
            with torch.inference_mode():
                wavs, sr = models._model.generate_voice_clone(**gen_kwargs)
            return wavs, sr
        except TypeError as te:
            # Ältere Builds ohne instruct: einmal ohne wiederholen
            if "instruct" in gen_kwargs and "instruct" in str(te):
                log.warning(
                    "generate_voice_clone [%s] rejected `instruct` kwarg — "
                    "retrying without it",
                    req_hash,
                )
                gen_kwargs.pop("instruct", None)
                with torch.inference_mode():
                    wavs, sr = models._model.generate_voice_clone(**gen_kwargs)
                return wavs, sr
            log.exception("generate_voice_clone [%s] failed", req_hash)
            raise HTTPException(
                status_code=500, detail=f"generation failed: {te}"
            ) from te
        except Exception as e:  # noqa: BLE001
            log.exception("generate_voice_clone [%s] failed", req_hash)
            raise HTTPException(
                status_code=500, detail=f"generation failed: {e}"
            ) from e

    wavs, sr = _run_with_heartbeat_and_timeout(
        run, label=f"synth [{req_hash}]", timeout_s=GENERATION_TIMEOUT_S
    )

    elapsed = time.time() - t0
    if loop_detector is not None and loop_detector.triggered:
        log.warning(
            "synth [%s] LOOP DETECTED at token %d (unique=%d ≤ %d in last %d) — abort after %.1fs",
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
        log.error("synth [%s] returned empty waveform after %.1fs", req_hash, elapsed)
        raise HTTPException(status_code=500, detail="model returned empty waveform")

    samples = _normalize_samples(np.asarray(wavs[0]))
    audio_s = samples.shape[0] / float(sr) if sr else 0.0
    log.info(
        "synth done  [%s] in %.1fs (audio=%.1fs, rt=%.2fx)",
        req_hash, elapsed, audio_s, elapsed / audio_s if audio_s > 0 else 0.0,
    )
    return samples, int(sr)
