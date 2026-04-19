# Qwen3-TTS Voice-Clone Sidecar für PageMentor.
# Lädt Qwen/Qwen3-TTS-12Hz-1.7B-Base aus dem HuggingFace-Hub zur
# Laufzeit — die Model-Weights liegen NICHT im Image, sondern im Volume
# /root/.cache/huggingface, das beim ersten Start befüllt wird (~4 GB).
#
# ---------------------------------------------------------------------
# Stage 1: flash-attention 2 aus Source bauen.
# ---------------------------------------------------------------------
# Das offizielle Prebuild-Wheel von Dao-AILab existiert für zahlreiche
# torch/CUDA/cp/ABI-Permutationen — aber nicht immer exakt unsere. Statt
# URL zu raten (und bei Fail still auf sdpa zu fallen), bauen wir
# verlässlich selbst. Braucht einmalig ~15-20 min CI-Zeit; der Docker-
# Layer-Cache trifft bei nachfolgenden Builds, solange torch-Version
# und flash-attn-Version konstant bleiben.
#
# Dieses Stage nutzt das -devel-Image (~17 GB mit nvcc). Wir kopieren
# danach NUR das kompilierte Python-Package ins schlanke runtime-Image.
FROM pytorch/pytorch:2.4.1-cuda12.4-cudnn9-devel AS flash-attn-build

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    MAX_JOBS=2

# packaging + ninja sind build-Deps für flash-attn. MAX_JOBS=2 verhindert
# OOM auf GitHub-Actions-Runnern (7 GB RAM Limit).
RUN pip install --no-cache-dir packaging ninja wheel setuptools

# Version pinnen. 2.7.2.post1 funktioniert mit torch 2.4 sauber. Wenn
# Qwen-TTS eine neuere flash-attn-API nutzt: hochziehen und CI-Zeit
# akzeptieren.
RUN pip install --no-cache-dir flash-attn==2.7.2.post1 --no-build-isolation \
 && python -c "import flash_attn; print(f'flash-attn {flash_attn.__version__} built OK')"

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

# Kompiliertes flash-attn aus Stage 1 übernehmen. Der site-packages-
# Pfad im pytorch/pytorch-Image ist /opt/conda/lib/python3.11/site-packages.
# Wir kopieren nur das flash_attn-Paket und die CUDA-Extension-`.so`,
# ohne die Build-Toolchain mitzuschleppen.
COPY --from=flash-attn-build \
    /opt/conda/lib/python3.11/site-packages/flash_attn \
    /opt/conda/lib/python3.11/site-packages/flash_attn
COPY --from=flash-attn-build \
    /opt/conda/lib/python3.11/site-packages/flash_attn-2.7.2.post1.dist-info \
    /opt/conda/lib/python3.11/site-packages/flash_attn-2.7.2.post1.dist-info
COPY --from=flash-attn-build \
    /opt/conda/lib/python3.11/site-packages/flash_attn_2_cuda.cpython-311-x86_64-linux-gnu.so \
    /opt/conda/lib/python3.11/site-packages/flash_attn_2_cuda.cpython-311-x86_64-linux-gnu.so

# Hard-Check: wenn Import fehlschlägt, scheitert der Build sofort — kein
# stummer sdpa-Fallback mehr. Der User sieht eine klare CI-Meldung.
RUN python -c "import flash_attn; print(f'[build-verify] flash-attn {flash_attn.__version__} ready')"

COPY main.py ./

EXPOSE 8880

HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8880/health', timeout=3).status == 200 else 1)"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8880", "--log-level", "info"]
