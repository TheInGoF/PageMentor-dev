"""Kokoro-82M Deutsch, ONNX auf der CPU, zwei feste Stimmen.

Jede Stimme ist ein eigenes Modell (Einsprecher-Feinabstimmung aus kikiri-tts), beide im Image:
- martin:  Godelaune/Kokoro-82M-ONNX-German-Martin (Apache 2.0)
- kerstin: crane-local-ai/Kokoro-82M-v1.0-German-ONNX (Apache 2.0, Daten Kerstin 1.0 CC0)
Textregeln des Originaldienstes bewusst weggelassen: das Backend normalisiert schon.
"""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass

import numpy as np

from tts_common.audio_io import Ref
from tts_common.server import SpeechRequest

MODEL_DIR = os.environ.get("KOKORO_MODEL_DIR", "/models")
DEFAULT_VOICE = os.environ.get("KOKORO_VOICE", "martin")
# Etwas schneller klingt bei Martin natürlicher, Wert aus dem Originaldienst
BASE_SPEED = float(os.environ.get("KOKORO_SPEED", "1.125"))
KERSTIN_SPEED = float(os.environ.get("KOKORO_KERSTIN_SPEED", "1.0"))


@dataclass(frozen=True)
class VoiceModel:
    model: str
    voices: str
    base_speed: float
    # Kerstins Export übergeht den Tempo-Eingang, dann ffmpeg atempo
    native_speed: bool


VOICES = {
    "martin": VoiceModel("kokoro-martin.onnx", "voices-martin.npz", BASE_SPEED, True),
    "kerstin": VoiceModel("kokoro-kerstin.onnx", "voices-kerstin.npz", KERSTIN_SPEED, False),
}


class _FloatSpeed:
    """kokoro-onnx 0.5.0 gibt bei Exporten mit input_ids das Tempo als int32, das Modell will float."""

    def __init__(self, sess) -> None:
        self._sess = sess

    def get_inputs(self):
        return self._sess.get_inputs()

    def run(self, out, inputs):
        if "speed" in inputs:
            inputs = {**inputs, "speed": np.asarray(inputs["speed"], dtype=np.float32)}
        return self._sess.run(out, inputs)


def _atempo(samples: np.ndarray, sr: int, speed: float) -> np.ndarray:
    # atempo kann 0.5 bis 2.0 je Stufe, mehr braucht die App nicht
    speed = min(max(speed, 0.5), 2.0)
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "pipe:0",
         "-filter:a", f"atempo={speed:.4f}", "-f", "f32le", "pipe:1"],
        input=samples.astype(np.float32).tobytes(), capture_output=True, check=True,
    )
    return np.frombuffer(r.stdout, dtype=np.float32)


def voice_name(raw: str | None) -> str:
    # Das Backend schickt "kokoro:<stimme>"
    name = (raw or "").split(":")[-1].strip().lower()
    return name if name in VOICES else DEFAULT_VOICE


class KokoroEngine:
    name = "kokoro"
    model_id = "kokoro-82m-german (martin, kerstin)"
    sample_rate = 24000
    clones = False
    voices = list(VOICES)

    def __init__(self) -> None:
        self._tts: dict[str, object] = {}

    def load(self) -> None:
        from kokoro_onnx import Kokoro

        for name, v in VOICES.items():
            tts = Kokoro(os.path.join(MODEL_DIR, v.model), os.path.join(MODEL_DIR, v.voices))
            tts.sess = _FloatSpeed(tts.sess)
            # Aufwärmen, erster Aufruf baut die Sitzung auf
            tts.create("Hallo.", voice=name, speed=v.base_speed if v.native_speed else 1.0, lang="de")
            self._tts[name] = tts

    def synth(self, text: str, ref: Ref | None, req: SpeechRequest) -> np.ndarray:
        name = voice_name(req.voice)
        v = VOICES[name]
        tts = self._tts[name]
        speed = v.base_speed * req.speed
        samples, sr = tts.create(text, voice=name, speed=speed if v.native_speed else 1.0, lang="de")
        if not v.native_speed and abs(speed - 1.0) > 1e-3:
            samples = _atempo(samples, sr, speed)
        if sr != self.sample_rate:
            from tts_common.audio_io import resample

            samples = resample(samples, sr, self.sample_rate)
        return samples


ENGINE = KokoroEngine()
