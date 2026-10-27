"""Kokoro-82M, deutsche Stimme Martin, ONNX auf der CPU.

Modell: Godelaune/Kokoro-82M-ONNX-German-Martin (Apache 2.0), im Image enthalten.
Textregeln des Originaldienstes bewusst weggelassen: das Backend normalisiert schon.
"""

from __future__ import annotations

import os

import numpy as np

from tts_common.audio_io import Ref
from tts_common.server import SpeechRequest

MODEL_DIR = os.environ.get("KOKORO_MODEL_DIR", "/models")
VOICE = os.environ.get("KOKORO_VOICE", "martin")
# Etwas schneller klingt bei Martin natürlicher, Wert aus dem Originaldienst
BASE_SPEED = float(os.environ.get("KOKORO_SPEED", "1.125"))


class KokoroEngine:
    name = "kokoro"
    model_id = "Godelaune/Kokoro-82M-ONNX-German-Martin"
    sample_rate = 24000
    clones = False
    voices = [VOICE]

    def __init__(self) -> None:
        self._tts = None

    def load(self) -> None:
        from kokoro_onnx import Kokoro

        self._tts = Kokoro(os.path.join(MODEL_DIR, "kokoro-martin.onnx"), os.path.join(MODEL_DIR, "voices-martin.npz"))
        # Aufwärmen, erster Aufruf baut die Sitzung auf
        self._tts.create("Hallo.", voice=VOICE, speed=BASE_SPEED, lang="de")

    def synth(self, text: str, ref: Ref | None, req: SpeechRequest) -> np.ndarray:
        assert self._tts is not None
        samples, sr = self._tts.create(text, voice=VOICE, speed=BASE_SPEED * req.speed, lang="de")
        if sr != self.sample_rate:
            from tts_common.audio_io import resample

            samples = resample(samples, sr, self.sample_rate)
        return samples


ENGINE = KokoroEngine()
