// scripts/src/lib/pi/contract.ts
//
// Bun-side implementations of the contract-pipeline bridge commands.

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
    writeManifest({
      manifest: args.manifest as RunManifest,
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
    writeStageResult({
      resultPath: requireString(args, 'resultPath'),
      result: args.result as ContractStageResult,
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
