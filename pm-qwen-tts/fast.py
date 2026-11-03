"""Schneller Weg für den Stimmklon: faster-qwen3-tts (CUDA-Graphen) mit demselben Modell und denselben Gewichten.

Die Grafikkarte bekommt jeden Sprechschritt als aufgezeichneten Graphen statt einzeln aus Python angestoßen; das
Modell (Qwen3-TTS-12Hz-1.7B-Base, bfloat16) und der Stimmklon mit Referenztext (ICL) bleiben gleich. Mehrere
Abschnitte laufen über die gebündelten Graphen aus faster-qwen3-tts-batch. Geht hier etwas schief, schaltet sich der
schnelle Weg ab und der bisherige (qwen-tts) übernimmt – die Anfrage scheitert dadurch nicht.
"""

from __future__ import annotations

import os
import threading
import time
from typing import Any, Optional

import numpy as np
import torch

from logs import log

ENABLED = os.environ.get("QWEN_TTS_FAST", "1") not in ("0", "false", "no")
# Platz im festen Speicher der Graphen: Vorlauf (Referenz, Text) plus erzeugte Tonzeichen. Reicht er nicht, schneidet
# faster-qwen3-tts still ab; 4096 deckt auch Abschnitte mit 2500 Zeichen (~3 min Ton) sicher
MAX_SEQ_LEN = int(os.environ.get("QWEN_TTS_FAST_MAX_SEQ_LEN", "4096"))
MAX_BATCH = int(os.environ.get("QWEN_TTS_FAST_MAX_BATCH", "4"))

_fast: Any = None
_batched: Any = None
_batch_broken = False
_lock = threading.Lock()


def load(model_path: str, device: str, dtype: Any) -> Any:
    """FasterQwen3TTS laden; liefert die qwen-tts-Instanz darin (für Presets, Designs, alten Weg) oder None."""
    global _fast
    if not ENABLED:
        log.info("fast path disabled (QWEN_TTS_FAST=0)")
        return None
    try:
        from faster_qwen3_tts import FasterQwen3TTS  # noqa: WPS433
    except Exception as e:  # noqa: BLE001
        log.warning("faster-qwen3-tts not importable, using plain qwen-tts: %r", e)
        return None
    try:
        t0 = time.time()
        _fast = FasterQwen3TTS.from_pretrained(model_path, device=device, dtype=dtype, attn_implementation="sdpa", max_seq_len=MAX_SEQ_LEN)
        log.info("fast path ready (faster-qwen3-tts, CUDA graphs) in %.1fs", time.time() - t0)
        return _fast.model
    except Exception:  # noqa: BLE001
        log.exception("faster-qwen3-tts load failed, using plain qwen-tts")
        _fast = None
        return None


def available() -> bool:
    return _fast is not None


def _disable(why: str) -> None:
    global _fast
    log.error("fast path disabled after error (%s) — plain qwen-tts from now on", why)
    _fast = None


def _sampling(s: dict) -> dict:
    return {k: s[k] for k in ("do_sample", "temperature", "top_k", "top_p", "repetition_penalty") if k in s and s[k] is not None}


def _decode(m: Any, codec_ids: Any, ref_codes: Any) -> np.ndarray:
    """Wie faster-qwen3-tts selbst: Referenz-Codes voranstellen (Klangkontext), danach abschneiden."""
    if ref_codes is not None:
        codes = torch.cat([ref_codes.to(codec_ids.device), codec_ids], dim=0)
    else:
        codes = codec_ids
    audio_list, _sr = m.speech_tokenizer.decode({"audio_codes": codes.unsqueeze(0)})
    a = audio_list[0]
    a = a.flatten().float().cpu().numpy() if hasattr(a, "cpu") else np.asarray(a).flatten()
    if ref_codes is not None:
        a = a[int(ref_codes.shape[0] / max(codes.shape[0], 1) * len(a)):]
    return a


def clone(text: str, prompt: Any, ref_text: Optional[str], language: str, sampling: dict, max_new_tokens: int, instruct: Optional[str]) -> Optional[tuple[np.ndarray, int]]:
    """Ein Abschnitt; None = schneller Weg nicht verfügbar oder gescheitert (dann alter Weg)."""
    if _fast is None:
        return None
    try:
        with _lock, torch.inference_mode():
            wavs, sr = _fast.generate_voice_clone(
                text=text,
                language=language,
                ref_text=ref_text or "",
                voice_clone_prompt=prompt,
                max_new_tokens=max_new_tokens,
                instruct=instruct or None,
                **_sampling(sampling),
            )
        return np.asarray(wavs[0]), int(sr)
    except Exception as e:  # noqa: BLE001
        log.exception("fast clone failed")
        _disable(repr(e))
        return None


def clone_batch(texts: list[str], prompt: Any, ref_text: Optional[str], language: str, sampling: dict, max_new_tokens: int, instruct: Optional[str]) -> Optional[list[tuple[np.ndarray, int]]]:
    """Mehrere Abschnitte über die gebündelten Graphen; None = nicht verfügbar (dann alter Batch-Weg)."""
    global _batched, _batch_broken
    if _fast is None or _batch_broken or len(texts) > MAX_BATCH:
        return None
    try:
        from faster_qwen3_tts_batch import BatchedFasterQwen3TTS  # noqa: WPS433
        from faster_qwen3_tts_batch.batched_generate import batched_fast_generate  # noqa: WPS433

        with _lock, torch.inference_mode():
            if _batched is None:
                _batched = BatchedFasterQwen3TTS(_fast, max_batch_size=MAX_BATCH, max_seq_len=MAX_SEQ_LEN)
            prepared = [
                _fast._prepare_generation(
                    text=t,
                    language=language,
                    ref_text=ref_text or "",
                    voice_clone_prompt=prompt,
                    non_streaming_mode=False,
                    instruct=instruct or None,
                )
                for t in texts
            ]
            if not _batched._warmed_up:
                _batched.warmup(prefill_len=max(p[3].shape[1] for p in prepared))
            m = prepared[0][0]
            results = batched_fast_generate(
                talker=m.talker,
                talker_input_embeds_list=[p[3] for p in prepared],
                attention_mask_list=[p[4] for p in prepared],
                trailing_text_hiddens_list=[p[5] for p in prepared],
                tts_pad_embed=prepared[0][6],
                config=m.config.talker_config,
                predictor_graph=_batched.batched_predictor_graph,
                talker_graph=_batched.batched_talker_graph,
                max_new_tokens=max_new_tokens,
                **{k: v for k, v in _sampling(sampling).items()},
            )
            out = []
            for (codec_ids, _timing), p in zip(results, prepared):
                if codec_ids is None:
                    raise RuntimeError("batch sample returned no tokens")
                out.append((_decode(m, codec_ids, p[7]), int(_fast.sample_rate)))
        return out
    except Exception:  # noqa: BLE001
        log.exception("fast batch failed — batches use plain qwen-tts from now on")
        _batch_broken = True
        return None
