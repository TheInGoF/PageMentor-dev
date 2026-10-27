"""Docker-Helfer; blockierende Aufrufe laufen über asyncio.to_thread."""

from __future__ import annotations

import asyncio
import time

import docker.errors

from config import TTS_STARTUP_TIMEOUT, Engine
from state import clients, http, log


def _get(name: str):
    assert clients.docker is not None
    try:
        return clients.docker.containers.get(name)
    except docker.errors.NotFound:
        return None


def status_sync(name: str) -> str:
    c = _get(name)
    if c is None:
        return "missing"
    c.reload()
    return c.status


def _stop_sync(name: str) -> None:
    c = _get(name)
    if c is None:
        return
    c.reload()
    if c.status == "running":
        log.info("stopping container %s", name)
        c.stop(timeout=10)


def _start_sync(name: str) -> None:
    c = _get(name)
    if c is None:
        raise RuntimeError(f"container {name!r} is not defined — check docker-compose")
    c.reload()
    if c.status != "running":
        log.info("starting container %s", name)
        c.start()


async def status(name: str) -> str:
    return await asyncio.to_thread(status_sync, name)


async def is_running(name: str) -> bool:
    try:
        return await status(name) == "running"
    except Exception:  # noqa: BLE001
        return False


async def stop(name: str) -> None:
    await asyncio.to_thread(_stop_sync, name)


async def wait_healthy(url: str, timeout: float) -> tuple[bool, str | None]:
    deadline = time.time() + timeout
    last_err: str | None = None
    while time.time() < deadline:
        try:
            r = await http().get(url, timeout=3.0)
            if r.status_code == 200:
                return True, None
            last_err = f"HTTP {r.status_code}"
        except Exception as e:  # noqa: BLE001
            last_err = repr(e)
        await asyncio.sleep(1.0)
    return False, last_err


async def start_engine_and_wait(engine: Engine) -> None:
    t0 = time.time()
    await asyncio.to_thread(_start_sync, engine.container)
    ok, err = await wait_healthy(f"{engine.url}/health", TTS_STARTUP_TIMEOUT)
    if not ok:
        raise TimeoutError(
            f"TTS {engine.name} did not become healthy within {TTS_STARTUP_TIMEOUT}s (last error: {err})"
        )
    log.info("tts %s healthy after %.1fs", engine.name, time.time() - t0)


async def hard_restart(name: str, wait_url: str | None = None, wait_timeout: float = 90.0) -> dict[str, str]:
    """Stopp, kurz warten, Start, optional auf /health warten."""
    before = await status(name)
    await stop(name)
    # Docker braucht kurz, um die GPU freizugeben
    await asyncio.sleep(2)
    await asyncio.to_thread(_start_sync, name)
    healthy = "skipped"
    if wait_url is not None:
        t0 = time.time()
        ok, err = await wait_healthy(wait_url, wait_timeout)
        healthy = f"ok after {time.time() - t0:.1f}s" if ok else f"timeout after {wait_timeout:.0f}s (last={err})"
        if not ok:
            log.warning("hard-restart of %s: health-check failed: %s", name, err)
    return {"before": before, "after": await status(name), "healthy": healthy}
