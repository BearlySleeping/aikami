// scripts/src/lib/agents/contract_pipeline/prompt_loader.ts
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { ContractWorkerRole } from './types.ts';

const ROLE_PROMPTS: Record<ContractWorkerRole, string> = {
  writer: '.pi/prompts/contract-create.md',
  critic: '.pi/prompts/contract-critique.md',
  implementer: '.pi/prompts/contract.md',
  verifier: '.pi/prompts/contract-verify.md',
};

const stripFrontmatter = (content: string): string => content.replace(/^---\n[\s\S]*?\n---\n/, '');

/** Mutually exclusive review profiles that isolate context windows per agent mode. */
export type ReviewProfile = 'yolo' | 'ready' | 'fallback_recovery';

export const feedbackMessage = (options: {
  role: ContractWorkerRole;
  feedback: string;
}): string => {
  if (options.role === 'implementer') {
    return [
      '## 🔴 Verifier requested changes — fix these before re-submitting',
      'Read EACH issue below, fix it, then call `contract_stage_complete` with `passed`.',
      'Do NOT just re-call `contract_stage_complete` with the same code — you must make actual changes.',
      '',
      options.feedback,
      '',
      '### How to proceed',
      '1. Read the contract Acceptance Criteria referenced in each finding',
      '2. Fix the code to satisfy each criterion',
      '3. Run the affected tests to confirm fixes work',
      '4. Call `contract_stage_complete` with `passed`',
    ].join('\n');
  }
  return options.feedback;
};

export const loadRolePrompt = (options: {
  role: ContractWorkerRole;
  contractPath: string;
  repoRoot: string;
}): string => {
  const promptPath = resolve(options.repoRoot, ROLE_PROMPTS[options.role]);
  if (!existsSync(promptPath)) {
    throw new Error(`Role prompt not found: ${promptPath}`);
  }
  const contractArgument = relative(options.repoRoot, resolve(options.contractPath)).replaceAll(
    '\\',
    '/',
  );
  const contractId = contractArgument.match(/(C-\d+|MIG-\d+)/)?.[0] ?? contractArgument;
  const contractExistsOnDisk = existsSync(resolve(options.contractPath));
  const canonical = stripFrontmatter(readFileSync(promptPath, 'utf-8')).replace(
    /\$ARGUMENTS\b/g,
    contractArgument,
  );
  const creationInstruction =
    options.role === 'writer' && !contractExistsOnDisk
      ? [
          '\n## Contract file does not exist yet',
          `No contract file exists yet for ${contractId}.`,
          `1. Call \`contract_generate\` with \`${contractId}\` to create the v2 contract shell.`,
          '2. Discover the actual file created by contract_generate.',
          '3. Read that file and complete every section.',
          '4. Set status to `draft` and call `contract_stage_complete`.',
        ].join('\n')
      : '';
  const criticInstruction =
    options.role === 'critic'
      ? [
          '\n## 🔴 CRITIC ROLE: Fix-Then-Approve',
          'Fix ALL correctable issues in the contract yourself, then approve.',
          '',
          '### What to fix (do NOT block for these):',
          '- Typos, wrong file paths, formatting, underspecified ACs',
          '- Draft/in-progress dependencies → document stubbing plan, do NOT block',
          '- Missing migration AC → add one if requirements are clear',
          '- Wrong moon project IDs, slot count inconsistencies, AC cross-references',
          '',
          '### What to block for (truly unresolvable):',
          '- A dependency marked `blocked`',
          '- Fundamentally wrong problem statement or scope',
          '- Missing critical ACs that need architect input',
          '',
          '### 🚀 YOLO MODE (if active):',
          '- NEVER block. Fix what you can, document remaining risks as warnings, PASS.',
          '- Only the human can block a YOLO pipeline.',
          '- The worst outcome is a blocked pipeline waiting for human input.',
        ].join('\n')
      : '';
  return [
    canonical,
    creationInstruction,
    criticInstruction,
    '\n## 🔴 MANDATORY COMPLETION HANDOFF',
    'Do not ask questions. If input is required, finish with `blocked`.',
    '🔴 Your last action MUST be a call to `contract_stage_complete`.',
    '\n## 🔴 EXECUTION RULES',
    '- For moon/test/build: use `moon_run_task` or `validate()` — built-in timeouts.',
    '- For any shell >10s: use `ctx_execute` or `bash` with explicit `timeout`.',
  ]
    .filter((s) => s.length > 0)
    .join('\n');
};

// ── Review profile injects ──────────────────────────────────
// Each profile is a self-contained context block that appends to the
// canonical review captain prompt. They are mutually exclusive and
// carry no code-editing crossover contamination.
//
// The full YOLO instructions live in .pi/prompts/yolo-overrides.md
// and are loaded dynamically at runtime. This YOLO_INJECT is a lightweight
// header that references the override file.

