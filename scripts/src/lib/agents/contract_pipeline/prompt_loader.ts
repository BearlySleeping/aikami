// scripts/src/lib/agents/contract_pipeline/prompt_loader.ts
//
// Loads static per-role system prompts. Feedback from prior stages is NOT
// injected into the system prompt — it is sent as a user message to keep
// DeepSeek's prefix cache valid across retries and stages.
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

/** Extract user-facing feedback text for a retry attempt. */
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
  // Critic receives writer context but no feedback loop (critic fixes inline).
  // Writer receives no feedback (no bounce — critic fixes directly).
  return options.feedback;
};

/** Load and expand the canonical role prompt (static — no feedback injected). */
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
          `No contract file exists yet for ${contractId}. The placeholder path ${contractArgument} is not a real file.`,
          `1. Call \`contract_generate\` with \`${contractId}\` to create the v2 contract shell from TEMPLATE.md.`,
          '2. Discover the actual file created by contract_generate (it will be under docs/contracts/).',
          '3. Read that file and complete every section with evidence from the codebase.',
          '4. Set status to `draft` and call `contract_stage_complete`.',
          'The pipeline will discover the actual filename after you finish.',
        ].join('\n')
      : '';

  // Critic role: state that the critic should fix issues inline, not bounce.
  const criticInstruction =
    options.role === 'critic'
      ? [
          '\n## 🔴 CRITIC ROLE: Fix-Then-Approve',
          'Your job is to fix ALL correctable issues in the contract yourself, then approve.',
          'You have `edit` access to the contract file. Use it.',
          'Only block the contract if it has STRUCTURAL problems you cannot fix:',
          '- Wrong scope or fundamentally wrong problem statement',
          '- Needs splitting (too large)',
          '- Missing critical Acceptance Criteria that require architect input',
          '- Cannot verify a factual claim even after codebase inspection',
          'For everything else — typos, wrong file paths, formatting, barrel position,',
          'missing evidence citations, underspecified ACs you can clarify — just fix it.',
          'Then call `contract_stage_complete` with status `passed`.',
        ].join('\n')
      : '';

  return [
    canonical,
    creationInstruction,
    criticInstruction,
    '\n## 🔴 MANDATORY COMPLETION HANDOFF',
    "This session has exactly one role. Do not perform another role's work.",
    'Do not ask the user questions. If input is required, finish with status `blocked` and list the questions in findings.',
    '🔴 Your last action MUST be a call to `contract_stage_complete`. The pipeline polls for this artifact. Without it, the pipeline blocks forever.',
    '🔴 Even if the contract is already complete, you MUST still call `contract_stage_complete` with status `passed`.',
    '🔴 Printing a text summary is NOT a handoff. The tool call is the only valid handoff mechanism.',
    '🔴 If you print a summary and stop without calling the tool, the pipeline will time out and fail.',
    '',
    '## 🔴 EXECUTION RULES',
    '- For moon/test/build operations: always use `moon_run_task` or `validate()` Pi tools — they have built-in timeouts.',
    '- For any other shell command that may run >10s: use `ctx_execute` (sandboxed, timeout, safe) or `bash` with an explicit `timeout` parameter.',
    '- Never run raw `bun moon run`, `bun test`, or unbounded shell commands — they hang forever with no timeout.',
    '- If a command stalls (same output for >60s), it is frozen — cancel and report.',
  ]
    .filter((section) => section.length > 0)
    .join('\n');
};

/** Load the final interactive review prompt directly. */
export const loadReviewPrompt = (options: {
  repoRoot: string;
  contractPath: string;
  runId: string;
}): string => {
  const promptPath = resolve(options.repoRoot, '.pi/prompts/contract-review-captain.md');
  if (!existsSync(promptPath)) {
    throw new Error(`Review prompt not found: ${promptPath}`);
  }
  const contractPath = relative(options.repoRoot, resolve(options.contractPath)).replaceAll(
    '\\',
    '/',
  );
  return [
    stripFrontmatter(readFileSync(promptPath, 'utf-8')).replace(/\$ARGUMENTS\b/g, options.runId),
    '\n## Active run coordinates',
    `Run manifest: .pi/contract-runs/${options.runId}/manifest.json`,
    `Contract: ${contractPath}`,
    '\nSpeak naturally with the user. You may inspect and fix code yourself.',
    '\n## Review Decision Modes',
    'When the user is ready, call `contract_review_decision` with one of:',
    '- `approve` — mark PR ready for review',
    '- `merge` — mark PR ready + auto-merge squash',
    '- `change` — keep PR open, return to implementer for fixes',
    '- `reject` — close PR, block the pipeline',
    '',
    'User shortcuts map as follows:',
    '- `/approve` or "looks good" → `approve`',
    '- `/merge` or "send it" → `merge`',
    '- `/fix` or "I changed X" → `change`',
    '- `/reject` or "bad" → `reject`',
    '',
    'Never commit or push unless the user separately and explicitly requests that Git operation.',
    '',
    '## 🔴 EXECUTION RULES',
    '- For moon/test/build operations: always use `moon_run_task` or `validate()` Pi tools — they have built-in timeouts.',
    '- For any other shell command that may run >10s: use `ctx_execute` (sandboxed, timeout, safe) or `bash` with an explicit `timeout` parameter.',
    '- Never run raw `bun moon run`, `bun test`, or unbounded shell commands — they hang forever on large suites.',
  ].join('\n');
};
