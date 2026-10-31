"""F5-TTS, klont aus Referenz-Audio: deutsches Modell vom HPI, spanisches von jpgallegoar, englisches Original.

Deutsch: aihpi/F5-TTS-German, Ordner F5TTS_Base (Vocos-Vocoder), lädt beim Start.
Spanisch (jpgallegoar/F5-Spanish) und Englisch (SWivid/F5-TTS) laden beim ersten Auftrag ihrer Sprache
und bleiben geladen, damit Sprachwechsel mitten im Kapitel nichts kosten (je Modell rund 1,5–2 GB Grafikspeicher).
Lizenz der Gewichte: CC-BY-NC-4.0, zur Laufzeit geladen, nicht im Image.
"""

from __future__ import annotations

import os
import threading

import numpy as np
import soundfile as sf

from tts_common.audio_io import Ref
from tts_common.logs import get_logger
from tts_common.server import SpeechRequest, _set_offline

log = get_logger("f5")

REPO = os.environ.get("F5_REPO", "aihpi/F5-TTS-German")
CKPT = os.environ.get("F5_CKPT", "F5TTS_Base/model_420000.safetensors")
ES_REPO = os.environ.get("F5_ES_REPO", "jpgallegoar/F5-Spanish")
ES_CKPT = os.environ.get("F5_ES_CKPT", "model_1200000.safetensors")
EN_REPO = os.environ.get("F5_EN_REPO", "SWivid/F5-TTS")
EN_CKPT = os.environ.get("F5_EN_CKPT", "F5TTS_v1_Base/model_1250000.safetensors")
# Sprache aus der Anfrage → (Repo, Checkpoint, Vokabular, Modellaufbau); unbekannte Sprachen sprechen Deutsch.
# Englisch ist das Originalmodell (Englisch/Chinesisch, v1-Aufbau)
MODELS = {
    "German": (REPO, CKPT, "vocab.txt", "F5TTS_Base"),
    "Spanish": (ES_REPO, ES_CKPT, "vocab.txt", "F5TTS_Base"),
    "English": (EN_REPO, EN_CKPT, "F5TTS_v1_Base/vocab.txt", "F5TTS_v1_Base"),
}
NFE_STEPS = int(os.environ.get("F5_NFE_STEPS", "32"))
# F5 schätzt die Länge aus Referenz und Text; knapp geschätzt verschluckt es Anfang oder Ende.
# Darum etwas Luft: Faktor auf die geschätzte Sprechzeit plus feste Sekunden
DURATION_MARGIN = float(os.environ.get("F5_DURATION_MARGIN", "1.15"))
DURATION_PAD = float(os.environ.get("F5_DURATION_PAD", "0.5"))
REF_DIR = "/tmp/f5-refs"


def _fetch(repo: str, name: str) -> str:
    """Erst aus dem Volume, sonst aus dem Netz (nach dem Start steht der Hub auf offline)."""
    from huggingface_hub import hf_hub_download

    try:
        return hf_hub_download(repo, name, local_files_only=True)
    except Exception:  # noqa: BLE001
        _set_offline(False)
        log.info("lade %s/%s aus dem Netz", repo, name)
        return hf_hub_download(repo, name)


class F5Engine:
    name = "f5"
    model_id = f"{REPO}/{CKPT}"
    sample_rate = 24000
    clones = True
    voices: list[str] = []

    def __init__(self) -> None:
        self._models: dict[str, object] = {}
        self._lock = threading.Lock()

    def _model(self, language: str):
        lang = language if language in MODELS else "German"
        with self._lock:
            if lang not in self._models:
                from f5_tts.api import F5TTS

                repo, ckpt_name, vocab_name, arch = MODELS[lang]
                ckpt = _fetch(repo, ckpt_name)
                vocab = ""
                if vocab_name:
                    try:
                        vocab = _fetch(repo, vocab_name)
                    except Exception:  # noqa: BLE001
                        # Ohne eigenes Vokabular gilt das des F5-Basismodells
                        log.warning("%s ohne %s, nehme das Standard-Vokabular", repo, vocab_name)
                self._models[lang] = F5TTS(model=arch, ckpt_file=ckpt, vocab_file=vocab, device="cuda")
                log.info("f5: Modell %s geladen (%s)", lang, repo)
            return self._models[lang]

    def load(self) -> None:
        # hf_hub_download statt cached_path: liegt dann im HF-Volume und übersteht Image-Updates
        self._model("German")
        os.makedirs(REF_DIR, exist_ok=True)

    def _ref_file(self, ref: Ref) -> str:
        # Fester Name je Referenz: F5 cacht die Vorverarbeitung pro Datei
        path = os.path.join(REF_DIR, f"{ref.key}.wav")
        if not os.path.exists(path):
            sf.write(path, ref.samples, ref.sr, subtype="PCM_16")
        return path

    def synth(self, text: str, ref: Ref | None, req: SpeechRequest) -> np.ndarray:
        assert ref is not None
        if not ref.text:
            # Ohne Transkript lädt F5 Whisper nach, das kostet Zeit und VRAM
            log.warning("ref_text fehlt, F5 transkribiert die Referenz selbst")
        tts = self._model(req.language)
        wav, sr, _ = tts.infer(
            self._ref_file(ref),
            ref.text or "",
            text,
            nfe_step=NFE_STEPS,
            speed=req.speed,
            fix_duration=self._duration(ref, text, req.speed),
            seed=req.seed,
            show_info=lambda *_: None,
            progress=None,
        )
        return np.asarray(wav, dtype=np.float32)


    @staticmethod
    def _duration(ref: Ref, text: str, speed: float) -> float | None:
        """Gesamtdauer (Referenz + neuer Text) wie F5 schätzt, mit Reserve; ohne Transkript F5 selbst schätzen lassen."""
        if not ref.text:
            return None
        ref_s = len(ref.samples) / ref.sr
        ref_len = max(1, len(ref.text.encode("utf-8")))
        gen_len = len(text.encode("utf-8"))
        # Nur wenn F5 den Text nicht selbst teilt (gleiche Grenze wie in f5_tts): eine feste Dauer
        # gälte sonst für jedes Teilstück; lange Referenzen kürzt F5 intern, dann passt die Rechnung nicht
        max_chars = int(ref_len / ref_s * (22 - ref_s) * speed) if ref_s < 12 else 0
        if gen_len > max_chars:
            return None
        gen_s = ref_s / ref_len * gen_len / max(speed, 0.1)
        return ref_s + gen_s * DURATION_MARGIN + DURATION_PAD


ENGINE = F5Engine()
