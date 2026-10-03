// apps/frontend/client/src/lib/services/ai/decision/decision_backend_logic.ts
//
// Pure decision-backend logic (issue #381).
//
// Everything here is a function of its arguments: the state projection, the
// automatic-gameplay gate, the task list, and the adapter a resolved backend
// implies. Keeping them out of the service is what makes the gate a DECISION the
// code makes — it can be read, tested and argued about without instantiating
// anything.

import type { DecisionBackendState } from '@aikami/constants';
import {
  createLlamaCppDecisionAdapter,
  createSystemOneDecisionAdapter,
  type DecisionAdapter,
  type DecisionReadinessVerdict,
  NATIVE_LLAMACPP_DIALECT,
  probeDecisionBackend,
  SYSTEM_ONE_DIALECT,
} from '@aikami/frontend/ai-gateway/decision';
import type { DecisionGameplayMode } from '@aikami/types';
import type { ResolvedDecisionBackend } from '../../config/decision_backend_resolution';
import type {
  DecisionBackendCapabilities,
  DecisionGameplayModeOption,
  DecisionGameplayRouting,
  DecisionTaskSummary,
} from './types';

/** How long a player waits for "Test connection" before it reports a timeout. */
export const DECISION_TEST_TIMEOUT_MS = 15_000;

/** Default probe: the real one. */
export const defaultDecisionProbe: DecisionBackendCapabilities['probe'] = ({
  adapter,
  signal,
  deadlineAt,
}) =>
  probeDecisionBackend({
    adapter,
    signal,
    deadlineAt,
    requestId: 'decision-settings-test',
    stateRevision: 0,
  });

/**
 * Builds the adapter a resolved backend implies.
 *
 * A runtime kind decides its own routes. A `jev` runtime is never handed an
 * Ollama `/api/version` URL it may not serve — that refusal is what made
 * external decision servers unusable. Native `llamacpp` is a different adapter
 * entirely, not this one with a different URL: it sends no `model` field,
 * reads `answers[q].noul` as a probability, treats 501 as the
 * not-a-decision-model signal, and enforces the loaded checkpoint's own option
 * ceiling.
 */
export const adapterForBackend = (backend: ResolvedDecisionBackend): DecisionAdapter => {
  const root = backend.endpoint.replace(/\/+$/, '');
  const authHeaders =
    backend.credential === undefined
      ? undefined
      : async () => ({
          // biome-ignore lint/style/useNamingConvention: verbatim HTTP header name
          Authorization: `Bearer ${backend.credential}`,
        });

  if (backend.runtime === 'llamacpp') {
    return createLlamaCppDecisionAdapter({
      endpoints: {
        decision: `${root}/v1/systemone`,
        health: `${root}/health`,
        props: `${root}/props`,
      },
      checkpoint: backend.checkpoint,
      languages: [...backend.languages],
      // Resolved per request so a rotated credential takes effect without a
      // restart, and so the secret never sits in a closure that could be
      // serialised into a report.
      ...(authHeaders === undefined ? {} : { authHeaders }),
    });
  }

  return createSystemOneDecisionAdapter({
    runtime: backend.runtime,
    endpoints: {
      decision: `${root}/v1/systemone`,
      ...(backend.runtime === 'ollama' ? { version: `${root}/api/version` } : {}),
      models: `${root}/v1/models`,
    },
    model: backend.checkpoint,
    languages: [...backend.languages],
    ...(authHeaders === undefined ? {} : { authHeaders }),
  });
};

/**
 * The wire dialect a configured backend actually speaks.
 *
 * Derived from the runtime kind, because the runtime kind IS the dialect choice
 * here: `llamacpp` builds the native adapter, everything else builds the
 * `jev-v1` one. Reading this from one place is what stops a qualification gate
 * from checking a native connection against `jev-v1` — the exact mistake a
 * hardcoded string made.
 */
export const dialectForBackend = (backend: ResolvedDecisionBackend): string =>
  backend.runtime === 'llamacpp' ? NATIVE_LLAMACPP_DIALECT : SYSTEM_ONE_DIALECT;

/** Inputs to the state projection. */
export type DeriveDecisionBackendStateOptions = {
  readonly configured: boolean;
  readonly enabled: boolean;
  /** The last explicit test result, or undefined when none has been run. */
  readonly verdict?: DecisionReadinessVerdict;
  /** Whether a measurement has cleared the workload gate for this checkpoint. */
  readonly workloadQualified: boolean;
};

/**
 * Projects configuration plus the last test into one of three states.
 *
 * A backend is `qualified` ONLY when it is enabled, the last test reached
 * `ready`, and a measurement has cleared the workload gate. Any missing leg
 * yields `ready` or `disabled` — there is no path from "configured" to
 * "qualified" that skips an actual answer.
 */
export const deriveDecisionBackendState = (
  options: DeriveDecisionBackendStateOptions,
): DecisionBackendState => {
  if (!options.configured || !options.enabled) {
    return 'disabled';
  }
  if (options.verdict?.state !== 'ready') {
    return 'disabled';
  }
  return options.workloadQualified ? 'qualified' : 'ready';
};

