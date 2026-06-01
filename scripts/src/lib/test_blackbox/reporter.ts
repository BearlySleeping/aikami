// scripts/src/lib/test_blackbox/reporter.ts
// Terminal and JSON report output for blackbox test results.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BlackboxReport, SuiteResult } from './types.ts';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export function printTerminalReport(results: SuiteResult[], duration: number): void {
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;

  console.log(`\n${BOLD}══════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  Blackbox Test Results${RESET}`);
  console.log(`${BOLD}══════════════════════════════════════${RESET}\n`);

  for (const r of results) {
    const icon =
      r.status === 'pass'
        ? `${GREEN}✓${RESET}`
        : r.status === 'fail'
          ? `${RED}✗${RESET}`
          : `${YELLOW}⏭${RESET}`;
    const dur = r.duration > 0 ? ` (${r.duration}ms)` : '';
    console.log(`  ${icon} ${r.name}${dur}`);
    if (r.error) {
      console.log(`    ${RED}${r.error.slice(0, 120)}${RESET}`);
    }
  }

  console.log(
    `\n${BOLD}Summary:${RESET} ${GREEN}${passed} passed${RESET}, ${RED}${failed} failed${RESET}, ${YELLOW}${skipped} skipped${RESET}`,
  );
  console.log(`Duration: ${CYAN}${(duration / 1000).toFixed(1)}s${RESET}\n`);
}

export function writeJsonReport(results: SuiteResult[], duration: number): void {
  const report: BlackboxReport = {
    timestamp: new Date().toISOString(),
    duration,
    total: results.length,
    passed: results.filter((r) => r.status === 'pass').length,
    failed: results.filter((r) => r.status === 'fail').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    suites: results,
  };

  const outPath = join(import.meta.dir, '../../..', 'test-results', 'blackbox-report.json');
  const fs = require('node:fs');
  fs.mkdirSync(join(import.meta.dir, '../../..', 'test-results'), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Report: ${outPath}`);
}
