# Qwen3-TTS Voice-Clone Sidecar für PageMentor.
# Lädt Qwen/Qwen3-TTS-12Hz-1.7B-Base aus dem HuggingFace-Hub zur
# Laufzeit — die Model-Weights liegen NICHT im Image, sondern im Volume
# /root/.cache/huggingface, das beim ersten Start befüllt wird (~4 GB).
#
# ---------------------------------------------------------------------
# Stage 1: flash-attention 2 Wheel bauen.
# ---------------------------------------------------------------------
# Wir bauen ein .whl (statt direkt installieren) und lassen Stage 2 es
# via pip install normal einspielen. Vorteil: KEINE Pfad-Hardcodes wie
# `flash_attn_2_cuda.cpython-311-…so`, die bei Python-Version-Wechseln
# brechen. Das Wheel trägt alle ABI-Info im Dateinamen und pip legt es
# am richtigen Platz ab.
FROM pytorch/pytorch:2.4.1-cuda12.4-cudnn9-devel AS flash-attn-build

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    MAX_JOBS=2

# git wird von flash-attn setup.py für `git submodule update --init
# csrc/cutlass` benötigt. pytorch/pytorch:devel-Images bringen es NICHT
# mit — ohne diesen apt-install scheitert der Build mit "No such file
# or directory: 'git'".
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir packaging ninja wheel setuptools

# `pip wheel` baut das Wheel ohne es zu installieren. --no-build-isolation
# lässt den Build die vorhandene torch-Version benutzen, --no-deps
# verhindert Mitinstallation von torch-Zeugs das wir eh schon haben.
RUN pip wheel --wheel-dir=/wheels --no-build-isolation --no-deps \
    flash-attn==2.7.2.post1 \
 && ls -la /wheels

# ---------------------------------------------------------------------
# Stage 2: Runtime-Image.
# ---------------------------------------------------------------------
FROM pytorch/pytorch:2.4.1-cuda12.4-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/root/.cache/huggingface \
    PIP_NO_CACHE_DIR=1

# sox wird von qwen-tts für Audio-Resampling genutzt; ffmpeg deckt
# MP3-Encoding in pydub ab.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg libsndfile1 sox ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Das vorgebaute flash-attn-Wheel aus Stage 1 übernehmen und installieren.
# Der Wheel-Dateiname ist unbekannt (enthält exakte Version, Python-ABI,
# Platform-Tag), deshalb Wildcard-Install.
COPY --from=flash-attn-build /wheels /tmp/wheels
RUN pip install --no-cache-dir /tmp/wheels/flash_attn-*.whl \
 && rm -rf /tmp/wheels \
 && python -c "import flash_attn; print(f'[build-verify] flash-attn {flash_attn.__version__} ready')"

COPY *.py ./

EXPOSE 8880

HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8880/health', timeout=3).status == 200 else 1)"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8880", "--log-level", "info"]