const YOLO_INJECT = [
  '',
  '## 🚀 YOLO MODE — Fully Automated CodeRabbit Pipeline',
  '',
  'You are the YOLO Review Captain. No human in the loop. You orchestrate',
  'CodeRabbit automation — you do NOT edit code or run tests yourself.',
  '',
  '🔴 **READ THE STATE JSON ABOVE** before starting. It tells you:',
  '- Current autofix cycle number (and whether you are at the limit)',
  '- Whether CodeRabbit has already reviewed',
  '- How many findings remain unresolved',
  '',
  'The full YOLO execution sequence and tool permissions are described in',
  'the yolo-overrides.md prompt that was appended below. Follow it EXACTLY.',
  '',
  '🔴 If you hit the autofix cycle limit (autofix_cycle >= max_autofix_cycles),',
  'call `contract_review_decision` with `change` instead of looping again.',
].join('\n');

const READY_INJECT = [
  '',
  '## ✅ READY MODE — Human-in-the-Loop Review',
  '',
  'The pipeline passed verification. The PR should be ready for human review.',
  '',
  '### Phase 1: Assemble Status',
  '1. Read the run manifest from `.pi/contract-runs/<run-id>/manifest.json`.',
  '2. Read the contract file, implementation report, and verification report.',
  '3. Produce a concise status summary.',
  '',
  '### Phase 2: Create the PR',
  'Create a public PR immediately — do not wait:',
  '- Use `gh_create_pr` with `draft: false` and a proper title/body.',
  '- Title: `C-XXX: Short description`',
  '- Body: your Phase 1 status report',
  '',
  '### Phase 3: Wait for CodeRabbit + User',
  'CodeRabbit will auto-review the PR. Present findings to the user.',
  'The user may ask you to:',
  '- Check CodeRabbit findings via `gh_pr_comments` or `gh_summarize_pr`',
  '- Apply fixes (use `edit` in the worktree, commit, push)',
  '- Promote / merge / close — the user decides, you call `contract_review_decision`',
  '',
  '### Decision mapping',
  '| User says | Decision |',
  '|---|---|',
  '| "looks good", "approve" | `approve` |',
  '| "merge it", "merge" | `merge` |',
  '| "needs changes", "fix" | `change` |',
  '| "close it", "reject" | `reject` |',
  '',
  '🔴 Never call `gh_merge_pr`, `gh_promote_pr`, or `gh_cancel_pr` — the orchestrator',
  'handles these with proper cleanup (sync main, remove worktree, delete branches).',
  'Manual gh calls skip cleanup and leave stale worktrees.',
].join('\n');

const FALLBACK_RECOVERY_INJECT = [
  '',
  '## ⚠️ FALLBACK RECOVERY — Verifier Loop Exhaustion',
  '',
  'The verifier → implementer bounce loop has been exhausted. This pipeline is BLOCKED.',
  'You are in diagnostic mode — you do NOT have implementation privileges.',
  '',
  '### 🔴 STRICT LIMITATIONS',
  '- You may NOT edit source files with `edit` or `write`',
  '- You may NOT run `validate()`, `moon_run_task`, or any test/build commands',
  '- You may NOT create new worktrees or branches',
  '- You may NOT call `gh_merge_pr` or `gh_promote_pr`',
  '',
  '### Your only permitted actions',
  '1. **Capture diagnostics**: Read the manifest, contract, and verifier findings.',
  '2. **Log the failure**: Call `contract_workspace_log_failure` with the workspace path.',
  '3. **Report**: Produce a clear summary of what failed and why, for human intervention.',
  '4. **Handoff**: Call `contract_review_decision` with your chosen resolution.',
  '',
  '### Decision mapping',
  '| Intent | Decision |',
  '|---|---|',
  '| Fix it yourself (you have edit + bash access) | `change` (retries implementer) |',
  '| Create a PR for manual review | `approve` |',
  '| Abandon the pipeline | `reject` |',
  '',
  '🔴 Your LAST action must call `contract_review_decision`.',
].join('\n');

const buildPrInfo = (options: {
  prUrl?: string;
  headBranch?: string;
  baseBranch?: string;
  draftFlag: string;
}): string => {
  if (options.prUrl) {
    return [
      '',
      '## 📦 Pull Request',
      `**URL:** ${options.prUrl}`,
      `**Branch:** ${options.headBranch ?? 'unknown'} → ${options.baseBranch ?? 'main'}`,
    ].join('\n');
  }
  if (options.headBranch) {
    return [
      '',
      '## 📦 Branch Pushed — No PR Yet',
      `**Branch:** ${options.headBranch} → ${options.baseBranch ?? 'main'}`,
      `**Compare:** https://github.com/BearlySleeping/aikami/compare/${options.baseBranch ?? 'main'}...${options.headBranch}`,
    ].join('\n');
  }
  return '';
};

