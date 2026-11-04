# pm-whisper-stt: faster-whisper (large-v3-turbo) für die Ausspracheprüfung, dazu ein Phonem-Modell für die Lautschrift;
# Gewichte zur Laufzeit von Hugging Face
# Bauen aus dem Repo-Wurzelordner: docker build -f pm-whisper-stt/Dockerfile .
# CUDA-Basis mit cuDNN 9: CTranslate2 (faster-whisper) braucht cuBLAS und cuDNN als Systembibliotheken
FROM nvidia/cuda:12.6.3-cudnn-runtime-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    HF_HOME=/root/.cache/huggingface PATH=/opt/venv/bin:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-venv ffmpeg espeak-ng ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv

WORKDIR /app
COPY pm-whisper-stt/requirements.txt .
# Torch nur für die CPU: das Phonem-Modell braucht keine Grafikkarte, das CUDA-Paket wäre Gigabytes größer
RUN pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu \
    && pip install -r requirements.txt \
    && python -c "import phonemizer, transformers, torch; from phonemizer import phonemize; print(phonemize('Hallo', language='de', backend='espeak'))"

COPY pm-tts-common/tts_common ./tts_common
COPY pm-whisper-stt/*.py ./

EXPOSE 8880
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8880/health', timeout=3).status == 200 else 1)"
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8880", "--log-level", "info"]
