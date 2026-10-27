# pm-f5-tts: F5-TTS German (HPI), Gewichte zur Laufzeit von Hugging Face
# Bauen aus dem Repo-Wurzelordner: docker build -f pm-f5-tts/Dockerfile .
FROM pytorch/pytorch:2.7.1-cuda12.6-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    HF_HOME=/root/.cache/huggingface

RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg libsndfile1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# torch aus dem Basis-Image festhalten, sonst zieht pip eine CPU-Version
RUN python -c "import torch, torchaudio, torchvision as v; print(f'torch=={torch.__version__}\\ntorchaudio=={torchaudio.__version__}\\ntorchvision=={v.__version__}')" > /tmp/constraints.txt && cat /tmp/constraints.txt
COPY pm-f5-tts/requirements.txt .
RUN pip install -c /tmp/constraints.txt -r requirements.txt

COPY pm-tts-common/tts_common ./tts_common
COPY pm-f5-tts/*.py ./

EXPOSE 8880
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8880/health', timeout=3).status == 200 else 1)"
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8880", "--log-level", "info"]
