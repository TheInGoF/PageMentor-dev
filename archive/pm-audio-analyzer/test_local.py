"""
Standalone validation for Qwen3-Omni-30B-A3B-Instruct AWQ-4bit on a 24 GB GPU.

Usage on the 3090 host:
    python test_local.py path/to/sample.wav

Prints: transcript + style description (single inference, JSON output) and the
peak VRAM measurement during the call. Use this BEFORE building the full
sidecar to confirm the model fits and produces usable output.

The test deliberately follows the same lazy-load + immediate-unload pattern
the production sidecar will use, so VRAM numbers match what the running
service would report.
"""

import json
import sys
import time
from pathlib import Path

import torch


MODEL_ID = "cyankiwi/Qwen3-Omni-30B-A3B-Instruct-AWQ-4bit"

PROMPT = (
    "Hör dir die Aufnahme an und antworte ausschließlich mit folgendem JSON, "
    "ohne Vorwort und ohne Erklärung:\n"
    "{\n"
    '  "transcript": "<exakte gesprochene Worte, Wort für Wort>",\n'
    '  "instruct": "<EIN deutscher Satz für ein TTS-instruct-Feld, '
    "beschreibt Tempo, Tonfall, Textur und Sprecher-Charakter>\"\n"
    "}"
)


def gb(bytes_: int) -> float:
    return bytes_ / (1024**3)


def measure_vram() -> tuple[float, float]:
    """Returns (current_GB, peak_GB) since last reset."""
    return (
        gb(torch.cuda.memory_allocated()),
        gb(torch.cuda.max_memory_allocated()),
    )


def main(audio_path: str) -> None:
    if not torch.cuda.is_available():
        print("ERROR: no CUDA device available", file=sys.stderr)
        sys.exit(1)

    audio = Path(audio_path)
    if not audio.exists():
        print(f"ERROR: audio file not found: {audio}", file=sys.stderr)
        sys.exit(1)

    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()

    print(f"[test] loading {MODEL_ID} …")
    t0 = time.time()
    # Imports inside main so the script can fail fast before the heavy
    # 5-min model load if e.g. the audio path is wrong.
    from transformers import (
        Qwen3OmniMoeForConditionalGeneration,
        Qwen3OmniMoeProcessor,
    )

    processor = Qwen3OmniMoeProcessor.from_pretrained(
        MODEL_ID, trust_remote_code=True
    )
    model = Qwen3OmniMoeForConditionalGeneration.from_pretrained(
        MODEL_ID,
        torch_dtype="auto",
        device_map="cuda",
        trust_remote_code=True,
        # AWQ is quantised; let transformers detect the kernel.
    )
    model.eval()
    load_s = time.time() - t0
    cur, peak = measure_vram()
    print(
        f"[test] model loaded in {load_s:.1f}s "
        f"(VRAM now {cur:.1f} GB, peak {peak:.1f} GB)"
    )

    print(f"[test] reading {audio} ({audio.stat().st_size / 1024:.0f} KB)")
    conversation = [
        {
            "role": "user",
            "content": [
                {"type": "audio", "audio": str(audio)},
                {"type": "text", "text": PROMPT},
            ],
        }
    ]

    print("[test] running inference …")
    t1 = time.time()
    inputs = processor.apply_chat_template(
        conversation,
        add_generation_prompt=True,
        tokenize=True,
        return_dict=True,
        return_tensors="pt",
    ).to("cuda")
    with torch.inference_mode():
        out_ids = model.generate(
            **inputs,
            max_new_tokens=512,
            do_sample=False,
        )
    text = processor.batch_decode(
        out_ids[:, inputs["input_ids"].shape[1]:],
        skip_special_tokens=True,
    )[0]
    infer_s = time.time() - t1
    cur, peak = measure_vram()
    print(
        f"[test] inference in {infer_s:.1f}s "
        f"(VRAM now {cur:.1f} GB, peak {peak:.1f} GB)"
    )

    print("\n========== RAW OUTPUT ==========")
    print(text)
    print("================================\n")
    try:
        parsed = json.loads(text)
        print(f"transcript: {parsed.get('transcript', '<missing>')}")
        print(f"instruct:   {parsed.get('instruct', '<missing>')}")
    except json.JSONDecodeError:
        print("(model did not return clean JSON — see raw above)")

    print("\n[test] unloading model …")
    del model
    del processor
    torch.cuda.empty_cache()
    cur, peak = measure_vram()
    print(
        f"[test] after unload: VRAM now {cur:.2f} GB, peak during run {peak:.1f} GB"
    )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1])
