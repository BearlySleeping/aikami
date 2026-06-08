// apps/backend/image/scripts/start.ts
// Starts the ComfyUI container via Podman with GPU passthrough and CORS enabled.
// Replaces the inline shell command in package.json dev:docker.

import { $ } from 'bun';

const IMAGE = 'yanwk/comfyui-boot:cu130-slim-v2';
const CONTAINER_NAME = 'aikami-image-dev';
const PORT = '8188';

// Ensure cache and mount directories exist
await $`mkdir -p src/cache/huggingface src/cache/torch src/cache/dot-config src/models/checkpoints src/input src/output src/user src/custom_nodes`;

// Remove any previous container
await $`docker rm -f ${CONTAINER_NAME} 2>/dev/null`.nothrow();

// Start ComfyUI with GPU, CORS, and model volume mounts
await $`podman run --rm \
  --name ${CONTAINER_NAME} \
  --pull=newer \
  --device nvidia.com/gpu=all \
  --security-opt label=disable \
  -p ${PORT}:8188 \
  -v ./src/cache:/root/.cache \
  -v ./src/cache/dot-config:/root/.config \
  -v ./src/models:/root/ComfyUI/models \
  -v ./src/cache/huggingface:/root/.cache/huggingface/hub \
  -v ./src/cache/torch:/root/.cache/torch/hub \
  -v ./src/input:/root/ComfyUI/input \
  -v ./src/output:/root/ComfyUI/output \
  -v ./src/user:/root/ComfyUI/user \
  -v ./src/custom_nodes:/root/ComfyUI/custom_nodes \
  -e CLI_ARGS='--fast --enable-cors-header' \
  -e HF_XET_HIGH_PERFORMANCE=1 \
  ${IMAGE}`;
