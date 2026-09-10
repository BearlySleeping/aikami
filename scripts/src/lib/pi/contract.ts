// scripts/src/lib/pi/contract.ts
//
// Bun-side implementations of the contract-pipeline bridge commands.

import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { commitContractContent } from '../agents/contract_pipeline/contract_sync.ts';
import { captureGitState } from '../agents/contract_pipeline/git_state.ts';
import { readManifest, writeManifest } from '../agents/contract_pipeline/manifest_store.ts';
import { runPrePushGate } from '../agents/contract_pipeline/pre_push_gate.ts';
import {
  createWorkspaceGitReader,
  deriveRunRepoRoot,
  evaluatePublicationGate,
  formatPublicationBlocks,
  formatPublicationWarning,
} from '../agents/contract_pipeline/publication_gate.ts';
import { writeStageResult } from '../agents/contract_pipeline/stage_result.ts';
import type { ContractStageResult, RunManifest } from '../agents/contract_pipeline/types.ts';
import { optionalString, requireString, toArgs } from './args.ts';
import type { PiHandlers } from './types.ts';

const CONTRACT_WORKER_ROLE_SCHEMA = Type.Union([
  Type.Literal('writer'),
  Type.Literal('critic'),
  Type.Literal('implementer'),
  Type.Literal('verifier'),
]);

const CONTRACT_PIPELINE_STAGE_SCHEMA = Type.Union([
  Type.Literal('prepare'),
  Type.Literal('write_contract'),
  Type.Literal('critique'),
  Type.Literal('implement'),
  Type.Literal('verify'),
  Type.Literal('review'),
  Type.Literal('accepted'),
  Type.Literal('reconciling'),
  Type.Literal('pr_created'),
  Type.Literal('merged'),
  Type.Literal('blocked'),
]);

const CONTRACT_STAGE_RESULT_SCHEMA = Type.Unsafe<ContractStageResult>(
  Type.Object({
    runId: Type.String(),
    stage: CONTRACT_WORKER_ROLE_SCHEMA,
    attempt: Type.Integer({ minimum: 0 }),
    generation: Type.Optional(Type.Integer({ minimum: 0 })),
    status: Type.Union([
      Type.Literal('passed'),
      Type.Literal('changes_requested'),
      Type.Literal('blocked'),
      Type.Literal('failed'),
    ]),
    summary: Type.String(),
    findings: Type.Array(Type.String()),
    filesTouched: Type.Array(Type.String()),
    evidence: Type.Array(Type.String()),
    contractHash: Type.String(),
    diffHash: Type.String(),
    haltedBy: Type.Optional(Type.Union([Type.Literal('cost_guard'), Type.Literal('hard_timeout')])),
  }),
);

const STAGE_USAGE_SCHEMA = Type.Object({
  model: Type.String(),
  turns: Type.Number(),
  inputTokens: Type.Number(),
  outputTokens: Type.Number(),
  cacheReadTokens: Type.Number(),
  cacheWriteTokens: Type.Number(),
  totalTokens: Type.Number(),
  cost: Type.Number(),
});

const MONETARY_AMOUNT_SCHEMA = Type.Object({
  amount: Type.Number(),
  currency: Type.String(),
  provenance: Type.Union([
    Type.Literal('provider_reported'),
    Type.Literal('estimated'),
    Type.Literal('unknown'),
    Type.Literal('incomplete'),
  ]),
  pricingVersion: Type.Optional(Type.String()),
  conversion: Type.Optional(
    Type.Object({ rate: Type.Number(), timestamp: Type.String(), source: Type.String() }),
  ),
});

const USAGE_RECORD_SCHEMA = Type.Object({
  model: Type.String(),
  provider: Type.String(),
  thinkingLevel: Type.String(),
  configVersion: Type.String(),
  turns: Type.Number(),
  inputTokens: Type.Number(),
  outputTokens: Type.Number(),
  cacheReadTokens: Type.Number(),
  cacheWriteTokens: Type.Number(),
  totalTokens: Type.Number(),
  elapsedSeconds: Type.Number(),
  toolErrors: Type.Number(),
  retries: Type.Number(),
  monetary: Type.Record(Type.String(), MONETARY_AMOUNT_SCHEMA),
  complete: Type.Boolean(),
  eventId: Type.String(),
  finalizedAt: Type.String(),
  externalCoverageComplete: Type.Boolean(),
  contributingRoles: Type.Optional(Type.Array(CONTRACT_WORKER_ROLE_SCHEMA)),
});

const AGGREGATED_USAGE_SCHEMA = Type.Object({
  totalTurns: Type.Number(),
  totalInputTokens: Type.Number(),
  totalOutputTokens: Type.Number(),
  totalCacheReadTokens: Type.Number(),
  totalCacheWriteTokens: Type.Number(),
  aggregatedTotalTokens: Type.Number(),
  totalElapsedSeconds: Type.Number(),
  totalToolErrors: Type.Number(),
  totalRetries: Type.Number(),
  monetary: Type.Record(Type.String(), MONETARY_AMOUNT_SCHEMA),
  convertedTotal: Type.Optional(MONETARY_AMOUNT_SCHEMA),
  unknownAttempts: Type.Number(),
  failedAttempts: Type.Number(),
  models: Type.Array(Type.String()),
  providers: Type.Array(Type.String()),
  externalCoverageComplete: Type.Boolean(),
});

const STAGE_ATTEMPT_SCHEMA = Type.Object({
  stage: CONTRACT_PIPELINE_STAGE_SCHEMA,
  role: CONTRACT_WORKER_ROLE_SCHEMA,
  attempt: Type.Integer({ minimum: 0 }),
  paneId: Type.String(),
  startTime: Type.String(),
  endTime: Type.Optional(Type.String()),
  result: Type.Optional(CONTRACT_STAGE_RESULT_SCHEMA),
  usage: Type.Optional(STAGE_USAGE_SCHEMA),
  usageRecord: Type.Optional(USAGE_RECORD_SCHEMA),
});

