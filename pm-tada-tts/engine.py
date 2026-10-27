"""TADA 3B-ML von Hume AI, klont aus Referenz-Audio mit Transkript.

Gewichte: HumeAI/tada-3b-ml, Llama-3.2-Lizenz. Der Tokenizer kommt aus
meta-llama/Llama-3.2-1B und braucht einen HF-Token mit Freigabe (HF_TOKEN).
"""

from __future__ import annotations

import os
from collections import OrderedDict

import numpy as np
from fastapi import HTTPException

from tts_common.audio_io import Ref
from tts_common.server import SpeechRequest

MODEL = os.environ.get("TADA_MODEL", "HumeAI/tada-3b-ml")
CODEC = os.environ.get("TADA_CODEC", "HumeAI/tada-codec")
LANGUAGE = os.environ.get("TADA_LANGUAGE", "de")
PROMPT_CACHE = int(os.environ.get("TADA_PROMPT_CACHE", "8"))


class TadaEngine:
    name = "tada"
    model_id = MODEL
    sample_rate = 24000
    clones = True
    voices: list[str] = []

    def __init__(self) -> None:
        self._encoder = None
        self._model = None
        # Kodierte Referenz je Stimme, spart den Encoder bei jedem Chunk
        self._prompts: OrderedDict[str, object] = OrderedDict()

    def load(self) -> None:
        import torch
        from tada.modules.encoder import Encoder
        from tada.modules.tada import TadaForCausalLM

        self._encoder = Encoder.from_pretrained(CODEC, subfolder="encoder", language=LANGUAGE).to("cuda")
        self._model = TadaForCausalLM.from_pretrained(MODEL, torch_dtype=torch.bfloat16).to("cuda")

    def _prompt(self, ref: Ref):
        import torch

        if ref.key in self._prompts:
            self._prompts.move_to_end(ref.key)
            return self._prompts[ref.key]
        audio = torch.from_numpy(ref.samples).unsqueeze(0).to("cuda")
        prompt = self._encoder(audio, text=[ref.text], sample_rate=ref.sr)
        self._prompts[ref.key] = prompt
        while len(self._prompts) > PROMPT_CACHE:
            self._prompts.popitem(last=False)
        return prompt

    def synth(self, text: str, ref: Ref | None, req: SpeechRequest) -> np.ndarray:
        import torch

        assert self._model is not None and ref is not None
        if not ref.text:
            # Eingebaute Spracherkennung kann nur Englisch
            raise HTTPException(status_code=400, detail="ref_text fehlt, TADA braucht das Transkript der Referenz")
        torch.manual_seed(req.seed)
        # Jeder Chunk neu ab der Referenz, kein Kontext aus dem vorigen
        out = self._model.generate(prompt=self._prompt(ref), text=text)
        wav = out.audio[0] if out.audio else None
        if wav is None:
            raise RuntimeError("TADA lieferte kein Audio")
        return wav.float().cpu().numpy()


ENGINE = TadaEngine()
