"""
pm-audio-analyzer — Qwen3-Omni-30B-A3B-Instruct (AWQ-4bit) sidecar.

Single endpoint: POST /v1/audio/analyze
  multipart upload of a voice sample (~10-25 s) → JSON with transcript +
  TTS-instruct sentence in one inference call.

Lazy-load + immediate-unload pattern: model is loaded on each request and
freed afterwards. Costs ~20-30 s of cold-start latency per call but keeps
VRAM at 0 between calls so other GPU consumers (Ollama, Qwen-TTS) can use
the card without arbitration overhead during idle periods.

Why no warm-cache: the user explicitly requested "ein Modell gleichzeitig
auf der GPU, nie zwei" — a resident audio-analyzer would block the entire
TTS/LLM pipeline whenever it sat idle, which is most of the time. Lazy
load makes the constraint trivial to enforce.
"""

import gc
import json
import logging
import os
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any

import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("pm-audio-analyzer")


MODEL_ID = os.environ.get(
    "AUDIO_ANALYZER_MODEL",
    "cyankiwi/Qwen3-Omni-30B-A3B-Instruct-AWQ-4bit",
)
DEFAULT_MAX_NEW_TOKENS = int(
    os.environ.get("AUDIO_ANALYZER_MAX_NEW_TOKENS", "512")
)
ALLOWED_AUDIO_EXTS = {".wav", ".mp3", ".flac", ".ogg", ".m4a"}


PROMPT_TEMPLATE = (
    "Hör dir die Aufnahme an und antworte ausschließlich mit folgendem JSON, "
    "ohne Vorwort und ohne Erklärung:\n"
    "{{\n"
    '  "transcript": "<exakte gesprochene Worte, Wort für Wort>",\n'
    '  "instruct": "<EIN {language_label} Satz für ein TTS-instruct-Feld, '
    "beschreibt Tempo, Tonfall, Textur und Sprecher-Charakter>\"\n"
    "}}"
)


def _release_vram() -> None:
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def _run_analysis(audio_path: str, language: str) -> dict[str, Any]:
    """Loads model, runs inference, unloads. Pure function — no global
    state survives the call. The model object is local to this scope and
    becomes unreachable as soon as the function returns."""
    from transformers import (
        Qwen3OmniMoeForConditionalGeneration,
        Qwen3OmniMoeProcessor,
    )

    if not torch.cuda.is_available():
        raise HTTPException(
            status_code=503, detail="no CUDA device available"
        )

    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()

    t0 = time.time()
    log.info("loading %s …", MODEL_ID)
    processor = Qwen3OmniMoeProcessor.from_pretrained(
        MODEL_ID, trust_remote_code=True
    )
    model = Qwen3OmniMoeForConditionalGeneration.from_pretrained(
        MODEL_ID,
        torch_dtype="auto",
        device_map="cuda",
        trust_remote_code=True,
    )
    model.eval()
    load_s = time.time() - t0
    log.info(
        "model loaded in %.1fs (VRAM %.1f GB)",
        load_s,
        torch.cuda.memory_allocated() / (1024**3),
    )

    language_label = "deutscher" if language.startswith("de") else "englischer"
    prompt = PROMPT_TEMPLATE.format(language_label=language_label)

    conversation = [
        {
            "role": "user",
            "content": [
                {"type": "audio", "audio": audio_path},
                {"type": "text", "text": prompt},
            ],
        }
    ]

    t1 = time.time()
    try:
        inputs = processor.apply_chat_template(
            conversation,
            add_generation_prompt=True,
            tokenize=True,
            return_dict=True,
            return_tensors="pt",
        ).to("cuda")
        with torch.inference_mode():
            out_ids = model.generate(
                **inputs,
                max_new_tokens=DEFAULT_MAX_NEW_TOKENS,
                do_sample=False,
            )
        text = processor.batch_decode(
            out_ids[:, inputs["input_ids"].shape[1] :],
            skip_special_tokens=True,
        )[0]
    finally:
        # Always unload, even on inference failure. Otherwise an OOM
        # midway would leave 14 GB resident until the container restarts.
        del model
        del processor
        _release_vram()

    infer_s = time.time() - t1
    peak_gb = torch.cuda.max_memory_allocated() / (1024**3)
    log.info(
        "inference %.1fs (load %.1fs, peak VRAM %.1f GB) — output %d chars",
        infer_s,
        load_s,
        peak_gb,
        len(text),
    )

    parsed: dict[str, Any] = {}
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        # Model didn't produce clean JSON. Return the raw text so the
        # backend / user can still see what came out instead of
        # discarding it silently.
        log.warning("model output is not valid JSON, returning raw")
        parsed = {"transcript": "", "instruct": "", "raw": text}

    return {
        **parsed,
        "model": MODEL_ID,
        "loadSeconds": round(load_s, 1),
        "inferSeconds": round(infer_s, 1),
        "peakVramGb": round(peak_gb, 1),
    }


app = FastAPI(title="pm-audio-analyzer")


@app.get("/health")
async def health() -> dict[str, Any]:
    """Liveness only — does NOT trigger a model load. The model is
    transient (one-shot per /analyze call) so 'is the model loaded' is
    never the right question."""
    return {
        "ok": True,
        "model": MODEL_ID,
        "cuda": torch.cuda.is_available(),
    }


@app.post("/v1/audio/analyze")
async def analyze(
    audio: UploadFile = File(...),
    language: str = Form("de"),
) -> JSONResponse:
    ext = Path(audio.filename or "").suffix.lower()
    if ext not in ALLOWED_AUDIO_EXTS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"unsupported extension {ext or '(none)'} — "
                f"allowed: {sorted(ALLOWED_AUDIO_EXTS)}"
            ),
        )

    # Persist to a temp file because the Qwen3-Omni processor expects a
    # path on disk (or HTTP URL), not a file-like.
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        try:
            shutil.copyfileobj(audio.file, tmp)
            tmp.flush()
            tmp_path = tmp.name
        finally:
            audio.file.close()

    try:
        result = _run_analysis(tmp_path, language)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    return JSONResponse(result)
