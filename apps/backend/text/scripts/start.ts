// apps/backend/text/scripts/start.ts
// Starts the Ollama text container via Podman.
// Replaces the inline shell command in package.json dev:docker.

import { $ } from 'bun';

const IMAGE = 'ollama/ollama';
const CONTAINER_NAME = 'aikami-text-dev';
const HOST_PORT = '11434';
const CONTAINER_PORT = '11434';

// Ensure cache directory exists
await $`mkdir -p src/cache/ollama`;

// Remove any previous container
await $`docker rm -f ${CONTAINER_NAME} 2>/dev/null`.nothrow();

// Start Ollama
await $`podman run --rm \
  --name ${CONTAINER_NAME} \
  --pull=newer \
  --security-opt label=disable \
  -p ${HOST_PORT}:${CONTAINER_PORT} \
  -v ./src/cache/ollama:/root/.ollama \
  ${IMAGE}`;
