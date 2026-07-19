// apps/backend/voice/scripts/update.ts
// Pulls the latest Kokoro TTS image.

import { $ } from 'bun';

const BASE_IMAGE = 'hwdsl2/kokoro-server:latest';

console.log('🔊 Updating voice service...');

console.log(`📥 Pulling image: ${BASE_IMAGE}`);
const pullExit = await $`podman pull ${BASE_IMAGE}`.nothrow();
if (pullExit.exitCode !== 0) {
  console.error('❌ Failed to pull image.');
  process.exit(1);
}

console.log('✅ Voice service updated.');
