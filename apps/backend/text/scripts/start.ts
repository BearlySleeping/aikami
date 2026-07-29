// apps/backend/text/scripts/start.ts
// Starts the Ollama text container via Podman.
// Replaces the inline shell command in package.json dev:docker.

import { $ } from 'bun';
import { homedir } from 'node:os';

const IMAGE = 'ollama/ollama';
const CONTAINER_NAME = 'aikami-text-dev';
const HOST_PORT = 11434;
const CONTAINER_PORT = 11434;

// Skip Docker if a system Ollama is already listening on the port.
const checkPort = await $`ss -tlnp src :${HOST_PORT} 2>/dev/null | grep -q LISTEN`.nothrow();
if (checkPort.exitCode === 0) {
  // Verify it's actually Ollama by probing its API
  const isOllama = await $`curl -sf http://localhost:${HOST_PORT}/api/version 2>/dev/null`.nothrow();
  if (isOllama.exitCode !== 0) {
    console.error(`❌ Port ${HOST_PORT} is already in use by another process (not Ollama).`);
    console.error('   Please free the port or stop the conflicting service before running this script.');
    process.exit(1);
  }
  console.log(`Port ${HOST_PORT} is already in use — local Ollama detected.`);
  console.log('Tailing logs below. Press Ctrl+C to stop.\n');

  // Detect best log source and tail it so the herdr tab stays alive with real-time output.
  const systemdCheck = await $`systemctl is-active ollama 2>/dev/null`.nothrow();
  if (String(systemdCheck.stdout).trim() === 'active') {
    console.log('📋 Streaming via journalctl -u ollama -f\n');
    await $`journalctl -u ollama -f -n 20 --no-pager`;
  } else {
    const logFile = `${homedir()}/.ollama/logs/server.log`;
    const logExists = await $`test -f ${logFile}`.nothrow();
    if (logExists.exitCode === 0) {
      console.log(`📋 Streaming via tail -f ${logFile}\n`);
      await $`tail -f ${logFile}`;
    } else {
      console.log('⚠ Could not find Ollama logs (not a systemd service, no ~/.ollama/logs/server.log).');
      console.log('Ollama is running — no automatic log source detected.');
      // Stay alive so the herdr tab doesn't close immediately.
      await $`echo 'Press Ctrl+C to stop watching.'; sleep infinity`;
    }
  }
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