/**
 * The automatic-gameplay gate.
 *
 * It exists as a function so the refusal is a DECISION the code makes rather
 * than an absence of code.
 *
 * The three legs are unchanged and all three still have to hold: a backend is
 * configured, it is `qualified` (not merely `ready`), and a measurement has
 * cleared the frozen gate. What changed in C-568 is only WHY the last leg is
 * currently unsatisfiable — it is no longer "the workload pilot has not
 * landed", it is a named task at a named version that a shipped measurement has
 * to clear. `decision_action_qualification` is where that verdict is read from.
 */
export const decisionGameplayRouting = (options: {
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly state: DecisionBackendState;
  readonly workloadQualified: boolean;
}): DecisionGameplayRouting => {
  if (!options.configured || !options.enabled) {
    return { allowed: false, reason: 'no decision backend is enabled' };
  }
  if (options.state !== 'qualified') {
    return {
      allowed: false,
      reason: `the backend is ${options.state}, not qualified; a sample decision is not a task qualification`,
    };
  }
  if (!options.workloadQualified) {
    return {
      allowed: false,
      reason:
        'the frozen gate has not been cleared on held-out data for npc-action-selection at its current task version',
    };
  }
  return {
    allowed: true,
    reason:
      'npc-action-selection is qualified on held-out data for this checkpoint; the consumer still enforces per-turn qualification, staleness and one fallback',
  };
};

/**
 * The persisted Off/Shadow/On projection, one row per mode.
 *
 * Kept as a pure function beside {@link decisionGameplayRouting} so the UI
 * renders a DECISION the code made rather than re-deriving "is `on` allowed?"
 * in a template — which is how a mode selector ends up offering a setting the
 * router would silently refuse.
 *
 * The asymmetry between `shadow` and `on` is deliberate and is the whole point
 * of shadow existing: `shadow` evaluates a decision and DISCARDS it, so it
 * cannot cause a wrong mutation and is therefore not gated on qualification.
 * `on` can change the game and must be.
 */
export const decisionGameplayModeOptions = (options: {
  readonly routing: DecisionGameplayRouting;
  readonly persisted: DecisionGameplayMode;
}): readonly DecisionGameplayModeOption[] =>
  DECISION_GAMEPLAY_MODES.map((mode) => {
    // `off` and `shadow` are always selectable: neither can change the game, so
    // neither needs a measurement. Only `on` is gated.
    const allowed = mode !== 'on' || options.routing.allowed;
    const detail =
      mode === 'on' && !allowed
        ? `Refused: ${options.routing.reason}`
        : DECISION_GAMEPLAY_MODE_DETAILS[mode];
    return { mode, selected: options.persisted === mode, allowed, detail };
  });

/** The three modes, in the order the selector renders them. */
const DECISION_GAMEPLAY_MODES: readonly DecisionGameplayMode[] = ['off', 'shadow', 'on'];

/**
 * What each mode does, as data.
 *
 * A lookup rather than a branch ladder: these are four sentences, not four
 * behaviours, and a table keeps the copy readable and the logic flat.
 */
const DECISION_GAMEPLAY_MODE_DETAILS: Readonly<Record<DecisionGameplayMode, string>> = {
  off: 'No decision call is made. Every turn is answered by the existing extraction path.',
  shadow:
    "A decision is evaluated and discarded, under the turn's own deadline and resource " +
    'budget. The turn still answers from the existing path, so this cannot change the game.',
  on: 'The decision may answer the turn.',
};

/**
 * The tasks a decision backend could serve today.
 *
 * Two entries, and the distinction between them is the point of this lane.
 * The probe measures a bare discriminator and says so; the production task
 * measures a choice among already-authorized, id-bearing candidates.
 */
export const decisionTaskSummaries = (
  workloadQualified: boolean,
): readonly DecisionTaskSummary[] => [
  {
    id: 'npc-action-selection',
    label: 'NPC action (gameplay)',
    description:
      'Chooses which already-permitted action this NPC takes now — or none — from candidates carrying real content-pack ids. Used by the dialogue turn when enabled.',
    qualified: workloadQualified,
  },
  {
    id: 'npc-command-kind',
    label: 'NPC command kind (research probe)',
    description:
      'Chooses which bounded dialogue command, if any, a player message warrants. Measures the discriminator only — not the payloads, IDs or world preconditions production commands carry.',
    qualified: false,
  },
];
/**
 * Whether a completed test may be shown.
 *
 * A result belongs to the configuration it ran against. Two things can move
 * under a test in flight: the player can save again (a new generation), or the
 * resolved backend can become a different connection. A stale result displayed
 * as if it described the current configuration is worse than no result, because
 * it is a green badge on the wrong settings.
 */
export const isTestResultCurrent = (options: {
  readonly generation: number;
  readonly currentGeneration: number;
  readonly testedConnectionId: string;
  readonly resolvedConnectionId: string | undefined;
}): boolean =>
  options.generation === options.currentGeneration &&
  options.testedConnectionId === options.resolvedConnectionId;
