"""pm-qwen-tts — Qwen3-TTS-12Hz-1.7B-Base Voice-Clone Sidecar.

OpenAI-kompatible API, erweitert um Voice-Clone-Felder. Lädt beim ersten
Request das Qwen3-TTS-Base-Modell via das offizielle ``qwen-tts``-Package
(Alibaba), clonest aus einem 3-10 s Referenz-WAV eine Lesestimme und
generiert deutschen Text. Deterministisch dank `torch.manual_seed` vor
jedem Call.

Endpoints
---------

    GET  /health                      liveness (503 bis Modell ready)
    GET  /v1/audio/voices             leer — PageMentor-Backend pflegt
                                      den Voice-Katalog selbst
    POST /v1/audio/speech             Request-Body:
      {
        "input": "...",               zu sprechender Text
        "ref_audio_b64": "..."        base64(WAV), 3-10 s Referenz
        "ref_text": "...",            optional — Transkript der
                                      Referenz (erhöht Klon-Qualität)
        "language": "German",         optional, default "German"
        "seed": 12345,                optional, default 0
        "response_format": "mp3",     "mp3" | "wav" | "flac"
        "speed": 1.0
      }

Seed-Garantie: Der Caller schickt einen festen Seed pro „logischer Voice"
(PageMentor-Backend hält einen Seed pro hochgeladenem Sample in SQLite).
Der Sidecar setzt `torch.manual_seed(seed)` + `cuda.manual_seed_all(seed)`
+ `numpy.random.seed(seed)` vor dem Generate-Call. Gleiche Referenz + gleicher
Text + gleicher Seed = bit-identisches Audio.

Lizenz: Das TTS-Modell Qwen/Qwen3-TTS-12Hz-1.7B-Base ist © Alibaba,
Apache 2.0, und wird zur Laufzeit aus dem HuggingFace-Hub geladen
(nicht im Image gebundelt).
"""

from __future__ import annotations

import base64
import hashlib
import io
import logging
import os
import random
import threading
import time
from contextlib import asynccontextmanager
from typing import Any, Literal, Optional

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from transformers import StoppingCriteria, StoppingCriteriaList

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
log = logging.getLogger("qwen-tts")


class _RingHandler(logging.Handler):
    """In-memory ring buffer of recent log records.

    The PageMentor backend pulls /diagnostics/recent-logs every few
    seconds and forwards new lines into its own SSE stream so the user
    sees backend + sidecar interleaved in the Logs page without SSHing
    onto the GPU host.
    """

    def __init__(self, capacity: int = 500):
        super().__init__()
        self.capacity = capacity
        self.buf: list[dict[str, Any]] = []
        self._lock = threading.Lock()

    def emit(self, record: logging.LogRecord) -> None:
        try:
            entry = {
                "ts": int(record.created * 1000),
                "level": record.levelname,
                "message": self.format(record),
            }
            with self._lock:
                self.buf.append(entry)
                if len(self.buf) > self.capacity:
                    del self.buf[: len(self.buf) - self.capacity]
        except Exception:  # noqa: BLE001
            # never let logging crash the caller
            pass

    def snapshot(self, since_ts: int = 0) -> list[dict[str, Any]]:
        with self._lock:
            if since_ts <= 0:
                return list(self.buf)
            return [e for e in self.buf if e["ts"] > since_ts]


_log_ring = _RingHandler(capacity=500)
_log_ring.setLevel(logging.INFO)
_log_ring.setFormatter(
    logging.Formatter("%(name)s :: %(message)s")
)
# Attach to the root logger so we capture qwen-tts plus everything
# from libraries (uvicorn, transformers, …) that bubbles up.
logging.getLogger().addHandler(_log_ring)

MODEL_ID = os.environ.get("QWEN_TTS_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-Base")
# CustomVoice-Modell mit 9 Preset-Stimmen + Instruction-Control (Freitext-
# Prompt wie "Calm audiobook narrator, slow and clear pacing"). Wird
# lazy geladen beim ersten Request der einen `speaker`-Parameter setzt.
# Base und CustomVoice laufen co-resident (je ~4 GB in bf16; mit Ollama
# auf 24-GB-GPU knapp aber praktikabel wenn nicht alles gleichzeitig
# aktiv). Auf 0 setzen = CustomVoice-Pfad deaktiviert.
CUSTOMVOICE_MODEL_ID = os.environ.get(
    "QWEN_TTS_CUSTOMVOICE_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
)
# VoiceDesign model: produces a voice from a free-text description
# (instead of one of 9 presets or a ref.wav). Lazy-loaded analogously
# to CustomVoice — the first request with a `voice_description` field
# triggers it. The HF snapshot is complete (speech_tokenizer/ is in
# the repo), so no symlink dance needed.
VOICEDESIGN_MODEL_ID = os.environ.get(
    "QWEN_TTS_VOICEDESIGN_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
)
# Audio tokenizer. Qwen hosts the base model and tokenizer as
# separate HF repos, but the qwen-tts loader expects a
# speech_tokenizer/ subfolder inside the base snapshot — so we load
# both and symlink them together (see `_prepare_model_path`).
TOKENIZER_ID = os.environ.get(
    "QWEN_TTS_TOKENIZER_MODEL", "Qwen/Qwen3-TTS-Tokenizer-12Hz"
)

