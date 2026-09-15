# apps/backend/local-stack/stack/ace-step.Dockerfile

FROM nvidia/cuda:12.6.0-runtime-ubuntu22.04 AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=7865 \
    HF_HUB_ENABLE_HF_TRANSFER=1 \
    DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 \
    python3-pip \
    python3-venv \
    python3-dev \
    build-essential \
    git \
    curl \
    wget \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/bin/python3 /usr/bin/python

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

RUN useradd -m -u 1001 appuser
WORKDIR /app

RUN git init . \
    && git remote add origin https://github.com/ace-step/ACE-Step.git \
    && git fetch --depth=1 origin 1bee4c9f5b43e30995f8d4d33b3919197ce1bd68 \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "1bee4c9f5b43e30995f8d4d33b3919197ce1bd68" \
    && rm -rf .git

# Pin the CUDA-12.6 torch triple BEFORE the unpinned requirements.
#
# ACE-Step's requirements.txt lists bare `torch`, `torchaudio` and
# `torchvision`. Resolving those with the cu126 index as a mere
# `--extra-index-url` lets pip pick PyPI's default torch (2.14.0, built for
# CUDA 13) while torchvision/torchaudio still come from cu126. The container
# then dies at import with:
#   RuntimeError: Detected that PyTorch and torchvision were compiled with
#   different CUDA major versions. PyTorch has CUDA Version=13.0 and
#   torchvision has CUDA Version=12.6.
# Installing the matching cu126 triple first means the later bare
# requirements are already satisfied and are never re-resolved. The versions
# are torch 2.6.0 <-> torchvision 0.21.0 <-> torchaudio 2.6.0, the cu126
# builds this CUDA 12.6 runtime base ships.
RUN pip3 install --no-cache-dir --upgrade pip \
    && pip3 install --no-cache-dir --index-url https://download.pytorch.org/whl/cu126 \
        torch==2.6.0+cu126 torchaudio==2.6.0+cu126 torchvision==0.21.0+cu126 \
    && pip3 install --no-cache-dir hf_transfer peft \
    && pip3 install --no-cache-dir -r requirements.txt
RUN pip3 install --no-cache-dir .

# ACE-Step's shipped infer-api.py calls the pipeline positionally but omits the
# pipeline's leading `format` parameter, so every argument is shifted by one:
# `format` receives `audio_duration` (an int) and generation dies with
# "object of type 'int' has no len()". Restore the missing first positional
# argument. The grep makes a future upstream change fail the build loudly
# instead of silently running an argument-misaligned server.
RUN sed -i 's/params = (/params = ("wav",/' /app/infer-api.py \
    && grep -q 'params = ("wav",' /app/infer-api.py

RUN mkdir -p /app/outputs /app/checkpoints /app/logs \
    && chown -R appuser:appuser /app

USER appuser
EXPOSE 7865
VOLUME ["/app/checkpoints", "/app/outputs", "/app/logs"]
HEALTHCHECK --interval=60s --timeout=10s --start-period=5s --retries=5 \
  CMD curl -f http://localhost:7865/ || exit 1

CMD ["python3", "acestep/gui.py", "--server_name", "0.0.0.0", "--bf16", "true"]
