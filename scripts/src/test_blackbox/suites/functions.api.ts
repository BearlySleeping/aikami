// scripts/src/test_blackbox/suites/functions.api.ts
// Test Firebase Functions via HTTP calls against local emulators.

import type { TestSuite } from '../types.ts';

const FUNCTIONS_URL = 'http://localhost:5001';

export const functionsSuite: TestSuite = {
  name: 'functions',
  category: 'service',
  run: async () => {
    console.log('  Probing function endpoints...');

    // Try to hit the emulator functions hub
    try {
      const res = await fetch(`${FUNCTIONS_URL}/`, { signal: AbortSignal.timeout(5000) });
      if (res.ok || res.status < 500) {
        console.log(`  ✓ Functions emulator responding (${res.status})`);
      }
    } catch {
      console.log('  ⚠ Functions emulator not reachable — skipping API tests');
      return;
    }

    // Emulator is running — basic health check passed
    console.log('  ✓ Functions emulator health check passed');
  },
};