# The 9 preset voices in CustomVoice. No DE-native speaker — the
# model card recommends `Ryan`/`Aiden` (EN speakers) + language="German"
# for DE; the model re-renders the voice in the target language.
CUSTOMVOICE_PRESETS: list[str] = [
    "Vivian",     # ZH, young woman
    "Serena",     # ZH, warm
    "Uncle_Fu",   # ZH, mature man
    "Dylan",      # ZH (Beijing)
    "Eric",       # ZH (Sichuan)
    "Ryan",       # EN, dynamic — DE recommendation
    "Aiden",      # EN, sunny — DE recommendation
    "Ono_Anna",   # JP, playful
    "Sohee",      # KR, warm
]
DEVICE = os.environ.get("QWEN_TTS_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
DTYPE_NAME = os.environ.get("QWEN_TTS_DTYPE", "bfloat16")
# flash_attention_2 has been preinstalled in the image since v1.17.003
# (prebuilt wheel, see Dockerfile). On older GPUs (compute capability
# < 8.0, e.g. RTX 20xx) set `QWEN_TTS_ATTN_IMPL=sdpa` — flash-attn
# only supports Ampere+.
ATTN_IMPL = os.environ.get("QWEN_TTS_ATTN_IMPL", "flash_attention_2")

# Voice clone quality tuning (overridable via ENV).
DEFAULT_LANGUAGE = os.environ.get("QWEN_TTS_DEFAULT_LANGUAGE", "German")
MAX_NEW_TOKENS = int(os.environ.get("QWEN_TTS_MAX_NEW_TOKENS", "4096"))

# Sampling defaults — used when the request doesn't override them.
# These four params land in `gen_kwargs` of every synthesis path and
# directly affect chunk-to-chunk voice stability. Lower temperature +
# tighter top_p reduce drift; repetition_penalty > 1.0 helps against
# the well-known "looping garble" (issue #258 in QwenLM/Qwen3-TTS).
DEFAULT_TEMPERATURE = float(os.environ.get("QWEN_TTS_DEFAULT_TEMPERATURE", "0.75"))
DEFAULT_TOP_P = float(os.environ.get("QWEN_TTS_DEFAULT_TOP_P", "0.8"))
DEFAULT_TOP_K = int(os.environ.get("QWEN_TTS_DEFAULT_TOP_K", "40"))
DEFAULT_REPETITION_PENALTY = float(
    os.environ.get("QWEN_TTS_DEFAULT_REPETITION_PENALTY", "1.05")
)

# Subtalker (the secondary AR head) sampler defaults. Qwen's official
# `examples/test_model_12hz_base.py` passes these explicitly; without
# them the subtalker can fall back to greedy decoding and lock into a
# token cycle independently of the main decoder — the same "looping
# garble" symptom that issue #258 describes. Values from the upstream
# example file.
DEFAULT_SUBTALKER_DOSAMPLE = os.environ.get(
    "QWEN_TTS_SUBTALKER_DOSAMPLE", "true"
).lower() in ("1", "true", "yes")
DEFAULT_SUBTALKER_TEMPERATURE = float(
    os.environ.get("QWEN_TTS_SUBTALKER_TEMPERATURE", "0.9")
)
DEFAULT_SUBTALKER_TOP_P = float(
    os.environ.get("QWEN_TTS_SUBTALKER_TOP_P", "1.0")
)
DEFAULT_SUBTALKER_TOP_K = int(
    os.environ.get("QWEN_TTS_SUBTALKER_TOP_K", "50")
)

# Loop-detection tunables. The model occasionally falls into a sampling
# loop where it generates the same handful of audio tokens forever,
# never reaching EOS (Qwen3-TTS issue #258). The detector inspects the
# last `LOOP_WINDOW` tokens of the generation; if they only span
# fewer than `LOOP_MAX_UNIQUE` distinct values, we consider it stuck
# and stop the generate call early. `LOOP_MIN_TOKENS` keeps the early
# part of generation (which is naturally low-variance silence/breath
# tokens) from triggering false positives.
LOOP_WINDOW = int(os.environ.get("QWEN_TTS_LOOP_WINDOW", "256"))
LOOP_MAX_UNIQUE = int(os.environ.get("QWEN_TTS_LOOP_MAX_UNIQUE", "20"))
LOOP_MIN_TOKENS = int(os.environ.get("QWEN_TTS_LOOP_MIN_TOKENS", "1500"))
LOOP_DETECTION_ENABLED = os.environ.get(
    "QWEN_TTS_LOOP_DETECTION", "true"
).lower() in ("1", "true", "yes")

# Hard timeout per generate call. Zombie generations (model loop,
# NaN, infinite-repeat) otherwise freeze the GPU until container
# restart. On overrun: 504 to the client + self-exit(1) so Docker
# can bring the container back up. Arbiter `restart: "no"` means:
# the arbiter decides the restart on the next TTS call.
#
# 1200 s = 20 min: default generously sized so 4000-char chunks (raised
# backend-side via PM_TTS_MAX_CHUNK) get through. Backend timeout
# SYNTH_TIMEOUT_MS should be ≤ this value, otherwise the sidecar
# kills itself before the client sees the 504. Override for stricter
# fail-fast setups via QWEN_TTS_GENERATION_TIMEOUT.
GENERATION_TIMEOUT_S = int(os.environ.get("QWEN_TTS_GENERATION_TIMEOUT", "1200"))

# Heartbeat log interval during active generation (logs only, not
# the client). Helps see that the process isn't stuck.
HEARTBEAT_INTERVAL_S = float(os.environ.get("QWEN_TTS_HEARTBEAT_INTERVAL", "10"))
# When `ref_text` is empty, Qwen3-TTS-Base uses the x_vector-only
# mode — clone quality is slightly reduced but you skip the
# transcription. Default: real clone with ref_text when supplied,
# otherwise x_vector-only.
X_VECTOR_ONLY_FALLBACK = os.environ.get("QWEN_TTS_X_VECTOR_ONLY", "true").lower() in (
    "1", "true", "yes",
)


def _torch_dtype(name: str):
    return {
        "float16": torch.float16, "fp16": torch.float16, "half": torch.float16,
        "bfloat16": torch.bfloat16, "bf16": torch.bfloat16,
        "float32": torch.float32, "fp32": torch.float32,
    }.get(name.lower(), torch.bfloat16)


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------

_model = None
_load_error: Optional[str] = None

# CustomVoice is lazy-loaded (not in lifespan) so setups that don't
# use presets don't reserve the extra ~4 GB of VRAM. The first
# request with a `speaker` param triggers the load.
_custom_model = None
_custom_load_error: Optional[str] = None
_custom_load_lock = threading.Lock()

# VoiceDesign analogously lazy, triggered by the first
# `voice_description` request. Another ~4 GB VRAM — tight on a 24 GB
# GPU with Ollama, fine without Ollama. Three concurrently loaded
# models are realistic only on 32 GB+ GPUs.
_design_model = None
_design_load_error: Optional[str] = None
_design_load_lock = threading.Lock()


def _prepare_model_path() -> str:
    """Loads base model and audio tokenizer from the HF Hub and links
    the tokenizer as a ``speech_tokenizer/`` subfolder in the base
    snapshot.

    Qwen ships the two as separate HF repos, but the
    ``Qwen3TTSModel`` loader expects them together. The symlink is
    idempotent — on restart with an already-cached volume the function
    does nothing.

    Returns the local path of the (now complete) base snapshot.
    """
    from huggingface_hub import snapshot_download  # noqa: WPS433

    log.info("resolving %s (base model)", MODEL_ID)
    base_dir = snapshot_download(repo_id=MODEL_ID)
    log.info("resolving %s (audio tokenizer)", TOKENIZER_ID)
    tokenizer_dir = snapshot_download(repo_id=TOKENIZER_ID)

    target = os.path.join(base_dir, "speech_tokenizer")

    if os.path.islink(target):
        # Already linked — make sure the link points at the expected
        # snapshot (a repo update could change the snapshot hash).
        current = os.readlink(target)
        if os.path.realpath(current) != os.path.realpath(tokenizer_dir):
            log.info("updating stale tokenizer symlink %s → %s", target, tokenizer_dir)
            os.remove(target)
            os.symlink(tokenizer_dir, target, target_is_directory=True)
        return base_dir

    if os.path.isdir(target):
        # Already shipped by upstream (repo structure may change
        # later). Don't touch, expected best case.
        log.info("speech_tokenizer/ already present in base snapshot")
        return base_dir

    log.info("symlinking %s → %s/speech_tokenizer", tokenizer_dir, base_dir)
    try:
        os.symlink(tokenizer_dir, target, target_is_directory=True)
    except OSError as e:
        # Fallback for filesystems without symlink support (some bind mounts).
        log.warning("symlink failed (%r), falling back to copytree", e)
        import shutil  # noqa: WPS433
        shutil.copytree(tokenizer_dir, target)
    return base_dir


def _load_model() -> None:
    global _model, _load_error
    if _model is not None or _load_error is not None:
        return

    try:
        from qwen_tts import Qwen3TTSModel  # noqa: WPS433
    except Exception as e:  # noqa: BLE001
        _load_error = f"qwen-tts package not importable: {e!r}"
        log.error(_load_error)
        return

    log.info(
        "loading %s on %s (dtype=%s, attn=%s)",
        MODEL_ID, DEVICE, DTYPE_NAME, ATTN_IMPL,
    )
    t0 = time.time()
    try:
        model_path = _prepare_model_path()
        _model = Qwen3TTSModel.from_pretrained(
            model_path,
            device_map=DEVICE,
            dtype=_torch_dtype(DTYPE_NAME),
            attn_implementation=ATTN_IMPL,
        )
    except Exception as e:  # noqa: BLE001
        _load_error = f"Qwen3TTSModel.from_pretrained failed: {e!r}"
        log.exception("model load failed")
        return

    log.info("model ready in %.1fs", time.time() - t0)


def _load_customvoice_model() -> None:
    """Lazy load for the CustomVoice model. Idempotent + thread-safe
    (multiple concurrent ``/v1/audio/speech`` calls with a preset can
    trigger the load simultaneously, only one actually loads).

    When the user has set `QWEN_TTS_MODEL` to the CustomVoice repo
    themselves (instead of leaving the default base repo), the base
    and CustomVoice paths share the same loaded model instance —
    otherwise we'd have two identical ~4 GB downloads and double the
    VRAM usage. The ``Qwen3TTSModel`` class exposes both
    ``generate_voice_clone`` and ``generate_custom_voice`` — which one
    sensibly responds depends on the weights.

    Doesn't use an audio-tokenizer symlink — the CustomVoice repo
    already contains speech_tokenizer/ or doesn't need it (the
    qwen-tts loader fetches it on demand). If the load fails, the
    error lands in ``_custom_load_error`` and the request gets 503.
    """
    global _custom_model, _custom_load_error
    if _custom_model is not None or _custom_load_error is not None:
        return

    with _custom_load_lock:
        # Double-check after lock acquisition.
        if _custom_model is not None or _custom_load_error is not None:
            return

        # Case: MODEL_ID and CUSTOMVOICE_MODEL_ID point at the same
        # repo (e.g. because the user overrode
        # `QWEN_TTS_MODEL=…CustomVoice`). Reuse instead of reloading.
        if (
            MODEL_ID == CUSTOMVOICE_MODEL_ID
            and _model is not None
        ):
            log.info(
                "customvoice load: reusing base-slot model instance "
                "(MODEL_ID == CUSTOMVOICE_MODEL_ID == %s) — no second download",
                CUSTOMVOICE_MODEL_ID,
            )
            _custom_model = _model
            return

        try:
            from qwen_tts import Qwen3TTSModel  # noqa: WPS433
        except Exception as e:  # noqa: BLE001
            _custom_load_error = f"qwen-tts package not importable: {e!r}"
            log.error(_custom_load_error)
            return

        log.info(
            "loading %s on %s (dtype=%s, attn=%s) — lazy trigger",
            CUSTOMVOICE_MODEL_ID, DEVICE, DTYPE_NAME, ATTN_IMPL,
        )
        t0 = time.time()
        try:
            _custom_model = Qwen3TTSModel.from_pretrained(
                CUSTOMVOICE_MODEL_ID,
                device_map=DEVICE,
                dtype=_torch_dtype(DTYPE_NAME),
                attn_implementation=ATTN_IMPL,
            )
        except Exception as e:  # noqa: BLE001
            _custom_load_error = f"CustomVoice load failed: {e!r}"
            log.exception("customvoice load failed")
            return

        log.info("customvoice ready in %.1fs", time.time() - t0)


def _load_voicedesign_model() -> None:
    """Lazy load for VoiceDesign. Analogous to ``_load_customvoice_model``.

    Reuses the base or CustomVoice instance when the user configured
    the same repo for multiple slots (saves 4 GB download + VRAM). In
    the typical case the repo is its own, though.
    """
    global _design_model, _design_load_error
    if _design_model is not None or _design_load_error is not None:
        return

    with _design_load_lock:
        if _design_model is not None or _design_load_error is not None:
            return

        if VOICEDESIGN_MODEL_ID == MODEL_ID and _model is not None:
            log.info(
                "voicedesign load: reusing base-slot instance (VOICEDESIGN_MODEL_ID == MODEL_ID)"
            )
            _design_model = _model
            return
        if VOICEDESIGN_MODEL_ID == CUSTOMVOICE_MODEL_ID and _custom_model is not None:
            log.info(
                "voicedesign load: reusing customvoice-slot instance (VOICEDESIGN_MODEL_ID == CUSTOMVOICE_MODEL_ID)"
            )
            _design_model = _custom_model
            return

        try:
            from qwen_tts import Qwen3TTSModel  # noqa: WPS433
        except Exception as e:  # noqa: BLE001
            _design_load_error = f"qwen-tts package nicht importierbar: {e!r}"
            log.error(_design_load_error)
            return

        log.info(
            "loading %s on %s (dtype=%s, attn=%s) — voicedesign lazy trigger",
            VOICEDESIGN_MODEL_ID, DEVICE, DTYPE_NAME, ATTN_IMPL,
        )
        t0 = time.time()
        try:
            _design_model = Qwen3TTSModel.from_pretrained(
                VOICEDESIGN_MODEL_ID,
                device_map=DEVICE,
                dtype=_torch_dtype(DTYPE_NAME),
                attn_implementation=ATTN_IMPL,
            )
        except Exception as e:  # noqa: BLE001
            _design_load_error = f"VoiceDesign load failed: {e!r}"
            log.exception("voicedesign load failed")
            return

        log.info("voicedesign ready in %.1fs", time.time() - t0)


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
    """Builds the sampling kwargs subset for a generate-call.

    The critical bit is ``do_sample=True``: without it HuggingFace's
    ``generate`` defaults to greedy decoding, which silently ignores
    temperature / top_p / top_k / repetition_penalty AND is highly
    prone to AR-decoder loops (issue #258). Every reproducer of the
    "loops on every chunk regardless of length" symptom traces back
    to a missing or false ``do_sample`` flag.

    The four ``subtalker_*`` kwargs fan the same configuration into
    Qwen3-TTS's secondary AR head. The official
    ``examples/test_model_12hz_base.py`` passes them explicitly; we
    do too. Without subtalker_dosample=True that head can loop
    independently of the main decoder.

    Anything passed as ``None`` falls back to the ENV-provided default;
    that means an empty App-Settings field hands control back to the
    container's startup ENV instead of leaking a blank to the model.
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
    """Stops generation early when the AR decoder has fallen into a
    sampling loop — repeating the same few audio tokens forever
    without ever emitting EOS (Qwen3-TTS issue #258).

    Diagnostic: look at the most recent ``window`` tokens. A healthy
    speech stream covers a wide range of audio codebook entries; a
    looping stream cycles through fewer than ~20 unique values.

    The first ``min_tokens`` of generation are skipped — the prefix is
    naturally low-variance (silence, breath) and would false-trigger.

    When the criterion fires, ``self.triggered`` is set to True so the
    caller can distinguish a clean EOS from an early loop-stop. The
    generation also returns the partial output (everything up to the
    detection point), which is unusable as audio but useful for
    debugging the failure pattern.
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
        # Last `window` tokens, flattened. Qwen3-TTS produces
        # multi-codebook tokens; we treat them as a flat token stream
        # for the diversity check — a real loop reduces the unique
        # count across all codebooks at once.
        last = input_ids[..., -self.window :].reshape(-1)
        unique = int(torch.unique(last).numel())
        if unique <= self.max_unique:
            self.triggered = True
            self.trigger_at_token = seq_len
            self.trigger_unique = unique
            return True
        return False


def _build_stopping_criteria() -> tuple[Optional[StoppingCriteriaList], Optional[LoopDetector]]:
    """Returns ``(criteria_list, detector)`` if loop detection is on,
    otherwise ``(None, None)``. The detector instance is returned so
    callers can check ``.triggered`` after generation."""
    if not LOOP_DETECTION_ENABLED:
        return None, None
    detector = LoopDetector()
    return StoppingCriteriaList([detector]), detector


# ---------------------------------------------------------------------------
# Audio helpers
# ---------------------------------------------------------------------------


# Decode cache for reference audio. With a 100-chapter audiobook
# always using the same user sample, we save N times the base64
# decode + soundfile parse + mono conversion (~50-200 ms per chunk).
# Key = SHA-256 of the raw string; LRU-like behavior via OrderedDict
# + max size.
from collections import OrderedDict  # noqa: E402

_REF_AUDIO_CACHE_MAX = int(os.environ.get("QWEN_TTS_REF_CACHE_SIZE", "16"))
_ref_audio_cache: OrderedDict[str, tuple[np.ndarray, int]] = OrderedDict()
_ref_audio_cache_lock = threading.Lock()


REF_TARGET_SR = 24_000


def _resample_to_24khz(arr: np.ndarray, src_sr: int) -> np.ndarray:
    """Resample mono float32 audio to 24 kHz.

    Qwen3-TTS-12Hz expects its speaker-encoder input at 24 kHz mono
    float32. The official Qwen test uses raw 24 kHz WAV files and the
    `yauh/qwen3-tts-german-clones` recipe explicitly runs
    ``ffmpeg -ar 24000 -ac 1`` before any clone call. Feeding audio
    at the wrong rate (e.g. a 22.05 kHz MP3 from VoiceDesign) makes
    the speaker embedding silently corrupt — manifests as the AR
    decoder cycling through a tiny token set forever ("looping
    garble", issue #258 et al.).

    scipy.signal.resample_poly uses polyphase filtering — fast and
    high-quality enough for a 1-time speaker reference.
    """
    if src_sr == REF_TARGET_SR:
        return arr.astype(np.float32, copy=False)
    from scipy.signal import resample_poly  # noqa: WPS433
    from math import gcd

    g = gcd(REF_TARGET_SR, src_sr)
    up = REF_TARGET_SR // g
    down = src_sr // g
    out = resample_poly(arr.astype(np.float32), up, down)
    return out.astype(np.float32, copy=False)


def _decode_ref_audio(b64: str) -> tuple[np.ndarray, int]:
    """base64 (WAV/MP3/FLAC) → (mono float32 numpy at 24 kHz, sr=24000).

    Always returns 24 kHz audio — the Qwen3-TTS-12Hz speaker encoder
    expects this rate, and feeding it the file's native rate (often
    22.05 kHz MP3 from VoiceDesign) silently corrupts the speaker
    embedding. See _resample_to_24khz for the longer rationale.

    Cached on the raw base64 string (SHA-256). Identical upload at
    chunk N+1 hits the cache and skips parsing entirely.
    """
    cache_key = hashlib.sha256(b64.encode("utf-8", errors="ignore")).hexdigest()
    with _ref_audio_cache_lock:
        cached = _ref_audio_cache.get(cache_key)
        if cached is not None:
            _ref_audio_cache.move_to_end(cache_key)
            return cached

    try:
        raw = base64.b64decode(b64)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"ref_audio_b64 not valid base64: {e}")

    # soundfile reads WAV/FLAC/OGG natively. MP3 needs libsndfile ≥ 1.1
    # OR pydub → we go the pydub route for MP3 so it also works on
    # older hosts.
    try:
        arr, sr = sf.read(io.BytesIO(raw), dtype="float32")
    except Exception:
        try:
            from pydub import AudioSegment  # noqa: WPS433
            seg = AudioSegment.from_file(io.BytesIO(raw))
            arr = np.array(seg.get_array_of_samples(), dtype=np.float32)
            if seg.channels > 1:
                arr = arr.reshape(-1, seg.channels).mean(axis=1)
            arr /= 2 ** (8 * seg.sample_width - 1)
            sr = seg.frame_rate
        except Exception as e:  # noqa: BLE001
            raise HTTPException(
                status_code=400,
                detail=f"ref_audio decode failed: {e}",
            )

    # Convert to mono + force shape (N,).
    arr = np.squeeze(arr)
    if arr.ndim > 1:
        arr = arr.mean(axis=1)
    if arr.size == 0:
        raise HTTPException(status_code=400, detail="ref_audio is empty")

    src_sr = int(sr)
    if src_sr != REF_TARGET_SR:
        log.info(
            "ref_audio resampling %d Hz → %d Hz (samples %d → estimate %d)",
            src_sr, REF_TARGET_SR, arr.size,
            int(arr.size * REF_TARGET_SR / src_sr),
        )
        arr = _resample_to_24khz(arr.astype(np.float32, copy=False), src_sr)

    result = (arr.astype(np.float32), REF_TARGET_SR)
    with _ref_audio_cache_lock:
        _ref_audio_cache[cache_key] = result
        _ref_audio_cache.move_to_end(cache_key)
        while len(_ref_audio_cache) > _REF_AUDIO_CACHE_MAX:
            _ref_audio_cache.popitem(last=False)
    return result


def _encode_audio(samples: np.ndarray, sample_rate: int, fmt: str) -> tuple[bytes, str]:
    fmt = fmt.lower()
    if fmt in ("wav", "wave"):
        buf = io.BytesIO()
        sf.write(buf, samples, sample_rate, format="WAV", subtype="PCM_16")
        return buf.getvalue(), "audio/wav"
    if fmt == "flac":
        buf = io.BytesIO()
        sf.write(buf, samples, sample_rate, format="FLAC")
        return buf.getvalue(), "audio/flac"
    if fmt == "mp3":
        from pydub import AudioSegment  # noqa: WPS433
        wav_buf = io.BytesIO()
        sf.write(wav_buf, samples, sample_rate, format="WAV", subtype="PCM_16")
        wav_buf.seek(0)
        seg = AudioSegment.from_wav(wav_buf)
        out_buf = io.BytesIO()
        seg.export(out_buf, format="mp3", bitrate="96k")
        return out_buf.getvalue(), "audio/mpeg"
    raise HTTPException(status_code=400, detail=f"unsupported response_format {fmt!r}")


def _normalize_samples(arr: np.ndarray) -> np.ndarray:
    arr = np.squeeze(arr)
    if arr.ndim > 1:
        arr = arr[0]
    peak = float(np.max(np.abs(arr))) if arr.size else 0.0
    if peak > 1.0:
        arr = arr / peak
    return arr.astype(np.float32)


# ---------------------------------------------------------------------------
# Synthesis
# ---------------------------------------------------------------------------


def _schedule_self_exit(reason: str, delay_s: float = 1.5) -> None:
    """Plant ``os._exit(1)`` nach kurzer Wartezeit ein.

    Zwingende Last Resort wenn die CUDA-Generation hängt: der Thread
    lässt sich in Python nicht sauber killen, also killt der Prozess
    sich selbst. Docker sieht den Exit, der Arbiter started den
    Container beim nächsten TTS-Call neu. Die Wartezeit gibt uvicorn
    Zeit, den aktuellen 504-Response noch zu senden.
    """

    def kick() -> None:
        time.sleep(delay_s)
        log.error("self-exit triggered: %s — container needs restart", reason)
        os._exit(1)

    threading.Thread(target=kick, daemon=True).start()


def _run_with_heartbeat_and_timeout(
    func: Any,
    *,
    label: str,
    timeout_s: int,
) -> Any:
    """Runs ``func()`` in a thread, logs a heartbeat every
    ``HEARTBEAT_INTERVAL_S``, and aborts after ``timeout_s`` (HTTP
    504 + scheduled self-exit)."""
    result: dict[str, Any] = {}
    done = threading.Event()

    def worker() -> None:
        try:
            result["value"] = func()
        except BaseException as e:  # noqa: BLE001
            result["error"] = e
        finally:
            done.set()

    t_start = time.time()
    th = threading.Thread(target=worker, daemon=True)
    th.start()

    while not done.wait(HEARTBEAT_INTERVAL_S):
        elapsed = time.time() - t_start
        if elapsed >= timeout_s:
            log.error(
                "%s timed out after %.0fs (limit=%ds) — zombie generation, self-exit scheduled",
                label, elapsed, timeout_s,
            )
            _schedule_self_exit(f"{label} timeout ({elapsed:.0f}s)")
            raise HTTPException(
                status_code=504,
                detail=(
                    f"TTS generation stalled after {elapsed:.0f}s. The sidecar "
                    f"is restarting — please retry the request."
                ),
            )
        log.info(
            "%s :: still running, elapsed %.0fs (timeout in %.0fs)",
            label, elapsed, timeout_s - elapsed,
        )

    if "error" in result:
        raise result["error"]
    return result.get("value")


# --- Clone prompt cache ------------------------------------------------
# Qwen's official longform recommendation: run
# `create_voice_clone_prompt()` once per voice, then pass the resulting
# prompt into EVERY chunk via the `voice_clone_prompt=` kwarg —
# instead of re-extracting ref_audio every time. Speaker vector stays
# identical → consistent voice color across all chunks.
# See the Qwen README "Voice Design then Clone" section.
_CLONE_PROMPT_CACHE_MAX = int(os.environ.get("QWEN_TTS_CLONE_PROMPT_CACHE_SIZE", "8"))
_clone_prompt_cache: OrderedDict[str, Any] = OrderedDict()
_clone_prompt_cache_lock = threading.Lock()


def _clone_prompt_key(ref_audio: tuple[np.ndarray, int], ref_text: Optional[str]) -> str:
    arr, sr = ref_audio
    h = hashlib.sha256()
    # arr.tobytes() covers shape + values, sr and ref_text are
    # style-relevant; together they uniquely identify the clone prompt.
    h.update(arr.tobytes())
    h.update(str(sr).encode())
    h.update((ref_text or "").encode("utf-8"))
    return h.hexdigest()


def _get_clone_prompt(
    ref_audio: tuple[np.ndarray, int],
    ref_text: Optional[str],
) -> Any:
    key = _clone_prompt_key(ref_audio, ref_text)
    with _clone_prompt_cache_lock:
        cached = _clone_prompt_cache.get(key)
        if cached is not None:
            _clone_prompt_cache.move_to_end(key)
            return cached

    if _model is None:
        raise HTTPException(status_code=503, detail="base model not loaded")

    build_kwargs: dict[str, Any] = {"ref_audio": ref_audio}
    if ref_text and ref_text.strip():
        build_kwargs["ref_text"] = ref_text.strip()
    elif X_VECTOR_ONLY_FALLBACK:
        build_kwargs["x_vector_only_mode"] = True

    log.info(
        "clone-prompt compile: ref_samples=%d sr=%d ref_text_len=%d key=%s",
        len(ref_audio[0]), ref_audio[1], len(ref_text or ""), key[:8],
    )
    t0 = time.time()
    with torch.inference_mode():
        prompt = _model.create_voice_clone_prompt(**build_kwargs)
    log.info(
        "clone-prompt compile done in %.2fs (key=%s)",
        time.time() - t0, key[:8],
    )

    with _clone_prompt_cache_lock:
        _clone_prompt_cache[key] = prompt
        _clone_prompt_cache.move_to_end(key)
        while len(_clone_prompt_cache) > _CLONE_PROMPT_CACHE_MAX:
            _clone_prompt_cache.popitem(last=False)
    return prompt


def _synth_clone(
    text: str,
    ref_audio: tuple[np.ndarray, int],
    ref_text: Optional[str],
    language: str,
    seed: int,
    speed: float,
    max_new_tokens_override: Optional[int] = None,
    temperature: Optional[float] = None,
    top_p: Optional[float] = None,
    top_k: Optional[int] = None,
    repetition_penalty: Optional[float] = None,
    instruct: Optional[str] = None,
) -> tuple[np.ndarray, int]:
    if _model is None:
        raise HTTPException(
            status_code=503,
            detail=f"model not loaded ({_load_error or 'still initializing'})",
        )

    _apply_seed(seed)

    # Fetch the pre-compiled clone prompt (from cache or freshly built).
    # The same prompt object is used for all chunks of the same voice
    # → no speaker drift between chunks.
    clone_prompt = _get_clone_prompt(ref_audio, ref_text)

    effective_max = (
        max_new_tokens_override
        if max_new_tokens_override and max_new_tokens_override > 0
        else MAX_NEW_TOKENS
    )

    stopping_criteria, loop_detector = _build_stopping_criteria()
    gen_kwargs: dict[str, Any] = {
        "text": text,
        "language": language,
        "voice_clone_prompt": clone_prompt,
        "max_new_tokens": effective_max,
        **_resolve_sampling(temperature, top_p, top_k, repetition_penalty),
    }
    if stopping_criteria is not None:
        gen_kwargs["stopping_criteria"] = stopping_criteria
    # Optional speaking-style prompt — without it, Qwen drifts in
    # tempo between chunks because the reference audio alone doesn't
    # fix prosody. The model build accepts `instruct` on the clone
    # path; if a future Qwen version doesn't, the run loop catches
    # the TypeError and retries without the kwarg.
    if instruct and instruct.strip():
        gen_kwargs["instruct"] = instruct.strip()
    _ = speed  # speed cannot be set via this path (see older comment)

    # Request identifier for log grepping: 8-char hash from text +
    # seed + ref_audio shape. Makes it easy to identify the stuck
    # chunk inside a contiguous audiobook run.
    req_hash = hashlib.sha256(
        f"{text}|{seed}|{len(ref_audio[0])}".encode("utf-8")
    ).hexdigest()[:8]
    log.info(
        "clone start [%s] seed=%d lang=%s text[0:60]=%r ref_text[0:60]=%r ref_audio_samples=%d instruct[0:80]=%r kwargs=%s",
        req_hash, seed, language,
        text[:60], (ref_text or "")[:60], len(ref_audio[0]),
        (instruct or "")[:80],
        sorted(gen_kwargs.keys()),
    )
    t0 = time.time()

    def run() -> tuple[Any, Any]:
        try:
            with torch.inference_mode():
                wavs, sr = _model.generate_voice_clone(**gen_kwargs)
            return wavs, sr
        except TypeError as te:
            # Older Qwen3-TTS builds may not accept `instruct` on the
            # clone path — strip it and retry once. Any other TypeError
            # is a real bug and re-raises.
            if "instruct" in gen_kwargs and "instruct" in str(te):
                log.warning(
                    "generate_voice_clone [%s] rejected `instruct` kwarg — "
                    "retrying without it",
                    req_hash,
                )
                gen_kwargs.pop("instruct", None)
                with torch.inference_mode():
                    wavs, sr = _model.generate_voice_clone(**gen_kwargs)
                return wavs, sr
            log.exception("generate_voice_clone [%s] failed", req_hash)
            raise HTTPException(
                status_code=500, detail=f"generation failed: {te}"
            ) from te
        except Exception as e:  # noqa: BLE001
            log.exception("generate_voice_clone [%s] failed", req_hash)
            raise HTTPException(
                status_code=500, detail=f"generation failed: {e}"
            ) from e

    wavs, sr = _run_with_heartbeat_and_timeout(
        run, label=f"synth [{req_hash}]", timeout_s=GENERATION_TIMEOUT_S
    )

    elapsed = time.time() - t0
    if loop_detector is not None and loop_detector.triggered:
        log.warning(
            "synth [%s] LOOP DETECTED at token %d (unique=%d ≤ %d in last %d) — abort after %.1fs",
            req_hash,
            loop_detector.trigger_at_token,
            loop_detector.trigger_unique,
            LOOP_MAX_UNIQUE,
            LOOP_WINDOW,
            elapsed,
        )
        raise HTTPException(
            status_code=503,
            detail=(
                f"loop_detected: AR decoder cycled through "
                f"{loop_detector.trigger_unique} tokens in the last "
                f"{LOOP_WINDOW} (threshold {LOOP_MAX_UNIQUE}) — "
                f"retry with a different seed"
            ),
        )
    if wavs is None or len(wavs) == 0:
        log.error("synth [%s] returned empty waveform after %.1fs", req_hash, elapsed)
        raise HTTPException(status_code=500, detail="model returned empty waveform")

    samples = _normalize_samples(np.asarray(wavs[0]))
    audio_s = samples.shape[0] / float(sr) if sr else 0.0
    log.info(
        "synth done  [%s] in %.1fs (audio=%.1fs, rt=%.2fx)",
        req_hash, elapsed, audio_s, elapsed / audio_s if audio_s > 0 else 0.0,
    )
    return samples, int(sr)


def _synth_custom(
    text: str,
    speaker: str,
    instruct: Optional[str],
    language: str,
    seed: int,
    temperature: Optional[float] = None,
    top_p: Optional[float] = None,
    top_k: Optional[int] = None,
    repetition_penalty: Optional[float] = None,
    max_new_tokens_override: Optional[int] = None,
) -> tuple[np.ndarray, int]:
    """Synthesis via the CustomVoice model. `speaker` must be one of the
    nine presets; `instruct` is free text ("Calm narrator, slow pace")
    or empty.

    Sampling dials are forwarded 1:1 to Qwen — anything left as ``None``
    falls back to the ENV-provided defaults via ``_resolve_sampling``.
    Lower ``temperature`` (0.3-0.6) reduces accent drift in long body
    text (the model sticks closer to the instruction prompt) at the
    cost of slightly flatter prosody.

    There is no per-chunk style drift because the preset speaker is
    baked into the weights — but within a single very long chunk the
    autoregressive decoder can drift toward the speaker's native
    language (e.g. Vivian → Chinese). Lower temperature mitigates that.
    """
    if speaker not in CUSTOMVOICE_PRESETS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"unknown speaker {speaker!r}; erlaubte Presets: "
                f"{', '.join(CUSTOMVOICE_PRESETS)}"
            ),
        )

    _load_customvoice_model()
    if _custom_model is None:
        raise HTTPException(
            status_code=503,
            detail=f"customvoice not loaded ({_custom_load_error or 'still initializing'})",
        )

    _apply_seed(seed)

    effective_max = (
        max_new_tokens_override
        if max_new_tokens_override and max_new_tokens_override > 0
        else MAX_NEW_TOKENS
    )
    stopping_criteria, loop_detector = _build_stopping_criteria()
    gen_kwargs: dict[str, Any] = {
        "text": text,
        "language": language,
        "speaker": speaker,
        "max_new_tokens": effective_max,
        **_resolve_sampling(temperature, top_p, top_k, repetition_penalty),
    }
    if stopping_criteria is not None:
        gen_kwargs["stopping_criteria"] = stopping_criteria
    if instruct and instruct.strip():
        gen_kwargs["instruct"] = instruct.strip()

    req_hash = hashlib.sha256(
        f"{text}|{seed}|{speaker}|{instruct or ''}".encode("utf-8")
    ).hexdigest()[:8]
    log.info(
        "customvoice start [%s] seed=%d speaker=%s lang=%s text[0:60]=%r instruct[0:80]=%r kwargs=%s",
        req_hash, seed, speaker, language,
        text[:60], (instruct or "")[:80],
        sorted(gen_kwargs.keys()),
    )
    t0 = time.time()

    def run() -> tuple[Any, Any]:
        try:
            with torch.inference_mode():
                wavs, sr = _custom_model.generate_custom_voice(**gen_kwargs)
            return wavs, sr
        except Exception as e:  # noqa: BLE001
            log.exception("generate_custom_voice [%s] failed", req_hash)
            raise HTTPException(
                status_code=500, detail=f"generation failed: {e}"
            ) from e

    wavs, sr = _run_with_heartbeat_and_timeout(
        run, label=f"customvoice [{req_hash}]", timeout_s=GENERATION_TIMEOUT_S
    )

    elapsed = time.time() - t0
    if loop_detector is not None and loop_detector.triggered:
        log.warning(
            "customvoice [%s] LOOP DETECTED at token %d (unique=%d ≤ %d in last %d) — abort after %.1fs",
            req_hash,
            loop_detector.trigger_at_token,
            loop_detector.trigger_unique,
            LOOP_MAX_UNIQUE,
            LOOP_WINDOW,
            elapsed,
        )
        raise HTTPException(
            status_code=503,
            detail=(
                f"loop_detected: AR decoder cycled through "
                f"{loop_detector.trigger_unique} tokens in the last "
                f"{LOOP_WINDOW} (threshold {LOOP_MAX_UNIQUE}) — "
                f"retry with a different seed"
            ),
        )
    if wavs is None or len(wavs) == 0:
        log.error(
            "customvoice [%s] returned empty waveform after %.1fs",
            req_hash, elapsed,
        )
        raise HTTPException(status_code=500, detail="model returned empty waveform")

    samples = _normalize_samples(np.asarray(wavs[0]))
    audio_s = samples.shape[0] / float(sr) if sr else 0.0
    log.info(
        "customvoice done  [%s] in %.1fs (audio=%.1fs, rt=%.2fx)",
        req_hash, elapsed, audio_s,
        elapsed / audio_s if audio_s > 0 else 0.0,
    )
    return samples, int(sr)


