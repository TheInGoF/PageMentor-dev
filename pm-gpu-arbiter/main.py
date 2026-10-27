"""PageMentor GPU-Arbiter.

Reverse-Proxy vor Ollama und TTS-Sidecar, ein Modell zur Zeit auf der GPU.
- /api/*      → Ollama: TTS-Container stoppen, weiterleiten
- /v1/audio/* → TTS: Ollama entladen, TTS starten, weiterleiten
TTS-Engine egal, solange /health und /v1/audio/* vorhanden sind.
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
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from proxy import proxy_stream

# Logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
log = logging.getLogger("arbiter")

# Umgebung

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://ollama:11434").rstrip("/")

# TTS-Upstream, alte VIBEVOICE_*-Namen gelten weiter
TTS_URL = os.environ.get(
    "TTS_UPSTREAM_URL",
    os.environ.get("VIBEVOICE_URL", "http://qwen-tts:8880"),
).rstrip("/")
TTS_CONTAINER = os.environ.get(
    "TTS_CONTAINER",
    os.environ.get("VIBEVOICE_CONTAINER", "pm-qwen-tts"),
)
# Optional: GPU-Reset startet den Ollama-Container hart neu
# Leer = nur Modelle entladen
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
# TTS-Container bleibt N s nach einem Aufruf an, spart ~7 s pro Chunk
# LLM-Aufruf stoppt ihn trotzdem sofort; 0 = sofort stoppen
TTS_IDLE_LINGER_SECONDS = int(os.environ.get("TTS_IDLE_LINGER_SECONDS", "60"))
PROXY_REQUEST_TIMEOUT = float(os.environ.get("PROXY_REQUEST_TIMEOUT", "1800"))

Owner = Literal["idle", "llm", "tts"]

# Zustand


@dataclass
class ArbiterState:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    owner: Owner = "idle"
    since: float = field(default_factory=time.time)
    queue_depth: int = 0
    # Modell, das gerade im VRAM liegt; Basis für das Entladen vor einem Wechsel
    loaded_model: str | None = None

    def snapshot(self) -> dict[str, Any]:
        return {
            "owner": self.owner,
            "since_seconds": round(time.time() - self.since, 3),
            "queue_depth": self.queue_depth,
            "loaded_model": self.loaded_model,
        }


state = ArbiterState()

http_client: httpx.AsyncClient | None = None
docker_client: docker.DockerClient | None = None

# Verzögertes Stoppen nach TTS, beim nächsten own_gpu abgebrochen
_tts_idle_task: asyncio.Task[None] | None = None


def _cancel_pending_tts_stop() -> None:
    """Geplanten Idle-Stopp verwerfen."""
    global _tts_idle_task
    t = _tts_idle_task
    _tts_idle_task = None
    if t is not None and not t.done():
        t.cancel()


async def _idle_stop_tts(linger_seconds: int) -> None:
    """Nach ``linger_seconds`` TTS stoppen, wenn die GPU frei blieb."""
    try:
        await asyncio.sleep(linger_seconds)
    except asyncio.CancelledError:
        return
    # Lock nehmen: nicht in eine laufende Anfrage hinein stoppen
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


# Docker-Helfer, blockierend → asyncio.to_thread


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


async def _hard_restart_container(
    name: str,
    wait_url: str | None = None,
    wait_timeout: float = 90.0,
) -> dict[str, str]:
    """Stopp → kurz warten → Start → optional auf /health warten.

    Für den GPU-Reset: erst fertig, wenn das Modell wieder geladen ist."""
    before = await asyncio.to_thread(_container_status, name)
    await asyncio.to_thread(_stop_container_sync, name)
    # Kurz warten, damit Docker die GPU freigibt
    await asyncio.sleep(2)
    await asyncio.to_thread(_start_container_sync, name)

    healthy = "skipped"
    if wait_url is not None:
        assert http_client is not None
        deadline = time.time() + wait_timeout
        last_err: str | None = None
        while time.time() < deadline:
            try:
                r = await http_client.get(wait_url, timeout=3.0)
                if r.status_code == 200:
                    healthy = f"ok after {wait_timeout - (deadline - time.time()):.1f}s"
                    break
            except Exception as e:  # noqa: BLE001
                last_err = repr(e)
            await asyncio.sleep(1.5)
        else:
            healthy = f"timeout after {wait_timeout:.0f}s (last={last_err})"
            log.warning(
                "hard-restart of %s: container started but health-check "
                "did not pass within %.0fs — last error: %s",
                name, wait_timeout, last_err,
            )

    after = await asyncio.to_thread(_container_status, name)
    return {"before": before, "after": after, "healthy": healthy}


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


# Ollama-Helfer


async def _list_loaded_models() -> list[str]:
    """Modelle, die Ollama gerade im VRAM hat."""
    assert http_client is not None
    try:
        r = await http_client.get(f"{OLLAMA_URL}/api/ps", timeout=10.0)
        r.raise_for_status()
        data = r.json()
    except Exception as e:  # noqa: BLE001
        log.warning("could not read /api/ps: %r", e)
        return []
    models = [m.get("name") or m.get("model") for m in data.get("models", []) if m]
    return [m for m in models if m]


async def _unload_models(models: list[str]) -> None:
    """Modelle per keep_alive=0 entladen; Fehler nur loggen."""
    assert http_client is not None
    for model in models:
        try:
            await http_client.post(
                f"{OLLAMA_URL}/api/generate",
                json={"model": model, "prompt": "", "keep_alive": 0},
                timeout=30.0,
            )
        except Exception as e:  # noqa: BLE001
            log.warning("unload failed for %s: %r", model, e)


async def _unload_all_ollama_models() -> None:
    """Alle Modelle entladen, bevor TTS die GPU bekommt."""
    models = await _list_loaded_models()
    if not models:
        log.info("no Ollama model loaded, nothing to unload")
        state.loaded_model = None
        return
    log.info("unloading Ollama models: %s", ", ".join(models))
    await _unload_models(models)
    state.loaded_model = None


async def _ensure_single_model_resident(desired: str | None) -> None:
    """Nur ein Modell im VRAM: andere vorher entladen.

    desired=None: Modell unbekannt, Zustand bleibt."""
    if not desired:
        return
    loaded = await _list_loaded_models()
    stale = [m for m in loaded if m != desired]
    if stale:
        log.info(
            "single-model mode: '%s' wants the GPU — evicting %s",
            desired, ", ".join(stale),
        )
        await _unload_models(stale)
    state.loaded_model = desired


# GPU-Besitz


@asynccontextmanager
async def own_gpu(desired: Owner):
    assert desired in ("llm", "tts")
    state.queue_depth += 1
    # Neue Anfrage: geplanten Idle-Stopp verwerfen
    _cancel_pending_tts_stop()
    try:
        async with state.lock:
            state.owner = desired
            state.since = time.time()
            try:
                if desired == "llm":
                    await _stop_tts()
                else:
                    # TTS läuft noch dank Linger: Entladen und Start sparen
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
                        # Nicht sofort stoppen: Linger planen
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


# FastAPI


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
    # Schlüssel nur weiterreichen, wenn gesetzt
    return {"X-API-Key": TTS_API_KEY} if TTS_API_KEY else {}


@app.post("/admin/gpu/reset")
async def gpu_reset():
    """Harter Reset: TTS neu starten, Ollama neu starten oder entladen.

    Für den UI-Knopf bei hängendem Wechsel. Bewusst ohne state.lock:
    laufende Anfragen dürfen scheitern, own_gpu räumt im finally auf.
    """
    assert http_client is not None and docker_client is not None
    start = time.time()
    result: dict[str, Any] = {}

    _cancel_pending_tts_stop()

    # 1. TTS hart neu starten, nicht nur stoppen
    try:
        # Auf /health warten, sonst scheitert der nächste Synth-Aufruf
        result["tts_container"] = await _hard_restart_container(
            TTS_CONTAINER,
            wait_url=f"{TTS_URL}/health",
            wait_timeout=float(TTS_STARTUP_TIMEOUT),
        )
    except Exception as e:  # noqa: BLE001
        result["tts_container"] = {"error": repr(e)}
        log.warning("gpu-reset: tts hard-restart failed: %r", e)

    # 2. Ollama: Container neu starten, wenn OLLAMA_CONTAINER gesetzt
    # sonst nur Modelle entladen
    if OLLAMA_CONTAINER:
        try:
            # /api/tags antwortet, sobald der Server läuft
            result["ollama_container"] = await _hard_restart_container(
                OLLAMA_CONTAINER,
                wait_url=f"{OLLAMA_URL}/api/tags",
                wait_timeout=60.0,
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

    # Owner zurück auf idle, sonst glaubt die nächste Anfrage an einen Besitzer
    state.owner = "idle"
    state.since = time.time()
    state.queue_depth = 0
    state.loaded_model = None

    result["elapsed_s"] = round(time.time() - start, 2)
    result["snapshot"] = state.snapshot()
    log.info("gpu reset done in %.2fs", result["elapsed_s"])
    return result


def _peek_requested_model(path: str, body: bytes) -> str | None:
    """Modell einer /api/*-Anfrage lesen, für das Entladen vorab.

    Nur chat, generate, embeddings; sonst None."""
    if not body:
        return None
    if not any(
        path.startswith(p)
        for p in ("chat", "generate", "embeddings", "embed")
    ):
        return None
    import json as _json
    try:
        payload = _json.loads(body)
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(payload, dict):
        return None
    m = payload.get("model")
    return m if isinstance(m, str) and m else None


@app.api_route(
    "/api/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
)
async def ollama_proxy(path: str, request: Request):
    assert http_client is not None
    # Body vorab lesen; Starlette cached ihn für proxy_stream
    body = await request.body()
    desired = _peek_requested_model(path, body)
    async with own_gpu("llm"):
        if desired:
            # Andere Modelle entladen, bevor Ollama die Anfrage bekommt
            try:
                await _ensure_single_model_resident(desired)
            except Exception as e:  # noqa: BLE001
                log.warning("pre-unload before %s failed: %r", desired, e)
        return await proxy_stream(http_client, OLLAMA_URL, request, f"api/{path}")


@app.get("/diagnostics/{path:path}")
async def diagnostics_proxy(path: str, request: Request):
    """/diagnostics/* an den TTS-Sidecar durchreichen, für den Logs-Tab."""
    assert http_client is not None
    try:
        upstream = f"{TTS_URL}/diagnostics/{path}"
        if request.url.query:
            upstream += "?" + request.url.query
        r = await http_client.get(upstream, timeout=5.0)
        return Response(
            content=r.content,
            status_code=r.status_code,
            media_type=r.headers.get("content-type", "application/json"),
        )
    except Exception as e:  # noqa: BLE001
        return JSONResponse(
            status_code=503,
            content={"error": f"diagnostics-proxy: {e!r}"},
        )


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
