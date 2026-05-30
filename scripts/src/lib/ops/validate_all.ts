// scripts/src/lib/ops/validate_all.ts
/**
 * Run full CI validation: typecheck, lint, and test across all projects.
 */

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function step(label: string) {
  console.log(`\n${BLUE}${BOLD}▶ ${label}${RESET}`);
}

async function run(label: string, cmd: string[]): Promise<boolean> {
  step(label);
  const proc = Bun.spawn({ cmd, stdout: 'inherit', stderr: 'inherit' });
  const exitCode = await proc.exited;
  if (exitCode === 0) {
    console.log(`  ${GREEN}✓ Passed${RESET}`);
    return true;
  }
  console.log(`  ${RED}✗ Failed (exit code ${exitCode})${RESET}`);
  return false;
}

async function main() {
  console.log(`\n${BOLD}Aikami CI Validation${RESET}\n`);

  const results: { label: string; passed: boolean }[] = [];

  // Typecheck all projects
  results.push({
    label: 'Typecheck',
    passed: await run('Typechecking all projects', ['bun', 'run', 'moon', 'run', ':typecheck']),
  });

  // Lint all projects
  results.push({
    label: 'Lint',
    passed: await run('Linting all projects', ['bun', 'run', 'moon', 'run', ':lint']),
  });

  // Run tests
  results.push({
    label: 'Tests',
    passed: await run('Running all tests', ['bun', 'run', 'test']),
  });

  // Summary
  console.log(`\n${BOLD}═══════════════════════════════${RESET}`);
  console.log(`${BOLD}  Validation Summary${RESET}`);
  console.log(`${BOLD}═══════════════════════════════${RESET}\n`);

  for (const r of results) {
    const icon = r.passed ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(`  ${icon} ${r.label}`);
  }

  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    console.log(`\n${RED}${BOLD}${failed.length} check(s) failed.${RESET}\n`);
    process.exit(1);
  }

  console.log(`\n${GREEN}${BOLD}All checks passed!${RESET}\n`);
}

main();