const RUN_MANIFEST_SCHEMA = Type.Unsafe<RunManifest>(
  Type.Object({
    version: Type.Literal(3),
    runId: Type.String(),
    contractId: Type.String(),
    contractPath: Type.String(),
    baseCommit: Type.String(),
    baselineFingerprint: Type.String(),
    startTime: Type.String(),
    lastUpdated: Type.String(),
    currentStage: CONTRACT_PIPELINE_STAGE_SCHEMA,
    verifyLoops: Type.Number(),
    attempts: Type.Array(STAGE_ATTEMPT_SCHEMA),
    usage: Type.Record(Type.String(), STAGE_USAGE_SCHEMA),
    aggregatedUsage: Type.Optional(AGGREGATED_USAGE_SCHEMA),
    reviewDecision: Type.Optional(
      Type.Object({
        runId: Type.String(),
        decision: Type.Union([
          Type.Literal('approve'),
          Type.Literal('merge'),
          Type.Literal('change'),
          Type.Literal('reject'),
        ]),
        summary: Type.String(),
        details: Type.Optional(Type.String()),
        diffHash: Type.String(),
        contractChanged: Type.Boolean(),
        createdAt: Type.String(),
      }),
    ),
    reconciliation: Type.Optional(
      Type.Object({
        changeId: Type.String(),
        bookmarkName: Type.String(),
        headBranch: Type.String(),
        baseBranch: Type.String(),
        prTitle: Type.String(),
        prBody: Type.String(),
        prUrl: Type.Optional(Type.String()),
        merged: Type.Optional(Type.Boolean()),
      }),
    ),
    prePushValidation: Type.Optional(
      Type.Object({
        ok: Type.Boolean(),
        output: Type.String(),
        checkedAt: Type.String(),
        revision: Type.String(),
      }),
    ),
    verificationFingerprint: Type.Optional(Type.String()),
    verificationContractHash: Type.Optional(Type.String()),
    prUrl: Type.Optional(Type.String()),
    workspaceId: Type.Optional(Type.String()),
    pipelinePaneId: Type.Optional(Type.String()),
    reviewPaneId: Type.Optional(Type.String()),
    reviewTaskDelivered: Type.Optional(Type.Boolean()),
    reviewResumeNudgedAt: Type.Optional(Type.String()),
    worktreeWorkspaceId: Type.Optional(Type.String()),
    worktreeCheckoutPath: Type.Optional(Type.String()),
    worktreeBranch: Type.Optional(Type.String()),
    blockedReason: Type.Optional(Type.String()),
    blockedEscalations: Type.Optional(Type.Number()),
    autofixCycles: Type.Number(),
    skipAuthoring: Type.Optional(Type.Boolean()),
    critique: Type.Optional(Type.Boolean()),
    rootMode: Type.Optional(Type.Boolean()),
  }),
);

export const handlers: PiHandlers = {
  'contract.captureGitState': (payload) => captureGitState(requireString(toArgs(payload), 'cwd')),

  'contract.runRepoRoot': () => deriveRunRepoRoot(),

  'contract.manifest.read': (payload) => {
    const args = toArgs(payload);
    return readManifest({
      runId: requireString(args, 'runId'),
      cwd: requireString(args, 'repoRoot'),
    });
  },

  'contract.manifest.write': (payload) => {
    const args = toArgs(payload);
    Value.Assert(RUN_MANIFEST_SCHEMA, args.manifest);
    writeManifest({
      manifest: args.manifest,
      cwd: requireString(args, 'repoRoot'),
    });
    return null;
  },

  'contract.prepushGate': (payload) => {
    const args = toArgs(payload);
    return runPrePushGate({
      cwd: requireString(args, 'cwd'),
      base: requireString(args, 'base'),
      runId: optionalString(args, 'runId'),
    });
  },

  'contract.stage.writeResult': (payload) => {
    const args = toArgs(payload);
    Value.Assert(CONTRACT_STAGE_RESULT_SCHEMA, args.result);
    writeStageResult({
      resultPath: requireString(args, 'resultPath'),
      result: args.result,
    });
    return null;
  },

  /**
   * Evaluate the PR publication gate for a workspace and return both the
   * structured verdict and the pre-rendered refusal/warning text, so the
   * Node-side caller never needs the gate's formatting functions.
   */
  'contract.publication.evaluate': (payload) => {
    const args = toArgs(payload);
    const workspacePath = requireString(args, 'workspacePath');
    const runId = optionalString(args, 'runId');
    const manifest = runId ? readManifest({ runId, cwd: deriveRunRepoRoot() }) : undefined;
    const result = evaluatePublicationGate({
      git: createWorkspaceGitReader(workspacePath),
      manifest,
      branch: optionalString(args, 'branch'),
    });
    return {
      ok: result.ok,
      indeterminate: result.indeterminate ?? false,
      head: result.head,
      branch: result.branch,
      blocks: result.blocks.map((block) => block.code),
      warnings: result.warnings.map((warning) => warning.code),
      refusal: formatPublicationBlocks(result),
      warning: formatPublicationWarning(result),
    };
  },

  'contract.content.commit': (payload) => {
    const args = toArgs(payload);
    return commitContractContent({
      repoRoot: requireString(args, 'repoRoot'),
      contractPath: requireString(args, 'contractPath'),
      content: requireString(args, 'content'),
      message: requireString(args, 'message'),
    });
  },
};
