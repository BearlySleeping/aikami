// scripts/src/lib/test_blackbox/test_runner.ts
// Run test suites in dependency order, collecting results.

import type { SuiteResult, TestSuites } from './types.ts';

const SUITE_TIMEOUT_MS = 300_000;

export async function runSuites(
  suites: TestSuites,
  options: { suite?: string; noCrossService?: boolean } = {},
): Promise<SuiteResult[]> {
  const results: SuiteResult[] = [];

  for (const suite of suites) {
    if (options.suite && suite.name !== options.suite) continue;
    if (options.noCrossService && suite.category === 'cross-service') {
      console.log(`⏭  Skipping ${suite.name} (--no-cross-service)`);
      results.push({ name: suite.name, status: 'skipped', duration: 0 });
      continue;
    }

    console.log(`\n▶ Running ${suite.name}...`);
    const start = Date.now();

    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timed out')), SUITE_TIMEOUT_MS),
      );
      await Promise.race([suite.run(), timeout]);

      const duration = Date.now() - start;
      console.log(`  ✓ ${suite.name} (${duration}ms)`);
      results.push({ name: suite.name, status: 'pass', duration });
    } catch (err) {
      const duration = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ ${suite.name} (${duration}ms): ${message}`);
      results.push({ name: suite.name, status: 'fail', duration, error: message });
    }
  }

  return results;
}
