#!/usr/bin/env bun
// scripts/src/lib/herdr/start_autofix.ts
//
// Spawns a pi agent in the aikami-pi workspace configured for automated
// fix → typecheck → test → commit/push workflows.
//
// Model: deepseek-v4-flash (best cost/capability ratio for mechanical
//   lint/typecheck fixes — 10× cheaper than pro, fully competent)
// Thinking: medium (enough to reason about non-obvious fixes, not wasteful)
//
// Usage:
//   bun autofix                              # fix + typecheck + commit (default)
//   bun autofix --all                        # fix + typecheck + test:unit + commit
//   bun autofix --only commit                # commit only (pre-commit hook covers fix/typecheck)
//   bun autofix --only fix,typecheck         # fix + typecheck, no commit
//   bun autofix --only test,commit           # test:unit then commit
//   bun autofix --only test:e2e              # e2e tests only (starts client + firebase)
//   bun autofix --only test:all              # all tests including e2e
//   bun autofix --only fix --only typecheck  # repeated flags accumulate
//   bun autofix --model deepseek/deepseek-v4-pro --thinking high
//   bun autofix --join                       # spawn + attach

// biome-ignore-all lint/style/useNamingConvention: HerDr API response field names (snake_case) — must match external API contract
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AikamiMode } from './session.ts';
import {
  buildSessionName,
  ensureServer,
  findWorkspace,
  getWorkspaceTabNames,
  herdr,
  herdrJson,
  isPortReady,
  startServices,
  wrapCommand,
} from './session.ts';

// ── Types ──────────────────────────────────────────────────

type WorkspaceCreateResult = {
  result: {
    workspace: { workspace_id: string };
    tab: { tab_id: string };
    root_pane: { pane_id: string };
  };
};

type TabCreateResult = {
  result: {
    tab: { tab_id: string };
    root_pane: { pane_id: string };
  };
};

type AutofixStep = 'fix' | 'typecheck' | 'test' | 'commit';
type TestMode = 'unit' | 'e2e' | 'all';

const ALL_STEPS: AutofixStep[] = ['fix', 'typecheck', 'test', 'commit'];
const DEFAULT_STEPS: AutofixStep[] = ['fix', 'typecheck', 'commit'];

// ── Constants ──────────────────────────────────────────────

const PI_WORKSPACE = 'aikami-pi';
const AUTOFIX_TAB = 'autofix';
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';
const DEFAULT_THINKING = 'medium';
const CLIENT_PORT = 5274;
const FB_AUTH_PORT = 9098;
const FB_HUB_PORT = 4401;

// ── CLI arg parsing ────────────────────────────────────────

const args = process.argv.slice(2);

const doJoin = args.includes('--join') || args.includes('-j');
const doAll = args.includes('--all');
const model = parseOpt(['--model', '-m']) ?? DEFAULT_MODEL;
const thinking = parseOpt(['--thinking']) ?? DEFAULT_THINKING;

// Collect --only values (supports repeated flags, comma, and space separation)
const onlyValues = args.flatMap((a, i) => {
  if ((a === '--only' || a === '-o') && i + 1 < args.length) {
    return args[i + 1].split(/[,\s]+/).filter(Boolean);
  }
  return [];
});

// Parse test mode from --only values: "test", "test:unit", "test:e2e", "test:all"
const testMode: TestMode = parseTestMode(onlyValues);

// Normalize step names: "test:unit" / "test:e2e" / "test:all" → "test"
const normalizedOnly = onlyValues.map((v) => (v.startsWith('test') ? 'test' : v));

const steps: AutofixStep[] = doAll
  ? [...ALL_STEPS]
  : onlyValues.length > 0
    ? dedupe(normalizedOnly.filter(isValidStep))
    : [...DEFAULT_STEPS];

const doFix = steps.includes('fix');
const doTypecheck = steps.includes('typecheck');
const doTest = steps.includes('test');
const doCommit = steps.includes('commit');
const commitOnly = steps.length === 1 && doCommit;
const needsClient = doTest;
const needsFirebase = doTest && testMode !== 'unit';

// ── Helpers ────────────────────────────────────────────────

