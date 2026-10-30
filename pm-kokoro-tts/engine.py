"""Kokoro-82M Deutsch, ONNX auf der CPU, zwei feste Stimmen; auf Wunsch das mehrsprachige Grundmodell.

Jede Stimme ist ein eigenes Modell (Einsprecher-Feinabstimmung aus kikiri-tts), beide im Image:
- martin:  Godelaune/Kokoro-82M-ONNX-German-Martin (Apache 2.0)
- kerstin: crane-local-ai/Kokoro-82M-v1.0-German-ONNX (Apache 2.0, Daten Kerstin 1.0 CC0)
Sprachpaket (Englisch, Spanisch): offizielles Kokoro-82M v1.0 aus kokoro-onnx, Apache 2.0, ~340 MB.
Wird erst auf Wunsch in /packs (Docker-Volume) geladen; Stimmen heißen dann z. B. "es:ef_dora".
Textregeln des Originaldienstes bewusst weggelassen: das Backend normalisiert schon.
"""

from __future__ import annotations

import os
import subprocess
import threading
import urllib.request
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


PACK_DIR = os.environ.get("KOKORO_PACK_DIR", "/packs")
PACK_BASE = os.environ.get("KOKORO_PACK_URL", "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0")
PACK_FILES = ("kokoro-v1.0.onnx", "voices-v1.0.bin")

# Auswahl je Sprache: Kokoro-Sprachcode → Stimmen (Präfix: Sprache, f/m)
PACK_VOICES = {
    "en-us": ["af_heart", "af_bella", "am_michael", "am_adam"],
    "en-gb": ["bf_emma", "bm_george"],
    "es": ["ef_dora", "em_alex"],
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


def voice_name(raw: str | None) -> tuple[str | None, str]:
    # Das Backend schickt "kokoro:<stimme>" oder "kokoro:<sprache>:<stimme>" (Sprachpaket)
    parts = (raw or "").strip().lower().split(":")
    if parts and parts[0] == "kokoro":
        parts = parts[1:]
    if len(parts) == 2 and parts[0] in PACK_VOICES:
        return parts[0], parts[1]
    name = parts[-1] if parts else ""
    return None, (name if name in VOICES else DEFAULT_VOICE)


class KokoroEngine:
    name = "kokoro"
    model_id = "kokoro-82m-german (martin, kerstin)"
    sample_rate = 24000
    clones = False

    def __init__(self) -> None:
        self._tts: dict[str, object] = {}
        self._multi = None
        self.pack = {"installed": False, "downloading": False, "fraction": 0.0, "error": None}

    @property
    def voices(self) -> list[str]:
        extra = [f"{lang}:{v}" for lang, vs in PACK_VOICES.items() for v in vs] if self._multi else []
        return list(VOICES) + extra

    def _load_pack(self) -> None:
        from kokoro_onnx import Kokoro

        paths = [os.path.join(PACK_DIR, f) for f in PACK_FILES]
        if not all(os.path.exists(p) for p in paths):
            return
        tts = Kokoro(*paths)
        tts.sess = _FloatSpeed(tts.sess)
        self._multi = tts
        self.pack["installed"] = True

    def install_pack(self) -> None:
        """Lädt das Sprachpaket im Hintergrund; Fortschritt in self.pack."""
        if self.pack["downloading"] or self.pack["installed"]:
            return
        self.pack.update(downloading=True, fraction=0.0, error=None)

        def run() -> None:
            try:
                os.makedirs(PACK_DIR, exist_ok=True)
                for i, name in enumerate(PACK_FILES):
                    target = os.path.join(PACK_DIR, name)
                    if os.path.exists(target):
                        continue
                    part = target + ".part"
                    with urllib.request.urlopen(f"{PACK_BASE}/{name}", timeout=60) as r, open(part, "wb") as f:
                        total = int(r.headers.get("Content-Length") or 0)
                        done = 0
                        while chunk := r.read(1 << 20):
                            f.write(chunk)
                            done += len(chunk)
                            if total:
                                self.pack["fraction"] = (i + done / total) / len(PACK_FILES)
                    os.replace(part, target)
                self._load_pack()
            except Exception as e:  # noqa: BLE001
                self.pack["error"] = repr(e)
            finally:
                self.pack["downloading"] = False

        threading.Thread(target=run, name="kokoro-pack", daemon=True).start()

    def load(self) -> None:
        from kokoro_onnx import Kokoro

        for name, v in VOICES.items():
            tts = Kokoro(os.path.join(MODEL_DIR, v.model), os.path.join(MODEL_DIR, v.voices))
            tts.sess = _FloatSpeed(tts.sess)
            # Aufwärmen, erster Aufruf baut die Sitzung auf
            tts.create("Hallo.", voice=name, speed=v.base_speed if v.native_speed else 1.0, lang="de")
            self._tts[name] = tts
        # Sprachpaket, falls schon geladen
        try:
            self._load_pack()
        except Exception as e:  # noqa: BLE001
            self.pack["error"] = repr(e)

    def synth(self, text: str, ref: Ref | None, req: SpeechRequest) -> np.ndarray:
        lang, name = voice_name(req.voice)
        if lang:
            if not self._multi:
                raise RuntimeError("Sprachpaket nicht geladen")
            samples, sr = self._multi.create(text, voice=name, speed=req.speed, lang=lang)
            if sr != self.sample_rate:
                from tts_common.audio_io import resample

                samples = resample(samples, sr, self.sample_rate)
            return samples
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
