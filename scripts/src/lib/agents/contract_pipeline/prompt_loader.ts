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

export const feedbackMessage = (options: {
  role: ContractWorkerRole;
  feedback: string;
}): string => {
  if (options.role === 'implementer') {
    return [
      '## Prior Verifier Feedback',
      'The verifier found the following issues. Fix them and re-submit.',
      '',
      options.feedback,
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
          'Only block for STRUCTURAL problems: wrong scope, needs splitting, missing critical ACs.',
          'For everything else — fix it, then call `contract_stage_complete` with `passed`.',
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

export const loadReviewPrompt = (options: {
  repoRoot: string;
  contractPath: string;
  runId: string;
  prUrl?: string;
  headBranch?: string;
  baseBranch?: string;
  ready?: boolean;
  yolo?: boolean;
}): string => {
  const promptPath = resolve(options.repoRoot, '.pi/prompts/contract-review-captain.md');
  if (!existsSync(promptPath)) {
    throw new Error(`Review prompt not found: ${promptPath}`);
  }
  const contractPath = relative(options.repoRoot, resolve(options.contractPath)).replaceAll(
    '\\',
    '/',
  );

  const draftFlag = (options.ready || options.yolo) ? 'false' : 'true';
  const prInfo = options.prUrl
    ? [
        '',
        '## 📦 Pull Request',
        `**URL:** ${options.prUrl}`,
        `**Branch:** ${options.headBranch ?? 'unknown'} → ${options.baseBranch ?? 'main'}`,
        '',
        '### GitHub tools',
        '| Action | Tool |',
        `| Summary | gh_summarize_pr |`,
        '| CI | gh_pr_status |',
        '| Edit | gh_edit_pr |',
        '| Promote | gh_promote_pr |',
        '| Close | gh_cancel_pr |',
      ].join('\n')
    : options.headBranch
      ? [
          '',
          '## 📦 Branch Pushed — Create the PR',
          `**Branch:** ${options.headBranch} → ${options.baseBranch ?? 'main'}`,
          `**Compare:** https://github.com/BearlySleeping/aikami/compare/${options.baseBranch ?? 'main'}...${options.headBranch}`,
          '',
          '🔴 **No PR exists yet.** You must create it:',
          '1. Read the manifest + contract + verifier findings',
          '2. Write a PR title + body (follow PR #19 style):',
          '   - Title: `C-XXX: Short description`',
          '   - Body: "What was built" / "Verification" table / "Test Results" counts',
          `3. Call \`gh_create_pr\` with draft=${draftFlag}`,
          '4. After creation, PR URL is available',
          '',
          '### GitHub tools',
          `| Create PR | gh_create_pr headBranch=${options.headBranch} draft=${draftFlag} |`,
          '| Summary | gh_summarize_pr |',
          '| CI | gh_pr_status |',
          '| Promote | gh_promote_pr |',
        ].join('\n')
      : '';

  return [
    stripFrontmatter(readFileSync(promptPath, 'utf-8')).replace(/\$ARGUMENTS\b/g, options.runId),
    '\n## Active run',
    `Manifest: .pi/contract-runs/${options.runId}/manifest.json`,
    `Contract: ${contractPath}`,
    prInfo,
    '\n### Decisions',
    '- "approve" → promote ready, close review',
    '- "merge" → promote + squash-merge + sync main + cleanup',
    '- "fix" → back to implementer',
    '- "reject" → close PR, block',
    '',
    'Never commit/push unless explicitly asked.',
    '\n## 🔴 EXECUTION RULES',
    '- moon/test/build: use `moon_run_task` or `validate()`',
    '- shell >10s: use `ctx_execute` or `bash` with `timeout`',
  ].join('\n');
};
