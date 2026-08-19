// scripts/src/lib/herdr/start_autofix.ts
//
// Spawns a pi agent in the aikami-pi workspace configured for automated
// fix → typecheck → test workflows. Commit/push runs ONLY on explicit caller
// request (`--only commit` or `commit` in `--only`) — the default pipeline
// stops after validation and never mutates the repository.
//
// Model: deepseek-v4-pro (best for correctness, falls back to v4-flash if unavailable)
// Thinking: high (non-negotiable for reliable fixes)
//
// Usage:
//   bun autofix                              # fix + typecheck (git-scoped; stops after validation)
//   bun autofix --all                        # fix + typecheck + test:unit (git-scoped; stops after validation)
//   bun autofix --scope all                  # fix + typecheck (entire project; stops after validation)
//   bun autofix --scope all --all             # entire project + all tests (stops after validation)
//   bun autofix --only commit                # commit only — explicit authorization (pre-commit hook covers fix/typecheck)
//   bun autofix --only fix,typecheck         # fix + typecheck, no commit (git-scoped)
//   bun autofix --only fix,typecheck,commit  # fix + typecheck + explicit commit (git-scoped)
//   bun autofix --only test,commit           # test:unit then commit (git-scoped; commit explicitly authorized)
//   bun autofix --only test:e2e              # e2e tests only (starts client + firebase)
//   bun autofix --only test:all              # all tests including e2e
//   bun autofix --model deepseek/deepseek-v4-flash --thinking high
//   bun autofix --join                       # spawn + attach

// biome-ignore-all lint/style/useNamingConvention: HerDr API response field names (snake_case) — must match external API contract
import { exec, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { resolveAikamiMode } from '../env/mode';
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
  wrapCommandForPane,
} from './session.ts';

const execAsync = promisify(exec);

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
type ScopeMode = 'git' | 'all';

// `commit` is deliberately NOT in the implicit step sets: staging, committing
// and pushing require explicit caller authorization (`--only commit`, or
// `commit` in an explicit `--only` list). The default pipeline stops after
// validation.
const ALL_STEPS: AutofixStep[] = ['fix', 'typecheck', 'test'];
const DEFAULT_STEPS: AutofixStep[] = ['fix', 'typecheck'];

// ── Constants ──────────────────────────────────────────────

const PI_WORKSPACE = 'aikami-pi';
const AUTOFIX_TAB = 'autofix';
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';
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
const scope: ScopeMode = (parseOpt(['--scope', '-s']) as ScopeMode | undefined) ?? 'git';
const isGitScoped = scope === 'git';

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

let steps: AutofixStep[];
if (doAll) {
  steps = [...ALL_STEPS];
} else if (onlyValues.length > 0) {
  steps = dedupe(normalizedOnly.filter(isValidStep));
} else {
  steps = [...DEFAULT_STEPS];
}

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

// ── Baseline snapshot ─────────────────────────────────────
//
// Before the agent runs, snapshot the FULL working tree state (tracked diff
// vs HEAD + untracked files) to ~/.herdr/autofix-snapshots/<timestamp>/.
// If the agent ever destroys pre-existing work (e.g. reverting line-ending
// churn with `git checkout --`), a human can restore it with:
//   bun run autofix:restore <timestamp>

const SNAPSHOT_ROOT = join(homedir(), '.herdr', 'autofix-snapshots');

