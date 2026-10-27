"""Einstellungen aus der Umgebung."""

from __future__ import annotations

import os
import torch


MODEL_ID = os.environ.get("QWEN_TTS_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-Base")
# CustomVoice: 9 Preset-Stimmen + Freitext-Anweisung, lazy geladen
# Leer = Preset-Pfad aus
CUSTOMVOICE_MODEL_ID = os.environ.get(
    "QWEN_TTS_CUSTOMVOICE_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
)
# VoiceDesign: Stimme aus Beschreibung, lazy geladen
VOICEDESIGN_MODEL_ID = os.environ.get(
    "QWEN_TTS_VOICEDESIGN_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
)
# Audio-Tokenizer: eigenes HF-Repo, wird als speech_tokenizer/ verlinkt
TOKENIZER_ID = os.environ.get(
    "QWEN_TTS_TOKENIZER_MODEL", "Qwen/Qwen3-TTS-Tokenizer-12Hz"
)

# Die 9 Presets, kein deutscher Sprecher: Ryan/Aiden + language=German
CUSTOMVOICE_PRESETS: list[str] = [
    "Vivian",     # ZH, young woman
    "Serena",     # ZH, warm
    "Uncle_Fu",   # ZH, mature man
    "Dylan",      # ZH (Beijing)
    "Eric",       # ZH (Sichuan)
    "Ryan",       # EN, dynamic — DE recommendation
    "Aiden",      # EN, sunny — DE recommendation
    "Ono_Anna",   # JP, playful
    "Sohee",      # KR, warm
]
DEVICE = os.environ.get("QWEN_TTS_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
DTYPE_NAME = os.environ.get("QWEN_TTS_DTYPE", "bfloat16")
# flash_attention_2 ab Ampere; ältere GPUs: QWEN_TTS_ATTN_IMPL=sdpa
ATTN_IMPL = os.environ.get("QWEN_TTS_ATTN_IMPL", "flash_attention_2")

# Klon-Qualität, per ENV änderbar
DEFAULT_LANGUAGE = os.environ.get("QWEN_TTS_DEFAULT_LANGUAGE", "German")
MAX_NEW_TOKENS = int(os.environ.get("QWEN_TTS_MAX_NEW_TOKENS", "4096"))

# Sampling-Standards, wenn die Anfrage nichts setzt
# Niedrige temperature + engeres top_p: weniger Drift
# repetition_penalty > 1.0 gegen Schleifen, Qwen-Issue #258
DEFAULT_TEMPERATURE = float(os.environ.get("QWEN_TTS_DEFAULT_TEMPERATURE", "0.75"))
DEFAULT_TOP_P = float(os.environ.get("QWEN_TTS_DEFAULT_TOP_P", "0.8"))
DEFAULT_TOP_K = int(os.environ.get("QWEN_TTS_DEFAULT_TOP_K", "40"))
DEFAULT_REPETITION_PENALTY = float(
    # 1.15: 1.05 ließ Schleifen bei wiederholten Wörtern zu
    os.environ.get("QWEN_TTS_DEFAULT_REPETITION_PENALTY", "1.15")
)

# Subtalker-Sampling wie im offiziellen Qwen-Beispiel
# Ohne: zweiter AR-Kopf kann in Greedy-Schleifen fallen
DEFAULT_SUBTALKER_DOSAMPLE = os.environ.get(
    "QWEN_TTS_SUBTALKER_DOSAMPLE", "true"
).lower() in ("1", "true", "yes")
DEFAULT_SUBTALKER_TEMPERATURE = float(
    os.environ.get("QWEN_TTS_SUBTALKER_TEMPERATURE", "0.9")
)
DEFAULT_SUBTALKER_TOP_P = float(
    os.environ.get("QWEN_TTS_SUBTALKER_TOP_P", "1.0")
)
DEFAULT_SUBTALKER_TOP_K = int(
    os.environ.get("QWEN_TTS_SUBTALKER_TOP_K", "50")
)

# Schleifen-Erkennung: letzte LOOP_WINDOW Tokens mit weniger als
# LOOP_MAX_UNIQUE verschiedenen Werten = Schleife, Abbruch
# LOOP_MIN_TOKENS: Anfang ist natürlich gleichförmig, nicht prüfen
LOOP_WINDOW = int(os.environ.get("QWEN_TTS_LOOP_WINDOW", "256"))
LOOP_MAX_UNIQUE = int(os.environ.get("QWEN_TTS_LOOP_MAX_UNIQUE", "20"))
LOOP_MIN_TOKENS = int(os.environ.get("QWEN_TTS_LOOP_MIN_TOKENS", "1500"))
LOOP_DETECTION_ENABLED = os.environ.get(
    "QWEN_TTS_LOOP_DETECTION", "true"
).lower() in ("1", "true", "yes")

# Harter Timeout pro Generierung: bei Überschreitung 504 + Selbstbeendigung
# Backend-Timeout muss kleiner sein, sonst sieht es den 504 nicht
GENERATION_TIMEOUT_S = int(os.environ.get("QWEN_TTS_GENERATION_TIMEOUT", "1200"))

# Herzschlag im Log während der Generierung
HEARTBEAT_INTERVAL_S = float(os.environ.get("QWEN_TTS_HEARTBEAT_INTERVAL", "10"))
# Ohne ref_text: x_vector-only, etwas schlechter, aber ohne Transkript
X_VECTOR_ONLY_FALLBACK = os.environ.get("QWEN_TTS_X_VECTOR_ONLY", "true").lower() in (
    "1", "true", "yes",
)


def _torch_dtype(name: str):
    return {
        "float16": torch.float16, "fp16": torch.float16, "half": torch.float16,
        "bfloat16": torch.bfloat16, "bf16": torch.bfloat16,
        "float32": torch.float32, "fp32": torch.float32,
    }.get(name.lower(), torch.bfloat16)