def _synth_design(
    text: str,
    voice_description: str,
    language: str,
    seed: int,
    temperature: Optional[float] = None,
    top_p: Optional[float] = None,
    top_k: Optional[int] = None,
    repetition_penalty: Optional[float] = None,
    max_new_tokens_override: Optional[int] = None,
) -> tuple[np.ndarray, int]:
    """Synthesis via the VoiceDesign model. `voice_description` lands
    in the `instruct` parameter (the model has no separate speaker
    slot — the entire voice spec sits in the description text).

    Seed semantics are not guaranteed by the model card, but
    ``torch.manual_seed(seed)`` before the call works empirically —
    same seed + same description reproduces the same voice in most
    cases.
    """
    if not voice_description or not voice_description.strip():
        raise HTTPException(
            status_code=400,
            detail="voice_description must not be empty (VoiceDesign path)",
        )

    _load_voicedesign_model()
    if _design_model is None:
        raise HTTPException(
            status_code=503,
            detail=f"voicedesign not loaded ({_design_load_error or 'still initializing'})",
        )

    _apply_seed(seed)

    effective_max = (
        max_new_tokens_override
        if max_new_tokens_override and max_new_tokens_override > 0
        else MAX_NEW_TOKENS
    )
    stopping_criteria, loop_detector = _build_stopping_criteria()
    gen_kwargs: dict[str, Any] = {
        "text": text,
        "language": language,
        "instruct": voice_description.strip(),
        "max_new_tokens": effective_max,
        **_resolve_sampling(temperature, top_p, top_k, repetition_penalty),
    }
    if stopping_criteria is not None:
        gen_kwargs["stopping_criteria"] = stopping_criteria

    req_hash = hashlib.sha256(
        f"{text}|{seed}|{voice_description}".encode("utf-8")
    ).hexdigest()[:8]
    log.info(
        "voicedesign start [%s] seed=%d lang=%s text[0:60]=%r description[0:120]=%r kwargs=%s",
        req_hash, seed, language,
        text[:60], voice_description[:120],
        sorted(gen_kwargs.keys()),
    )
    t0 = time.time()

    def run() -> tuple[Any, Any]:
        # Re-apply seed in the worker thread. `torch.manual_seed` is
        # process-global, but if entropy is consumed between
        # main-thread seeding and thread start (or Qwen creates its
        # own generator internally), generate ends up with a different
        # RNG state. Belt and suspenders, and the official Qwen docs
        # don't guarantee seeding behavior anyway.
        _apply_seed(seed)
        # Explicit generator on top. If `generate_voice_design`
        # accepts it as a kwarg (HF generate stack), Qwen uses this
        # generator internally instead of the global RNG. If the
        # model doesn't accept the kwarg, ignores it, or raises, we
        # catch and fall back to plain manual_seed.
        final_kwargs = dict(gen_kwargs)
        try:
            gen_device = DEVICE if DEVICE.startswith("cuda") else "cpu"
            final_kwargs["generator"] = torch.Generator(
                device=gen_device
            ).manual_seed(seed)
        except Exception as e:  # noqa: BLE001
            log.warning(
                "voicedesign [%s]: could not create generator (%r), " +
                "continuing with manual_seed only", req_hash, e,
            )

        try:
            with torch.inference_mode():
                try:
                    wavs, sr = _design_model.generate_voice_design(**final_kwargs)
                except TypeError as e:
                    # generator kwarg wasn't accepted — retry without.
                    if "generator" in final_kwargs and "generator" in str(e):
                        log.warning(
                            "voicedesign [%s]: generator-kwarg rejected (%s), retrying without",
                            req_hash, e,
                        )
                        final_kwargs.pop("generator", None)
                        _apply_seed(seed)  # re-seed before retry
                        wavs, sr = _design_model.generate_voice_design(**final_kwargs)
                    else:
                        raise
            return wavs, sr
        except HTTPException:
            raise
        except Exception as e:  # noqa: BLE001
            log.exception("generate_voice_design [%s] failed", req_hash)
            raise HTTPException(
                status_code=500, detail=f"generation failed: {e}"
            ) from e

    wavs, sr = _run_with_heartbeat_and_timeout(
        run, label=f"voicedesign [{req_hash}]", timeout_s=GENERATION_TIMEOUT_S
    )

    elapsed = time.time() - t0
    if loop_detector is not None and loop_detector.triggered:
        log.warning(
            "voicedesign [%s] LOOP DETECTED at token %d (unique=%d ≤ %d in last %d) — abort after %.1fs",
            req_hash,
            loop_detector.trigger_at_token,
            loop_detector.trigger_unique,
            LOOP_MAX_UNIQUE,
            LOOP_WINDOW,
            elapsed,
        )
        raise HTTPException(
            status_code=503,
            detail=(
                f"loop_detected: AR decoder cycled through "
                f"{loop_detector.trigger_unique} tokens in the last "
                f"{LOOP_WINDOW} (threshold {LOOP_MAX_UNIQUE}) — "
                f"retry with a different seed"
            ),
        )
    if wavs is None or len(wavs) == 0:
        log.error(
            "voicedesign [%s] returned empty waveform after %.1fs",
            req_hash, elapsed,
        )
        raise HTTPException(status_code=500, detail="model returned empty waveform")

    samples = _normalize_samples(np.asarray(wavs[0]))
    audio_s = samples.shape[0] / float(sr) if sr else 0.0
    log.info(
        "voicedesign done  [%s] in %.1fs (audio=%.1fs, rt=%.2fx)",
        req_hash, elapsed, audio_s,
        elapsed / audio_s if audio_s > 0 else 0.0,
    )
    return samples, int(sr)


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("=" * 64)
    log.info("pm-qwen-tts starting up")
    log.info("  base-slot model     : %s", MODEL_ID)
    log.info("  customvoice model   : %s (lazy)", CUSTOMVOICE_MODEL_ID)
    log.info("  voicedesign model   : %s (lazy)", VOICEDESIGN_MODEL_ID)
    log.info("  device=%s dtype=%s attn=%s", DEVICE, DTYPE_NAME, ATTN_IMPL)
    log.info(
        "  generation_timeout=%ds ref_cache=%d",
        GENERATION_TIMEOUT_S, _REF_AUDIO_CACHE_MAX,
    )
    if MODEL_ID == CUSTOMVOICE_MODEL_ID:
        log.warning(
            "MODEL_ID == CUSTOMVOICE_MODEL_ID — "
            "you're loading CustomVoice into both slots. The voice "
            "clone path (ref_audio_b64) will then run against the "
            "CustomVoice weights and may fail unexpectedly. If you "
            "only use presets, that's OK; if you also upload your own "
            "samples, set "
            "QWEN_TTS_MODEL=Qwen/Qwen3-TTS-12Hz-1.7B-Base (or unset)."
        )
    log.info("=" * 64)
    _load_model()  # blocks startup until model (or load error) is ready
    yield