function parseOpt(names: string[]): string | undefined {
  for (const name of names) {
    const idx = args.indexOf(name);
    if (idx !== -1 && idx + 1 < args.length) {
      return args[idx + 1];
    }
  }
  return undefined;
}

function isValidStep(s: string): s is AutofixStep {
  return (ALL_STEPS as string[]).includes(s);
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/** Extract test mode from --only values. Defaults to 'unit'. */
function parseTestMode(values: string[]): TestMode {
  for (const v of values) {
    if (v === 'test:e2e') {
      return 'e2e';
    }
    if (v === 'test:all') {
      return 'all';
    }
  }
  return 'unit';
}

const ok = (m: string) => console.log(`  ✓ ${m}`);

// ── Service readiness ──────────────────────────────────────

/**
 * Waits for the client dev server to be fully ready — port open + Vite
 * has compiled and is serving real HTML (not a blank/loading page).
 */
const waitForClientReady = async (port: number, timeoutSec: number): Promise<boolean> => {
  for (let i = 0; i < timeoutSec; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(`http://localhost:${port}/`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        continue;
      }
      const text = await res.text();
      if (text.length > 500) {
        ok(`client ready (port ${port}, ${text.length}B response)`);
        return true;
      }
    } catch {
      // Not ready yet
    }
  }
  return false;
};

/** Wait for firebase emulator hub to respond. */
const waitForFirebaseReady = async (timeoutSec: number): Promise<boolean> => {
  for (let i = 0; i < timeoutSec; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(`http://localhost:${FB_HUB_PORT}/`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        ok('firebase emulators ready');
        return true;
      }
    } catch {
      // Not ready yet
    }
  }
  return false;
};

/** Ensure a dev service is running in herdr, starting it if needed. */
const ensureService = async (
  service: 'client' | 'firebase',
  port: number,
  readyCheck: (port: number, timeout: number) => Promise<boolean>,
  timeoutSec: number,
): Promise<void> => {
  const mode: AikamiMode = (process.env.AIKAMI_MODE as AikamiMode) ?? 'emulator';
  const wsLabel = buildSessionName(mode);
  const wsId = await findWorkspace(wsLabel);

  if (wsId) {
    const tabNames = await getWorkspaceTabNames(wsId);
    if (tabNames.includes(service)) {
      if (await isPortReady(port)) {
        ok(`${service} is running and ready`);
        return;
      }
      console.log(`  ⚠️  ${service} tab exists but not ready — waiting...`);
      if (await readyCheck(port, timeoutSec)) {
        return;
      }
      console.log(`  ⚠️  ${service} never became ready — proceeding anyway`);
      return;
    }
  }

  console.log(`  🚀 Starting ${service} in herdr...`);
  await startServices({ mode, services: [service], projectRoot: process.cwd() });
  await readyCheck(port, Math.max(timeoutSec, 90));
};

const ensureClientDevServer = (): Promise<void> =>
  ensureService('client', CLIENT_PORT, waitForClientReady, 60);

const ensureFirebaseEmulators = (): Promise<void> =>
  ensureService('firebase', FB_AUTH_PORT, (_, t) => waitForFirebaseReady(t), 60);

// ── Build system prompt ────────────────────────────────────