const createBaselineSnapshot = async (): Promise<string | null> => {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(SNAPSHOT_ROOT, ts);
  try {
    mkdirSync(dir, { recursive: true });

    // 1. Tracked changes, split staged vs unstaged so a restore can put
    //    staged changes back on the index (not just the working tree).
    //    `git diff --binary HEAD` (combined) is kept for backward compat with
    //    snapshots/restores that only know tracked.patch.
    const { stdout: stagedPatch } = await execAsync('git diff --cached --binary');
    const { stdout: unstagedPatch } = await execAsync('git diff --binary');
    const { stdout: combinedPatch } = await execAsync('git diff --binary HEAD');
    writeFileSync(join(dir, 'staged.patch'), stagedPatch);
    writeFileSync(join(dir, 'unstaged.patch'), unstagedPatch);
    writeFileSync(join(dir, 'tracked.patch'), combinedPatch);

    // 2. Untracked files — keep the list AND a copy of each file.
    const { stdout: untracked } = await execAsync('git ls-files --others --exclude-standard');
    const files = untracked.split('\n').filter(Boolean);
    writeFileSync(join(dir, 'untracked.txt'), files.join('\n'));
    const untrackedDir = join(dir, 'untracked');
    for (const f of files) {
      const src = join(process.cwd(), f);
      const dest = join(untrackedDir, f);
      if (existsSync(src)) {
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(src, dest);
      }
    }

    // 3. HEAD sha the patch applies to.
    const { stdout: head } = await execAsync('git rev-parse HEAD');
    writeFileSync(join(dir, 'HEAD.txt'), head.trim());

    writeFileSync(
      join(dir, 'RESTORE.md'),
      [
        `# Autofix baseline snapshot — ${ts}`,
        '',
        `HEAD: ${head.trim()}`,
        '',
        'This snapshot captures the working tree BEFORE the autofix agent ran.',
        '',
        '## Restore',
        '```bash',
        `bun run autofix:restore ${ts}`,
        '```',
        '',
        '## Contents',
        '- tracked.patch    — `git diff --binary HEAD` (combined, backward-compat)',
        '- staged.patch     — `git diff --cached --binary` (changes on the index)',
        '- unstaged.patch   — `git diff --binary` (worktree-only changes)',
        '- untracked.txt    — list of untracked files',
        '- untracked/       — copies of those untracked files',
        '- HEAD.txt         — the HEAD commit the patches apply to',
        '',
      ].join('\n'),
    );

    console.log(`  📸 Baseline snapshot: ${dir}`);
    return dir;
  } catch (err) {
    console.warn(`  ⚠️  Failed to create baseline snapshot: ${(err as Error).message}`);
    return null;
  }
};

// ── Git Scope ─────────────────────────────────────────────

const getGitScopedFiles = async (): Promise<string[]> => {
  try {
    const { stdout: unstaged } = await execAsync('git diff --name-only');
    const { stdout: staged } = await execAsync('git diff --name-only --cached');
    return [...new Set([...unstaged.split('\n'), ...staged.split('\n')])]
      .filter(Boolean)
      .map((f) => f.trim());
  } catch {
    return [];
  }
};

// ── Service readiness ──────────────────────────────────────

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

const ensureService = async (
  service: 'client' | 'firebase',
  port: number,
  readyCheck: (port: number, timeout: number) => Promise<boolean>,
  timeoutSec: number,
): Promise<void> => {
  const mode: AikamiMode = resolveAikamiMode();
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
  await startServices({ mode, services: [service], projectRoot: process.cwd(), wait: false });
  await readyCheck(port, Math.max(timeoutSec, 90));
};

const ensureClientDevServer = (): Promise<void> =>
  ensureService('client', CLIENT_PORT, waitForClientReady, 120);

const ensureFirebaseEmulators = (): Promise<void> =>
  ensureService('firebase', FB_AUTH_PORT, (_, t) => waitForFirebaseReady(t), 90);

// ── Build system prompt ────────────────────────────────────

