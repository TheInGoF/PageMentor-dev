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

USER 0
RUN dnf install -y tesseract-langpack-deu && dnf clean all
USER 1001
