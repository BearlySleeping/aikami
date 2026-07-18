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
//   bun autofix --all                        # fix + typecheck + test + commit
//   bun autofix --only commit                # commit only (pre-commit hook covers fix/typecheck)
//   bun autofix --only fix,typecheck         # fix + typecheck, no commit
//   bun autofix --only test,commit           # test then commit
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
  SERVICE_DEFS,
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

const ALL_STEPS: AutofixStep[] = ['fix', 'typecheck', 'test', 'commit'];
const DEFAULT_STEPS: AutofixStep[] = ['fix', 'typecheck', 'commit'];

// ── Constants ──────────────────────────────────────────────

const PI_WORKSPACE = 'aikami-pi';
const AUTOFIX_TAB = 'autofix';
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';
const DEFAULT_THINKING = 'medium';

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

const steps: AutofixStep[] = doAll
  ? [...ALL_STEPS]
  : onlyValues.length > 0
    ? dedupe(onlyValues.filter(isValidStep))
    : [...DEFAULT_STEPS];

const doFix = steps.includes('fix');
const doTypecheck = steps.includes('typecheck');
const doTest = steps.includes('test');
const doCommit = steps.includes('commit');
const commitOnly = steps.length === 1 && doCommit;

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

const ok = (m: string) => console.log(`  ✓ ${m}`);

/**
 * Waits for the client dev server to be fully ready — port open + Vite
 * has compiled and is serving real HTML (not a blank/loading page).
 * Returns true when ready, false on timeout.
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
      // Vite returns a short HTML page while compiling — real SvelteKit
      // pages have substantial body content (scripts, styles, markup).
      // Require at least 500 bytes to filter out Vite "compiling" stubs.
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

// ── Build system prompt ────────────────────────────────────

const buildSystemPrompt = (): string => {
  const stepsText: string[] = [];

  if (commitOnly) {
    // Commit-only mode — pre-commit hook handles fix + typecheck
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
      '   The message should summarize WHAT changed and WHY, not just repeat',
      '   file names.',
      '3. The pre-commit hook will automatically run `bun run pre-commit`',
      '   which does fix + typecheck on staged projects. If it fails, fix',
      '   the issues and try again.',
      '4. Run `git commit -m "<message>"` to commit.',
      '',
      '## Step 3 — Push',
      'Run `git push` to push the commit.',
      '',
      '## General rules',
      '- Do NOT ask questions. If blocked by pre-commit failures, fix them.',
      '- Do NOT modify .pi/, node_modules/, or generated files.',
      '- Do NOT change moon.yml, biome.json, or tsconfig files unless',
      '  the pre-commit hook error specifically requires it.',
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
      'errors. Pre-existing errors that are clearly unrelated to your',
      'changes may be left with a `@ts-expect-error` comment explaining',
      'why. Do not proceed until this step is clean.',
      '',
    );
  }

  if (doTest) {
    stepNum += 1;
    stepsText.push(
      `## Step ${stepNum} — \`bun run test\``,
      'Run `bun run test`. If tests fail, examine the output carefully.',
      'Fix the source code — not the tests — unless a test assertion is',
      'genuinely incorrect. Re-run until all tests pass.',
      'The client dev server should already be running in herdr — if',
      'tests fail with connection errors, verify the client is accessible',
      'before debugging test logic.',
      '',
    );
  }

  if (doCommit) {
    stepNum += 1;
    stepsText.push(
      `## Step ${stepNum} — Commit and push`,
      'When all prior steps pass cleanly:',
      '1. Run `git add -A` to stage all changes.',
      '2. Run `git diff --cached --stat` to review what will be committed.',
      '3. Write a concise, descriptive commit message following conventional',
      '   commits format. The pre-commit hook runs fix + typecheck automatically.',
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
    lines.push(`${stepNum}. \`bun run test\` — fix all test failures, re-run until passing`);
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

// ── Client dev server check ────────────────────────────────

/**
 * Ensures the client dev server is running in the mode-specific herdr
 * workspace so that tests (which hit the client) can pass.
 */
const ensureClientDevServer = async (): Promise<void> => {
  const mode: AikamiMode = (process.env.AIKAMI_MODE as AikamiMode) ?? 'emulator';
  const wsLabel = buildSessionName(mode);

  const wsId = await findWorkspace(wsLabel);
  if (wsId) {
    const tabNames = await getWorkspaceTabNames(wsId);
    if (tabNames.includes('client')) {
      // Client tab exists — check if the port is ready
      const clientPort = SERVICE_DEFS.client.readyPort;
      if (clientPort !== undefined && (await isPortReady(clientPort))) {
        ok('client dev server is running and ready');
        return;
      }
      console.log('  ⚠️  Client tab exists but port is not ready — waiting...');
      // Wait up to 60s for port + compiled content
      if (clientPort !== undefined && (await waitForClientReady(clientPort, 60))) {
        return;
      }
      console.log('  ⚠️  Client never became ready — proceeding anyway');
      return;
    }
  }

  // Start client in herdr
  console.log('  🚀 Starting client dev server in herdr...');
  await startServices({
    mode,
    services: ['client'],
    projectRoot: process.cwd(),
  });

  // Wait for the port + compiled content
  const clientPort = SERVICE_DEFS.client.readyPort;
  if (clientPort !== undefined) {
    if (await waitForClientReady(clientPort, 90)) {
      return;
    }
    console.log('  ⚠️  Client dev server did not become ready within 90s');
  }
};

// ── Main ───────────────────────────────────────────────────

// Print configuration
const checkmark = (v: boolean) => (v ? '✓' : '✗');
console.log('╭──────────────────────────────────────────╮');
console.log('│         🤖 Autofix Pipeline              │');
console.log('├──────────────────────────────────────────┤');
console.log(`│  fix:       ${checkmark(doFix)}    typecheck: ${checkmark(doTypecheck)}  │`);
console.log(`│  test:      ${checkmark(doTest)}    commit:    ${checkmark(doCommit)}  │`);
console.log(`│  model:     ${model.padEnd(24)} │`);
console.log(`│  thinking:  ${thinking.padEnd(24)} │`);
console.log('╰──────────────────────────────────────────╯');
console.log();

await ensureServer();

// If tests are enabled, ensure client is running first
if (doTest) {
  console.log('🔍 Checking client dev server...');
  await ensureClientDevServer();
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

  // Add autofix tab to existing workspace
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

    // Send the task text
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
  // Create new workspace
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

  // Send the task text
  await new Promise((r) => setTimeout(r, 3000));
  await herdr(['pane', 'send-keys', rootPaneId, 'Escape']);
  await new Promise((r) => setTimeout(r, 1000));
  await herdr(['pane', 'run', rootPaneId, buildTaskText()]);
  ok('task prompt sent');
}

// ── Attach if requested ────────────────────────────────────
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
  console.log(`  attach: herdr session attach default (then Ctrl+B w to switch workspaces)`);
}
