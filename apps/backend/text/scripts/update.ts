// apps/backend/text/scripts/update.ts
// Pulls the latest Ollama image.

import { $ } from 'bun';

const BASE_IMAGE = 'ollama/ollama';

console.log('📝 Updating text service...');

console.log(`📥 Pulling image: ${BASE_IMAGE}`);
const pullExit = await $`podman pull ${BASE_IMAGE}`.nothrow();
if (pullExit.exitCode !== 0) {
  console.error('❌ Failed to pull image.');
  process.exit(1);
}

console.log('✅ Text service updated.');
