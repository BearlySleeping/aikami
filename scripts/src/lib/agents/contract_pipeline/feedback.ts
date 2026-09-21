// scripts/src/lib/agents/contract_pipeline/feedback.ts
// Feedback assembly for worker stages: converts the run's history (verifier
// verdicts, review-captain diagnoses, pre-push gate output) into the prompt
// feedback the next implement attempt starts with. Pure manifest → string
// logic; no IO, no side effects.
import type { PrePushGateResult } from './pre_push_gate.ts';
import type { RunManifest } from './types.ts';

export const verifierFeedback = (options: {
  manifest: RunManifest;
  attempt: number;
  revision: string;
}): string | undefined => {
  if (options.attempt <= 1) {
    return undefined;
  }
  const prevImpl = [...options.manifest.attempts]
    .reverse()
    .find((c) => c.role === 'implementer' && c.result);
  const prevVerify = [...options.manifest.attempts]
    .reverse()
    .find((c) => c.role === 'verifier' && c.result);
  // 🔴 If this implement attempt was triggered by a review captain bouncing
  // the run back with `change` — from fallback recovery OR from a live
  // human-in-the-loop review session — its diagnosis (often the product of
  // consulting AskClaude/Opus for a second opinion) is the most current,
  // most specific signal available — more specific than the stale verifier
  // findings that already exhausted the loop once. Without this,
  // `contract_review_decision`'s `summary`/`details` were written to the
  // manifest and then never read again — the captain's diagnosis was
  // discarded and the implementer re-ran blind on the same old findings.
  const reviewChange = options.manifest.reviewDecision?.decision === 'change';
  const reviewFeedback = reviewChange ? options.manifest.reviewDecision?.summary : undefined;
  const reviewDetails = reviewChange ? options.manifest.reviewDecision?.details : undefined;
  // 🔴 Red pre-push gate diagnostics are implementer work, not reviewer
  // work. They reach this function from two directions: a gate bounce
  // (verify passed, gate red → straight back to implement — see the
  // verify-stage block) or a review `change` decision on a gate-red branch.
  // Either way the implementer needs the raw diagnostics, because the gate
  // already ran `:fix` and what survives is real code work.
  //
  // 🔴 Only a `failed` outcome is implementer work. `unavailable` and
  // `cancelled` also carry `ok: false`, but they mean "the gate could not
  // reach a verdict" — telling the implementer to "fix every diagnostic
  // below" against an infra error sends it chasing a failure that is not in
  // the code. This is the same distinction `isImplementerGateFailure` draws
  // when ROUTING a bounce; the prompt must not contradict the router.
  const gate = prePushGateForRevision({ manifest: options.manifest, revision: options.revision });
  const gateOutput = gate?.outcome === 'failed' ? gate.output : undefined;
  if (!prevVerify?.result && !reviewFeedback && !gateOutput) {
    return undefined;
  }
  const parts: string[] = [];
  if (gateOutput) {
    parts.push(
      '## 🔴 Pre-push validation (:fix + :validate) is RED on the branch',
      "The verifier passed the acceptance criteria, but the pipeline's pre-push gate failed.",
      'Fix every diagnostic below, then call `contract_stage_complete` with `passed`.',
      '',
      '```',
      gateOutput,
      '```',
      '',
    );
  }
  if (reviewFeedback) {
    parts.push('## Review Captain diagnosis', reviewFeedback, '');
    if (reviewDetails) {
      parts.push('### Additional context from the review captain', reviewDetails, '');
    }
  }
  if (prevVerify?.result) {
    parts.push(prevVerify.result.summary);
    parts.push(...prevVerify.result.findings.map((item) => `- ${item}`));
  }
  if (prevImpl?.result) {
    parts.push(
      '',
      'Previous implementer summary:',
      prevImpl.result.summary,
      'Continue from where the previous attempt left off. Do NOT redo already-completed work.',
    );
  }
  return parts.join('\n');
};

/** Return gate diagnostics only when they describe the requested revision. */
export const prePushGateForRevision = (options: {
  manifest: RunManifest;
  revision: string;
}): PrePushGateResult | undefined => {
  const validation = options.manifest.prePushValidation;
  if (!validation || options.revision === 'unknown' || validation.revision !== options.revision) {
    return undefined;
  }
  const outcome = validation.outcome ?? (validation.ok ? 'passed' : 'failed');
  return {
    outcome,
    ran: outcome === 'passed' || outcome === 'failed',
    ok: outcome === 'passed',
    output: validation.output,
  };
};
