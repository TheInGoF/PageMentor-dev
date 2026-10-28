# pm-kokoro-tts: Kokoro-82M Deutsch (Martin, Kerstin), ONNX auf der CPU
# Bauen aus dem Repo-Wurzelordner: docker build -f pm-kokoro-tts/Dockerfile .
FROM python:3.11-slim-bookworm

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 OMP_WAIT_POLICY=PASSIVE

RUN apt-get update && apt-get install -y --no-install-recommends \
        espeak-ng libsndfile1 ffmpeg curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pm-kokoro-tts/requirements.txt .
RUN pip install -r requirements.txt

# Modell fest auf einen Stand, ~330 MB
ARG KOKORO_REV=a1cba7fbf0e72fbae38f0a3a48ce0dc8e6077804
RUN mkdir -p /models && for f in kokoro-martin.onnx voices-martin.npz; do \
      curl -fsSL -o /models/$f "https://huggingface.co/Godelaune/Kokoro-82M-ONNX-German-Martin/resolve/${KOKORO_REV}/$f"; \
    done

# Kerstin, eigenes Modell gleicher Bauart, ~340 MB; Stimmvektor als npz für kokoro-onnx
ARG KERSTIN_REV=eeccb15741604cdc894053e1f4c72bb56c1a59be
RUN base="https://huggingface.co/crane-local-ai/Kokoro-82M-v1.0-German-ONNX/resolve/${KERSTIN_REV}" \
 && curl -fsSL -o /models/kokoro-kerstin.onnx "$base/onnx/model.onnx" \
 && curl -fsSL -o /tmp/df_kerstin.bin "$base/voices/df_kerstin.bin" \
 && python -c "import numpy as np; np.savez('/models/voices-kerstin.npz', kerstin=np.fromfile('/tmp/df_kerstin.bin', dtype=np.float32).reshape(-1, 1, 256))" \
 && rm /tmp/df_kerstin.bin

COPY pm-tts-common/tts_common ./tts_common
COPY pm-kokoro-tts/*.py ./

EXPOSE 8880
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8880/health', timeout=3).status == 200 else 1)"
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8880", "--log-level", "info"]
