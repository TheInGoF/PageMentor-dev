"""Logging mit Ringpuffer für den Logs-Tab."""

from __future__ import annotations

import logging
import threading
from typing import Any


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
log = logging.getLogger("qwen-tts")


class _RingHandler(logging.Handler):
    """Ringpuffer der letzten Log-Zeilen für den Logs-Tab im Backend."""

    def __init__(self, capacity: int = 500):
        super().__init__()
        self.capacity = capacity
        self.buf: list[dict[str, Any]] = []
        self._lock = threading.Lock()

    def emit(self, record: logging.LogRecord) -> None:
        try:
            entry = {
                "ts": int(record.created * 1000),
                "level": record.levelname,
                "message": self.format(record),
            }
            with self._lock:
                self.buf.append(entry)
                if len(self.buf) > self.capacity:
                    del self.buf[: len(self.buf) - self.capacity]
        except Exception:  # noqa: BLE001
            # Logging darf nie den Aufrufer abstürzen lassen
            pass

    def snapshot(self, since_ts: int = 0) -> list[dict[str, Any]]:
        with self._lock:
            if since_ts <= 0:
                return list(self.buf)
            return [e for e in self.buf if e["ts"] > since_ts]


_log_ring = _RingHandler(capacity=500)
_log_ring.setLevel(logging.INFO)
_log_ring.setFormatter(
    logging.Formatter("%(name)s :: %(message)s")
)
# Am Root-Logger: auch uvicorn, transformers usw.
logging.getLogger().addHandler(_log_ring)