const buildSystemPrompt = async (baselineSnapshotDir: string | null): Promise<string> => {
  const gitFiles = isGitScoped ? await getGitScopedFiles() : [];
  const scopeInstruction = isGitScoped
    ? [
        '## GIT SCOPE',
        'You **MUST ONLY** modify files that appear in `git diff` or `git diff --cached`.',
        'Run these commands at the start to identify the files:',
        '```bash',
        'git diff --name-only',
        'git diff --name-only --cached',
        '```',
        `Current git-scoped files: ${gitFiles.length ? gitFiles.join(', ') : 'None (empty diff)'}`,
        '',
      ].join('\n')
    : '';

  if (commitOnly) {
    return [
      '# MISSION',
      'You are an automated commit agent. Your sole purpose is to review pending changes, stage them, write a descriptive commit message, and push.',
      '',
      scopeInstruction,
      baselineSnapshotDir
        ? `\nA baseline snapshot of the pre-run working tree is saved at:\n\`${baselineSnapshotDir}\`\nIf you are unsure whether a change was intentional, compare against tracked.patch before staging.`
        : '',
      '## STEP 1: Review & Stage',
      '1. Run `git status`.',
      '2. Run `git diff` (unstaged) and `git diff --cached` (staged) to understand the scope.',
      "1b. Run `git status --porcelain=v1 --untracked-files=all -- biome.json biome.jsonc '**/tsconfig*.json' moon.yml '.pi/**' lint_rules.json`. If this prints ANY line, STOP and report the protected file with its status code — do not commit or stage it.",
      '3. Run `git add -A`.',
      '',
      '## STEP 2: Write & Commit',
      '1. Write a concise conventional commit message (e.g. `fix:`, `feat:`, `refactor:`, `chore:`). Keep the body brief.',
      '2. Run `git commit --no-verify -m "<message>"`.',
      '3. 🔴 **CRITICAL**: The pre-commit hook is skipped. Ensure all fixes were already validated.',
      '',
      '## STEP 3: Push',
      'Run `git push origin HEAD` to push the commit to the CURRENT branch. You are done.',
      '',
      '🔴 **BRANCH SAFETY**: You MUST use `git push origin HEAD`. Plain `git push` (without remote/branch args) is FORBIDDEN — it may push to the wrong branch if upstream tracking differs from the current branch. NEVER fall back to pushing to `main` (`git push origin HEAD:main`). If the current branch is `main` or the repo is in a detached HEAD state, STOP and report the issue — do NOT push.',
      '',
      '# STRICT RULES',
      '- **🔴 DESTRUCTIVE GIT IS FORBIDDEN**: NEVER run `git checkout --`, `git checkout .`, `git restore`, `git clean`, `git reset --hard`, or `git stash drop`. These destroy uncommitted work. The ONLY git mutations allowed are `git add`, `git commit`, and `git push origin HEAD` (commit step only).',
      "- **🔴 WINDOWS CRLF CHURN — IGNORE IT**: On Windows (`core.autocrlf=true`), `bun run fix` (biome --write) rewrites files as LF while git expects CRLF, so `git status` will list MANY 'modified' files with ZERO content change. NEVER 'clean up' or revert them. To see real changes use `git diff --numstat HEAD` — entries like `0\t0` are pure line-ending churn and must be left untouched.",
      '- **🔴 PROTECT PRE-EXISTING WORK**: The working tree may contain uncommitted changes from before your run. If you ever lose or accidentally revert work, STOP and restore from the baseline snapshot (`bun run autofix:restore <timestamp>`) instead of improvising.',
      '- Do NOT ask questions or wait for human approval.',
      '- Do NOT modify .pi/, node_modules/, or generated files.',
      '- **NO `as`, `any`, or `unknown`**: Never use type assertions or `any`/`unknown`.',
      '- **No Config Tampering**: Do NOT edit biome.json, biome.jsonc, tsconfig*.json, moon.yml, or lint_rules.json under any circumstance.',
    ].join('\n');
  }

  let stepNum = 0;
  const stepsText: string[] = [];
  const scopedFileArgs = gitFiles.map((f) => `'${f}'`).join(' ');

  if (doFix) {
    stepNum += 1;
    stepsText.push(
      `## STEP ${stepNum}: \`bun run fix\` (git-scoped)`,
      isGitScoped
        ? `1. Run: \`bunx biome check --write ${scopedFileArgs} --error-on-warnings --no-errors-on-unmatched\` — the command receives ONLY the git-scoped files above, so biome cannot process anything outside that set. Files biome ignores (e.g. docs/*.md) are skipped, not lint targets.`
        : '1. Run `bun run fix` on the entire project.',
      '2. Fix errors and warnings at the source. Prefer minimal, mechanical edits.',
      '3. 🔴 **CIRCUIT BREAKER**: If you cannot fix an error after **5 attempts**, use an escape hatch (see rules below).',
      '4. Do not proceed until the fix command outputs zero errors AND zero warnings.',
      '',
    );
  }

  if (doTypecheck) {
    stepNum += 1;
    stepsText.push(
      `## STEP ${stepNum}: \`bun run typecheck\` (affected projects)`,
      isGitScoped
        ? '1. Run: `(git diff --name-only; git diff --name-only --cached) | bunx moon run :typecheck --affected --stdin` — the git-scoped file list is piped into moon, so ONLY projects touched by those files are type-checked.'
        : '1. Run `bun run typecheck` on the entire project.',
      '2. Fix every type error by adjusting interfaces or adding imports.',
      '3. 🔴 **CIRCUIT BREAKER**: If you cannot fix a type error after **5 attempts**, use an escape hatch (see rules below).',
      '4. Do not proceed until the typecheck command passes cleanly.',
      '',
    );
  }

  if (doTest) {
    stepNum += 1;
    stepsText.push(...(await buildTestPrompt(stepNum)));
  }

  if (!doCommit) {
    // Default flow: no repository mutations. The agent validates, then
    // stops — committing/pushing only happens on explicit caller request.
    stepNum += 1;
    stepsText.push(
      `## STEP ${stepNum}: Validate and stop`,
      '1. 🔴 **VALIDATION GATE**: Run `bun moon run :validate` on all affected projects. Do not proceed until it passes cleanly.',
      '2. Run `git status --porcelain=v1 --untracked-files=all` and confirm every modified path is in the git-scoped set above (plus this prompt file). If any out-of-scope or protected file changed, STOP and report it — do NOT revert it (destructive git is forbidden); fix the underlying issue in source instead.',
      '3. 🔴 **STOP**: Do NOT stage, commit, or push. Repository mutations require explicit caller authorization (`bun autofix --only commit`, or `commit` in `--only`). Report a final diff summary instead.',
      '',
    );
  }

  if (doCommit) {
    stepNum += 1;
    stepsText.push(
      `## STEP ${stepNum}: Commit and push`,
      "1. Run `git status --porcelain=v1 --untracked-files=all -- biome.json biome.jsonc '**/tsconfig*.json' moon.yml '.pi/**' lint_rules.json`. If this prints ANY line, STOP and report the protected file + status code. Fix the underlying issue in source instead. Do not proceed until it prints nothing.",
      '2. Run `git add -A`.',
      '3. Run `git diff --cached --stat` to review.',
      '4. Run `git commit --no-verify -m "<conventional commit message>"`.',
      '5. 🔴 **HOOK FAILURES**: The pre-commit hook is skipped. Ensure all checks passed before committing.',
      '5a. 🔴 **VALIDATION GATE**: Before committing, you MUST run `bun moon run :validate` on all affected projects. The commit must not proceed until validation passes cleanly.',
      '6. Run `git push origin HEAD`. 🔴 **NEVER `git push` alone** — it may push to the wrong branch if upstream tracking differs from the current branch. Always use `git push origin HEAD` to push to the CURRENT branch.',
      '',
    );
  }

  return [
    '# MISSION',
    isGitScoped
      ? 'You are a **git-scoped** autofix agent. Only modify files in `git diff` or `git diff --cached`.'
      : 'You are a **full-project** autofix agent. Fix/typecheck/test the entire project.',
    '',
    scopeInstruction,
    '# WORKFLOW',
    stepsText.join('\n'),
    '# STRICT RULES',
    '- **🔴 DESTRUCTIVE GIT IS FORBIDDEN**: NEVER run `git checkout --`, `git checkout .`, `git restore`, `git clean`, `git reset --hard`, or `git stash drop`. These destroy uncommitted work. Git mutations (`git add`, `git commit`, `git push origin HEAD`) are ONLY allowed inside an explicitly authorized commit step (commit-only runs).',
    "- **🔴 WINDOWS CRLF CHURN — IGNORE IT**: On Windows (`core.autocrlf=true`), `bun run fix` (biome --write) rewrites files as LF while git expects CRLF, so `git status` will list MANY 'modified' files with ZERO content change. NEVER 'clean up' or revert them. To see real changes use `git diff --numstat HEAD` — entries like `0\t0` are pure line-ending churn and must be left untouched.",
    '- **🔴 PROTECT PRE-EXISTING WORK**: The working tree may contain uncommitted changes from before your run. If you ever lose or accidentally revert work, STOP and restore from the baseline snapshot (`bun run autofix:restore <timestamp>`) instead of improvising.',
    '- **Load Conventions First**: Before writing ANY code, load the `aikami-conventions` skill. Read `.context/CONTEXT.md` and `.context/index.md` before making structural changes (file moves, new packages, boundary changes).',
    '- **No Hallucinations**: Read error messages carefully. Fix only what is broken.',
    '- **Step-by-Step**: Re-run the verification command (`bun run fix`, `typecheck`, etc.) after EVERY file edit to confirm your fix worked.',
    '- **Never Skip**: A step must pass cleanly before you move to the next.',
    '- **No Human Intervention**: Do NOT ask questions. If you are entirely blocked, explain why and stop.',
    '- **Forbidden Paths**: Do NOT modify node_modules/, config files (moon.yml, biome.json, biome.jsonc, tsconfig*.json, lint_rules.json), or examples/. Within .pi/, ONLY the git-scoped .pi files listed above and this prompt file (`.pi/autofix/system_prompt.md`) may be modified — every other .pi/ path is protected.',
    '- **🔴 BRANCH SAFETY — NEVER `git push` alone**: Always use `git push origin HEAD`. Plain `git push` may target the wrong branch if the local branch tracks a different remote branch (e.g. `origin/main` instead of the current feature branch). `git push origin HEAD` ALWAYS pushes to the current branch. If you see an upstream mismatch error, do NOT fall back to `git push origin HEAD:main` — push to the CURRENT branch.',
    baselineDir
      ? `- **Baseline snapshot**: The pre-run working tree is saved at \`${baselineSnapshotDir}\`. It contains tracked.patch (all modifications vs HEAD) plus copies of untracked files. If you think you destroyed something, tell the user to run \`bun run autofix:restore <timestamp>\`.`
      : '',
    '- **NO `as`, `any`, or `unknown`**: Never use type assertions or `any`/`unknown`.',
    '',
    '## LINTER & ERROR RESOLUTION — FIX, NEVER SUPPRESS',
    '- **Fix, Never Suppress**: When resolving Biome warnings, TypeScript errors, or naming-convention violations, refactor the actual source code — rename identifiers to camelCase, update interfaces, and fix every import/export/usage site across affected files.',
    '- **No Config Tampering**: Strictly forbidden from editing `biome.json`, `biome.jsonc`, any `tsconfig*.json`, `moon.yml`, or `lint_rules.json` to disable a rule, set it to `"off"`, lower its severity, or add a file/path exclusion. A config edit is never an acceptable "attempt" under the circuit breaker below.',
    '- **No New Inline Suppressions for Style/Naming Rules**: `// biome-ignore` and `@ts-expect-error` may NEVER be used for naming-convention, formatting, or other mechanical style violations (e.g. `useNamingConvention`, `useFilenamingConvention`). These are always fixable by renaming — there is no valid justification to suppress instead.',
    '- **Pre-existing suppressions are not violations**: Do not remove or "fix" an existing `biome-ignore` comment that already carries a human-authored justification (e.g. a file mapping external snake_case API fields) — that is a deliberate boundary, not cleanup work.',
    '- **ESCAPE HATCHES — GENUINE TYPE ERRORS ONLY (LAST RESORT)**:',
    '  After **5 documented attempts** (each = an edit + a re-run of the failing command, with output shown), if a **type error** remains unfixable without a breaking architectural change, you may use `@ts-expect-error - FIXME: <detailed reason>`. This does NOT apply to naming, formatting, or any Biome style rule.',
    '  **Conditions:** (1) unfixable without breaking core functionality, (2) explain why in a comment, (3) include a FIXME/TODO, (4) list every escape hatch used in your final summary for human review.',
  ].join('\n');
};

