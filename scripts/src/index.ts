// scripts/src/index.ts
/**
 * Script runner for the Aikami monorepo.
 *
 * Usage:
 *   bun run scripts                     # Interactive mode — lists all scripts
 *   bun run scripts -- setup            # Run setup.ts directly
 *   bun run scripts -- dev_all          # Run dev_all.ts directly
 *   bun run scripts -- generate_llms    # Run generate_llms_txt.ts
 */

import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

// Short name → relative path from src/lib/
const SCRIPT_MAP: Record<string, string> = {
  setup: 'setup.ts',
  dev_all: 'dev_all.ts',
  dev: 'dev_all.ts',
  generate_llms: 'generate_llms_txt.ts',
  generate_context: 'generate_context.ts',
  cleanup_vendor_dirs: 'cleanup_vendor_dirs.ts',
  cleanup: 'cleanup_vendor_dirs.ts',
  validate_all: 'validate_all.ts',
  validate: 'validate_all.ts',
  test_blackbox: '../test_blackbox/run.ts',
  test_bb: '../test_blackbox/run.ts',
  bb: '../test_blackbox/run.ts',
};

const SCRIPT_DIR = join(import.meta.dir, 'lib');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function log(msg: string) {
  console.log(msg);
}

function ok(msg: string) {
  console.log(`${GREEN}✓${RESET} ${msg}`);
}

function error(msg: string) {
  console.error(`${RED}✗${RESET} ${msg}`);
}

async function findScripts(dir: string, base: string): Promise<string[]> {
  const scripts: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      scripts.push(...(await findScripts(fullPath, base)));
    } else if (entry.name.endsWith('.ts')) {
      scripts.push(relative(base, fullPath));
    }
  }
  return scripts.sort();
}

async function runScript(scriptRelPath: string, scriptArgs: string[]): Promise<void> {
  const absPath = join(SCRIPT_DIR, scriptRelPath);

  try {
    // Dynamic import to run the script
    log(`\n${BOLD}Running: ${CYAN}${scriptRelPath}${RESET}`);
    if (scriptArgs.length > 0) {
      log(`Args: ${scriptArgs.join(' ')}`);
    }
    log('');

    const proc = Bun.spawn({
      cmd: ['bun', 'run', absPath, ...scriptArgs],
      stdout: 'inherit',
      stderr: 'inherit',
      stdin: 'inherit',
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      error(`Script exited with code ${exitCode}`);
      process.exit(exitCode);
    }

    ok(`Done — ${scriptRelPath}`);
  } catch (err) {
    error(`Failed to run: ${scriptRelPath}`);
    if (err instanceof Error) error(err.message);
    process.exit(1);
  }
}

function resolveScriptPath(nameOrPath: string): string {
  if (SCRIPT_MAP[nameOrPath]) {
    return SCRIPT_MAP[nameOrPath];
  }
  if (nameOrPath.endsWith('.ts')) {
    return nameOrPath;
  }
  return `${nameOrPath}.ts`;
}

// Interactive mode
async function interactiveMode(): Promise<void> {
  const scripts = await findScripts(SCRIPT_DIR, SCRIPT_DIR);

  if (scripts.length === 0) {
    error('No scripts found.');
    process.exit(1);
  }

  console.log(`
${BOLD}╔════════════════════════════════════════════╗${RESET}
${BOLD}║        Aikami Script Runner                ║${RESET}
${BOLD}╚════════════════════════════════════════════╝${RESET}
`);
  console.log(`${BOLD}Available scripts:${RESET}\n`);
  scripts.forEach((s, i) => {
    const num = String(i + 1).padStart(2, ' ');
    console.log(`  ${DIM}${num}.${RESET} ${s}`);
  });
  console.log();

  process.stdout.write(`${BOLD}Select a script (1-${scripts.length}):${RESET} `);

  const decoder = new TextDecoder();
  let input = '';

  for await (const chunk of Bun.stdin.stream()) {
    input += decoder.decode(chunk);
    if (input.includes('\n')) break;
  }

  const choice = input.trim();
  const index = Number.parseInt(choice, 10) - 1;

  if (Number.isNaN(index) || index < 0 || index >= scripts.length) {
    error(`Invalid selection: "${choice}"`);
    process.exit(1);
  }

  await runScript(scripts[index], Bun.argv.slice(2));
}

// Entry
const args = Bun.argv.slice(2);

if (args.length === 0) {
  await interactiveMode();
} else {
  const scriptName = args[0];
  const scriptArgs = args.slice(1);
  const scriptPath = resolveScriptPath(scriptName);
  await runScript(scriptPath, scriptArgs);
}