app = FastAPI(title="pm-qwen-tts", lifespan=lifespan)


@app.get("/health")
async def health():
    # The base model is loaded by the startup gate (lifespan) — if it
    # doesn't make it through, the sidecar is completely broken.
    # CustomVoice is lazy-loaded so it's deliberately missing from
    # the ready condition (would otherwise stay "healthy=false" until
    # someone uses a preset).
    if _model is None:
        return JSONResponse(
            status_code=503,
            content={
                "ok": False,
                "reason": _load_error or "model_not_loaded",
                "model": MODEL_ID,
            },
        )
    return {
        "ok": True,
        "base_model": MODEL_ID,
        "customvoice_model": CUSTOMVOICE_MODEL_ID,
        "customvoice_loaded": _custom_model is not None,
        "customvoice_error": _custom_load_error,
        "voicedesign_model": VOICEDESIGN_MODEL_ID,
        "voicedesign_loaded": _design_model is not None,
        "voicedesign_error": _design_load_error,
        "max_new_tokens": MAX_NEW_TOKENS,
        "generation_timeout_s": GENERATION_TIMEOUT_S,
        "sampling_defaults": {
            "do_sample": True,
            "temperature": DEFAULT_TEMPERATURE,
            "top_p": DEFAULT_TOP_P,
            "top_k": DEFAULT_TOP_K,
            "repetition_penalty": DEFAULT_REPETITION_PENALTY,
            "subtalker_dosample": DEFAULT_SUBTALKER_DOSAMPLE,
            "subtalker_temperature": DEFAULT_SUBTALKER_TEMPERATURE,
            "subtalker_top_p": DEFAULT_SUBTALKER_TOP_P,
            "subtalker_top_k": DEFAULT_SUBTALKER_TOP_K,
        },
        "loop_detection": {
            "enabled": LOOP_DETECTION_ENABLED,
            "window": LOOP_WINDOW,
            "max_unique": LOOP_MAX_UNIQUE,
            "min_tokens": LOOP_MIN_TOKENS,
        },
    }


