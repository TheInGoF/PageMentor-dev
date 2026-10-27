"""Umgebung und Engine-Liste.

TTS_ENGINES: name=url|container[|cpu], durch Komma getrennt
Beispiel: qwen=http://qwen-tts:8880|pm-qwen-tts,kokoro=http://kokoro-tts:8880|pm-kokoro-tts|cpu
cpu: läuft dauerhaft ohne GPU, Arbiter reicht nur durch
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Engine:
    name: str
    url: str
    container: str
    gpu: bool = True


OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://ollama:11434").rstrip("/")
# Leer = GPU-Reset entlädt nur Modelle
OLLAMA_CONTAINER = os.environ.get("OLLAMA_CONTAINER", "").strip()

# Alte Einzel-Engine-Variablen gelten weiter
_LEGACY_URL = os.environ.get(
    "TTS_UPSTREAM_URL", os.environ.get("VIBEVOICE_URL", "http://qwen-tts:8880")
).rstrip("/")
_LEGACY_CONTAINER = os.environ.get(
    "TTS_CONTAINER", os.environ.get("VIBEVOICE_CONTAINER", "pm-qwen-tts")
)

TTS_API_KEY = os.environ.get("TTS_API_KEY", os.environ.get("VIBEVOICE_API_KEY", ""))
TTS_STARTUP_TIMEOUT = int(
    os.environ.get("TTS_STARTUP_TIMEOUT", os.environ.get("VIBEVOICE_STARTUP_TIMEOUT", "180"))
)
# Container bleibt N s nach dem letzten Aufruf an; LLM stoppt ihn sofort
TTS_IDLE_LINGER_SECONDS = int(os.environ.get("TTS_IDLE_LINGER_SECONDS", "60"))
PROXY_REQUEST_TIMEOUT = float(os.environ.get("PROXY_REQUEST_TIMEOUT", "1800"))


def parse_engines(raw: str) -> dict[str, Engine]:
    engines: dict[str, Engine] = {}
    for item in filter(None, (s.strip() for s in raw.split(","))):
        name, _, rest = item.partition("=")
        parts = rest.split("|")
        if not name or len(parts) < 2:
            raise ValueError(f"TTS_ENGINES: ungültiger Eintrag {item!r}")
        gpu = not (len(parts) > 2 and parts[2].strip() == "cpu")
        engines[name.strip()] = Engine(name.strip(), parts[0].strip().rstrip("/"), parts[1].strip(), gpu)
    return engines


ENGINES = parse_engines(os.environ.get("TTS_ENGINES", "")) or {
    "qwen": Engine("qwen", _LEGACY_URL, _LEGACY_CONTAINER)
}
# /v1/audio/* ohne Engine-Präfix geht hierhin
DEFAULT_ENGINE = os.environ.get("TTS_DEFAULT_ENGINE", next(iter(ENGINES)))
if DEFAULT_ENGINE not in ENGINES:
    raise ValueError(f"TTS_DEFAULT_ENGINE {DEFAULT_ENGINE!r} fehlt in TTS_ENGINES")


def gpu_engines() -> list[Engine]:
    return [e for e in ENGINES.values() if e.gpu]
