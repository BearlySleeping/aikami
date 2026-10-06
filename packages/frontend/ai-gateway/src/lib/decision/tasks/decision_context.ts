// packages/frontend/ai-gateway/src/lib/decision/tasks/decision_context.ts
//
// The input projection a decision backend receives for one turn
// (issue #381, lane C).
//
// ---------------------------------------------------------------------------
// Why this is one shared function
// ---------------------------------------------------------------------------
//
// The first version of the lane C benchmark sent a DIFFERENT input shape than
// production. The corpus generator wrote
//
//     [NPC]
//     Elder Thalia. Stay in character.
//
//     [PLAYER] … [ELDER] …
//
// while the dialogue turn sent
//
//     [NPC]
//     Elder Thalia
//     Voice: …
//     Manner: …
//
//     [EXCHANGE]
//     …
//
// A benchmark that measures a different input from the one production sends is
// not a measurement of that workload, and the drift is invisible — both shapes
// read as "context" in a diff.
//
// This lives in the decision package rather than in the client so that BOTH the
// gameplay consumer and the corpus generator can import it. Putting it in the
// client would have forced `scripts/` to import an app, which the repository's
// import boundary does not permit, and duplicating it would defeat the point.
//
// When this changes, the recorded measurements describe a previous input shape
// and must be re-run.

/** One turn's decision input. */
export type NpcActionDecisionContextInput = {
  /** Display name of the NPC being addressed. */
  readonly npcName: string;
  /** The same persona block the narrative call receives. */
  readonly persona: string;
  /** The already-spoken exchange, verbatim. */
  readonly narrative: string;
};

/**
 * Projects a turn into the text a decision backend is asked to read.
 *
 * Section order is part of the contract: the backend's answer depends on what it
 * is shown, so reordering these changes the workload being measured.
 */
export const buildNpcActionDecisionContext = (input: NpcActionDecisionContextInput): string =>
  ['[NPC]', input.npcName, input.persona, '', '[EXCHANGE]', input.narrative].join('\n');