@app.get("/diagnostics/recent-logs")
async def recent_logs(since: int = 0):
    """Pull the in-memory log ring for the PageMentor backend's
    sidecar-log-pump. ``since`` is a unix-ms timestamp; only entries
    strictly newer are returned. The PageMentor Logs page uses this to
    interleave sidecar lines into its merged log stream.

    Returns ``{"source": "qwen-tts", "lines": [...]}`` so the backend
    can also point this endpoint at the arbiter without changing
    callers — the arbiter is a separate process and would label its
    own lines ``arbiter``.
    """
    return {
        "source": "qwen-tts",
        "lines": _log_ring.snapshot(since_ts=since),
    }


@app.get("/v1/audio/voices")
async def list_voices():
    # No more built-in voices — voice management lives in the
    # PageMentor backend (uploads + DB). Here we only return metadata
    # so the sidecar can also be checked solo.
    return {
        "base_model": MODEL_ID,
        "customvoice_model": CUSTOMVOICE_MODEL_ID,
        "voicedesign_model": VOICEDESIGN_MODEL_ID,
        "customvoice_presets": CUSTOMVOICE_PRESETS,
        "voices": [],
        "accepts_voice_clone": True,
        "accepts_customvoice": True,
        "accepts_voicedesign": True,
        "required_fields_clone": ["input", "ref_audio_b64"],
        "required_fields_preset": ["input", "speaker"],
        "required_fields_design": ["input", "voice_description"],
    }