const buildSystemPrompt = (): string => {
  const stepsText: string[] = [];

  if (commitOnly) {
    return [
      'You are an automated commit agent. Your sole purpose is to review',
      'pending changes, stage them, write a descriptive commit message,',
      'and push.',
      '',
      '## Step 1 — Review changes',
      '1. Run `git status` to see what files have changed.',
      '2. Run `git diff` (for unstaged) and `git diff --cached` (for staged)',
      '   to understand the full scope of changes.',
      '3. If nothing is staged yet, run `git add -A`.',
      '',
      '## Step 2 — Write and commit',
      '1. Run `git diff --cached --stat` one final time.',
      '2. Write a concise, descriptive commit message following conventional',
      '   commits format (e.g. `fix:`, `feat:`, `refactor:`, `chore:`).',
      '3. The pre-commit hook runs `bun run pre-commit` which does fix +',
      '   typecheck on staged projects. If it fails, fix the issues and retry.',
      '4. Run `git commit -m "<message>"` to commit.',
      '',
      '## Step 3 — Push',
      'Run `git push` to push the commit.',
      '',
      '## General rules',
      '- Do NOT ask questions. If blocked by pre-commit failures, fix them.',
      '- Do NOT modify .pi/, node_modules/, or generated files.',
    ].join('\n');
  }

  let stepNum = 0;

  if (doFix) {
    stepNum += 1;
    stepsText.push(
      `## Step ${stepNum} — \`bun run fix\``,
      'Run `bun run fix`. Examine every error and warning. Fix each one',
      'at the source. Re-run until all tasks pass with zero errors and',
      'zero warnings. Do not proceed until this step is clean.',
      '',
    );
  }

  if (doTypecheck) {
    stepNum += 1;
    stepsText.push(
      `## Step ${stepNum} — \`bun run typecheck\``,
      'Run `bun run typecheck`. Fix every type error. Re-run until zero',
      'errors. Pre-existing errors may be left with `@ts-expect-error`.',
      'Do not proceed until this step is clean.',
      '',
    );
  }

  if (doTest) {
    stepNum += 1;
    stepsText.push(...buildTestPrompt(stepNum));
  }

  if (doCommit) {
    stepNum += 1;
    stepsText.push(
      `## Step ${stepNum} — Commit and push`,
      'When all prior steps pass cleanly:',
      '1. Run `git add -A` to stage all changes.',
      '2. Run `git diff --cached --stat` to review what will be committed.',
      '3. Write a concise, descriptive conventional commit message.',
      '4. Run `git commit -m "<message>"` and then `git push`.',
      '',
    );
  }

  return [
    'You are an automated code quality agent. Your sole purpose is to',
    'ensure the codebase passes all configured checks, then optionally',
    'commit and push the results.',
    '',
    '## Active checks',
    stepsText.join('\n'),
    '## General rules',
    '- Read error messages carefully before fixing. Do not guess.',
    '- Fix source files, not config files, unless the error is in config.',
    '- Prefer minimal, targeted edits. Do not refactor unrelated code.',
    '- Re-run the command after each round of fixes to verify.',
    '- NEVER skip a step. Steps must complete cleanly before proceeding.',
    '- Do NOT ask questions. If truly blocked, explain why and stop.',
    '- Do NOT modify .pi/, node_modules/, or generated files.',
    '- Do NOT change moon.yml, biome.json, or tsconfig files unless',
    '  the error specifically requires it.',
    '- Prefer `@ts-expect-error` over `as any` or `as never` for',
    '  pre-existing type issues.',
  ].join('\n');
};

const buildTestPrompt = (stepNum: number): string[] => {
  const lines: string[] = [];
  const fbRunning = needsFirebase ? ' Firebase emulators and' : '';

  lines.push(`## Step ${stepNum} — \`bun run test\``);

  if (testMode === 'e2e') {
    lines.push(
      'Run ONLY the e2e test suite:',
      '',
      '```bash',
      'bun moon run e2e:test',
      '```',
      '',
      'The script pre-started the client dev server and Firebase emulators',
      'for you. Before running, verify both are accessible:',
      '',
      '```bash',
      'curl -s http://localhost:5274/ | wc -c    # should show >10000 (full page)',
      'curl -s http://localhost:4401/ | head -1  # should show emulator hub status',
      '```',
      '',
      'If either returns "Connection refused", wait 10s and retry. If',
      'still refused after 3 retries, use `herdr_session start <service>`.',
      'Fix any test failures in source code and re-run until passing.',
      '',
    );
  } else if (testMode === 'all') {
    lines.push(
      'Run the full test suite including e2e tests:',
      '',
      '```bash',
      'bun run test',
      '```',
      '',
      `The script pre-started the${fbRunning} client dev server. Before`,
      'running, verify both are accessible:',
      '',
      '```bash',
      'curl -s http://localhost:5274/ | wc -c    # should show >10000 (full page)',
      'curl -s http://localhost:4401/ | head -1  # should show emulator hub status',
      '```',
      '',
      'If either returns "Connection refused", wait 10s and retry up to',
      '3 times. If still refused, use `herdr_session start <service>`.',
      'Fix any test failures in source code and re-run until all pass.',
      '',
    );
  } else {
    lines.push(
      'Run unit and integration tests (all projects except e2e):',
      '',
      '```bash',
      'bun run test',
      '```',
      '',
      'Note: e2e tests may fail with connection errors (they need Firebase',
      'emulators + client which are not running in unit mode). Those failures',
      'are expected — report them as skipped, not failures. Focus on fixing',
      'unit/integration test failures only.',
      '',
      `The script pre-started the client dev server. Before running, verify:`,
      '',
      '```bash',
      'curl -s http://localhost:5274/ | wc -c    # should show >10000 (full page)',
      '```',
      '',
      'If the client returns "Connection refused", wait 10s and retry up',
      'to 3 times. Fix any test failures in source code and re-run until',
      'unit/integration tests pass.',
      '',
    );
  }

  return lines;
};

