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

/** Load and expand the canonical role prompt without invoking a slash command. */
export const loadRolePrompt = (options: {
  role: ContractWorkerRole;
  contractPath: string;
  repoRoot: string;
  feedback?: string;
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
  const feedback = options.feedback?.trim();
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

  return [
    canonical,
    creationInstruction,
    feedback ? `\n## Prior-stage feedback\n\n${feedback}` : '',
    '\n## 🔴 MANDATORY COMPLETION HANDOFF',
    "This session has exactly one role. Do not perform another role's work.",
    'Do not ask the user questions. If input is required, finish with status `blocked` and list the questions in findings.',
    '🔴 Your last action MUST be a call to `contract_stage_complete`. The pipeline polls for this artifact. Without it, the pipeline blocks forever.',
    '🔴 Even if the contract is already complete, you MUST still call `contract_stage_complete` with status `passed`.',
    '🔴 Printing a text summary is NOT a handoff. The tool call is the only valid handoff mechanism.',
    '🔴 If you print a summary and stop without calling the tool, the pipeline will time out and fail.',
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
    'When the user approves, rejects, or asks for re-verification after changes, call `contract_review_decision`.',
    'Never commit or push unless the user separately and explicitly requests that Git operation.',
  ].join('\n');
};
