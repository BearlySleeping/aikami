// scripts/src/lib/agents/contract_pipeline/gate_outcome.ts
//
// 🔴 One outcome model for validation, review, and publication (C-474-family
// brief, P1). Before this module the pipeline spoke three dialects:
//
//   • `validation_policy.ts` had a rich `CheckOutcome`
//     (`passed` | `failed` | `unavailable` | `cancelled` | `not_applicable`).
//   • `pre_push_gate.ts` collapsed everything to `{ ran: boolean; ok: boolean }`
//     and returned `{ ran: false, ok: true }` on a spawn/setup failure — so
//     "the gate could not run" silently became "the code is green".
//   • `publication_gate.ts` returned `ok: true, indeterminate: true` whenever
//     git or the remote could not be read — so an unreadable workspace
//     silently authorized `gh_pr create`.
//
// The invariant this module encodes: **unknown, cancelled, and unavailable are
// never the same thing as passed.** A consumer that wants to treat an unknown
// as permissive must do so explicitly (see `PublicationGateResult`), and the
// returned outcome records that choice rather than hiding it inside an `ok`.

/**
 * The verdict of a gate, in one vocabulary shared by validation, review, and
 * publication.
 *
 * - `passed` — the gate ran to completion and every required check passed.
 * - `failed` — the gate ran to completion and at least one required check
 *   failed on the code under test.
 * - `unavailable` — the gate could not run (missing tool, unreadable
 *   workspace, unresolvable base ref). Not evidence about the code.
 * - `cancelled` — the gate was interrupted before reaching a verdict.
 */
export type GateOutcome = 'passed' | 'failed' | 'unavailable' | 'cancelled';

/**
 * Whether an outcome is a *definitive positive* result — the only outcome that
 * may authorize promotion without an explicit override or diagnostic caveat.
 */
export const isPassingOutcome = (outcome: GateOutcome): boolean => outcome === 'passed';

/**
 * Whether an outcome proves the code is bad (`failed`) as opposed to merely
 * inconclusive (`unavailable` / `cancelled`). Callers use this to choose the
 * right remedy text: fix the code, or fix the infrastructure.
 */
export const isFailingOutcome = (outcome: GateOutcome): boolean => outcome === 'failed';

/**
 * Whether an outcome is inconclusive — the gate did not reach a verdict about
 * the code. These must never be silently reported as green.
 */
export const isInconclusiveOutcome = (outcome: GateOutcome): boolean =>
  outcome === 'unavailable' || outcome === 'cancelled';

/**
 * How a non-`passed` outcome is allowed to influence promotion.
 *
 * - `block` — the gate outcome prevents promotion outright (default).
 * - `permit_with_authorization` — promotion may proceed only when a
 *   revision-bound authorization record exists for this exact outcome (see
 *   `PublicationAuthorization`).
 */
export type OutcomePolicy = 'block' | 'permit_with_authorization';

/**
 * A revision-bound record of explicit authorization to publish over a
 * non-green gate outcome.
 *
 * 🔴 Why this exists. The gate previously let a RED verdict become a *warning*:
 * publishing proceeded "with the user's permission (or automatically under
 * YOLO)". The permission lived only in prose in a prompt and was never an
 * input to the gate, so a red verdict and a green one produced the same
 * `ok: true` and the same PR. This type makes permission a first-class,
 * verifiable input: the outcome it covers, the revision it was granted
 * against, who granted it, and when.
 *
 * `revision` binds the authorization to the exact commit the red verdict
 * covered. If the branch moves (a new commit), the authorization is void and
 * must be re-granted — otherwise a fresh failure could ride an old approval.
 */
export type PublicationAuthorization = {
  /** The non-green outcome this authorization covers. Never `passed`. */
  outcome: Exclude<GateOutcome, 'passed'>;
  /** Local HEAD the authorization was granted against. */
  revision: string;
  /** Who authorized publishing over the red/unavailable outcome. */
  grantedBy: string;
  /** ISO timestamp the authorization was recorded. */
  grantedAt: string;
};

/**
 * Whether an authorization record validly covers the given outcome at the
 * given revision. Both fields must match exactly — an authorization for a
 * different outcome, or for a different commit, does not apply.
 */
export const authorizationCovers = (options: {
  authorization: PublicationAuthorization | undefined;
  outcome: GateOutcome;
  revision: string;
}): boolean => {
  const { authorization } = options;
  if (!authorization) {
    return false;
  }
  if (options.outcome === 'passed') {
    return false;
  }
  return authorization.outcome === options.outcome && authorization.revision === options.revision;
};
