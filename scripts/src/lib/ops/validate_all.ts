// scripts/src/lib/ops/validate_all.ts
/**
 * Run full CI validation: typecheck, lint, and test across all projects.
 */

import { c, runChecked } from '../cli_utils.ts';

async function main() {
  console.log(`${c.bold}Aikami CI Validation${c.reset}\n`);

  const results: { label: string; passed: boolean }[] = [];

  // Typecheck all projects
  results.push({
    label: 'Typecheck',
    passed: await runChecked('Typechecking all projects', [
      'bun',
      'run',
      'moon',
      'run',
      ':typecheck',
    ]),
  });

  // Lint all projects
  results.push({
    label: 'Lint',
    passed: await runChecked('Linting all projects', ['bun', 'run', 'moon', 'run', ':lint']),
  });

  // Run tests
  results.push({
    label: 'Tests',
    passed: await runChecked('Running all tests', ['bun', 'run', 'test']),
  });

  // Summary
  console.log(`\n${c.bold}═══════════════════════════════${c.reset}`);
  console.log(`${c.bold}  Validation Summary${c.reset}`);
  console.log(`${c.bold}═══════════════════════════════${c.reset}\n`);

  for (const r of results) {
    const icon = r.passed ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
    console.log(`  ${icon} ${r.label}`);
  }

  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    console.log(`\n${c.red}${c.bold}${failed.length} check(s) failed.${c.reset}\n`);
    process.exit(1);
  }

  console.log(`\n${c.green}${c.bold}All checks passed!${c.reset}\n`);
}

main();