const buildTestPrompt = async (stepNum: number): Promise<string[]> => {
  const lines: string[] = [];
  const fbRunning = needsFirebase ? ' Firebase emulators and' : '';

  lines.push(`## STEP ${stepNum}: \`bun run test\``);

  let testCommand: string;
  if (testMode === 'e2e') {
    testCommand = 'bun moon run e2e:test';
  } else if (testMode === 'all') {
    testCommand = 'bun moon run test:all';
  } else {
    testCommand = 'bun run test';
  }

  lines.push(
    `Run the tests using: \`${testCommand}\`${isGitScoped ? ' on git-scoped files' : ''}.`,
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
    '1. **First**, assume your `fix` or `typecheck` edits broke the source code.',
    '   - Run `git diff` to see what changed.',
    '   - Revert or fix the **source code** (not the test).',
    '2. **Only if the test is provably wrong**, edit it:',
    '   - Example: The test expects an old API response format.',
    '   - **Justify every test edit** with a comment (e.g., `// Updated mock for new API`).',
    '3. **Never** edit a test just to "make it pass" without understanding why.',
    '4. Do not proceed until tests pass.',
    '',
  );

  return lines.filter(Boolean);
};

// ── Build task text ────────────────────────────────────────

const buildTaskText = async (baselineSnapshotDir: string | null): Promise<string> => {
  const gitFiles = isGitScoped ? await getGitScopedFiles() : [];
  const scopeLabel = isGitScoped ? 'GIT-SCOPED' : 'FULL PROJECT';

  if (commitOnly) {
    return [
      '# TASK: COMMIT ONLY',
      'Review pending changes and commit them.',
      '',
      '1. `git status` + `git diff`',
      '2. `git add -A && git commit --no-verify -m "..." && git push origin HEAD`',
      '',
      baselineSnapshotDir ? `> 📸 Pre-run baseline snapshot: \`${baselineSnapshotDir}\`` : '',
      "🔴 **NEVER run destructive git commands** (git checkout -- / git restore / git clean / git reset --hard). The working tree contains pre-existing work — protect it. On Windows, CRLF line-ending churn in `git status` after `bun run fix` is expected — ignore it, never 'clean' the tree.",
      '🔴 **BRANCH SAFETY**: You MUST use `git push origin HEAD`. Plain `git push` (without remote/branch args) is FORBIDDEN — it may push to the wrong branch if upstream tracking differs from the current branch. NEVER fall back to pushing to `main` (`git push origin HEAD:main`). If the current branch is `main` or the repo is in a detached HEAD state, STOP and report the issue — do NOT push.',
      '',
      '> ⚠️ Pre-commit hook is skipped. Ensure all checks passed.',
    ].join('\n');
  }

  const lines: string[] = [
    `# TASK: AUTOFIX PIPELINE [${scopeLabel}]`,
    isGitScoped
      ? `Only modify these git-scoped files: ${gitFiles.length ? gitFiles.join(', ') : 'None (empty diff)'}`
      : 'Fix/typecheck/test the entire project.',
    baselineDir
      ? `\n📸 A baseline snapshot of the pre-run working tree is saved at \`${baselineSnapshotDir}\`. Never run destructive git commands (git checkout -- / git restore / git clean / git reset --hard). Ignore CRLF line-ending churn in git status on Windows.`
      : '',
    'Execute the following steps sequentially:',
    '',
  ];
  let stepNum = 0;
  const scopedFileArgs = gitFiles.map((f) => `'${f}'`).join(' ');

  if (doFix) {
    stepNum += 1;
    lines.push(
      isGitScoped
        ? `${stepNum}. Fix (git-scoped): \`bunx biome check --write ${scopedFileArgs} --error-on-warnings --no-errors-on-unmatched\` — fixes ONLY the git-scoped files. Max 5 retries per error; escape hatches allowed as last resort.`
        : `${stepNum}. \`bun run fix\` — Fix errors mechanically. Max 5 retries per error. Escape hatches allowed as last resort.`,
    );
  }
  if (doTypecheck) {
    stepNum += 1;
    lines.push(
      isGitScoped
        ? `${stepNum}. Typecheck (affected): \`(git diff --name-only; git diff --name-only --cached) | bunx moon run :typecheck --affected --stdin\` — type-checks only the projects touched by git-scoped files. Max 5 retries per error; escape hatches allowed as last resort.`
        : `${stepNum}. \`bun run typecheck\` — Fix types. Max 5 retries per error. Escape hatches allowed as last resort.`,
    );
  }
  if (doTest) {
    stepNum += 1;
    let modeLabel: string;
    if (testMode === 'e2e') {
      modeLabel = 'e2e-only';
    } else if (testMode === 'all') {
      modeLabel = 'all incl. e2e';
    } else {
      modeLabel = 'unit';
    }
    lines.push(
      `${stepNum}. \`bun run test\` [${modeLabel}] — ONLY fix source code regressions. Edit tests **ONLY IF PROVABLY WRONG**.`,
    );
  }
  if (doCommit) {
    stepNum += 1;
    lines.push(
      `${stepNum}. Review diff → \`git add -A\` → \`git commit --no-verify -m "..."\` → \`git push origin HEAD\` (explicitly authorized commit — the caller passed \`commit\` in --only).`,
    );
  } else {
    stepNum += 1;
    lines.push(
      `${stepNum}. 🔴 STOP after validation — do NOT stage, commit, or push. Repository mutations require explicit caller authorization (\`bun autofix --only commit\`).`,
    );
  }

  lines.push(
    '',
    '> 🔴 Never modify biome.json/tsconfig/moon.yml/lint_rules.json. Never use biome-ignore or @ts-expect-error for naming/style violations — rename the code instead.',
    '> 🔴 NEVER run destructive git commands (git checkout -- / git restore / git clean / git reset --hard). The working tree contains pre-existing work — protect it. CRLF churn in git status on Windows is expected; ignore it.',
    '> Read your system prompt for detailed rules. Do not ask for permission, just begin Step 1.',
  );

  return lines.join('\n');
};

