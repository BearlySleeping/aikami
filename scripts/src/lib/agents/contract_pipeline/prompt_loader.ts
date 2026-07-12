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
          `The contract at ${contractArgument} does not exist on disk.`,
          `1. Call \`contract_generate\` with \`${contractId}\` to create the v2 contract shell from the canonical TEMPLATE.md.`,
          '2. Read the newly created file and complete every section with evidence from the codebase.',
          '3. Set status to `draft` and call `contract_stage_complete`.',
        ].join('\n')
      : '';

  return [
    canonical,
    creationInstruction,
    feedback ? `\n## Prior-stage feedback\n\n${feedback}` : '',
    '\n## Automated pipeline completion',
    "This session has exactly one role. Do not perform another role's work.",
    'Do not ask the user questions. If input is required, finish with status `blocked` and list the questions in findings.',
    'Your final action MUST call `contract_stage_complete` with a truthful status, summary, findings, filesTouched, and evidence.',
    'Do not merely print a completion heading; terminal text is not a pipeline handoff.',
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
