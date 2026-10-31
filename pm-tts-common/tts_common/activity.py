"""Was der Sidecar gerade lädt, für die Anzeige in der App: Modell laden oder herunterladen, mit Fortschritt.

Downloads von Hugging Face schreiben in blobs/*.incomplete; deren Größe ist der Fortschritt."""

from __future__ import annotations

import glob
import os
import threading
import time
from contextlib import contextmanager
from typing import Any, Iterator

_lock = threading.Lock()
_now: dict[str, Any] | None = None


def _hub_dir() -> str:
    home = os.environ.get("HF_HOME", os.path.join(os.path.expanduser("~"), ".cache", "huggingface"))
    return os.environ.get("HF_HUB_CACHE", os.path.join(home, "hub"))


def _incomplete_bytes(repo: str) -> int:
    path = os.path.join(_hub_dir(), f"models--{repo.replace('/', '--')}", "blobs", "*.incomplete")
    total = 0
    for f in glob.glob(path):
        try:
            total += os.path.getsize(f)
        except OSError:
            pass
    return total


def remote_size(repo: str, name: str) -> int | None:
    """Dateigröße auf dem Hub, für den Prozentwert; ohne Netz None."""
    try:
        from huggingface_hub import HfApi

        info = HfApi().get_paths_info(repo, [name])
        return int(getattr(info[0], "size", 0) or 0) or None
    except Exception:  # noqa: BLE001
        return None


@contextmanager
def activity(phase: str, model: str, repo: str | None = None, total: int | None = None) -> Iterator[None]:
    """phase: "load" (in den Grafikspeicher) oder "download" (aus dem Netz)."""
    global _now
    with _lock:
        prev = _now
        # Download innerhalb eines Ladevorgangs: lesbarer Name des Modells statt Dateipfad
        label = prev["model"] if prev else model
        _now = {"phase": phase, "model": label, "repo": repo, "total": total, "since": time.time()}
    try:
        yield
    finally:
        with _lock:
            _now = prev


def snapshot() -> dict[str, Any] | None:
    with _lock:
        cur = dict(_now) if _now else None
    if not cur:
        return None
    out: dict[str, Any] = {"phase": cur["phase"], "model": cur["model"], "seconds": round(time.time() - cur["since"], 1)}
    if cur["phase"] == "download" and cur.get("repo"):
        out["bytes"] = _incomplete_bytes(cur["repo"])
        if cur.get("total"):
            out["total"] = cur["total"]
    return out
