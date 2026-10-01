// packages/frontend/ai-gateway/src/lib/decision/probe_case.ts
//
// The canonical readiness probe (issue #381, contract C-567).
//
// What this probe proves, and what it deliberately does NOT prove:
//
//   PROVES    — the checkpoint is loaded, speaks the dialect, emits a
//               distribution, and its answer survives the ORIGINAL schema.
//               In other words: the backend can answer *at all*.
//   NOT PROVES — that the answer is CORRECT.
//
// That distinction is the whole point of keeping the probe separate from the
// quality harness. A wrong-but-legal answer is proof of liveness; only
// `live_measurement.ts` scoring the held-out split says anything about quality.
// Conflating the two is how a benchmark ends up claiming accuracy from a
// health check.
//
// The content is deliberately synthetic and content-free: no player text, no
// campaign state, no real transcript, nothing that could carry personal data
// into a third-party endpoint. It is authored here and goes nowhere else.

import Type from 'typebox';
import type { DecisionTaskPolicy } from './types.ts';

/** Task id under which probe runs are recorded in telemetry and logs. */
export const PROBE_TASK_ID = 'decision-readiness-probe';

/** Probe schema: one closed, two-option discriminator. */
export const PROBE_SCHEMA = Type.Object(
  {
    verdict: Type.Union([Type.Literal('proceed'), Type.Literal('halt')]),
  },
  { additionalProperties: false },
);

/**
 * Probe state text.
 *
 * Authored so that a correct answer is unambiguous to a human reviewer, while
 * carrying no game, player or campaign content. It is not keyword-matching bait:
 * the probe does not score correctness.
 */
export const PROBE_CONTEXT = [
  'Readiness check.',
  'A scheduled maintenance task has not finished.',
  'Question: should the task proceed to its next stage?',
].join(' ');

/** Probe task policy. Enabled: the probe exists precisely to ask. */
export const PROBE_POLICY: DecisionTaskPolicy = {
  task: PROBE_TASK_ID,
  enabled: true,
  language: 'en',
  instructions:
    'Read a short system status note and decide whether the described task should continue to its next stage.',
  fieldInstructions: {
    verdict: 'Should the described task proceed to its next stage?',
  },
  optionDescriptions: {
    verdict: {
      proceed: 'The task may continue to its next stage.',
      halt: 'The task must stop at its current stage.',
    },
  },
};
