// .pi/extensions/contract_pipeline.ts
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StringEnum } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { captureGitState } from '../../scripts/src/lib/agents/contract_pipeline/git_state.ts';
import { readManifest } from '../../scripts/src/lib/agents/contract_pipeline/manifest_store.ts';
import { writeStageResult } from '../../scripts/src/lib/agents/contract_pipeline/stage_result.ts';
import type {
  ContractReviewDecision,
  ContractWorkerRole,
} from '../../scripts/src/lib/agents/contract_pipeline/types.ts';

const MUTATING_GIT_RE =
  /\bgit\s+(?:add|commit|push|merge|rebase|reset|checkout|switch|clean|stash|tag)\b/i;
const MUTATING_SHELL_RE = /(?:^|[;&|]\s*)(?:rm|mv|cp|mkdir|touch|tee)\b|>{1,2}|\bsed\s+-i\b/i;
const DEPLOY_TOOLS = new Set(['firebase_deploy_functions', 'direnv_switch_mode']);

const environment = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing pipeline environment variable: ${name}`);
  }
  return value;
};

const hashContract = (path: string): string =>
  existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : '';

const atomicWrite = (options: { path: string; value: unknown }): void => {
  const temporaryPath = `${options.path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(options.value, undefined, 2));
  renameSync(temporaryPath, options.path);
};

const isFileMutationAllowed = (options: {
  role: string;
  inputPath: string;
  contractPath: string;
}): boolean => {
  if (options.role === 'implementer' || options.role === 'review') {
    return true;
  }
  if (options.role === 'writer') {
    return resolve(options.inputPath) === resolve(options.contractPath);
  }
  return false;
};

/** Register deterministic contract pipeline completion, review, and role guards. */
export default function contractPipelineExtension(pi: ExtensionAPI): void {
  pi.on('tool_call', async (event) => {
    const role = process.env.CONTRACT_PIPELINE_ROLE;
    if (!role) {
      return undefined;
    }

    if (DEPLOY_TOOLS.has(event.toolName)) {
      return {
        block: true,
        reason: `Deployment tool ${event.toolName} is disabled in contract runs.`,
      };
    }

    const input = event.input as Record<string, unknown>;
    if (
      (event.toolName === 'write' || event.toolName === 'edit') &&
      typeof input.path === 'string'
    ) {
      const contractPath = environment('CONTRACT_PIPELINE_CONTRACT_PATH');
      if (!isFileMutationAllowed({ role, inputPath: input.path, contractPath })) {
        return {
          block: true,
          reason: `Role ${role} may not mutate ${input.path}.`,
        };
      }
    }

    if (event.toolName === 'bash' && typeof input.command === 'string') {
      if (role !== 'review' && MUTATING_GIT_RE.test(input.command)) {
        return { block: true, reason: 'Git mutations are disabled inside contract workers.' };
      }
      if ((role === 'critic' || role === 'writer') && MUTATING_SHELL_RE.test(input.command)) {
        return { block: true, reason: `Mutating shell commands are disabled for ${role}.` };
      }
    }

    return undefined;
  });

  pi.registerTool({
    name: 'contract_stage_complete',
    label: 'Contract Stage Complete',
    description:
      'Finish the current automated contract stage with a validated, atomic result artifact. This must be the final action of every writer, critic, implementer, and verifier stage.',
    promptSnippet: 'Write the authoritative completion result for the current contract stage',
    promptGuidelines: [
      'Use contract_stage_complete exactly once as the final action of an automated contract pipeline worker.',
      'Do not claim passed when required work, tests, or evidence are incomplete.',
    ],
    parameters: Type.Object({
      status: StringEnum(['passed', 'changes_requested', 'blocked', 'failed'] as const),
      summary: Type.String({ maxLength: 4096 }),
      findings: Type.Array(Type.String(), { default: [] }),
      filesTouched: Type.Array(Type.String(), { default: [] }),
      evidence: Type.Array(Type.String(), { default: [] }),
    }),
    async execute(_toolCallId, params) {
      const runId = environment('CONTRACT_PIPELINE_RUN_ID');
      const role = environment('CONTRACT_PIPELINE_ROLE') as ContractWorkerRole;
      if (!['writer', 'critic', 'implementer', 'verifier'].includes(role)) {
        throw new Error(`Role ${role} cannot complete a worker stage.`);
      }
      const attempt = Number(environment('CONTRACT_PIPELINE_ATTEMPT'));
      if (!Number.isInteger(attempt) || attempt < 1) {
        throw new Error('Pipeline attempt is invalid.');
      }
      const contractPath = environment('CONTRACT_PIPELINE_CONTRACT_PATH');
      const resultPath = environment('CONTRACT_PIPELINE_RESULT_PATH');
      const gitState = captureGitState(process.cwd());
      writeStageResult({
        resultPath,
        result: {
          runId,
          stage: role,
          attempt,
          status: params.status,
          summary: params.summary,
          findings: params.findings,
          filesTouched: params.filesTouched,
          evidence: params.evidence,
          contractHash: hashContract(contractPath),
          diffHash: gitState.fingerprint,
        },
      });
      return {
        content: [{ type: 'text', text: `Stage ${role} result saved: ${params.status}` }],
        details: { runId, role, attempt, status: params.status },
        terminate: true,
      };
    },
  });

  pi.registerTool({
    name: 'contract_review_decision',
    label: 'Contract Review Decision',
    description:
      'Record the user-informed final review decision. Approval is rejected when code changed after independent verification.',
    promptSnippet:
      'Record approve, changes_applied, reject, or blocked for the active contract review',
    parameters: Type.Object({
      decision: StringEnum(['approve', 'changes_applied', 'reject', 'blocked'] as const),
      summary: Type.String({ maxLength: 4096 }),
    }),
    async execute(_toolCallId, params) {
      if (environment('CONTRACT_PIPELINE_ROLE') !== 'review') {
        throw new Error('contract_review_decision is only available in the review session.');
      }
      const runId = environment('CONTRACT_PIPELINE_RUN_ID');
      const reviewPath = environment('CONTRACT_PIPELINE_REVIEW_PATH');
      const manifest = readManifest({ runId, cwd: process.cwd() });
      if (!manifest) {
        throw new Error(`Run manifest not found: ${runId}`);
      }
      const fingerprint = captureGitState(process.cwd()).fingerprint;
      if (
        params.decision === 'approve' &&
        (!manifest.verificationFingerprint || manifest.verificationFingerprint !== fingerprint)
      ) {
        throw new Error(
          'Code changed after verification. Choose changes_applied to request re-verification.',
        );
      }
      const contractPath = environment('CONTRACT_PIPELINE_CONTRACT_PATH');
      const contractChanged =
        typeof manifest.verificationContractHash === 'string' &&
        manifest.verificationContractHash !== hashContract(contractPath);
      const decision: ContractReviewDecision = {
        runId,
        decision: params.decision,
        summary: params.summary,
        diffHash: fingerprint,
        contractChanged,
        createdAt: new Date().toISOString(),
      };
      atomicWrite({ path: reviewPath, value: decision });
      return {
        content: [{ type: 'text', text: `Review decision recorded: ${params.decision}` }],
        details: decision,
      };
    },
  });
}
