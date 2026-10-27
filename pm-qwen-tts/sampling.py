"""Sampling-Argumente und Schleifen-Erkennung."""

from __future__ import annotations

import numpy as np
import random
import torch
from transformers import StoppingCriteria, StoppingCriteriaList
from typing import Any, Optional

from config import (
    DEFAULT_REPETITION_PENALTY,
    DEFAULT_SUBTALKER_DOSAMPLE,
    DEFAULT_SUBTALKER_TEMPERATURE,
    DEFAULT_SUBTALKER_TOP_K,
    DEFAULT_SUBTALKER_TOP_P,
    DEFAULT_TEMPERATURE,
    DEFAULT_TOP_K,
    DEFAULT_TOP_P,
    LOOP_DETECTION_ENABLED,
    LOOP_MAX_UNIQUE,
    LOOP_MIN_TOKENS,
    LOOP_WINDOW,
)


def _apply_seed(seed: int) -> None:
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    np.random.seed(seed)
    random.seed(seed)


def _resolve_sampling(
    temperature: Optional[float],
    top_p: Optional[float],
    top_k: Optional[int],
    repetition_penalty: Optional[float],
) -> dict[str, Any]:
    """Sampling-Argumente für einen generate-Aufruf.

    do_sample=True ist entscheidend: sonst Greedy, Regler wirkungslos, Schleifen.
    subtalker_* gelten für den zweiten AR-Kopf.
    None = ENV-Standard.
    """
    return {
        "do_sample": True,
        "temperature": temperature if temperature is not None else DEFAULT_TEMPERATURE,
        "top_p": top_p if top_p is not None else DEFAULT_TOP_P,
        "top_k": top_k if top_k is not None else DEFAULT_TOP_K,
        "repetition_penalty": (
            repetition_penalty
            if repetition_penalty is not None
            else DEFAULT_REPETITION_PENALTY
        ),
        "subtalker_dosample": DEFAULT_SUBTALKER_DOSAMPLE,
        "subtalker_temperature": DEFAULT_SUBTALKER_TEMPERATURE,
        "subtalker_top_p": DEFAULT_SUBTALKER_TOP_P,
        "subtalker_top_k": DEFAULT_SUBTALKER_TOP_K,
    }


class LoopDetector(StoppingCriteria):
    """Bricht ab, wenn der Decoder in einer Token-Schleife hängt (Qwen-Issue #258).

    Prüft die letzten window Tokens auf zu wenige verschiedene Werte.
    Die ersten min_tokens werden übersprungen.
    triggered zeigt danach, ob abgebrochen wurde.
    """

    def __init__(
        self,
        window: int = LOOP_WINDOW,
        max_unique: int = LOOP_MAX_UNIQUE,
        min_tokens: int = LOOP_MIN_TOKENS,
    ):
        self.window = window
        self.max_unique = max_unique
        self.min_tokens = min_tokens
        self.triggered = False
        self.trigger_at_token = 0
        self.trigger_unique = 0

    def __call__(
        self, input_ids: torch.LongTensor, scores: Any, **_: Any
    ) -> bool:
        seq_len = input_ids.shape[-1]
        if seq_len < self.min_tokens:
            return False
        # Letzte window Tokens, alle Codebooks flach
        last = input_ids[..., -self.window :].reshape(-1)
        unique = int(torch.unique(last).numel())
        if unique <= self.max_unique:
            self.triggered = True
            self.trigger_at_token = seq_len
            self.trigger_unique = unique
            return True
        return False


def _build_stopping_criteria() -> tuple[Optional[StoppingCriteriaList], Optional[LoopDetector]]:
    """(criteria_list, detector) bei aktiver Erkennung, sonst (None, None)."""
    if not LOOP_DETECTION_ENABLED:
        return None, None
    detector = LoopDetector()
    return StoppingCriteriaList([detector]), detector
