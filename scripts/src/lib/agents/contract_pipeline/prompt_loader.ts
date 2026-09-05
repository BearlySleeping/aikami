// scripts/src/lib/agents/contract_pipeline/prompt_loader.ts
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { ContractWorkerRole } from './types.ts';

const ROLE_PROMPTS: Record<ContractWorkerRole, string> = {
  writer: '.pi/prompts/contract-create.md',
  critic: '.pi/prompts/contract-critique.md',
  implementer: '.pi/prompts/contract-implement.md',
  verifier: '.pi/prompts/contract-verify.md',
};

const stripFrontmatter = (content: string): string => content.replace(/^---\n[\s\S]*?\n---\n/, '');

/** Mutually exclusive review profiles that isolate context windows per agent mode. */
export type ReviewProfile = 'yolo' | 'ready' | 'post_verify_failure' | 'fallback_recovery';

/**
 * File backing each profile's inject, relative to repoRoot. Every profile is
 * a self-contained markdown file — no inline JS string literals — so
 * prompt-only edits never require touching this module. Mirrors the
 * pre-existing pattern for `yolo-overrides.md`.
 */
const PROFILE_PROMPT_FILES: Record<ReviewProfile, string> = {
  yolo: '.pi/prompts/yolo-overrides.md',
  ready: '.pi/prompts/contract-review-ready.md',
  post_verify_failure: '.pi/prompts/contract-review-post-verify-failure.md',
  fallback_recovery: '.pi/prompts/contract-review-recovery.md',
};

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

/**
 * The one boundary every pipeline role shares: the worktree is yours, the
 * main checkout is the human's.
 *
 * 🔴 2026-09-02: an agent running in a worktree pane decided, unprompted, to
 * compare its typecheck errors against `main`. It did that by operating on
 * the MAIN checkout — which is a live developer workspace with uncommitted
 * work in it. The checkout it ran there produced a merge conflict and
 * disrupted unrelated in-flight development.
 *
 * The rule is stated with its escape hatch attached, because the underlying
 * goal (see what `main` looks like) is legitimate and cheap to satisfy from
 * inside the worktree — `git show`, `git diff` and `git fetch` all read other
 * refs without touching another checkout's working tree. An agent told only
 * "don't" will improvise; one told "don't, do this instead" complies.
 *
 * Appended to every role prompt via loadRolePrompt's EXECUTION RULES.
 */
export const WORKSPACE_BOUNDARY_RULES: readonly string[] = [
  '- 🔴 **Your workspace is the directory you started in — never operate outside it.**',
  '  If your cwd is under `~/.herdr/worktrees/`, you are in an isolated worktree and',
  '  the main checkout (e.g. `~/Development/.../aikami`) is OFF LIMITS. It is the',
  "  human's live workspace and normally holds uncommitted work.",
  '  NEVER, against any path outside your worktree: `cd` into it, `git checkout`,',
  '  `git switch`, `git stash`, `git pull`, `git merge`, `git reset`, edit a file,',
  '  or run a build/test/typecheck there.',
  '- 🔴 **To compare against `main`, stay inside your worktree.** Everything you',
  '  need reads from refs, not from another checkout:',
  '  `git show main:<path>` (file contents), `git diff main -- <path>` (your changes),',
  '  `git log main..HEAD`, `git fetch origin main` (refresh the ref).',
  '  A baseline typecheck belongs on `git stash` **within your own worktree**, or on a',
  '  second worktree you create — never on the main checkout.',
  '  If you truly cannot answer a question without another checkout, report it in your',
  "  findings and move on. Disrupting the human's workspace is never the right trade.",
  '- The ONLY exception is a run explicitly started in root mode (`--root`), where no',
  '  worktree exists and the repo you started in IS your workspace.',
];

