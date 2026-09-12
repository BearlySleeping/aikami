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

RUN pip3 install --no-cache-dir --upgrade pip \
    && pip3 install --no-cache-dir hf_transfer peft \
    && pip3 install --no-cache-dir -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cu126
RUN pip3 install --no-cache-dir .

RUN mkdir -p /app/outputs /app/checkpoints /app/logs \
    && chown -R appuser:appuser /app

USER appuser
EXPOSE 7865
VOLUME ["/app/checkpoints", "/app/outputs", "/app/logs"]
HEALTHCHECK --interval=60s --timeout=10s --start-period=5s --retries=5 \
  CMD curl -f http://localhost:7865/ || exit 1

CMD ["python3", "acestep/gui.py", "--server_name", "0.0.0.0", "--bf16", "true"]
