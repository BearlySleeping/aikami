// scripts/src/lib/test_blackbox/reporter.ts
// Terminal and JSON report output for blackbox test results.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { c } from '../cli_utils.ts';
import type { BlackboxReport, SuiteResult } from './types.ts';

export function printTerminalReport(results: SuiteResult[], duration: number): void {
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;

  console.log(`\n${c.bold}══════════════════════════════════════${c.reset}`);
  console.log(`${c.bold}  Blackbox Test Results${c.reset}`);
  console.log(`${c.bold}══════════════════════════════════════${c.reset}\n`);

  for (const r of results) {
    let icon: string;
    if (r.status === 'pass') {
      icon = `${c.green}✓${c.reset}`;
    } else if (r.status === 'fail') {
      icon = `${c.red}✗${c.reset}`;
    } else {
      icon = `${c.yellow}⏭${c.reset}`;
    }
    const dur = r.duration > 0 ? ` (${r.duration}ms)` : '';
    console.log(`  ${icon} ${r.name}${dur}`);
    if (r.error) {
      console.log(`    ${c.red}${r.error.slice(0, 120)}${c.reset}`);
    }
  }

  console.log(
    `\n${c.bold}Summary:${c.reset} ${c.green}${passed} passed${c.reset}, ${c.red}${failed} failed${c.reset}, ${c.yellow}${skipped} skipped${c.reset}`,
  );
  console.log(`Duration: ${c.cyan}${(duration / 1000).toFixed(1)}s${c.reset}\n`);
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