// ── Logging ───────────────────────────────────────────────

const checkmark = (v: boolean) => (v ? '✓' : '✗');
let modeLabel: string;
if (doTest) {
  if (testMode === 'e2e') {
    modeLabel = 'e2e-only';
  } else if (testMode === 'all') {
    modeLabel = 'all incl. e2e';
  } else {
    modeLabel = 'unit';
  }
} else {
  modeLabel = '';
}

console.log('╭──────────────────────────────────────────╮');
console.log('│         🤖 Autofix Pipeline              │');
console.log('├──────────────────────────────────────────┤');
console.log(`│  fix:       ${checkmark(doFix)}    typecheck: ${checkmark(doTypecheck)}  │`);
console.log(`│  test:      ${checkmark(doTest)}    commit:    ${checkmark(doCommit)}  │`);
if (modeLabel) {
  console.log(`│  test mode: ${modeLabel.padEnd(31)} │`);
}
console.log(`│  scope:     ${scope.padEnd(24)} │`);
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

// 📸 Snapshot the pre-run working tree so the agent can never permanently
// destroy pre-existing work. Restore with `bun run autofix:restore <ts>`.
const baselineDir = await createBaselineSnapshot();

// Ensure `.pi` deps are installed — `.pi` is a standalone bun project (own
// package.json + bun.lock) NOT covered by the root `bun install`. Without
// this, `pi:typecheck` fails on missing modules and the agent wastes the run.
const piNodeModules = join(repoRoot, '.pi', 'node_modules');
if (!existsSync(piNodeModules)) {
  console.log('  ⚠️  .pi/node_modules missing — installing .pi deps…');
  try {
    await execAsync('bun install', { cwd: join(repoRoot, '.pi') });
    ok('.pi deps installed');
  } catch (err) {
    console.warn(`  ⚠️  .pi install failed: ${(err as Error).message}`);
  }
}

