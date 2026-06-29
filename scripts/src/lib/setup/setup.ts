#!/usr/bin/env bun
// scripts/src/lib/setup/setup.ts
/**
 * Aikami Developer Setup
 * Interactive onboarding script for the aikami monorepo.
 *
 * Usage:
 *   bun run scripts/src/lib/setup/setup.ts        # Full interactive setup
 *   bun run setup                            # Via root package.json shortcut
 *   CI=true bun run setup                    # Non-interactive CI mode
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

// ─── Constants ────────────────────────────────────────────────────────────
const ROOT = join(import.meta.dir, '../../../..');
const ENV_FILE = join(ROOT, '.env');
const ENV_EXAMPLE = join(ROOT, '.env.example');

const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const isCI = process.env.CI === 'true';

// ─── Helpers ──────────────────────────────────────────────────────────────
function header(text: string) {
  console.log(`\n${BOLD}${CYAN}═══ ${text} ═══${RESET}\n`);
}

function step(num: number, text: string) {
  console.log(`\n${BOLD}${CYAN}[${num}]${RESET} ${text}`);
}

function ok(msg: string) {
  console.log(`  ${GREEN}✓${RESET} ${msg}`);
}

function warn(msg: string) {
  console.log(`  ${YELLOW}⚠${RESET} ${msg}`);
}

function fail(msg: string) {
  console.log(`  ${RED}✗${RESET} ${msg}`);
}

function info(msg: string) {
  console.log(`  ${DIM}•${RESET} ${msg}`);
}

async function prompt(question: string, defaultVal?: string): Promise<string> {
  if (isCI && defaultVal !== undefined) {
    info(`${question} ${DIM}(CI mode — using default: ${defaultVal})${RESET}`);
    return defaultVal;
  }
  if (isCI) {
    info(`${question} ${DIM}(CI mode — skipping)${RESET}`);
    return '';
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    const q = defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `;
    rl.question(q, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

async function run(label: string, cmd: string[], opts?: { cwd?: string }): Promise<boolean> {
  info(label);
  const proc = Bun.spawn({
    cmd,
    stdout: isCI ? 'pipe' : 'inherit',
    stderr: isCI ? 'pipe' : 'inherit',
    cwd: opts?.cwd,
  });

  const exitCode = await proc.exited;
  if (exitCode === 0) {
    ok(label);
    return true;
  }
  fail(`${label} (exit code ${exitCode})`);
  return false;
}

function checkTool(name: string, installHint?: string): boolean {
  const found = Bun.which(name) !== null;
  if (found) {
    ok(`${name} found`);
  } else {
    fail(`${name} NOT found`);
    if (installHint) {
      info(`Install: ${installHint}`);
    }
  }
  return found;
}

function checkVersion(name: string, minVersion: number): boolean {
  try {
    const proc = Bun.spawnSync({ cmd: [name, '--version'], stdout: 'pipe' });
    const ver = new TextDecoder().decode(proc.stdout).trim().replace(/^v/, '').split('.')[0];
    const major = Number.parseInt(ver, 10);
    const pass = major >= minVersion;
    if (pass) {
      ok(`${name} >= ${minVersion}.x (v${ver})`);
    } else {
      fail(`${name} ${ver} < ${minVersion}.x required`);
    }
    return pass;
  } catch {
    fail(`${name} version check failed`);
    return false;
  }
}

// ─── Step 1: Prerequisite Checks ──────────────────────────────────────────
async function checkPrerequisites(): Promise<boolean> {
  step(1, 'Checking prerequisites');

  const checks: boolean[] = [];

  info('Required tools:');
  checks.push(checkTool('bun', 'curl -fsSL https://bun.sh/install | bash'));
  checks.push(checkVersion('bun', 1));
  checks.push(checkTool('git', 'Install from https://git-scm.com'));

  info('\nOptional tools:');
  const hasFirebase = checkTool('firebase', 'npm install -g firebase-tools');
  if (!hasFirebase) {
    warn('Firebase CLI not found — Firebase deploy/emulator tasks will not work');
  }

  const hasMoon = Bun.which('moon') || existsSync(join(ROOT, 'node_modules/.bin/moon'));
  if (hasMoon) {
    ok('moon CLI available');
  }

  return checks.every(Boolean);
}

// ─── Step 2: Install Dependencies ─────────────────────────────────────────
async function installDependencies(): Promise<boolean> {
  step(2, 'Installing dependencies');

  const nodeModules = existsSync(join(ROOT, 'node_modules'));
  const bunLock = existsSync(join(ROOT, 'bun.lock'));

  if (nodeModules && bunLock) {
    const reinstall = await prompt('Dependencies already installed. Reinstall?', 'n');
    if (reinstall.toLowerCase() !== 'y') {
      ok('Skipping dependency installation');
      return true;
    }
  }

  if (!(await run('bun install', ['bun', 'install']))) {
    return false;
  }
  if (!(await run('moon sync', ['bun', 'run', 'moon', 'sync']))) {
    return false;
  }

  return true;
}

// ─── Step 3: Environment Configuration ────────────────────────────────────
async function configureEnvironment(): Promise<boolean> {
  step(3, 'Configuring environment');

  // Create .env.example if it doesn't exist
  if (!existsSync(ENV_EXAMPLE)) {
    const exampleContent = `# Aikami Environment Configuration
# Copy this file to .env and fill in your values.
# Generated by setup script — see scripts/src/lib/setup/setup.ts

# Mode / Flavor
PUBLIC_FLAVOR=staging

# Firebase Configuration
PUBLIC_FIREBASE_PROJECT_ID=your-project-id
PUBLIC_FIREBASE_API_KEY=your-api-key
PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
PUBLIC_FIREBASE_MESSAGING_SENDER_ID=000000000000
PUBLIC_FIREBASE_APP_ID=your-app-id
PUBLIC_FIREBASE_MEASUREMENT_ID=your-measurement-id

# Optional: Firebase Emulator
# Set PUBLIC_FLAVOR=emulator to use local emulators

# Optional: App Check (set PUBLIC_DISABLE_APP_CHECK=1 to disable)
# PUBLIC_DISABLE_APP_CHECK=1

# Optional: Gmail Integration
# PUBLIC_GMAIL_CLIENT_ID=your-client-id

# Optional: Push Notifications
# PUBLIC_VAPID_KEY=your-vapid-key
`;
    writeFileSync(ENV_EXAMPLE, exampleContent, 'utf8');
    ok('Created .env.example');
  }

  // Handle existing .env
  if (existsSync(ENV_FILE)) {
    const overwrite = await prompt('.env already exists. Overwrite?', 'n');
    if (overwrite.toLowerCase() !== 'y') {
      ok('Keeping existing .env');
      return true;
    }
  }

  // Check for .env.example
  if (!existsSync(ENV_EXAMPLE)) {
    warn('No .env.example found — skipping .env creation');
    return true;
  }

  // Interactive: prompt for Firebase project
  const projectId = await prompt('Firebase project ID (leave blank for default)', 'demo-aikami');
  const flavor = await prompt('Environment flavor (staging/emulator/production)', 'staging');

  const envContent = readFileSync(ENV_EXAMPLE, 'utf8')
    .replace('PUBLIC_FLAVOR=staging', `PUBLIC_FLAVOR=${flavor}`)
    .replace(
      'PUBLIC_FIREBASE_PROJECT_ID=your-project-id',
      `PUBLIC_FIREBASE_PROJECT_ID=${projectId}`,
    );

  writeFileSync(ENV_FILE, envContent, 'utf8');
  ok('.env created');

  if (projectId === 'demo-aikami' || !projectId) {
    warn('.env created with placeholder values — update before deploying');
  }

  return true;
}

// ─── Step 4: Verification ─────────────────────────────────────────────────
async function verifySetup(): Promise<boolean> {
  step(4, 'Verifying setup');

  info('Running typecheck on all projects...');
  const typecheckPassed = await run('Typecheck', ['bun', 'run', 'moon', 'run', ':typecheck']);

  if (!typecheckPassed) {
    warn('Typecheck had issues — check errors above');
    return false;
  }

  info('\nRunning lint checks...');
  const lintPassed = await run('Lint', ['bun', 'run', 'moon', 'run', ':lint']);
  if (!lintPassed) {
    warn('Lint had issues — run `bun run fix` to auto-fix');
  }

  return typecheckPassed;
}

// ─── Step 5: Next Steps ───────────────────────────────────────────────────
function printNextSteps() {
  header('Setup Complete!');
  console.log(`${BOLD}Getting started:${RESET}\n`);
  console.log(`  ${CYAN}bun run dev${RESET}              Start Client dev server`);
  console.log(`  ${CYAN}bun run dev:all${RESET}           Start all services (firebase + client)`);
  console.log(`  ${CYAN}bun run test${RESET}             Run all tests (requires firebase)`);
  console.log(`  ${CYAN}bun run fix${RESET}              Auto-fix lint/format issues`);
  console.log(`  ${CYAN}bun run typecheck${RESET}        Typecheck all projects`);
  console.log(
    `  ${CYAN}bun run validate${RESET}         Full validation (lint + format + typecheck)`,
  );
  console.log(`  ${CYAN}bun run scripts${RESET}          Interactive script runner`);
  console.log(`\n${BOLD}Documentation:${RESET}\n`);
  console.log(`  ${DIM}.context/CONTEXT.md${RESET}      AI briefing — read this first`);
  console.log(`  ${DIM}.context/llms.txt${RESET}         Full knowledge index`);
  console.log(`  ${DIM}docs/contracts/INDEX.md${RESET}   Feature contracts`);
  console.log(`  ${DIM}docs/guides/STACK.md${RESET}     Tech stack reference`);
  console.log('');
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${BOLD}╔══════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}║     Aikami Developer Setup               ║${RESET}`);
  console.log(`${BOLD}╚══════════════════════════════════════════╝${RESET}`);

  if (isCI) {
    info('CI mode detected — running non-interactively');
  }

  // Step 1: Prerequisites
  const prereqsOk = await checkPrerequisites();
  if (!prereqsOk) {
    header('Prerequisite Check Failed');
    console.log('Please install the missing tools above and re-run setup.');
    process.exit(1);
  }

  // Step 2: Dependencies
  const depsOk = await installDependencies();
  if (!depsOk) {
    header('Dependency Installation Failed');
    console.log('Please check the errors above and re-run setup.');
    process.exit(1);
  }

  // Step 3: Environment
  const envOk = await configureEnvironment();
  if (!envOk) {
    warn('Environment configuration incomplete — you can run setup again later');
  }

  // Step 4: Verify
  const verifyOk = await verifySetup();
  if (!verifyOk) {
    warn('Verification had issues — you can still develop, but fix the errors soon');
  }

  // Step 5: Next steps
  printNextSteps();
}

main().catch((err) => {
  console.error(`${RED}Setup failed with unexpected error:${RESET}`, err);
  process.exit(1);
});
