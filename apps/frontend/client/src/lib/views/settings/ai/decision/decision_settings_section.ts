// apps/frontend/client/src/lib/views/settings/ai/decision/decision_settings_section.ts
//
// Pure projections for the Decisions / System One settings section.
//
// No state, no services. The ViewModel reads configuration and delegates here,
// and every string a player reads about a decision backend is decided in this
// file so the three states cannot be collapsed by a template edit.
//
// The one rule the whole section is built around: `disabled`, `ready` and
// `qualified` are DIFFERENT promises and must look different.
//   disabled  — not in use.
//   ready     — a real sample decision came back and validated. Good for testing
//               and shadow evaluation. NOT for automatic gameplay.
//   qualified — additionally cleared the frozen task gate on held-out data.
// Nothing in this release reaches `qualified`; the section says so rather than
// implying otherwise.

import {
  DECISION_BACKEND_STATES,
  type DecisionBackendState,
  type DecisionProviderDescriptor,
} from '@aikami/constants';
import type { DecisionReadinessState } from '@aikami/frontend/ai-gateway/decision';

/** How a state is rendered. Distinct colour and wording per state, by construction. */
export type DecisionStateDescriptor = {
  readonly state: DecisionBackendState;
  readonly label: string;
  readonly colorClass: string;
  readonly textColorClass: string;
  readonly dot: string;
  /** One sentence explaining what this state does and does not permit. */
  readonly meaning: string;
};

/** Rendering for each of the three states. */
export const DECISION_STATE_DESCRIPTORS: Readonly<
  Record<DecisionBackendState, DecisionStateDescriptor>
> = {
  disabled: {
    state: 'disabled',
    label: 'Disabled',
    colorClass: 'badge-ghost',
    textColorClass: 'text-base-content/60',
    dot: '○',
    meaning: 'Not in use. Nothing is probed and nothing is routed to it.',
  },
  ready: {
    state: 'ready',
    label: 'Ready to test',
    colorClass: 'badge-info',
    textColorClass: 'text-info',
    dot: '◐',
    meaning:
      'A real sample decision came back and passed validation. Good for testing — not qualified for automatic gameplay.',
  },
  qualified: {
    state: 'qualified',
    label: 'Qualified for automatic tasks',
    colorClass: 'badge-success',
    textColorClass: 'text-success',
    dot: '●',
    meaning: 'Cleared the frozen task gate on held-out data as well as the sample check.',
  },
};

/** The descriptor for a state. */
export const describeDecisionState = (state: DecisionBackendState): DecisionStateDescriptor =>
  DECISION_STATE_DESCRIPTORS[state];

/**
 * Player-facing readiness copy, keyed by the readiness state.
 *
 * Every entry names the next ACTION. A readiness message that only reports a
 * problem leaves the player guessing what to do about it, and "unsupported
 * runtime" with no upgrade hint is the message that produced the original
 * "System One cannot be configured" report.
 */
export const DECISION_READINESS_COPY: Readonly<Record<DecisionReadinessState, string>> = {
  ready: 'The endpoint answered a sample decision and the answer passed validation.',
  'unsupported-runtime':
    'This runtime is older than the jev-v1 dialect requires. Upgrade it yourself — Aikami never installs or upgrades a runtime for you.',
  'model-missing':
    'The runtime is new enough but does not have that checkpoint. Pull the checkpoint, then test again.',
  'capability-missing':
    'That checkpoint is installed but does not advertise decision scoring. Pick a decision checkpoint.',
  'incompatible-dialect':
    'That endpoint speaks a different dialect than the decision adapter requires.',
  oversize: 'The sample question did not fit inside the backend’s declared limits.',
  'sample-rejected':
    'The backend answered, but the answer was not a legal value. Nothing was applied.',
  unreachable: 'The endpoint did not answer. Check the URL and that the server is running.',
  unauthorized: 'The endpoint refused the stored credential. Re-enter the API key.',
  'deadline-exceeded':
    'The endpoint did not answer in time. A cold first call can exceed this; try again.',
  cancelled: 'The test was cancelled before it finished.',
  misconfigured:
    'The runtime and endpoint disagree with each other. Fix the runtime or the endpoint.',
};

/** The readiness sentence for a state, with a fallback for an unknown one. */
export const decisionReadinessCopy = (state: DecisionReadinessState): string =>
  DECISION_READINESS_COPY[state] ?? 'The backend did not report a readiness result.';

/** A provider row in the picker. */
export type DecisionProviderOption = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** Mirrors the registry's runtime kind, including native `llamacpp`. */
  readonly runtime: 'ollama' | 'jev' | 'llamacpp';
  readonly needsKey: boolean;
  readonly optionalKey: boolean;
  readonly defaultUrl?: string;
  readonly isLocal: boolean;
  readonly docsUrl: string;
};

/** Projects the decision registry into picker rows. */
export const decisionProviderOptions = (
  providers: readonly DecisionProviderDescriptor[],
): readonly DecisionProviderOption[] =>
  providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    description: provider.description,
    runtime: provider.runtime,
    needsKey: provider.needsKey,
    optionalKey: provider.optionalKey === true,
    ...(provider.defaultUrl === undefined ? {} : { defaultUrl: provider.defaultUrl }),
    isLocal: provider.isLocal,
    docsUrl: provider.docsUrl,
  }));

/** The credential field label for a provider. */
export const decisionCredentialLabel = (
  provider: DecisionProviderDescriptor | undefined,
): string => {
  if (provider?.optionalKey === true) {
    return 'API key (optional for this endpoint)';
  }
  return 'API key';
};

/** The states a player can be shown, in a stable order. */
export const decisionStates = (): readonly DecisionBackendState[] => DECISION_BACKEND_STATES;
