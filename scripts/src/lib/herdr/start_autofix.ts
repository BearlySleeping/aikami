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
/**
 * Deepseek only support high and max thinking
 */
const DEFAULT_THINKING = 'high';
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
      '# MISSION',
      'You are an automated commit agent. Your sole purpose is to review pending changes, stage them, write a descriptive commit message, and push.',
      '',
      '## STEP 1: Review & Stage',
      '1. Run `git status`.',
      '2. Run `git diff` (unstaged) and `git diff --cached` (staged) to understand the scope.',
      '3. Run `git add -A`.',
      '',
      '## STEP 2: Write & Commit',
      '1. Write a concise conventional commit message (e.g. `fix:`, `feat:`, `refactor:`, `chore:`). Keep the body brief.',
      '2. Run `git commit -m "<message>"`.',
      '3. 🔴 **CRITICAL**: The pre-commit hook runs `fix` + `typecheck`. If `git commit` fails:',
      '   - DO NOT just retry the commit command.',
      '   - Read the hook failure output carefully.',
      '   - Fix the specific lint/type errors surfaced.',
      '   - Run `git add -A` again to stage your new fixes.',
      '   - Then retry `git commit`.',
      '',
      '## STEP 3: Push',
      'Run `git push` to push the commit. You are done.',
      '',
      '## RULES',
      '- Do NOT ask questions or wait for human approval.',
      '- Do NOT modify .pi/, node_modules/, or generated files.',
    ].join('\n');
  }

  let stepNum = 0;

  if (doFix) {
    stepNum += 1;
    stepsText.push(
      `## STEP ${stepNum}: \`bun run fix\``,
      '1. Run `bun run fix`.',
      '2. Fix errors and warnings at the source. Prefer minimal, mechanical edits.',
      '3. 🔴 **CIRCUIT BREAKER**: If you cannot fix an error after 3 attempts, add a `// biome-ignore lint: <reason>` comment and move on to prevent infinite loops.',
      '4. Do not proceed until `bun run fix` outputs zero errors.',
      '',
    );
  }

  if (doTypecheck) {
    stepNum += 1;
    stepsText.push(
      `## STEP ${stepNum}: \`bun run typecheck\``,
      '1. Run `bun run typecheck`.',
      '2. Fix every type error by adjusting interfaces or adding imports.',
      '3. 🔴 **CIRCUIT BREAKER**: Do not rewrite core business logic. If a type error is too complex, use `@ts-expect-error - FIXME: <reason>` after 3 failed attempts.',
      '4. Do not proceed until `bun run typecheck` passes cleanly.',
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
      `## STEP ${stepNum}: Commit and push`,
      '1. Run `git add -A`.',
      '2. Run `git diff --cached --stat` to review.',
      '3. Run `git commit -m "<conventional commit message>"`.',
      '4. 🔴 **HOOK FAILURES**: If the commit fails due to pre-commit hooks, fix the code, run `git add -A` AGAIN, then retry the commit.',
      '5. Run `git push`.',
      '',
    );
  }

  return [
    '# MISSION',
    'You are a mechanical code quality agent. Your purpose is to ensure the codebase passes all configured checks without altering business logic.',
    '',
    '# WORKFLOW',
    stepsText.join('\n'),
    '# STRICT RULES',
    '- **No Hallucinations**: Read error messages carefully. Fix only what is broken.',
    '- **Step-by-Step**: Re-run the verification command (`bun run fix`, `typecheck`, etc.) after EVERY file edit to confirm your fix worked.',
    '- **Never Skip**: A step must pass cleanly before you move to the next.',
    '- **No Human Intervention**: Do NOT ask questions. If you are entirely blocked, explain why and stop.',
    '- **Forbidden Paths**: Do NOT modify .pi/, node_modules/, config files (moon.yml, biome.json, tsconfig), or examples/.',
  ].join('\n');
};

const buildTestPrompt = (stepNum: number): string[] => {
  const lines: string[] = [];
  const fbRunning = needsFirebase ? ' Firebase emulators and' : '';

  lines.push(`## STEP ${stepNum}: \`bun run test\``);

  const testCommand = testMode === 'e2e' ? 'bun moon run e2e:test' : 'bun run test';

  lines.push(
    `Run the tests using: \`${testCommand}\``,
    '',
    '**Service Verification:**',
    `The script pre-started the${fbRunning} client dev server. Verify they are accessible:`,
    '```bash',
    'curl -s http://localhost:5274/ | wc -c    # should show >10000',
    needsFirebase ? 'curl -s http://localhost:4401/ | head -1  # emulator hub' : '',
    '```',
    'If connection is refused, wait 10s and retry (max 3 times). If still refused, run `herdr_session start <service>`.',
    '',
    '🔴 **CRITICAL TEST RULES:**',
    '1. **Do NOT modify `.test.ts` files.** If a test fails, it means your previous lint/type fixes broke the source code logic.',
    '2. Analyze the `git diff` to see what you broke, and revert or fix the source code.',
    testMode !== 'all' && testMode !== 'e2e'
      ? '3. e2e test connection failures are expected in unit mode. Ignore them.'
      : '',
    '4. Do not proceed until tests pass.',
    '',
  );

  return lines.filter(Boolean); // Filter out empty lines from ternaries
};

// ── Build task text ────────────────────────────────────────

const buildTaskText = (): string => {
  if (commitOnly) {
    return [
      '# TASK: COMMIT ONLY',
      'Review pending changes and commit them.',
      '',
      '1. `git status` + `git diff`',
      '2. `git add -A && git commit -m "..." && git push`',
      '',
      '> ⚠️ If the pre-commit hook fails, fix the code, run `git add -A` again, and retry the commit.',
    ].join('\n');
  }

  const lines: string[] = [
    '# TASK: AUTOFIX PIPELINE',
    'Execute the following steps sequentially:',
    '',
  ];
  let stepNum = 0;

  if (doFix) {
    stepNum += 1;
    lines.push(`${stepNum}. \`bun run fix\` — Fix errors mechanically. Max 3 retries per error.`);
  }
  if (doTypecheck) {
    stepNum += 1;
    lines.push(`${stepNum}. \`bun run typecheck\` — Fix types. Max 3 retries per error.`);
  }
  if (doTest) {
    stepNum += 1;
    const modeLabel =
      testMode === 'e2e' ? 'e2e-only' : testMode === 'all' ? 'all incl. e2e' : 'unit';
    lines.push(
      `${stepNum}. \`bun run test\` [${modeLabel}] — ONLY fix source code regressions. DO NOT modify test files.`,
    );
  }
  if (doCommit) {
    stepNum += 1;
    lines.push(`${stepNum}. Review diff → \`git add -A\` → \`git commit -m "..."\` → \`git push\``);
  }

  lines.push(
    '',
    '> Read your system prompt for detailed rules. Do not ask for permission, just begin Step 1.',
  );

  return lines.join('\n');
};

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