/**
 * Load the review captain prompt with exactly one mutually exclusive profile inject.
 *
 * Profiles:
 * - `yolo`: CodeRabbit-only automation, no code editing, no git, no tests.
 * - `ready`: Human-in-the-loop, draft=false, standard review workflow.
 * - `fallback_recovery`: Verifier loop exhausted — diagnostics only, no implementation.
 */
export const loadReviewPrompt = (options: {
  repoRoot: string;
  contractPath: string;
  runId: string;
  prUrl?: string;
  headBranch?: string;
  baseBranch?: string;
  profile: ReviewProfile;
  /** Current autofix cycle number (1-indexed). Used for circuit breaker. */
  autofixCycle?: number;
  /** Hard limit on autofix cycles before YOLO degrades to manual. */
  maxAutofixCycles?: number;
}): string => {
  const promptPath = resolve(options.repoRoot, '.pi/prompts/contract-review-captain.md');
  if (!existsSync(promptPath)) {
    throw new Error(`Review prompt not found: ${promptPath}`);
  }
  const relativeContractPath = relative(options.repoRoot, resolve(options.contractPath)).replaceAll(
    '\\',
    '/',
  );

  const isYolo = options.profile === 'yolo';
  const isReady = options.profile === 'ready';
  const isFallback = options.profile === 'fallback_recovery';
  const draftFlag = isYolo || isReady ? 'false' : 'true';

  const prInfo = buildPrInfo({
    prUrl: options.prUrl,
    headBranch: options.headBranch,
    baseBranch: options.baseBranch,
    draftFlag,
  });

  const profileInject: string = (() => {
    if (isYolo) {
      // Load yolo-overrides.md for full YOLO instructions
      const yoloOverridePath = resolve(options.repoRoot, '.pi/prompts/yolo-overrides.md');
      let yoloOverrides = '';
      if (existsSync(yoloOverridePath)) {
        yoloOverrides = [
          '',
          '---',
          '## 📄 YOLO Overrides (from .pi/prompts/yolo-overrides.md)',
          readFileSync(yoloOverridePath, 'utf-8'),
        ].join('\n');
      }
      return [YOLO_INJECT, yoloOverrides].filter(Boolean).join('\n');
    }
    if (isReady) {
      return READY_INJECT;
    }
    if (isFallback) {
      return FALLBACK_RECOVERY_INJECT;
    }
    // Default: no profile inject — legacy bare prompt (manual review with draft=true).
    return [
      '',
      '## 📋 Manual Review Mode',
      '',
      'Create a draft PR (`gh_create_pr` with `draft: true`) and wait for the user.',
      'The user will direct you to check CodeRabbit, apply fixes, or merge.',
      '',
      '### Decision mapping',
      '| User says | Decision |',
      '|---|---|',
      '| "looks good", "approve" | `approve` |',
      '| "merge it", "merge" | `merge` |',
      '| "needs changes", "fix" | `change` |',
      '| "close it", "reject" | `reject` |',
      '',
      '🔴 Never call `gh_merge_pr`, `gh_promote_pr`, or `gh_cancel_pr` — the orchestrator',
      'handles these with proper cleanup.',
    ].join('\n');
  })();

  const autofixCycle = options.autofixCycle ?? 1;
  const maxCycles = options.maxAutofixCycles ?? 2;

  // 🔴 STATE JSON: Injected at the start so the agent always knows
  // the current runtime state without having to re-parse the prompt.
  const stateBlock = isYolo
    ? [
        '',
        '## 📊 STATE',
        '```json',
        JSON.stringify({
          mode: 'YOLO',
          coderabbitStatus: 'pending',
          unresolvedComments: 0,
          autofixCycle,
          maxAutofixCycles: maxCycles,
        }),
        '```',
        '',
      ].join('\n')
    : '';

  return [
    stateBlock,
    stripFrontmatter(readFileSync(promptPath, 'utf-8')).replace(/\$ARGUMENTS\b/g, options.runId),
    profileInject,
    '',
    '## Active run',
    `Manifest: .pi/contract-runs/${options.runId}/manifest.json`,
    `Contract: ${relativeContractPath}`,
    prInfo,
    '',
    '## 🔴 EXECUTION RULES',
    '- moon/test/build: use `moon_run_task` or `validate()`',
    '- shell >10s: use `ctx_execute` or `bash` with `timeout`',
  ].join('\n');
};