// ── Build task text ────────────────────────────────────────

const buildTaskText = (): string => {
  if (commitOnly) {
    return [
      'Review all pending changes and commit them with a descriptive message.',
      '',
      '1. `git status` + `git diff` (or `git diff --cached` if already staged)',
      '2. `git add -A && git commit -m "..." && git push`',
      '',
      'The pre-commit hook runs fix + typecheck automatically. If it fails,',
      'fix the issues and retry the commit. Your system prompt has full details.',
    ].join('\n');
  }

  const lines: string[] = ['Run through the autofix pipeline:'];
  let stepNum = 0;

  if (doFix) {
    stepNum += 1;
    lines.push(`${stepNum}. \`bun run fix\` — fix all lint errors/warnings, re-run until clean`);
  }
  if (doTypecheck) {
    stepNum += 1;
    lines.push(`${stepNum}. \`bun run typecheck\` — fix all type errors, re-run until clean`);
  }
  if (doTest) {
    stepNum += 1;
    const modeLabel =
      testMode === 'e2e' ? 'e2e-only' : testMode === 'all' ? 'all incl. e2e' : 'unit';
    lines.push(
      `${stepNum}. \`bun run test\` [${modeLabel}] — verify services, fix failures, re-run until clean`,
    );
  }
  if (doCommit) {
    stepNum += 1;
    lines.push(
      `${stepNum}. Review diff → write conventional commit message → \`git add -A && git commit -m "..." && git push\``,
    );
  }

  lines.push(
    '',
    'Your system prompt has the full detailed instructions. Work',
    'methodically — one step at a time. Do not skip ahead.',
  );

  return lines.join('\n');
};

// ── Main ───────────────────────────────────────────────────

const checkmark = (v: boolean) => (v ? '✓' : '✗');
const modeLabel = doTest
  ? testMode === 'e2e'
    ? 'e2e-only'
    : testMode === 'all'
      ? 'all incl. e2e'
      : 'unit'
  : '';

console.log('╭──────────────────────────────────────────╮');
console.log('│         🤖 Autofix Pipeline              │');
console.log('├──────────────────────────────────────────┤');
console.log(`│  fix:       ${checkmark(doFix)}    typecheck: ${checkmark(doTypecheck)}  │`);
console.log(`│  test:      ${checkmark(doTest)}    commit:    ${checkmark(doCommit)}  │`);
if (modeLabel) {
  console.log(`│  test mode: ${modeLabel.padEnd(31)} │`);
}
console.log(`│  model:     ${model.padEnd(24)} │`);
console.log(`│  thinking:  ${thinking.padEnd(24)} │`);
console.log('╰──────────────────────────────────────────╯');
console.log();

await ensureServer();

// If tests are enabled, ensure required services are running
if (doTest) {
  if (needsClient) {
    console.log('🔍 Checking client dev server...');
    await ensureClientDevServer();
  }
  if (needsFirebase) {
    console.log('🔍 Checking Firebase emulators...');
    await ensureFirebaseEmulators();
  }
}

const repoRoot = process.cwd();

