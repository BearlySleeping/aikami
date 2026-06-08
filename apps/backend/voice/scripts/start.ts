// apps/backend/voice/scripts/start.ts
// Starts the Kokoro TTS container via Podman.
// Replaces the inline shell command in package.json dev:docker.

import { $ } from 'bun';

const IMAGE = 'hwdsl2/kokoro-server:latest';
const CONTAINER_NAME = 'aikami-voice-dev';
const HOST_PORT = '8089';
const CONTAINER_PORT = '8880';

// Remove any previous container
await $`docker rm -f ${CONTAINER_NAME} 2>/dev/null`.nothrow();

// Start Kokoro TTS server
await $`podman run --rm \
  --name ${CONTAINER_NAME} \
  -p ${HOST_PORT}:${CONTAINER_PORT} \
  --network bridge \
  -v aikami-kokoro-cache:/root/.cache/huggingface \
  ${IMAGE}`;
