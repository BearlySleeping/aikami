// scripts/src/lib/agents/contract_pipeline/run_setup.ts
// Run bootstrap: resume discovery, manifest resurrection, and fresh-manifest
// creation. Everything that happens BEFORE the orchestrator acquires its lock
// and initializes the herdr workspace lives here.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveContract } from './contract_resolver.ts';
import { readContractStatus } from './contract_status.ts';
import { captureGitState, currentCommit } from './git_state.ts';
import { createManifest, pipelineLog, readManifest, writeManifest } from './manifest_store.ts';
import type { ContractPipelineStage, RunManifest } from './types.ts';
import { isTerminalStage, STATUS_TO_START_STAGE } from './types.ts';

export const findPreviousRuns = (options: {
  contractId: string;
  cwd: string;
}): string | undefined => {
  const d = join(options.cwd, '.pi/contract-runs');
  if (!existsSync(d)) {
    return undefined;
  }
  const sid = options.contractId.replace(/[^A-Za-z0-9]/g, '-');
  for (const rid of readdirSync(d)
    .filter((e) => e.startsWith('run-') && e.endsWith(`-${sid}`))
    .sort()
    .reverse()) {
    const m = readManifest({ runId: rid, cwd: options.cwd });
    if (m && !isTerminalStage(m.currentStage)) {
      return rid;
    }
  }
  return undefined;
};

/**
 * Resolve the run's manifest: resume a previous incomplete run (by explicit
 * run id, or auto-discovered from the target contract) or create a fresh one.
 * Persists any resulting stage/option changes before returning.
 */
