"""Lautschrift statt Wörter: was die Stimme wirklich gesagt hat, und wie es klingen soll.

Whisper biegt Gehörtes zu echten Wörtern zurecht („Pejdsch Mentor“ wird trotzdem „PageMentor“). Das Phonem-Modell
(wav2vec2, auf espeak-Lautschrift trainiert) hat kein Wörterbuch und schreibt nur Laute auf. espeak-ng liefert die
Soll-Lautschrift im selben Zeichensatz, so lassen sich beide direkt vergleichen.

Läuft auf der CPU (kurze Stücke, rund eine Sekunde) und lädt erst bei der ersten Anfrage: kein Platz im Grafikspeicher,
kein längerer Start für Whisper.
"""

from __future__ import annotations

import os
import threading
import time

import numpy as np

from tts_common.activity import activity, remote_size
from tts_common.logs import get_logger

log = get_logger("phonemes")

REPO = os.environ.get("PHONEME_REPO", "facebook/wav2vec2-xlsr-53-espeak-cv-ft")
DEVICE = os.environ.get("PHONEME_DEVICE", "cpu")

# espeak-Stimmen je Sprache der App
ESPEAK_LANG = {"de": "de", "en": "en-us", "es": "es", "fr": "fr-fr", "it": "it", "pt": "pt"}

_lock = threading.Lock()
_model = None
_processor = None
_error: str | None = None


def status() -> dict:
    return {"loaded": _model is not None, "error": _error, "model": REPO}


def _ensure() -> None:
    global _model, _processor, _error
    if _model is not None:
        return
    t0 = time.time()
    try:
        from huggingface_hub import snapshot_download
        from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

        with activity("load", "Lautschrift"):
            try:
                path = snapshot_download(REPO, local_files_only=True)
            except Exception:  # noqa: BLE001
                log.info("lade %s aus dem Netz", REPO)
                with activity("download", REPO, repo=REPO, total=remote_size(REPO, "pytorch_model.bin")):
                    path = snapshot_download(REPO)
            _processor = Wav2Vec2Processor.from_pretrained(path)
            _model = Wav2Vec2ForCTC.from_pretrained(path).to(DEVICE).eval()
        _error = None
        log.info("phoneme model ready after %.1fs (%s, %s)", time.time() - t0, REPO, DEVICE)
    except Exception as e:  # noqa: BLE001
        _error = repr(e)
        log.exception("phoneme model failed to load")
        raise


def recognize(audio: np.ndarray) -> list[str]:
    """16-kHz-Mono → Laute in espeak-Lautschrift, einer je Eintrag."""
    import torch

    with _lock:
        _ensure()
        inputs = _processor(audio, sampling_rate=16000, return_tensors="pt")
        with torch.inference_mode():
            logits = _model(inputs.input_values.to(DEVICE)).logits
        ids = torch.argmax(logits, dim=-1)
        text = _processor.batch_decode(ids)[0]
    return [p for p in text.split() if p]


def phonemize(text: str, language: str) -> list[list[str]]:
    """Soll-Lautschrift über espeak-ng: je Wort die Laute, im Zeichensatz des Phonem-Modells (ohne Betonung)."""
    from phonemizer import phonemize as _phonemize
    from phonemizer.separator import Separator

    lang = ESPEAK_LANG.get(language, language)
    out = _phonemize(
        text,
        language=lang,
        backend="espeak",
        separator=Separator(phone=" ", word=" | ", syllable=""),
        strip=True,
        with_stress=False,
        preserve_punctuation=False,
    )
    words = [w.split() for w in out.split("|")]
    return [w for w in words if w]
