"""GPU-Besitz: immer nur LLM oder eine TTS-Engine im VRAM."""

from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager

import containers
import ollama
from config import TTS_IDLE_LINGER_SECONDS, Engine, gpu_engines
from state import log, state

# Verzögerter Stopp je Engine, beim nächsten Zugriff verworfen
_idle_tasks: dict[str, asyncio.Task[None]] = {}


def cancel_idle_stops() -> None:
    for t in _idle_tasks.values():
        if not t.done():
            t.cancel()
    _idle_tasks.clear()


def idle_pending() -> list[str]:
    return [name for name, t in _idle_tasks.items() if not t.done()]


async def _idle_stop(engine: Engine, linger: int) -> None:
    try:
        await asyncio.sleep(linger)
    except asyncio.CancelledError:
        return
    # Lock: nicht in eine laufende Anfrage hinein stoppen
    async with state.lock:
        if state.owner != "idle":
            return
        try:
            if await containers.is_running(engine.container):
                log.info("tts %s idle linger (%ss) expired → stopping", engine.name, linger)
                await containers.stop(engine.container)
        except Exception as e:  # noqa: BLE001
            log.warning("idle stop failed: %r", e)


async def stop_tts_except(keep: str | None = None) -> None:
    for e in gpu_engines():
        if e.name != keep:
            await containers.stop(e.container)


async def _prepare_tts(engine: Engine) -> None:
    # Andere Engines raus, sie belegen sonst VRAM
    await stop_tts_except(engine.name)
    # Läuft dank Linger noch: Entladen und Start sparen
    if not await containers.is_running(engine.container):
        await ollama.unload_all()
        await containers.start_engine_and_wait(engine)


def _schedule_stop(engine: Engine) -> None:
    if TTS_IDLE_LINGER_SECONDS > 0:
        _idle_tasks[engine.name] = asyncio.create_task(_idle_stop(engine, TTS_IDLE_LINGER_SECONDS))
        log.info("tts %s done — linger %ss before stop", engine.name, TTS_IDLE_LINGER_SECONDS)
    else:
        asyncio.create_task(containers.stop(engine.container))


@asynccontextmanager
async def own_gpu(engine: Engine | None):
    """engine=None: LLM. Sonst die TTS-Engine."""
    state.queue_depth += 1
    cancel_idle_stops()
    try:
        async with state.lock:
            state.owner = f"tts:{engine.name}" if engine else "llm"
            state.since = time.time()
            try:
                if engine is None:
                    await stop_tts_except(None)
                else:
                    await _prepare_tts(engine)
                try:
                    yield
                finally:
                    if engine is not None:
                        _schedule_stop(engine)
            finally:
                state.owner = "idle"
                state.since = time.time()
    finally:
        state.queue_depth = max(0, state.queue_depth - 1)
