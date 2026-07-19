// scripts/src/lib/ops/update_ai.ts
// Orchestrates AI Docker image updates for all microservices.
// Usage: bun run update:ai [--only text,image,voice]

import { $ } from 'bun';

const SERVICES = ['image', 'text', 'voice'] as const;
type Service = (typeof SERVICES)[number];

function parseOnly(raw?: string): Set<Service> {
  if (!raw) {
    return new Set(SERVICES);
  }
  const names = raw.split(',').map((s) => s.trim()) as Service[];
  for (const name of names) {
    if (!SERVICES.includes(name)) {
      console.error(`❌ Unknown service: "${name}". Valid: ${SERVICES.join(', ')}`);
      process.exit(1);
    }
  }
  return new Set(names);
}

// Parse --only flag manually (Bun doesn't have node:util parseArgs in all versions)
let only: string | undefined;
const args = Bun.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--only' && i + 1 < args.length) {
    only = args[i + 1];
    i++;
  } else if (args[i].startsWith('--only=')) {
    only = args[i].split('=')[1];
  }
}

const selected = parseOnly(only);

console.log(`🔄 Updating AI services: ${[...selected].join(', ')}`);
console.log('');

let failed = 0;

for (const service of SERVICES) {
  if (!selected.has(service)) {
    continue;
  }

  console.log(`--- ${service} ---`);
  const cwd = `apps/backend/${service}`;
  const exit = await $`bun run update`.cwd(cwd).nothrow();
  if (exit.exitCode !== 0) {
    failed++;
    console.error(`❌ ${service} update failed.\n`);
  } else {
    console.log('');
  }
}

if (failed > 0) {
  console.error(`❌ ${failed} service(s) failed to update.`);
  process.exit(1);
}

console.log('✅ All selected AI services updated.');
