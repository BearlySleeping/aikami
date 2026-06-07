# scripts/docker/comfyui/Dockerfile
# Minimal ComfyUI container for blackbox API surface testing (AC4).
# Runs ComfyUI in CPU-only mode with no model weights — just enough to
# verify that the REST and WebSocket endpoints accept connections.
#
# The official image is large (~8 GB) but provides the exact API surface.
# Use --with-docker flag on test_blackbox to activate.

FROM python:3.11-slim

# Install ComfyUI dependencies (CPU-only PyTorch to keep image size manageable)
RUN pip install --no-cache-dir \
    torch==2.5.1 \
    torchvision==0.20.1 \
    --index-url https://download.pytorch.org/whl/cpu

# Clone ComfyUI (shallow clone for speed)
RUN apt-get update && apt-get install -y --no-install-recommends git && \
    git clone --depth 1 --branch v0.3.27 https://github.com/comfyanonymous/ComfyUI.git /comfyui && \
    apt-get purge -y git && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

WORKDIR /comfyui

# Install remaining Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Pre-create empty model directories so ComfyUI doesn't crash on startup
RUN mkdir -p models/checkpoints models/clip models/clip_vision models/controlnet \
    models/diffusers models/embeddings models/gligen models/hypernetworks \
    models/loras models/style_models models/unet models/upscale_models \
    models/vae models/vae_approx custom_nodes

EXPOSE 8188

# Run in CPU mode — no GPU required, no models loaded
CMD ["python", "main.py", "--cpu", "--listen", "0.0.0.0", "--port", "8188"]
