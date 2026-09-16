// .pi/extensions/lib/publication_assessment.ts
//
// 🔴 Extracted from github_cli.ts to keep that module under its grandfathered
// source-file-size baseline. Behaviour is unchanged.
//
// The contract-pipeline precondition that guards `gh_pr create`: PR creation is
// the choke point every publication path must pass through, so the invariant is
// enforced here rather than in a prompt.

import { existsSync } from 'node:fs';
import { runPiScript } from './bridge.ts';

/** Verdict shape returned by the `contract.publication.evaluate` bridge command. */
export type PublicationSummary = {
  outcome: 'passed' | 'failed' | 'unavailable' | 'cancelled';
  ok: boolean;
  authorized: boolean;
  refusal: string;
  warning?: string;
};

/**
 * Assess whether a contract-pipeline PR may be opened from this branch.
 *
 * 🔴 The C-484 lesson (PR #266, 2026-09-07). The pre-push gate ran once, in
 * the orchestrator, and correctly went red. The review captain then fixed the
 * flagged violation by hand, re-ran only the single guard it had been told
 * about, committed with `--no-verify`, pushed, and opened the PR — carrying
 * an un-indented edit that `client:format` rejected on CI. Every step after
 * the orchestrator's one-shot gate was unvalidated, and the prompt was the
 * only thing standing between a hand edit and a public PR.
 *
 * A prompt is guidance. This is a precondition: PR creation is the choke
 * point every path must pass through, so the invariant is enforced here.
 * See publication_gate.ts for the individual blocks and their remedies.
 *
 * 🔴 FAILS CLOSED. When the gate cannot read the workspace, or the bridge
 * itself throws, or the pipeline context is incomplete, this returns a
 * refusal — not an empty (permissive) result. The previous behaviour treated
 * every one of those as "allow", which let an unreadable workspace authorize
 * a PR. Recovery and review remain available; only publication is refused.
 *
 * A red verdict is a refusal UNLESS the gate found a revision-bound
 * authorization covering it (YOLO records one automatically; interactive
 * runs require explicit user permission, persisted on the manifest).
 */
export const pipelinePublicationAssessment = async (
  headBranch: string,
): Promise<{ refusal?: string; warning?: string }> => {
  const role = process.env.CONTRACT_PIPELINE_ROLE;
  const workspacePath = process.env.CONTRACT_PIPELINE_WORKSPACE_PATH;
  const runId = process.env.CONTRACT_PIPELINE_RUN_ID;
  if (!role) {
    // Not a pipeline worker at all — the gate does not apply. A missing role is
    // how a normal developer session is distinguished from a pipeline run.
    return {};
  }
  if (!workspacePath || !runId) {
    return {
      refusal:
        '❌ **PR creation blocked — incomplete pipeline context.**\n\n' +
        'This session is running as a contract-pipeline worker ' +
        `(role \`${role}\`) but the publication gate cannot run: ` +
        `${!workspacePath ? 'CONTRACT_PIPELINE_WORKSPACE_PATH is unset' : 'CONTRACT_PIPELINE_RUN_ID is unset'}. ` +
        'The gate cannot verify that the exact commit on the remote is green, so it ' +
        'refuses to open the PR. Resume the run through the orchestrator, or open the ' +
        'PR manually after verifying the branch by hand.',
    };
  }
  if (!existsSync(workspacePath)) {
    return {
      refusal:
        '❌ **PR creation blocked — the pipeline workspace is missing.**\n\n' +
        `The recorded workspace \`${workspacePath}\` does not exist, so the gate cannot ` +
        'verify the branch. Recover the worktree, then retry.',
    };
  }

  let result: PublicationSummary;
  try {
    result = await runPiScript<PublicationSummary>('contract.publication.evaluate', {
      workspacePath,
      runId,
      branch: headBranch,
    });
  } catch (error) {
    // 🔴 Fail closed. A bridge failure means the gate could not run — not
    // that the branch is publishable.
    const message = error instanceof Error ? error.message : String(error);
    return {
      refusal:
        '❌ **PR creation blocked — the publication gate could not run.**\n\n' +
        `Evaluating the gate threw: ${message}\n\n` +
        'The gate cannot verify that the exact commit on the remote is green. Resolve ' +
        'the failure (git access, manifest readability) and try again.',
    };
  }

  // Newer bridge returns a typed outcome; tolerate the legacy shape defensively
  // by treating anything that is not an explicit `ok: true` as a refusal.
  if (result.ok && result.outcome === 'passed') {
    return { warning: result.warning };
  }
  if (result.ok && result.authorized) {
    return { warning: result.warning };
  }
  if (result.refusal) {
    return { refusal: result.refusal };
  }
  return {
    refusal:
      '❌ **PR creation blocked — the publication gate returned no verdict.**\n\n' +
      `Outcome: ${result.outcome ?? 'unknown'}. The gate did not positively confirm ` +
      'the branch is publishable, so PR creation is refused.',
  };
};
