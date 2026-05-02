# pm-audio-analyzer — Qwen3-Omni-30B-A3B-Instruct (AWQ-4bit) sidecar.
#
# Build:  docker build -t pm-audio-analyzer:latest pm-audio-analyzer/
# Run:    docker run --rm -p 8791:8791 --gpus all \
#           -v audio-analyzer-hf:/root/.cache/huggingface \
#           pm-audio-analyzer:latest
#
# The image is heavier than pm-qwen-tts because the model is 30B (vs 1.7B);
# downloads ~12-14 GB on first run. autoawq is required for the 4-bit
# kernel — without it, the model falls back to dequantising at load time
# which doubles VRAM and defeats the point.

ARG CUDA_VERSION=12.4.1

# Stage 1: PyTorch with CUDA, single layer for cacheability.
FROM nvidia/cuda:${CUDA_VERSION}-cudnn-devel-ubuntu22.04 AS base

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/root/.cache/huggingface

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.11 python3.11-venv python3-pip \
        ffmpeg libsndfile1 git \
    && ln -sf /usr/bin/python3.11 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN python -m pip install --upgrade pip \
 && python -m pip install --extra-index-url https://download.pytorch.org/whl/cu124 \
        -r requirements.txt

COPY main.py test_local.py ./

EXPOSE 8791

# Healthcheck: docker treats the container unhealthy if /health doesn't
# answer quickly. Liveness is fine before the first inference because
# the model isn't loaded at startup (lazy-load pattern).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:8791/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8791"]
