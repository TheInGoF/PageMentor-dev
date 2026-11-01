"""TADA 3B-ML von Hume AI, klont aus Referenz-Audio mit Transkript, mehrsprachig.

Je Sprache ein eigener Aligner im Encoder (Deutsch, Englisch, Spanisch, Französisch, Italienisch, Portugiesisch …);
er lädt beim ersten Auftrag seiner Sprache und bleibt geladen (klein, wenige hundert MB).

Gewichte: HumeAI/tada-3b-ml, Llama-3.2-Lizenz. Der Tokenizer kommt aus
meta-llama/Llama-3.2-1B und braucht einen HF-Token mit Freigabe (HF_TOKEN).
"""

from __future__ import annotations

import os
from collections import OrderedDict

import numpy as np
from fastapi import HTTPException

from tts_common.activity import activity
from tts_common.audio_io import Ref
from tts_common.server import SpeechRequest, _set_offline

MODEL = os.environ.get("TADA_MODEL", "HumeAI/tada-3b-ml")
CODEC = os.environ.get("TADA_CODEC", "HumeAI/tada-codec")
LANGUAGE = os.environ.get("TADA_LANGUAGE", "de")
# Sprache aus der Anfrage → Aligner im Codec-Repo (Englisch ist der Standard-Aligner ohne Zusatz)
ALIGNERS = {"German": "de", "English": None, "Spanish": "es", "French": "fr", "Italian": "it", "Portuguese": "pt", "Polish": "pl", "Japanese": "ja"}
PROMPT_CACHE = int(os.environ.get("TADA_PROMPT_CACHE", "8"))
# Qualitätsstufen: Hume-Standard (schnell, aber zittrig), ruhiger (weniger Rauschen, mehr Schritte), beste (dazu
# mehrere Kandidaten je Lautstück, der wahrscheinlichste gewinnt). Mehr Schritte kosten nur den kleinen Klangkopf,
# nicht das Sprachmodell: „ruhig“ ist kaum langsamer
QUALITY = {
    "fast": {"noise_temperature": 0.9, "num_flow_matching_steps": 10, "num_acoustic_candidates": 1},
    "calm": {"noise_temperature": 0.7, "num_flow_matching_steps": 20, "num_acoustic_candidates": 1},
    "best": {"noise_temperature": 0.6, "num_flow_matching_steps": 32, "num_acoustic_candidates": 3},
}
DEFAULT_QUALITY = os.environ.get("TADA_QUALITY", "calm")


class TadaEngine:
    name = "tada"
    model_id = MODEL
    sample_rate = 24000
    clones = True
    voices: list[str] = []

    def __init__(self) -> None:
        self._encoders: dict[str | None, object] = {}
        self._model = None
        # Kodierte Referenz je Stimme, spart den Encoder bei jedem Chunk
        self._prompts: OrderedDict[str, object] = OrderedDict()

    def load(self) -> None:
        import torch
        from tada.modules.encoder import Encoder
        from tada.modules.tada import TadaForCausalLM

        self._encoders[LANGUAGE] = Encoder.from_pretrained(CODEC, subfolder="encoder", language=LANGUAGE).to("cuda")
        self._model = TadaForCausalLM.from_pretrained(MODEL, torch_dtype=torch.bfloat16).to("cuda")

    def _encoder(self, language: str):
        from tada.modules.encoder import Encoder

        code = ALIGNERS.get(language, LANGUAGE)
        if code not in self._encoders:
            with activity("load", f"TADA {language}"):
                try:
                    enc = Encoder.from_pretrained(CODEC, subfolder="encoder", language=code)
                except Exception:  # noqa: BLE001
                    # Nach dem ersten Start ist der Hub offline und der Aligner dieser Sprache fehlt noch. transformers
                    # liest den Offline-Schalter nur beim Import, darum die Dateien erst per huggingface_hub holen
                    # und dann offline aus dem Cache öffnen
                    self._fetch_aligner(code)
                    enc = Encoder.from_pretrained(CODEC, subfolder="encoder", language=code)
                self._encoders[code] = enc.to("cuda")
        return self._encoders[code]

    @staticmethod
    def _fetch_aligner(code: str | None) -> None:
        from huggingface_hub import snapshot_download

        folder = f"aligner-{code}" if code else "aligner"
        _set_offline(False)
        try:
            # Encoder mit dazu: Beide Ordner stehen dann im selben Stand des Repos
            snapshot_download(CODEC, allow_patterns=[f"{folder}/*", "encoder/*"])
        finally:
            _set_offline(True)

    def _prompt(self, ref: Ref, language: str):
        import torch

        key = f"{language}:{ref.key}"
        if key in self._prompts:
            self._prompts.move_to_end(key)
            return self._prompts[key]
        audio = torch.from_numpy(ref.samples).unsqueeze(0).to("cuda")
        prompt = self._encoder(language)(audio, text=[ref.text], sample_rate=ref.sr)
        self._prompts[key] = prompt
        while len(self._prompts) > PROMPT_CACHE:
            self._prompts.popitem(last=False)
        return prompt

    def synth(self, text: str, ref: Ref | None, req: SpeechRequest) -> np.ndarray:
        import torch

        assert self._model is not None and ref is not None
        if not ref.text:
            # Eingebaute Spracherkennung kann nur Englisch
            raise HTTPException(status_code=400, detail="ref_text fehlt, TADA braucht das Transkript der Referenz")
        from tada.modules.tada import InferenceOptions

        torch.manual_seed(req.seed)
        opts = InferenceOptions(**QUALITY.get(req.quality or DEFAULT_QUALITY, QUALITY["calm"]))
        # Jeder Chunk neu ab der Referenz, kein Kontext aus dem vorigen
        out = self._model.generate(prompt=self._prompt(ref, req.language), text=text, inference_options=opts)
        wav = out.audio[0] if out.audio else None
        if wav is None:
            raise RuntimeError("TADA lieferte kein Audio")
        return wav.float().cpu().numpy()


ENGINE = TadaEngine()
