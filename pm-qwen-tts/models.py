"""Modelle laden: Basis sofort, CustomVoice und VoiceDesign lazy."""

from __future__ import annotations

import os
import threading
import time
from typing import Optional

from logs import log
from config import (
    ATTN_IMPL,
    CUSTOMVOICE_MODEL_ID,
    DEVICE,
    DTYPE_NAME,
    MODEL_ID,
    TOKENIZER_ID,
    VOICEDESIGN_MODEL_ID,
    _torch_dtype,
)


_model = None
_load_error: Optional[str] = None

# CustomVoice lazy: ohne Presets keine ~4 GB VRAM extra
_custom_model = None
_custom_load_error: Optional[str] = None
_custom_load_lock = threading.Lock()

# VoiceDesign lazy: weitere ~4 GB, drei Modelle erst ab 32 GB realistisch
_design_model = None
_design_load_error: Optional[str] = None
_design_load_lock = threading.Lock()


def _prepare_model_path() -> str:
    """Basismodell + Audio-Tokenizer laden, Tokenizer als speech_tokenizer/ verlinken.

    Idempotent. Liefert den lokalen Pfad des Basis-Snapshots.
    """
    from huggingface_hub import snapshot_download  # noqa: WPS433

    log.info("resolving %s (base model)", MODEL_ID)
    base_dir = snapshot_download(repo_id=MODEL_ID)
    log.info("resolving %s (audio tokenizer)", TOKENIZER_ID)
    tokenizer_dir = snapshot_download(repo_id=TOKENIZER_ID)

    target = os.path.join(base_dir, "speech_tokenizer")

    if os.path.islink(target):
        # Link vorhanden: Ziel prüfen, Snapshot-Hash kann sich ändern
        current = os.readlink(target)
        if os.path.realpath(current) != os.path.realpath(tokenizer_dir):
            log.info("updating stale tokenizer symlink %s → %s", target, tokenizer_dir)
            os.remove(target)
            os.symlink(tokenizer_dir, target, target_is_directory=True)
        return base_dir

    if os.path.isdir(target):
        # Schon vom Upstream mitgeliefert: nichts tun
        log.info("speech_tokenizer/ already present in base snapshot")
        return base_dir

    log.info("symlinking %s → %s/speech_tokenizer", tokenizer_dir, base_dir)
    try:
        os.symlink(tokenizer_dir, target, target_is_directory=True)
    except OSError as e:
        # Fallback ohne Symlink-Unterstützung
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
    """CustomVoice lazy laden, idempotent und thread-sicher.

    Gleiches Repo wie das Basismodell: Instanz teilen statt doppelt laden.
    Fehler landet in _custom_load_error, Anfrage bekommt 503.
    """
    global _custom_model, _custom_load_error
    if _custom_model is not None or _custom_load_error is not None:
        return

    with _custom_load_lock:
        # Nach dem Lock nochmal prüfen
        if _custom_model is not None or _custom_load_error is not None:
            return

        # Gleiches Repo wie MODEL_ID: wiederverwenden
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
    """VoiceDesign lazy laden, wie _load_customvoice_model."""
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
