# Qwen3-TTS-Flash Sidecar für PageMentor.
# Lädt Qwen/Qwen3-TTS-Flash aus dem HuggingFace-Hub zur Laufzeit — die
# Model-Weights liegen NICHT im Image, sondern im Volume
# /root/.cache/huggingface, das beim ersten Start befüllt wird (~5 GB).
#
# Base: offizielles NVIDIA PyTorch-Image mit CUDA 12.4.
FROM pytorch/pytorch:2.4.1-cuda12.4-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/root/.cache/huggingface \
    PIP_NO_CACHE_DIR=1

# sox wird von qwen-tts für Audio-Resampling genutzt (soundfile reicht
# nicht für alle Pfade); fehlt er, kommt eine Warnung und spätere Calls
# schlagen fehl. ffmpeg deckt MP3-Encoding in pydub ab.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg libsndfile1 sox ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py ./

EXPOSE 8880

# Healthcheck startet erst nach 3 min — beim Cold-Start lädt das Modell
# aus dem HF-Hub, /health antwortet bis dahin mit 503.
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8880/health', timeout=3).status == 200 else 1)"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8880", "--log-level", "info"]
