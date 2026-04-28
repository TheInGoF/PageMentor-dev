"""PageMentor GPU Arbiter.

Transparent reverse proxy in front of Ollama and a TTS sidecar
(currently ``pm-qwen-tts``). Serializes GPU access via
``asyncio.Lock`` (queue mode, nothing is dropped):

- ``/api/*``       → Ollama mode: stops the TTS container, forwards the request.
- ``/v1/audio/*``  → TTS mode: unloads Ollama models, starts the TTS
  container, forwards the request, stops TTS again right after the
  response.

The arbiter is TTS-engine-agnostic — as long as the sidecar exposes a
``/health`` endpoint under ``TTS_UPSTREAM_URL`` and accepts requests
under ``/v1/audio/*`` (OpenAI shape), the setup works.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, Literal

import docker
import docker.errors
import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from proxy import proxy_stream

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
log = logging.getLogger("arbiter")

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://ollama:11434").rstrip("/")

# TTS upstream (historically "VIBEVOICE_*" — both names are still
# read so older compose files keep working without a breaking change).
TTS_URL = os.environ.get(
    "TTS_UPSTREAM_URL",
    os.environ.get("VIBEVOICE_URL", "http://qwen-tts:8880"),
).rstrip("/")
TTS_CONTAINER = os.environ.get(
    "TTS_CONTAINER",
    os.environ.get("VIBEVOICE_CONTAINER", "pm-qwen-tts"),
)
# Optional: when set, the GPU-reset button issues a hard
# stop+start on the Ollama container, not just a model unload via
# /api/ps. Use this when the Ollama process itself wedges (504 on
# /api/generate, sticks at 100 % GPU, …). Empty = unload-only.
OLLAMA_CONTAINER = os.environ.get("OLLAMA_CONTAINER", "").strip()
TTS_API_KEY = os.environ.get(
    "TTS_API_KEY", os.environ.get("VIBEVOICE_API_KEY", "")
)
TTS_STARTUP_TIMEOUT = int(
    os.environ.get(
        "TTS_STARTUP_TIMEOUT",
        os.environ.get("VIBEVOICE_STARTUP_TIMEOUT", "180"),
    )
)
# After a TTS call the container stays alive for N seconds. If
# another TTS call arrives in that time, no reboot is needed (saves
# ~7 s per chunk in audiobook batches). An intervening LLM call still
# stops the container immediately (in the own_gpu("llm") enter path).
# Set to 0 = old behavior (immediate stop).
TTS_IDLE_LINGER_SECONDS = int(os.environ.get("TTS_IDLE_LINGER_SECONDS", "60"))
PROXY_REQUEST_TIMEOUT = float(os.environ.get("PROXY_REQUEST_TIMEOUT", "1800"))

Owner = Literal["idle", "llm", "tts"]

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------


@dataclass
class ArbiterState:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    owner: Owner = "idle"
    since: float = field(default_factory=time.time)
    queue_depth: int = 0

    def snapshot(self) -> dict[str, Any]:
        return {
            "owner": self.owner,
            "since_seconds": round(time.time() - self.since, 3),
            "queue_depth": self.queue_depth,
        }


state = ArbiterState()

http_client: httpx.AsyncClient | None = None
docker_client: docker.DockerClient | None = None

# Idle-linger task: set when the stop after a TTS call should be
# delayed. Cancelled by the next own_gpu entry.
_tts_idle_task: asyncio.Task[None] | None = None


def _cancel_pending_tts_stop() -> None:
    """Discards a scheduled idle stop (because a new request is going
    to use or hard-stop the container momentarily anyway)."""
    global _tts_idle_task
    t = _tts_idle_task
    _tts_idle_task = None
    if t is not None and not t.done():
        t.cancel()


async def _idle_stop_tts(linger_seconds: int) -> None:
    """Waits ``linger_seconds`` then stops pm-qwen-tts if the GPU
    stayed idle. Cancel with ``task.cancel()`` when a new request
    arrives."""
    try:
        await asyncio.sleep(linger_seconds)
    except asyncio.CancelledError:
        return
    # Take the lock so we don't stop into a running request.
    async with state.lock:
        if state.owner != "idle":
            return  # Active request — it handles itself
        try:
            status = await asyncio.to_thread(_container_status, TTS_CONTAINER)
            if status == "running":
                log.info("tts idle linger (%ss) expired → stopping", linger_seconds)
                await _stop_tts()
        except Exception as e:  # noqa: BLE001
            log.warning("idle stop failed: %r", e)


# ---------------------------------------------------------------------------
# Docker helpers (docker-py is blocking → asyncio.to_thread)
# ---------------------------------------------------------------------------


def _get_container(name: str):
    assert docker_client is not None
    try:
        return docker_client.containers.get(name)
    except docker.errors.NotFound:
        return None


def _container_status(name: str) -> str:
    c = _get_container(name)
    if c is None:
        return "missing"
    c.reload()
    return c.status


def _stop_container_sync(name: str) -> None:
    c = _get_container(name)
    if c is None:
        return
    c.reload()
    if c.status == "running":
        log.info("stopping container %s", name)
        c.stop(timeout=10)


def _start_container_sync(name: str) -> None:
    c = _get_container(name)
    if c is None:
        raise RuntimeError(f"container {name!r} is not defined — check docker-compose")
    c.reload()
    if c.status != "running":
        log.info("starting container %s", name)
        c.start()


async def _stop_tts() -> None:
    await asyncio.to_thread(_stop_container_sync, TTS_CONTAINER)


async def _hard_restart_container(name: str) -> dict[str, str]:
    """stop → settle → start. Used by the GPU-reset button so the
    container isn't just stopped (waiting for the next call to bring
    it up) but is actively brought back to a clean ready state."""
    before = await asyncio.to_thread(_container_status, name)
    await asyncio.to_thread(_stop_container_sync, name)
    # Brief settle so docker has a chance to release the GPU before
    # we ask it to bring the same container up again.
    await asyncio.sleep(2)
    await asyncio.to_thread(_start_container_sync, name)
    after = await asyncio.to_thread(_container_status, name)
    return {"before": before, "after": after}


async def _start_tts_and_wait() -> None:
    await asyncio.to_thread(_start_container_sync, TTS_CONTAINER)
    assert http_client is not None
    deadline = time.time() + TTS_STARTUP_TIMEOUT
    last_err: Exception | None = None
    while time.time() < deadline:
        try:
            r = await http_client.get(f"{TTS_URL}/health", timeout=2.0)
            if r.status_code == 200:
                log.info(
                    "tts healthy after %.1fs",
                    TTS_STARTUP_TIMEOUT - (deadline - time.time()),
                )
                return
        except Exception as e:  # noqa: BLE001
            last_err = e
        await asyncio.sleep(1.0)
    raise TimeoutError(
        f"TTS did not become healthy within {TTS_STARTUP_TIMEOUT}s "
        f"(last error: {last_err!r})"
    )


# ---------------------------------------------------------------------------
# Ollama helpers
# ---------------------------------------------------------------------------


async def _unload_all_ollama_models() -> None:
    assert http_client is not None
    try:
        r = await http_client.get(f"{OLLAMA_URL}/api/ps", timeout=10.0)
        r.raise_for_status()
        data = r.json()
    except Exception as e:  # noqa: BLE001
        log.warning("could not read /api/ps, skipping unload: %r", e)
        return

    models = [m.get("name") or m.get("model") for m in data.get("models", []) if m]
    models = [m for m in models if m]
    if not models:
        log.info("no Ollama model loaded, nothing to unload")
        return

    log.info("unloading Ollama models: %s", ", ".join(models))
    for model in models:
        try:
            await http_client.post(
                f"{OLLAMA_URL}/api/generate",
                json={"model": model, "prompt": "", "keep_alive": 0},
                timeout=30.0,
            )
        except Exception as e:  # noqa: BLE001
            log.warning("unload failed for %s: %r", model, e)


# ---------------------------------------------------------------------------
# Core GPU ownership context manager
# ---------------------------------------------------------------------------


@asynccontextmanager
async def own_gpu(desired: Owner):
    assert desired in ("llm", "tts")
    state.queue_depth += 1
    # New request takes control — a pending idle stop would only get
    # in the way now (for TTS: still use the warm container;
    # for LLM: we stop synchronously ourselves in a moment).
    _cancel_pending_tts_stop()
    try:
        async with state.lock:
            state.owner = desired
            state.since = time.time()
            try:
                if desired == "llm":
                    await _stop_tts()
                else:
                    # When qwen-tts is still running thanks to linger,
                    # we skip Ollama unload + container start + health
                    # poll (~7 s).
                    container_running = False
                    try:
                        container_running = (
                            await asyncio.to_thread(_container_status, TTS_CONTAINER)
                        ) == "running"
                    except Exception:  # noqa: BLE001
                        container_running = False
                    if not container_running:
                        await _unload_all_ollama_models()
                        await _start_tts_and_wait()

                try:
                    yield
                finally:
                    if desired == "tts":
                        # Instead of stopping immediately: schedule
                        # the idle linger. If a new TTS call arrives
                        # within the linger window, the task is
                        # cancelled in own_gpu() and we skip the
                        # restart.
                        if TTS_IDLE_LINGER_SECONDS > 0:
                            global _tts_idle_task
                            _tts_idle_task = asyncio.create_task(
                                _idle_stop_tts(TTS_IDLE_LINGER_SECONDS)
                            )
                            log.info(
                                "tts done — linger %ss before stop",
                                TTS_IDLE_LINGER_SECONDS,
                            )
                        else:
                            try:
                                await _stop_tts()
                            except Exception as e:  # noqa: BLE001
                                log.warning("stop-after-tts failed: %r", e)
            finally:
                state.owner = "idle"
                state.since = time.time()
    finally:
        state.queue_depth = max(0, state.queue_depth - 1)


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client, docker_client
    http_client = httpx.AsyncClient(timeout=PROXY_REQUEST_TIMEOUT)
    docker_client = docker.from_env()
    log.info(
        "arbiter ready :: ollama=%s tts=%s container=%s startup_timeout=%ss",
        OLLAMA_URL,
        TTS_URL,
        TTS_CONTAINER,
        TTS_STARTUP_TIMEOUT,
    )
    try:
        yield
    finally:
        if http_client is not None:
            await http_client.aclose()
        if docker_client is not None:
            docker_client.close()


app = FastAPI(title="pm-gpu-arbiter", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/status")
async def status():
    try:
        tts_status = await asyncio.to_thread(_container_status, TTS_CONTAINER)
    except Exception as e:  # noqa: BLE001
        tts_status = f"error: {e!r}"
    return {
        **state.snapshot(),
        "tts_container": tts_status,
        "tts_idle_pending": _tts_idle_task is not None and not _tts_idle_task.done(),
        "config": {
            "ollama_url": OLLAMA_URL,
            "tts_url": TTS_URL,
            "tts_container": TTS_CONTAINER,
            "tts_startup_timeout": TTS_STARTUP_TIMEOUT,
            "tts_idle_linger_seconds": TTS_IDLE_LINGER_SECONDS,
            "proxy_request_timeout": PROXY_REQUEST_TIMEOUT,
        },
    }


def _tts_headers() -> dict[str, str]:
    # Qwen/vLLM doesn't need a key by default, but we forward one if
    # set — that way other TTS sidecars with auth work without a
    # code change.
    return {"X-API-Key": TTS_API_KEY} if TTS_API_KEY else {}


@app.post("/admin/gpu/reset")
async def gpu_reset():
    """Hard reset: hard-restarts the TTS container, hard-restarts or
    unloads Ollama (depending on `OLLAMA_CONTAINER` env), discards a
    scheduled idle stop. Intended as a UI button when the
    Ollama/Qwen swap is stuck (504 on either side, GPU pegged at
    100 %, zombie generation, …).

    We deliberately do NOT take state.lock — if a request is running,
    let it crash (button press = user intent that something is broken).
    The `own_gpu()` state machine cleans itself up in its
    ``finally`` block.
    """
    assert http_client is not None and docker_client is not None
    start = time.time()
    result: dict[str, Any] = {}

    _cancel_pending_tts_stop()

    # 1. TTS container — hard restart (not just stop).
    # Stopping alone leaves the user with a dead container that only
    # comes back on the next TTS call. A user clicking "GPU reset"
    # almost always wants a clean ready state right away, especially
    # if they're about to retry the chunk that was stuck.
    try:
        result["tts_container"] = await _hard_restart_container(TTS_CONTAINER)
    except Exception as e:  # noqa: BLE001
        result["tts_container"] = {"error": repr(e)}
        log.warning("gpu-reset: tts hard-restart failed: %r", e)

    # 2. Ollama — hard-restart container if OLLAMA_CONTAINER is set,
    # otherwise the historic model-unload-only behaviour. Container
    # restart is the right hammer for a wedged Ollama process (504
    # on /api/generate even though the API is reachable). The
    # unload-only fallback covers setups where the arbiter doesn't
    # have docker access to the Ollama container (e.g. Ollama running
    # outside docker, or on a separate host).
    if OLLAMA_CONTAINER:
        try:
            result["ollama_container"] = await _hard_restart_container(
                OLLAMA_CONTAINER
            )
        except Exception as e:  # noqa: BLE001
            result["ollama_container"] = {"error": repr(e)}
            log.warning(
                "gpu-reset: ollama hard-restart failed: %r — falling back to model unload",
                e,
            )
            try:
                await _unload_all_ollama_models()
                result["ollama_unload_fallback"] = "ok"
            except Exception as e2:  # noqa: BLE001
                result["ollama_unload_fallback"] = {"error": repr(e2)}
    else:
        try:
            await _unload_all_ollama_models()
            result["ollama_unload"] = "ok"
        except Exception as e:  # noqa: BLE001
            result["ollama_unload"] = {"error": repr(e)}
            log.warning("gpu-reset: ollama unload failed: %r", e)

    # State.snapshot would still report the old `owner` since we don't
    # take the lock. Reset it to idle so the next request doesn't think
    # someone else owns the GPU.
    state.owner = "idle"
    state.since = time.time()
    state.queue_depth = 0

    result["elapsed_s"] = round(time.time() - start, 2)
    result["snapshot"] = state.snapshot()
    log.info("gpu reset done in %.2fs", result["elapsed_s"])
    return result


@app.api_route(
    "/api/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
)
async def ollama_proxy(path: str, request: Request):
    assert http_client is not None
    async with own_gpu("llm"):
        return await proxy_stream(http_client, OLLAMA_URL, request, f"api/{path}")


@app.api_route(
    "/v1/audio/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
)
async def tts_proxy(path: str, request: Request):
    assert http_client is not None
    try:
        async with own_gpu("tts"):
            return await proxy_stream(
                http_client,
                TTS_URL,
                request,
                f"v1/audio/{path}",
                extra_headers=_tts_headers(),
            )
    except TimeoutError as e:
        return JSONResponse(
            status_code=503,
            content={"error": "tts_startup_timeout", "detail": str(e)},
        )
