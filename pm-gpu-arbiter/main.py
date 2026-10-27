"""PageMentor GPU-Arbiter.

Reverse-Proxy vor Ollama und den TTS-Engines, ein Modell zur Zeit auf der GPU.
- /api/*                    → Ollama: TTS-Container stoppen, weiterleiten
- /tts/<engine>/v1/audio/*  → TTS: Ollama entladen, Engine starten, weiterleiten
- /v1/audio/*               → wie oben mit der Standard-Engine
Jede Engine braucht /health und /v1/audio/*.
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from typing import Any

import docker
import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

import containers
import gpu
import ollama
from config import (
    DEFAULT_ENGINE,
    ENGINES,
    OLLAMA_CONTAINER,
    OLLAMA_URL,
    PROXY_REQUEST_TIMEOUT,
    TTS_API_KEY,
    TTS_IDLE_LINGER_SECONDS,
    TTS_STARTUP_TIMEOUT,
    Engine,
    gpu_engines,
)
from proxy import proxy_stream
from state import clients, http, log, state

ALL_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]


@asynccontextmanager
async def lifespan(app: FastAPI):
    clients.http = httpx.AsyncClient(timeout=PROXY_REQUEST_TIMEOUT)
    clients.docker = docker.from_env()
    log.info(
        "arbiter ready :: ollama=%s engines=%s default=%s startup_timeout=%ss",
        OLLAMA_URL,
        ", ".join(f"{e.name}{'' if e.gpu else '(cpu)'}" for e in ENGINES.values()),
        DEFAULT_ENGINE,
        TTS_STARTUP_TIMEOUT,
    )
    try:
        yield
    finally:
        await clients.http.aclose()
        clients.docker.close()


app = FastAPI(title="pm-gpu-arbiter", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/status")
async def status():
    engines: dict[str, Any] = {}
    for e in ENGINES.values():
        try:
            engines[e.name] = {"container": await containers.status(e.container), "gpu": e.gpu}
        except Exception as err:  # noqa: BLE001
            engines[e.name] = {"container": f"error: {err!r}", "gpu": e.gpu}
    default = engines.get(DEFAULT_ENGINE, {})
    return {
        **state.snapshot(),
        # Altes Feld, liest das Backend noch
        "tts_container": default.get("container"),
        "tts_idle_pending": bool(gpu.idle_pending()),
        "engines": engines,
        "default_engine": DEFAULT_ENGINE,
        "config": {
            "ollama_url": OLLAMA_URL,
            "tts_startup_timeout": TTS_STARTUP_TIMEOUT,
            "tts_idle_linger_seconds": TTS_IDLE_LINGER_SECONDS,
            "proxy_request_timeout": PROXY_REQUEST_TIMEOUT,
        },
    }


def _tts_headers() -> dict[str, str]:
    return {"X-API-Key": TTS_API_KEY} if TTS_API_KEY else {}


@app.post("/admin/gpu/reset")
async def gpu_reset():
    """Harter Reset für den UI-Knopf bei hängendem Wechsel.

    Ohne state.lock: laufende Anfragen dürfen scheitern, own_gpu räumt auf."""
    start = time.time()
    result: dict[str, Any] = {}
    gpu.cancel_idle_stops()

    # Nicht-Standard-Engines nur stoppen, die Standard-Engine neu starten
    for e in gpu_engines():
        try:
            if e.name == DEFAULT_ENGINE:
                result[f"tts_{e.name}"] = await containers.hard_restart(
                    e.container, wait_url=f"{e.url}/health", wait_timeout=float(TTS_STARTUP_TIMEOUT)
                )
            else:
                await containers.stop(e.container)
                result[f"tts_{e.name}"] = "stopped"
        except Exception as err:  # noqa: BLE001
            result[f"tts_{e.name}"] = {"error": repr(err)}
            log.warning("gpu-reset: %s failed: %r", e.name, err)

    try:
        if OLLAMA_CONTAINER:
            result["ollama_container"] = await containers.hard_restart(
                OLLAMA_CONTAINER, wait_url=f"{OLLAMA_URL}/api/tags", wait_timeout=60.0
            )
        else:
            await ollama.unload_all()
            result["ollama_unload"] = "ok"
    except Exception as err:  # noqa: BLE001
        result["ollama"] = {"error": repr(err)}
        log.warning("gpu-reset: ollama failed: %r — falling back to unload", err)
        try:
            await ollama.unload_all()
            result["ollama_unload_fallback"] = "ok"
        except Exception as err2:  # noqa: BLE001
            result["ollama_unload_fallback"] = {"error": repr(err2)}

    state.owner = "idle"
    state.since = time.time()
    state.queue_depth = 0
    state.loaded_model = None
    result["elapsed_s"] = round(time.time() - start, 2)
    result["snapshot"] = state.snapshot()
    log.info("gpu reset done in %.2fs", result["elapsed_s"])
    return result


@app.api_route("/api/{path:path}", methods=ALL_METHODS)
async def ollama_proxy(path: str, request: Request):
    # Body vorab lesen; Starlette cached ihn für proxy_stream
    body = await request.body()
    desired = ollama.peek_model(path, body)
    async with gpu.own_gpu(None):
        if desired:
            try:
                await ollama.ensure_single_resident(desired)
            except Exception as e:  # noqa: BLE001
                log.warning("pre-unload before %s failed: %r", desired, e)
        return await proxy_stream(http(), OLLAMA_URL, request, f"api/{path}")


def _engine(name: str) -> Engine | None:
    return ENGINES.get(name)


async def _diagnostics(engine: Engine, path: str, request: Request) -> Response:
    try:
        upstream = f"{engine.url}/diagnostics/{path}"
        if request.url.query:
            upstream += "?" + request.url.query
        r = await http().get(upstream, timeout=5.0)
        return Response(r.content, r.status_code, media_type=r.headers.get("content-type", "application/json"))
    except Exception as e:  # noqa: BLE001
        return JSONResponse(status_code=503, content={"error": f"diagnostics-proxy: {e!r}"})


async def _speech(engine: Engine, path: str, request: Request) -> Response:
    target = f"v1/audio/{path}"
    if not engine.gpu:
        # CPU-Engine läuft dauerhaft, GPU bleibt unberührt
        return await proxy_stream(http(), engine.url, request, target, extra_headers=_tts_headers())
    try:
        async with gpu.own_gpu(engine):
            return await proxy_stream(http(), engine.url, request, target, extra_headers=_tts_headers())
    except TimeoutError as e:
        return JSONResponse(status_code=503, content={"error": "tts_startup_timeout", "engine": engine.name, "detail": str(e)})


def _unknown(name: str) -> JSONResponse:
    return JSONResponse(status_code=404, content={"error": "unknown_engine", "engine": name, "known": list(ENGINES)})


@app.get("/tts/{name}/diagnostics/{path:path}")
async def engine_diagnostics(name: str, path: str, request: Request):
    engine = _engine(name)
    return await _diagnostics(engine, path, request) if engine else _unknown(name)


@app.api_route("/tts/{name}/v1/audio/{path:path}", methods=ALL_METHODS)
async def engine_speech(name: str, path: str, request: Request):
    engine = _engine(name)
    return await _speech(engine, path, request) if engine else _unknown(name)


# Alte Pfade ohne Engine: Standard-Engine
@app.get("/diagnostics/{path:path}")
async def diagnostics_proxy(path: str, request: Request):
    return await _diagnostics(ENGINES[DEFAULT_ENGINE], path, request)


@app.api_route("/v1/audio/{path:path}", methods=ALL_METHODS)
async def tts_proxy(path: str, request: Request):
    return await _speech(ENGINES[DEFAULT_ENGINE], path, request)
