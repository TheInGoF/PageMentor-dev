"""F5-TTS German vom HPI, klont aus Referenz-Audio.

Checkpoint: aihpi/F5-TTS-German, Ordner F5TTS_Base (Vocos-Vocoder).
Lizenz der Gewichte: CC-BY-NC-4.0, zur Laufzeit geladen, nicht im Image.
"""

from __future__ import annotations

import os

import numpy as np
import soundfile as sf

from tts_common.audio_io import Ref
from tts_common.logs import get_logger
from tts_common.server import SpeechRequest

log = get_logger("f5")

REPO = os.environ.get("F5_REPO", "aihpi/F5-TTS-German")
CKPT = os.environ.get("F5_CKPT", "F5TTS_Base/model_420000.safetensors")
NFE_STEPS = int(os.environ.get("F5_NFE_STEPS", "32"))
REF_DIR = "/tmp/f5-refs"


class F5Engine:
    name = "f5"
    model_id = f"{REPO}/{CKPT}"
    sample_rate = 24000
    clones = True
    voices: list[str] = []

    def __init__(self) -> None:
        self._tts = None

    def load(self) -> None:
        from f5_tts.api import F5TTS
        from huggingface_hub import hf_hub_download

        # hf_hub_download statt cached_path: liegt dann im HF-Volume und übersteht Image-Updates
        ckpt = hf_hub_download(REPO, CKPT)
        vocab = hf_hub_download(REPO, "vocab.txt")
        self._tts = F5TTS(model="F5TTS_Base", ckpt_file=ckpt, vocab_file=vocab, device="cuda")
        os.makedirs(REF_DIR, exist_ok=True)

    def _ref_file(self, ref: Ref) -> str:
        # Fester Name je Referenz: F5 cacht die Vorverarbeitung pro Datei
        path = os.path.join(REF_DIR, f"{ref.key}.wav")
        if not os.path.exists(path):
            sf.write(path, ref.samples, ref.sr, subtype="PCM_16")
        return path

    def synth(self, text: str, ref: Ref | None, req: SpeechRequest) -> np.ndarray:
        assert self._tts is not None and ref is not None
        if not ref.text:
            # Ohne Transkript lädt F5 Whisper nach, das kostet Zeit und VRAM
            log.warning("ref_text fehlt, F5 transkribiert die Referenz selbst")
        wav, sr, _ = self._tts.infer(
            self._ref_file(ref),
            ref.text or "",
            text,
            nfe_step=NFE_STEPS,
            speed=req.speed,
            seed=req.seed,
            show_info=lambda *_: None,
            progress=None,
        )
        return np.asarray(wav, dtype=np.float32)


ENGINE = F5Engine()
