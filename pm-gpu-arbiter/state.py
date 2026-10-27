"""Gemeinsamer Zustand und Clients."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

import docker as docker_sdk
import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
log = logging.getLogger("arbiter")


@dataclass
class ArbiterState:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    # idle, llm oder tts:<engine>
    owner: str = "idle"
    since: float = field(default_factory=time.time)
    queue_depth: int = 0
    # Modell im VRAM, Basis für das Entladen vor einem Wechsel
    loaded_model: str | None = None

    def snapshot(self) -> dict[str, Any]:
        return {
            "owner": self.owner,
            "since_seconds": round(time.time() - self.since, 3),
            "queue_depth": self.queue_depth,
            "loaded_model": self.loaded_model,
        }


state = ArbiterState()


class Clients:
    http: httpx.AsyncClient | None = None
    docker: docker_sdk.DockerClient | None = None


clients = Clients()


def http() -> httpx.AsyncClient:
    assert clients.http is not None
    return clients.http
