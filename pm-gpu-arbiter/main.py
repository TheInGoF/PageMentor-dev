"""PageMentor GPU Arbiter.

Transparenter Reverse-Proxy vor Ollama und einem TTS-Sidecar (derzeit
``pm-qwen-tts``). Serialisiert GPU-Zugriffe per ``asyncio.Lock``
(Queue-Modus, nichts wird verworfen):

- ``/api/*``       → Ollama-Mode: stoppt TTS-Container, reicht Request durch.
- ``/v1/audio/*``  → TTS-Mode: entlädt Ollama-Modelle, startet TTS-Container,
  reicht Request durch, stoppt TTS sofort wieder nach der Antwort.

Der Arbiter ist TTS-Engine-agnostisch — solange der Sidecar ein
``/health``-Endpoint unter ``TTS_UPSTREAM_URL`` hat und Requests unter
``/v1/audio/*`` akzeptiert (OpenAI-Shape), funktioniert das Setup.
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

# TTS-Upstream (historisch "VIBEVOICE_*" — beide Namen werden noch
# gelesen, damit ältere Compose-Dateien ohne Breaking-Change weiter-
# funktionieren).
TTS_URL = os.environ.get(
    "TTS_UPSTREAM_URL",
    os.environ.get("VIBEVOICE_URL", "http://qwen-tts:8880"),
).rstrip("/")
TTS_CONTAINER = os.environ.get(
    "TTS_CONTAINER",
    os.environ.get("VIBEVOICE_CONTAINER", "pm-qwen-tts"),
)
TTS_API_KEY = os.environ.get(
    "TTS_API_KEY", os.environ.get("VIBEVOICE_API_KEY", "")
)
TTS_STARTUP_TIMEOUT = int(
    os.environ.get(
        "TTS_STARTUP_TIMEOUT",
        os.environ.get("VIBEVOICE_STARTUP_TIMEOUT", "180"),
    )
)
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


# ---------------------------------------------------------------------------
# Docker helpers (docker-py ist blocking → asyncio.to_thread)
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
        f"TTS wurde nicht innerhalb von {TTS_STARTUP_TIMEOUT}s gesund "
        f"(letzter Fehler: {last_err!r})"
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
        log.warning("konnte /api/ps nicht lesen, überspringe unload: %r", e)
        return

    models = [m.get("name") or m.get("model") for m in data.get("models", []) if m]
    models = [m for m in models if m]
    if not models:
        log.info("kein Ollama-Modell geladen, nichts zu entladen")
        return

    log.info("entlade Ollama-Modelle: %s", ", ".join(models))
    for model in models:
        try:
            await http_client.post(
                f"{OLLAMA_URL}/api/generate",
                json={"model": model, "prompt": "", "keep_alive": 0},
                timeout=30.0,
            )
        except Exception as e:  # noqa: BLE001
            log.warning("unload fehlgeschlagen für %s: %r", model, e)


# ---------------------------------------------------------------------------
# Core GPU ownership context manager
# ---------------------------------------------------------------------------


@asynccontextmanager
async def own_gpu(desired: Owner):
    assert desired in ("llm", "tts")
    state.queue_depth += 1
    try:
        async with state.lock:
            state.owner = desired
            state.since = time.time()
            try:
                if desired == "llm":
                    await _stop_tts()
                else:
                    await _unload_all_ollama_models()
                    await _start_tts_and_wait()

                try:
                    yield
                finally:
                    if desired == "tts":
                        try:
                            await _stop_tts()
                        except Exception as e:  # noqa: BLE001
                            log.warning("stop-after-tts fehlgeschlagen: %r", e)
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
        "config": {
            "ollama_url": OLLAMA_URL,
            "tts_url": TTS_URL,
            "tts_container": TTS_CONTAINER,
            "tts_startup_timeout": TTS_STARTUP_TIMEOUT,
            "proxy_request_timeout": PROXY_REQUEST_TIMEOUT,
        },
    }


def _tts_headers() -> dict[str, str]:
    # Qwen/vLLM braucht per Default keinen Key, aber wir reichen einen
    # durch wenn gesetzt — für andere TTS-Sidecars mit Auth passt das
    # ohne Code-Änderung.
    return {"X-API-Key": TTS_API_KEY} if TTS_API_KEY else {}


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
