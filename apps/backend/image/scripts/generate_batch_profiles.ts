// apps/backend/image/scripts/generate_batch_profiles.ts
//
// C-520: the profile half of the `generate:batch` front door.
//
// Three concerns that all belong to "which versioned profiles did this run
// use, and what did they produce": the preparation hook wired into the runner,
// the run-level observations printed with the report, and the
// `media-validation.json` artifact written beside the run record.
//
// They live here rather than in the CLI so the orchestrator stays a dispatcher,
// and so the profile wiring can be unit-tested without spawning a process.
//
// Contract: C-520 Versioned image workflows and asset preparation

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  BatchMediaValidationRecord,
  BatchPreparationHook,
} from '@aikami/local-stack/generation';
import type { GenerationPlanWarning, MediaValidationReport } from '@aikami/types';
import { prepareCandidate } from './preparation_host.ts';

/** `media-validation.json` — the run's preparation evidence. */
export type MediaValidationFile = {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly preparationProfileId: string | undefined;
  readonly machinePassed: boolean;
  readonly validations: readonly BatchMediaValidationRecord[];
};

/**
 * Builds the deterministic-preparation hook the runner calls once per job.
 *
 * A rejected candidate does not throw: the contract's deliverable is an
 * auditable rejection reason, and the raw bytes stay content-addressed and
 * accepted-or-not on their own merits. The prepared artifact is recorded as
 * failing the machine gate instead of being silently promoted.
 */
export const buildPreparationHook =
  (options: {
    preparationProfileId: string;
    onRejected: (message: string) => void;
  }): BatchPreparationHook =>
  async (context) => {
    const prepared = await prepareCandidate({
      rawBytes: context.rawBytes,
      preparationProfileId: options.preparationProfileId,
    });
    if (!prepared.report.machinePassed) {
      const codes = prepared.report.findings
        .filter((finding) => finding.severity === 'error')
        .map((finding) => finding.code)
        .join(', ');
      options.onRejected(
        `✗ ${context.itemId}: media preparation rejected the candidate (${codes}) — the raw bytes stay content-addressed and the prepared artifact is recorded as failing review rather than silently accepted`,
      );
    }
    return {
      bytes: prepared.bytes,
      preparedSha256: prepared.preparedSha256,
      report: prepared.report,
    };
  };

/**
 * The run-level observations that name which profiles produced the artifacts.
 *
 * Emitted as warnings because the report's warning channel is its only
 * free-form field — they are observations, not problems, and a reader must be
 * able to see which graph and which processor produced the bytes.
 *
 * Both are gated on work that actually happened. Selecting a profile with
 * `--workflow-profile`/`--preparation-profile` and then failing before any
 * dispatch (or before any preparation) must not report that profile as
 * applied — the report is the audit trail, and an audit trail that claims
 * work it did not do is worse than no audit trail.
 */
export const profileWarnings = (options: {
  workflowProfileId?: string;
  preparationProfileId?: string;
  runsDir: string;
  runId: string;
  /** Engine requests this run really dispatched. */
  engineRequests: number;
  /** Prepared artifacts this run really produced. */
  preparedArtifacts: number;
}): readonly GenerationPlanWarning[] => {
  const warnings: GenerationPlanWarning[] = [];
  if (options.workflowProfileId !== undefined && options.engineRequests > 0) {
    warnings.push({
      code: 'workflow_profile_selected',
      message: `Every image job this run dispatched (${options.engineRequests} engine request(s)) compiled the pinned workflow profile "${options.workflowProfileId}" and was validated against the installed ComfyUI node schema before submission.`,
    });
  }
  if (options.preparationProfileId !== undefined && options.preparedArtifacts > 0) {
    warnings.push({
      code: 'preparation_profile_applied',
      message: `This run produced ${options.preparedArtifacts} prepared artifact(s) with the deterministic preparation profile "${options.preparationProfileId}"; its findings are written under ${options.runsDir}/${options.runId}/.`,
    });
  }
  return warnings;
};

/** A report is machine-passed only when every job's report is. */
export const allReportsMachinePassed = (
  validations: readonly BatchMediaValidationRecord[],
): boolean => validations.every((entry) => entry.report.machinePassed);

/** The `media-validation.json` document for a run. */
export const buildMediaValidationFile = (options: {
  runId: string;
  preparationProfileId?: string;
  validations: readonly BatchMediaValidationRecord[];
}): MediaValidationFile => ({
  schemaVersion: 1,
  runId: options.runId,
  preparationProfileId: options.preparationProfileId,
  machinePassed: allReportsMachinePassed(options.validations),
  validations: options.validations,
});

/**
 * Writes the run's preparation evidence beside its job records.
 *
 * @returns the path written.
 */
export const writeMediaValidationFile = (options: {
  runDir: string;
  runId: string;
  preparationProfileId?: string;
  validations: readonly BatchMediaValidationRecord[];
}): string => {
  const path = join(options.runDir, 'media-validation.json');
  writeFileSync(
    path,
    `${JSON.stringify(
      buildMediaValidationFile({
        runId: options.runId,
        ...(options.preparationProfileId === undefined
          ? {}
          : { preparationProfileId: options.preparationProfileId }),
        validations: options.validations,
      }),
      null,
      2,
    )}\n`,
  );
  return path;
};

/** The single finding an undecodable candidate produces, for CLI messaging. */
export const describeRejection = (report: MediaValidationReport): string =>
  report.findings
    .filter((finding) => finding.severity === 'error')
    .map((finding) => finding.code)
    .join(', ');