// Write the system prompt file
const promptDir = join(repoRoot, '.pi', 'autofix');
mkdirSync(promptDir, { recursive: true });
const promptPath = join(promptDir, 'system_prompt.md');
writeFileSync(promptPath, buildSystemPrompt());

let wsId: string | null = null;
const existingWsId = await findWorkspace(PI_WORKSPACE);

if (existingWsId) {
  wsId = existingWsId;
  const tabNames = await getWorkspaceTabNames(existingWsId);

  if (tabNames.includes(AUTOFIX_TAB)) {
    console.log(`✓ autofix tab already exists in ${PI_WORKSPACE}`);
    console.log('  Close the existing tab first or attach to it.');
    process.exit(0);
  }

  console.log(`📎 Adding autofix tab to ${PI_WORKSPACE}…`);
  const tabR = await herdrJson<TabCreateResult>([
    'tab',
    'create',
    '--workspace',
    existingWsId,
    '--cwd',
    repoRoot,
    '--label',
    AUTOFIX_TAB,
    '--no-focus',
  ]);

  if (tabR?.result) {
    const paneId = tabR.result.root_pane.pane_id;
    const command = [
      'pi',
      '--model',
      model,
      '--thinking',
      thinking,
      '--approve',
      '--append-system-prompt',
      promptPath,
    ].join(' ');

    await herdr(['pane', 'run', paneId, wrapCommand(command)]);
    ok(`autofix agent starting in ${PI_WORKSPACE}/${AUTOFIX_TAB}`);

    await new Promise((r) => setTimeout(r, 3000));
    await herdr(['pane', 'send-keys', paneId, 'Escape']);
    await new Promise((r) => setTimeout(r, 1000));
    await herdr(['pane', 'run', paneId, buildTaskText()]);
    ok('task prompt sent');
  } else {
    console.error('❌ Failed to create autofix tab');
    process.exit(1);
  }
} else {
  console.log(`🚀 Creating ${PI_WORKSPACE} workspace…`);
  const createR = await herdrJson<WorkspaceCreateResult>([
    'workspace',
    'create',
    '--cwd',
    repoRoot,
    '--label',
    PI_WORKSPACE,
    '--no-focus',
  ]);

  if (!createR?.result) {
    console.error(`❌ Failed to create ${PI_WORKSPACE} workspace`);
    process.exit(1);
  }

  wsId = createR.result.workspace.workspace_id;
  const rootPaneId = createR.result.root_pane.pane_id;
  const command = [
    'pi',
    '--model',
    model,
    '--thinking',
    thinking,
    '--approve',
    '--append-system-prompt',
    promptPath,
  ].join(' ');

  await herdr(['tab', 'rename', `${wsId}:1`, AUTOFIX_TAB]);
  await herdr(['pane', 'run', rootPaneId, wrapCommand(command)]);
  ok(`autofix agent running in ${PI_WORKSPACE}/${AUTOFIX_TAB}`);

  await new Promise((r) => setTimeout(r, 3000));
  await herdr(['pane', 'send-keys', rootPaneId, 'Escape']);
  await new Promise((r) => setTimeout(r, 1000));
  await herdr(['pane', 'run', rootPaneId, buildTaskText()]);
  ok('task prompt sent');
}

if (doJoin) {
  if (wsId) {
    await herdr(['workspace', 'focus', wsId]);
  }
  console.log(`🖥  Attaching to ${PI_WORKSPACE}…`);
  const proc = spawn('herdr', ['session', 'attach', 'default'], { stdio: 'inherit' });
  await new Promise<number>((resolveJ) => proc.on('exit', resolveJ));
} else {
  console.log(`\n✓ autofix agent ready in ${PI_WORKSPACE}/${AUTOFIX_TAB}`);
  console.log(`  model: ${model}  thinking: ${thinking}`);
  if (commitOnly) {
    console.log('  mode: commit-only (pre-commit hook handles fix + typecheck)');
  }
  if (needsFirebase) {
    console.log('  services: client + firebase');
  } else if (needsClient) {
    console.log('  services: client');
  }
  console.log(`  attach: herdr session attach default (then Ctrl+B w to switch workspaces)`);
}