export const prepareRunManifest = (options: {
  repoRoot: string;
  target?: string;
  resumeRunId?: string;
  fresh?: boolean;
  skipAuthoring?: boolean;
  critique?: boolean;
  rootMode?: boolean;
}): RunManifest => {
  let resumeRunId = options.resumeRunId;
  if (!resumeRunId && options.target && !options.fresh) {
    const c = resolveContract({ target: options.target, repoRoot: options.repoRoot });
    const f = findPreviousRuns({ contractId: c.id, cwd: options.repoRoot });
    if (f) {
      console.log(`Found incomplete run for ${c.id} - resuming ${f}.`);
      console.log('   (use --fresh to start over)');
      resumeRunId = f;
    }
  }

  let manifest: RunManifest;
  if (resumeRunId) {
    const resumed = readManifest({ runId: resumeRunId, cwd: options.repoRoot });
    if (!resumed) {
      throw new Error(`Run ${resumeRunId} is not a valid v3 manifest.`);
    }
    manifest = resumed;
    const priorBlockedReason = manifest.blockedReason;
    manifest.blockedReason = undefined;
    // 🔴 A resume starts a fresh blocked-escalation EPISODE. This counter
    // bounds consecutive blocked verdicts with no captain `change` in
    // between; a resume means a human (or a crash-restart) has intervened
    // since the last one. Without this reset, explicitly resuming a
    // terminally-blocked run — the exact C-526 recovery — hits the same
    // spent budget again and dies instantly. The run-total bound is
    // `blockedEscalationRounds`, which is deliberately NOT reset here.
    manifest.blockedEscalations = 0;

    const cs = readContractStatus(manifest.contractPath);
    let contractStage = STATUS_TO_START_STAGE[cs] ?? 'write_contract';
    // Path-sourced contracts skip authoring — a draft contract resumes at
    // implementation, not back to the writer. Use the persisted skipAuthoring
    // decision from the manifest so a draft path-sourced run resumed by run ID
    // without a target remains at implement instead of being reset to write_contract.
    const skipAuthoring = options.skipAuthoring ?? manifest.skipAuthoring;
    // `--critique` keeps the critic pass for a hand-authored contract: the
    // writer is still skipped, but the run enters at `critique` instead of
    // jumping straight to `implement`. The lastCompleted scan below advances
    // past it once critique has passed, so this only affects a fresh entry.
    // When the user supplies an explicit override (true or false), persist it
    // to support older manifests that may not have this field.
    const critique = options.critique ?? manifest.critique;
    // Persist any CLI overrides to the manifest for older manifests or changed options
    let manifestChanged = false;
    if (options.skipAuthoring !== undefined && options.skipAuthoring !== manifest.skipAuthoring) {
      manifest.skipAuthoring = options.skipAuthoring;
      manifestChanged = true;
    }
    if (options.critique !== undefined && options.critique !== manifest.critique) {
      manifest.critique = options.critique;
      manifestChanged = true;
    }
    if (options.rootMode !== undefined && options.rootMode !== manifest.rootMode) {
      manifest.rootMode = options.rootMode;
      manifestChanged = true;
    }
    if (manifestChanged) {
      writeManifest({ manifest, cwd: options.repoRoot });
    }
    if (skipAuthoring && contractStage === 'write_contract') {
      contractStage = critique ? 'critique' : 'implement';
    }
    const stageOrder: ContractPipelineStage[] = [
      'write_contract',
      'critique',
      'implement',
      'verify',
    ];
    const stageAfter: Partial<Record<ContractPipelineStage, ContractPipelineStage>> = {
      write_contract: 'critique',
      critique: 'implement',
      implement: 'verify',
      verify: 'review',
    };
    const lastCompleted = manifest.attempts
      .filter((a) => a.result?.status === 'passed')
      .reduce<ContractPipelineStage | null>((l, a) => {
        const ai = stageOrder.indexOf(a.stage);
        const li = l ? stageOrder.indexOf(l) : -1;
        return ai > li ? a.stage : l;
      }, null);
    let resumeStage = manifest.currentStage;
    if (resumeStage === 'blocked') {
      resumeStage = lastCompleted
        ? (stageAfter[lastCompleted] ??
          manifest.attempts[manifest.attempts.length - 1]?.stage ??
          contractStage)
        : contractStage;
    }
    // 🔴 Post-verify block: verification passed, so there is no worker stage
    // left to retry — `resumeStage` is `review`. Restore the reason so the run
    // re-enters a BLOCKED review (post_verify_failure profile), whose prompt
    // retries the push / PR creation. Without this, clearing the reason turned
    // it into a NORMAL review of an unpushed branch with no PR, which the
    // captain cannot reconcile (and which then crashed back to blocked).
    const lastVerifyPassed = manifest.attempts.some(
      (a) => a.stage === 'verify' && a.result?.status === 'passed',
    );
    const keepBlockedReason =
      resumeStage === 'review' && lastVerifyPassed && Boolean(priorBlockedReason);
    if (keepBlockedReason) {
      manifest.blockedReason = priorBlockedReason;
    }
    if (resumeStage !== manifest.currentStage || keepBlockedReason) {
      pipelineLog({
        runId: manifest.runId,
        cwd: options.repoRoot,
        message: `Resuming: contract status ${cs} → stage ${resumeStage} (was ${manifest.currentStage}).`,
      });
      manifest.currentStage = resumeStage;
      writeManifest({ manifest, cwd: options.repoRoot });
    }
  } else {
    if (!options.target) {
      throw new Error('A contract ID or path is required for a new run.');
    }
    const contract = resolveContract({ target: options.target, repoRoot: options.repoRoot });
    const baseStart = STATUS_TO_START_STAGE[contract.status] ?? 'write_contract';
    // Path-sourced contracts (existing contract by path or bare C-XXX) skip
    // the authoring stages — draft contracts start at implementation.
    let startStage: ContractPipelineStage;
    if (options.skipAuthoring && baseStart === 'write_contract') {
      startStage = options.critique ? 'critique' : 'implement';
    } else {
      startStage = baseStart;
    }
    manifest = createManifest({
      contractId: contract.id,
      contractPath: contract.path,
      baseCommit: currentCommit(options.repoRoot),
      baselineFingerprint: captureGitState(options.repoRoot).fingerprint,
      startStage,
      skipAuthoring: options.skipAuthoring,
      critique: options.critique,
      rootMode: options.rootMode,
    });
    writeManifest({ manifest, cwd: options.repoRoot });
  }
  return manifest;
};
