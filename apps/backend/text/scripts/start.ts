// apps/backend/text/scripts/start.ts
// Starts the Ollama text container via Podman.
// Replaces the inline shell command in package.json dev:docker.

import { $ } from 'bun';

const IMAGE = 'ollama/ollama';
const CONTAINER_NAME = 'aikami-text-dev';
const HOST_PORT = 11434;
const CONTAINER_PORT = 11434;

// Skip Docker if a system Ollama is already listening on the port.
const checkPort = await $`ss -tlnp src :${HOST_PORT} 2>/dev/null | grep -q LISTEN`.nothrow();
if (checkPort.exitCode === 0) {
  console.log(`Port ${HOST_PORT} is already in use — skipping Docker (system Ollama detected).`);
  process.exit(0);
}

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
