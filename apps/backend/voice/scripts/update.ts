// apps/backend/voice/scripts/update.ts
// Pulls the engine images used by the voice compose profile (C-392).
// Delegates to the local-stack topology — there is no per-service image
// anymore.

import { resolve } from 'node:path';
import { $ } from 'bun';

const COMPOSE_DIR = resolve(import.meta.dir, '../../local-stack');

console.log('🔊 Updating voice service images...');
console.log('  docker compose --profile voice pull');

const pull = await $`docker compose --profile voice pull`.cwd(COMPOSE_DIR).nothrow();
if (pull.exitCode !== 0) {
  console.error('❌ Failed to pull voice profile images.');
  process.exit(1);
}

console.log('✅ Voice service images updated.');