export const loadRolePrompt = (options: {
  role: ContractWorkerRole;
  contractPath: string;
  repoRoot: string;
  /** True for the interactive writer (direct draft): the agent waits for the
   *  user's feature description in the chat instead of executing a task
   *  immediately. Overrides the completion handoff so it never blocks early. */
  interactiveWriter?: boolean;
  /** Absolute path to the per-stage task brief file. The interactive writer
   *  reads it once the user describes the feature. */
  taskBriefPath?: string;
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
  // For the interactive writer, don't present the placeholder path as task
  // input — the agent would treat it as a job to execute. Its real input is
  // the feature the user types in the chat.
  const userInput = options.interactiveWriter
    ? '(direct draft — awaiting your feature description in the chat)'
    : contractArgument;
  const canonical = stripFrontmatter(readFileSync(promptPath, 'utf-8')).replace(
    /\$ARGUMENTS\b/g,
    userInput,
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
  // The interactive writer is a human-in-the-loop stage: it must WAIT for the
  // user's description. The standard completion handoff ("finish with blocked")
  // would make it abort when no description has arrived yet — exactly what
  // happened before. Replace it with explicit wait instructions.
  const completionHandoff = options.interactiveWriter
    ? [
        '\n## 🔴 INTERACTIVE DIRECT DRAFT — WAIT FOR THE USER',
        'You are the Contract Writer for a direct draft. The user will describe',
        'their feature in this chat. You have NO task to execute yet.',
        '',
        '- Do NOT inspect the codebase, scan the backlog, or write any file',
        '  until the user describes their feature.',
        '- Do NOT call `contract_stage_complete` before the contract is written.',
        '- When the user describes the feature, read your task brief at:',
        `  ${options.taskBriefPath ?? '(see your task brief path in the welcome message)'}`,
        '  and follow it exactly: derive a slug → create',
        '  `docs/contracts/C-XXX-<slug>.md` → read `docs/contracts/TEMPLATE.md` →',
        '  inspect the codebase → fill every section (no TBD) → set status to',
        '  `draft` → call `contract_stage_complete` with status `passed`.',
      ].join('\n')
    : [
        '\n## 🔴 MANDATORY COMPLETION HANDOFF',
        'Do not ask questions. If input is required, finish with `blocked`.',
        '🔴 Your last action MUST be a call to `contract_stage_complete`.',
      ].join('\n');
  return [
    canonical,
    creationInstruction,
    criticInstruction,
    completionHandoff,
    '\n## 🔴 EXECUTION RULES',
    '- For moon/test/build: use `moon_run_task` or `validate()` — built-in timeouts.',
    '- For any shell >10s: use `ctx_execute` or `bash` with explicit `timeout`.',
    ...WORKSPACE_BOUNDARY_RULES,
  ]
    .filter((s) => s.length > 0)
    .join('\n');
};

// ── Review profile injects ──────────────────────────────────
// Each profile is backed by exactly one markdown file (PROFILE_PROMPT_FILES
// above) that appends to the canonical review captain prompt. They are
// mutually exclusive and carry no code-editing crossover contamination — a
// run only ever sees the ONE profile file matching its actual outcome, never
// another profile's rules restated or contradicted alongside it. Keeping
// them as plain files (not inline JS string arrays) means a prompt-only
// tweak never needs a code change or redeploy.

const YOLO_HEADER = [
  '',
  '## 🚀 YOLO MODE — Fully Automated CodeRabbit Pipeline',
  '',
  'You are the YOLO Review Captain. No human in the loop. Read the `📊 STATE`',
  'JSON above before starting, then follow the instructions below EXACTLY.',
].join('\n');

/** Load one profile's markdown file, with a short header for yolo (its file
 *  is shared with other pi commands and doesn't self-identify as a review
 *  profile). Falls back to MANUAL_REVIEW_FALLBACK if the file is missing —
 *  a missing profile file must never leave the captain with NO tool-
 *  permission guidance at all. */
const loadProfileFile = (options: { repoRoot: string; profile: ReviewProfile }): string => {
  const path = resolve(options.repoRoot, PROFILE_PROMPT_FILES[options.profile]);
  if (!existsSync(path)) {
    return MANUAL_REVIEW_FALLBACK;
  }
  const body = readFileSync(path, 'utf-8');
  return options.profile === 'yolo' ? [YOLO_HEADER, '', body].join('\n') : `\n${body}`;
};

const MANUAL_REVIEW_FALLBACK = [
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
  '🔴 Never call `gh_pr` action `merge`, `gh_promote_pr`, or `gh_cancel_pr` — the orchestrator',
  'handles these with proper cleanup.',
].join('\n');

const buildPrInfo = (options: {
  prUrl?: string;
  headBranch?: string;
  baseBranch?: string;
  draftFlag: string;
  /**
   * Whether `headBranch` actually exists on origin.
   *
   * 🔴 Must be MEASURED, not assumed. Blocked reviews reach this with
   * `headBranch` falling back to the worktree's local branch — reconciliation
   * either never ran or threw, so nothing was pushed. The header used to say
   * "Branch Pushed" regardless, and in C-390 the captain burned a turn
   * disproving its own briefing ("the system-prompt header was stale").
   */
  branchPushed?: boolean;
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
    const base = options.baseBranch ?? 'main';
    return options.branchPushed
      ? [
          '',
          '## 📦 Branch Pushed — No PR Yet',
          `**Branch:** ${options.headBranch} → ${base}`,
          `**Compare:** https://github.com/BearlySleeping/aikami/compare/${base}...${options.headBranch}`,
        ].join('\n')
      : [
          '',
          '## 📦 Branch NOT Pushed — No PR Yet',
          `**Branch:** ${options.headBranch} (local only) → ${base}`,
          'Verified against origin at prompt time. Push it before creating a PR.',
        ].join('\n');
  }
  return '';
};

/**
 * Load the review captain prompt with exactly one mutually exclusive profile inject.
 *
 * Profiles (each backed by its own file in PROFILE_PROMPT_FILES):
 * - `yolo`: CodeRabbit-only automation, no manual code editing, no tests.
 * - `ready`: Human-in-the-loop, draft=false, standard review workflow.
 * - `post_verify_failure`: Verify passed but branch push / PR creation failed
 *   afterward — infra troubleshooting, not a code problem.
 * - `fallback_recovery`: Verifier ↔ implementer loop exhausted — diagnose
 *   (optionally via AskClaude) and hand off to the implementer via `change`;
 *   edit code directly only for small fixes.
 */
export const loadReviewPrompt = (options: {
  repoRoot: string;
  contractPath: string;
  runId: string;
  prUrl?: string;
  headBranch?: string;
  baseBranch?: string;
  /** Measured `git ls-remote` result for `headBranch`. See {@link buildPrInfo}. */
  branchPushed?: boolean;
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
  // Only 'ready' produces a non-draft PR straight away; 'post_verify_failure'
  // and 'fallback_recovery' don't have a PR yet at all (draftFlag is moot —
  // their own prompt files tell the captain to create one with draft:false
  // once it's actually fixed the block), and the bare-file-missing fallback
  // below stays conservative with a draft PR.
  const draftFlag = isYolo || options.profile === 'ready' ? 'false' : 'true';

  const prInfo = buildPrInfo({
    prUrl: options.prUrl,
    headBranch: options.headBranch,
    baseBranch: options.baseBranch,
    branchPushed: options.branchPushed,
    draftFlag,
  });

  const profileInject = loadProfileFile({ repoRoot: options.repoRoot, profile: options.profile });

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