class SpeechRequest(BaseModel):
    # OpenAI-kompat-Felder (werden teilweise ignoriert):
    model: Optional[str] = None
    input: str = Field(..., min_length=1)
    voice: Optional[str] = None          # logging/diagnostics only
    response_format: Literal["mp3", "wav", "flac"] = "mp3"
    speed: float = 1.0

    # Dispatch: exactly ONE of the following paths must be set.
    # If `speaker` is set → CustomVoice path (preset + instruction).
    # Otherwise → voice-clone path via `ref_audio_b64` + optional `ref_text`.

    # Voice clone fields (optional when speaker is set):
    ref_audio_b64: Optional[str] = None
    ref_text: Optional[str] = None

    # CustomVoice fields (optional when ref_audio_b64 is set):
    speaker: Optional[str] = None
    instruct: Optional[str] = None

    # VoiceDesign field — when set, overrides all other paths and
    # routes to `generate_voice_design`. The description IS the style
    # prompt at the same time (no separate instruct slot in the
    # VoiceDesign model).
    voice_description: Optional[str] = None

    language: str = DEFAULT_LANGUAGE
    seed: int = 0

    # Advanced sampling parameters — all optional. ``None`` falls back
    # to the QWEN_TTS_DEFAULT_* ENV defaults (resolved in
    # ``_resolve_sampling``). Forwarded 1:1 to all three generate
    # paths. Tuning recipe (community + official issues):
    #   - lower temperature (0.5-0.75) reduces chunk-to-chunk drift
    #   - top_p tighter than 0.9 (try 0.7-0.85) for stable timbre
    #   - top_k caps the long-tail random tokens
    #   - repetition_penalty > 1.0 fights the looping garble bug
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    top_k: Optional[int] = None
    repetition_penalty: Optional[float] = None
    max_new_tokens_override: Optional[int] = None


