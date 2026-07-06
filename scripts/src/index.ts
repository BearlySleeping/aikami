#!/usr/bin/env bun
/**
 * Script runner for the Aikami monorepo.
 *
 * Two modes:
 * 1. DIRECT:  bun run scripts -- <name> [args...]
 *    Resolves <name> via SCRIPT_MAP short names or as a path relative to src/lib/.
 *    Example: bun run scripts -- setup
 *
 * 2. INTERACTIVE:  bun run scripts
 *    Lists all available scripts and lets you pick one to run.
 */

import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { c, error, log, ok } from './lib/cli_utils';

// ---------------------------------------------------------------------------
// Short name → relative path from src/lib/
// ---------------------------------------------------------------------------
const SCRIPT_MAP: Record<string, string> = {
  // Ops scripts
  preview: 'ops/preview.ts',
  build_preview_client: 'ops/preview.ts',
  dev_all: 'ops/dev_all.ts',
  dev: 'ops/dev_all.ts',
  generate_llms: 'ops/generate_llms_txt.ts',
  generate_context: 'ops/generate_context.ts',
  cleanup_vendor_dirs: 'ops/cleanup_vendor_dirs.ts',
  cleanup: 'ops/cleanup_vendor_dirs.ts',
  validate_all: 'ops/validate_all.ts',
  validate: 'ops/validate_all.ts',

  // Setup scripts
  setup: 'setup/setup.ts',

  // Test scripts
  test_blackbox: 'test_blackbox/run.ts',
  test_bb: 'test_blackbox/run.ts',
  bb: 'test_blackbox/run.ts',

  // Herdr session management
  'herdr:start': 'herdr/start.ts',
  hstart: 'herdr/start.ts',
  'herdr:join': 'herdr/join.ts',
  hjoin: 'herdr/join.ts',
  'herdr:stop': 'herdr/stop.ts',
  hstop: 'herdr/stop.ts',
  'herdr:stop-all': 'herdr/stop_all.ts',
  hstopall: 'herdr/stop_all.ts',
  'herdr:status': 'herdr/status.ts',
  hstatus: 'herdr/status.ts',
  'herdr:list': 'herdr/list.ts',
  hlist: 'herdr/list.ts',

  // Swarm director
  'swarm:init': 'agents/swarm_init.ts',
  'swarm:start': 'agents/swarm_start.ts',
  'sandbox:scaffold': 'agents/sandbox_scaffolder.ts',
  scaffold: 'agents/sandbox_scaffolder.ts',
  'scope:explore': 'agents/scope_explorer.ts',
  'skill:optimize': 'agents/skill_optimizer.ts',
  'contract:generate': 'agents/contract_generator.ts',
};

const SCRIPT_DIR = join(import.meta.dir, 'lib');
const EXCLUDED_FILES = new Set(['cli_utils.ts']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findScripts(dir: string, base: string): Promise<string[]> {
  const scripts: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      scripts.push(...(await findScripts(fullPath, base)));
    } else if (entry.name.endsWith('.ts') && !EXCLUDED_FILES.has(entry.name)) {
      scripts.push(relative(base, fullPath));
    }
  }
  return scripts.sort();
}

async function runScript(scriptRelPath: string, scriptArgs: string[]): Promise<void> {
  const absPath = join(SCRIPT_DIR, scriptRelPath);
  const file = Bun.file(absPath);

  if (!(await file.exists())) {
    error(`Script not found: ${scriptRelPath}`);
    error(`  Looked at: ${absPath}`);
    process.exit(1);
  }

  log(`Running ${c.bold}${scriptRelPath}${c.reset}...`);
  if (scriptArgs.length > 0) {
    console.log(`Args: ${scriptArgs.join(' ')}`);
  }

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

  ok('Done');
}

function resolveScriptPath(nameOrPath: string): string {
  // Check short name map first
  if (SCRIPT_MAP[nameOrPath]) {
    return SCRIPT_MAP[nameOrPath];
  }

  // Try as relative path from src/lib/
  if (nameOrPath.endsWith('.ts')) {
    return nameOrPath;
  }

  return `${nameOrPath}.ts`;
}

// ---------------------------------------------------------------------------
// Interactive mode
// ---------------------------------------------------------------------------

async function interactiveMode(): Promise<void> {
  const scripts = await findScripts(SCRIPT_DIR, SCRIPT_DIR);

  if (scripts.length === 0) {
    error('No scripts found.');
    process.exit(1);
  }

  console.log(`
${c.bold}╔═══════════════════════════════════════════════════╗${c.reset}
${c.bold}║         Aikami Script Runner                      ║${c.reset}
${c.bold}╚═══════════════════════════════════════════════════╝${c.reset}
`);

  console.log(`${c.bold}Available scripts:${c.reset}\n`);
  scripts.forEach((s, i) => {
    const num = String(i + 1).padStart(2, ' ');
    console.log(`  ${c.dim}${num}.${c.reset} ${s}`);
  });
  console.log();

  const promptText = `${c.bold}Select a script to run (1-${scripts.length}):${c.reset} `;
  process.stdout.write(promptText);

  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  let input = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    input += decoder.decode(value, { stream: true });
    if (input.includes('\n')) {
      break;
    }
  }

  await reader.releaseLock();

  const choice = input.trim();
  const index = Number.parseInt(choice, 10) - 1;

  if (Number.isNaN(index) || index < 0 || index >= scripts.length) {
    error(`Invalid selection: "${choice}"`);
    process.exit(1);
  }

  const scriptPath = scripts[index];
  const extraArgs = Bun.argv.slice(2);

  await runScript(scriptPath, extraArgs);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

const args = Bun.argv.slice(2); // ['bun', 'index.ts', ...]

if (args.length === 0) {
  await interactiveMode();
} else {
  // Direct mode: first arg is script name/path, rest are script args
  const scriptName = args[0];
  const scriptArgs = args.slice(1);
  const scriptPath = resolveScriptPath(scriptName);

  await runScript(scriptPath, scriptArgs);
}
