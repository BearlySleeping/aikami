// scripts/src/lib/ops/legacy_catalog_bootstrap.ts
//
// Read-only inspection of the first-release migration.
//
//   bun run emberwatch:legacy-bootstrap --mode production
//
// Prints exactly what a first immutable production release would carry,
// replace, drop or reject from the legacy mutable catalog — and writes nothing.
// The migration itself runs inside the normal publish path; this exists so an
// operator can review it BEFORE that path is allowed to write, which is the
// whole point of having a dry run.
//
// The target goes through the same fail-closed release-target gate the
// publisher uses, so this cannot be pointed at a bucket or origin the mode does
// not declare.

import { resolveCatalogTarget } from '../catalog/config.ts';
import { bootstrapLegacyCatalog, describeLegacyBootstrap } from '../catalog/legacy_bootstrap.ts';

const USAGE = `Legacy catalog bootstrap (read-only)

  bun run emberwatch:legacy-bootstrap --mode production

Prints what a first immutable release would carry from the legacy mutable
catalog. Performs no write. Exit 0 = reviewable, 2 = refused.`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.length === 0) {
  console.log(USAGE);
  process.exit(args.length === 0 ? 4 : 0);
}

const modeIndex = args.indexOf('--mode');
const mode = modeIndex >= 0 ? args[modeIndex + 1] : undefined;
if (mode !== 'staging' && mode !== 'production') {
  console.error('❌ --mode must be staging or production.');
  console.error(USAGE);
  process.exit(4);
}

let target: ReturnType<typeof resolveCatalogTarget>;
try {
  target = resolveCatalogTarget(mode);
} catch (error) {
  console.error('❌ release target refused — nothing was read.');
  console.error(`   ${(error as Error).message}`);
  process.exit(2);
}

console.log(`Legacy catalog bootstrap — mode ${mode}`);
console.log(`  bucket: ${target.bucket}`);
console.log(`  origin: ${target.originUrl}`);
console.log('');

const outcome = await bootstrapLegacyCatalog({ originUrl: target.originUrl });

if (!outcome.ok) {
  console.error(`❌ migration refused (${outcome.code}): ${outcome.reason}`);
  process.exit(2);
}

if (!outcome.applied) {
  console.log(`✅ nothing to migrate — ${outcome.reason}`);
  process.exit(0);
}

console.log('✅ migration plan (read-only):');
for (const line of describeLegacyBootstrap(outcome.plan).split('\n')) {
  console.log(`   ${line}`);
}
console.log('');
console.log('   No write was performed. The migration runs inside the publish path.');
process.exit(0);