# IMPORTANT: `def` instead of `async def`. The synth call blocks for
# minutes (threading.Event.wait inside the heartbeat wrapper). An
# `async def` handler would block the asyncio event loop until
# generation is done → the Docker healthcheck on /health gets no
# response and the container is marked unhealthy. FastAPI runs `def`
# handlers in a thread pool automatically; the event loop stays
# responsive.
@app.post("/v1/audio/speech")
def speech(req: SpeechRequest):
    use_design = bool(req.voice_description and req.voice_description.strip())
    use_custom = bool(req.speaker and req.speaker.strip())
    if use_design:
        samples, sr = _synth_design(
            text=req.input,
            voice_description=req.voice_description,  # type: ignore[arg-type]
            language=req.language,
            seed=req.seed,
            temperature=req.temperature,
            top_p=req.top_p,
            top_k=req.top_k,
            repetition_penalty=req.repetition_penalty,
            max_new_tokens_override=req.max_new_tokens_override,
        )
    elif use_custom:
        samples, sr = _synth_custom(
            text=req.input,
            speaker=req.speaker.strip(),  # type: ignore[union-attr]
            instruct=req.instruct,
            language=req.language,
            seed=req.seed,
            temperature=req.temperature,
            top_p=req.top_p,
            top_k=req.top_k,
            repetition_penalty=req.repetition_penalty,
            max_new_tokens_override=req.max_new_tokens_override,
        )
    else:
        if not req.ref_audio_b64 or not req.ref_audio_b64.strip():
            raise HTTPException(
                status_code=400,
                detail=(
                    "request must contain either `speaker` (CustomVoice "
                    "preset) or `ref_audio_b64` (voice clone)."
                ),
            )
        ref_audio = _decode_ref_audio(req.ref_audio_b64)
        samples, sr = _synth_clone(
            text=req.input,
            ref_audio=ref_audio,
            ref_text=req.ref_text,
            language=req.language,
            seed=req.seed,
            speed=req.speed,
            temperature=req.temperature,
            top_p=req.top_p,
            top_k=req.top_k,
            repetition_penalty=req.repetition_penalty,
            max_new_tokens_override=req.max_new_tokens_override,
            instruct=req.instruct,
        )
    body, ctype = _encode_audio(samples, sr, req.response_format)
    return Response(content=body, media_type=ctype)