// Write the system prompt file
const promptDir = join(repoRoot, '.pi', 'autofix');
mkdirSync(promptDir, { recursive: true });
const promptPath = join(promptDir, 'system_prompt.md');
writeFileSync(promptPath, await buildSystemPrompt(baselineDir));

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

    await herdr(['pane', 'run', paneId, await wrapCommandForPane(paneId, command)]);
    ok(`autofix agent starting in ${PI_WORKSPACE}/${AUTOFIX_TAB}`);

    await new Promise((r) => setTimeout(r, 3000));
    await herdr(['pane', 'send-keys', paneId, 'Escape']);
    await new Promise((r) => setTimeout(r, 1000));
    await herdr(['pane', 'run', paneId, await buildTaskText(baselineDir)]);
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
  await herdr(['pane', 'run', rootPaneId, await wrapCommandForPane(rootPaneId, command)]);
  ok(`autofix agent running in ${PI_WORKSPACE}/${AUTOFIX_TAB}`);

  await new Promise((r) => setTimeout(r, 3000));
  await herdr(['pane', 'send-keys', rootPaneId, 'Escape']);
  await new Promise((r) => setTimeout(r, 1000));
  await herdr(['pane', 'run', rootPaneId, await buildTaskText(baselineDir)]);
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
  console.log(`  model: ${model}  thinking: ${thinking}  scope: ${scope}`);
  if (commitOnly) {
    console.log('  mode: commit-only (pre-commit hook skipped)');
  }
  if (needsFirebase) {
    console.log('  services: client + firebase');
  } else if (needsClient) {
    console.log('  services: client');
  }
  console.log(`  attach: herdr session attach default (then Ctrl+B w to switch workspaces)`);
}
