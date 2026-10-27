"""Ollama: geladene Modelle lesen und entladen."""

from __future__ import annotations

import json

from config import OLLAMA_URL
from state import http, log, state


async def loaded_models() -> list[str]:
    try:
        r = await http().get(f"{OLLAMA_URL}/api/ps", timeout=10.0)
        r.raise_for_status()
        data = r.json()
    except Exception as e:  # noqa: BLE001
        log.warning("could not read /api/ps: %r", e)
        return []
    models = [m.get("name") or m.get("model") for m in data.get("models", []) if m]
    return [m for m in models if m]


async def unload(models: list[str]) -> None:
    """Per keep_alive=0 entladen; Fehler nur loggen."""
    for model in models:
        try:
            await http().post(
                f"{OLLAMA_URL}/api/generate",
                json={"model": model, "prompt": "", "keep_alive": 0},
                timeout=30.0,
            )
        except Exception as e:  # noqa: BLE001
            log.warning("unload failed for %s: %r", model, e)


async def unload_all() -> None:
    models = await loaded_models()
    if models:
        log.info("unloading Ollama models: %s", ", ".join(models))
        await unload(models)
    state.loaded_model = None


async def ensure_single_resident(desired: str | None) -> None:
    """Nur ein Modell im VRAM; None = unbekannt, nichts tun."""
    if not desired:
        return
    stale = [m for m in await loaded_models() if m != desired]
    if stale:
        log.info("single-model mode: '%s' wants the GPU — evicting %s", desired, ", ".join(stale))
        await unload(stale)
    state.loaded_model = desired


def peek_model(path: str, body: bytes) -> str | None:
    """Modell aus chat, generate oder embed lesen."""
    if not body or not path.startswith(("chat", "generate", "embeddings", "embed")):
        return None
    try:
        payload = json.loads(body)
    except Exception:  # noqa: BLE001
        return None
    m = payload.get("model") if isinstance(payload, dict) else None
    return m if isinstance(m, str) and m else None
