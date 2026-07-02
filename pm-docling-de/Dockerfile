# pm-docling-de — docling-serve with German Tesseract language pack.
#
# The upstream docling-serve image (CPU and CUDA) ships tesseract
# itself but only the English language pack. That means ocr_engine=
# tesseract + ocr_lang=deu fails with "Failed loading language 'deu'",
# falling back to RapidOCR — which can't read German diacritics
# (Ubersicht instead of Übersicht, gedachtnis instead of Gedächtnis).
#
# This image adds tesseract-langpack-deu on top of the official CUDA
# variant. Nothing else changes — same entrypoint, same ports, same
# environment variables.
#
# Build target is multi-arch by default in CI, but the GPU container
# only makes sense on linux/amd64 with NVIDIA runtime; arm64 build is
# provided so the dev-box (M2 Mac) can pull-and-inspect without the
# CUDA path actually working.
FROM quay.io/docling-project/docling-serve:v1.16.1

# We tried `dnf install tesseract-langpack-deu` first but it fails
# inside this slim container — the package installs + verifies fine,
# then dnf returns exit 1 from a post-transaction trigger (no
# systemd / scriptlet runner). Workaround: pull the .traineddata
# straight from the upstream Tesseract repo. The tessdata_fast
# variant is what every recent tesseract uses by default (LSTM
# weights, ~15 MB).
#
# TESSDATA_PREFIX is set to /usr/share/tesseract/tessdata/ by the
# base image, so dropping the file there makes it pick-up
# automatically. `tesseract --list-langs` will then show "deu".
# osd.traineddata: orientation & script detection. The base image
# doesn't ship it, so every OCR rectangle logged "OSD failed" and
# rotated/skewed scans were OCR'd at an assumed 0° — garbage text on
# rotated pages. With the file present, tesseract detects rotation.
USER 0
RUN curl -fsSL \
      -o /usr/share/tesseract/tessdata/deu.traineddata \
      https://github.com/tesseract-ocr/tessdata_fast/raw/main/deu.traineddata \
 && curl -fsSL \
      -o /usr/share/tesseract/tessdata/osd.traineddata \
      https://github.com/tesseract-ocr/tessdata_fast/raw/main/osd.traineddata
USER 1001
