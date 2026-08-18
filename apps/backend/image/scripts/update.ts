// apps/backend/image/scripts/update.ts
/** biome-ignore-all lint/suspicious/noConsole: CLI script — console is the interface */
// Pulls the engine images used by the image compose profile (C-392).
// Delegates to the local-stack topology — there is no per-service image
// anymore.

import { resolve } from 'node:path';
import { $ } from 'bun';

const COMPOSE_DIR = resolve(import.meta.dir, '../../local-stack');

console.log('🖼️  Updating image service images...');
console.log('  docker compose --profile image pull');

const pull = await $`docker compose --profile image pull`.cwd(COMPOSE_DIR).nothrow();
if (pull.exitCode !== 0) {
  console.error('❌ Failed to pull image profile images.');
  process.exit(1);
}

console.log('✅ Image service images updated.');
