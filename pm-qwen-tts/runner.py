"""Generierung mit Herzschlag, Timeout und Selbstbeendigung."""

from __future__ import annotations

import os
import threading
import time
from fastapi import HTTPException
from typing import Any

from logs import log
from config import HEARTBEAT_INTERVAL_S


def _schedule_self_exit(reason: str, delay_s: float = 1.5) -> None:
    """os._exit(1) nach kurzer Wartezeit.

    Letztes Mittel bei hängender CUDA-Generierung. Der Arbiter startet neu.
    Wartezeit: uvicorn sendet noch den 504.
    """

    def kick() -> None:
        time.sleep(delay_s)
        log.error("self-exit triggered: %s — container needs restart", reason)
        os._exit(1)

    threading.Thread(target=kick, daemon=True).start()


def _run_with_heartbeat_and_timeout(
    func: Any,
    *,
    label: str,
    timeout_s: int,
) -> Any:
    """func() im Thread, Herzschlag im Log, Abbruch nach timeout_s mit 504."""
    result: dict[str, Any] = {}
    done = threading.Event()

    def worker() -> None:
        try:
            result["value"] = func()
        except BaseException as e:  # noqa: BLE001
            result["error"] = e
        finally:
            done.set()

    t_start = time.time()
    th = threading.Thread(target=worker, daemon=True)
    th.start()

    while not done.wait(HEARTBEAT_INTERVAL_S):
        elapsed = time.time() - t_start
        if elapsed >= timeout_s:
            log.error(
                "%s timed out after %.0fs (limit=%ds) — zombie generation, self-exit scheduled",
                label, elapsed, timeout_s,
            )
            _schedule_self_exit(f"{label} timeout ({elapsed:.0f}s)")
            raise HTTPException(
                status_code=504,
                detail=(
                    f"TTS generation stalled after {elapsed:.0f}s. The sidecar "
                    f"is restarting — please retry the request."
                ),
            )
        log.info(
            "%s :: still running, elapsed %.0fs (timeout in %.0fs)",
            label, elapsed, timeout_s - elapsed,
        )

    if "error" in result:
        raise result["error"]
    return result.get("value")
