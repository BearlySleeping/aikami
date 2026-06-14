// Quick single-screenshot smoke test for the LPC character URL.
import { $ } from 'bun';
import { resolve } from 'node:path';

const E2E_DIR = resolve(import.meta.dirname, '..');

console.log('📸 Capturing single LPC character screenshot...\n');

const result = await $`bun x playwright test tests/client/lpc_man.spec.ts --project=client`.cwd(E2E_DIR).nothrow();

if (result.exitCode !== 0) {
  console.error('❌ Test failed');
  process.exit(1);
}

const imgPath = resolve(E2E_DIR, 'test-results/lpc-visual/man-debug.png');
console.log(`\n✅ Screenshot saved: ${imgPath}`);
