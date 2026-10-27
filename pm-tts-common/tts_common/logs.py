"""Logging mit Ringpuffer für den Logs-Tab im Backend."""

from __future__ import annotations

import logging
import threading
from typing import Any

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")


class RingHandler(logging.Handler):
    def __init__(self, capacity: int = 500):
        super().__init__()
        self.capacity = capacity
        self.buf: list[dict[str, Any]] = []
        self._lock = threading.Lock()

    def emit(self, record: logging.LogRecord) -> None:
        try:
            entry = {"ts": int(record.created * 1000), "level": record.levelname, "message": self.format(record)}
            with self._lock:
                self.buf.append(entry)
                if len(self.buf) > self.capacity:
                    del self.buf[: len(self.buf) - self.capacity]
        except Exception:  # noqa: BLE001
            # Logging darf den Aufrufer nie abstürzen lassen
            pass

    def snapshot(self, since_ts: int = 0) -> list[dict[str, Any]]:
        with self._lock:
            return [e for e in self.buf if e["ts"] > since_ts] if since_ts > 0 else list(self.buf)


ring = RingHandler()
ring.setLevel(logging.INFO)
ring.setFormatter(logging.Formatter("%(name)s :: %(message)s"))
# Am Root-Logger: auch uvicorn, torch usw.
logging.getLogger().addHandler(ring)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
