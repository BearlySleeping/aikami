// packages/shared/constants/src/lib/decision_providers.ts
//
// The decision-backend registry (issue #381).
//
// A SEPARATE registry from `providers.ts`, on purpose. Text/image/voice
// providers carry chat concerns this feature has nothing to do with —
// verification strategies, CSP origins, generation parameters, reasoning
// controls — and threading `decision` through that descriptor would make every
// one of those fields answerable about a backend that has no opinion on them.
//
// The entries here are runtime facts, each learned from its own documentation at
// the time this was written and RE-PROBED at runtime before anything is claimed:
// readiness is never taken from this table.

/** A decision-backend descriptor. */
export type DecisionProviderDescriptor = {
  id: string;
  label: string;
  description: string;
  /**
   * Which runtime probe is legitimate for this backend.
   *
   * `llamacpp` is its own kind, NOT a flavour of `jev`. The two disagree on the
   * request body (native has no per-request `model`), on how a boolean comes
   * back (native answers `noul` as a numeric probability), on which status
   * means "this checkpoint cannot answer" (native 501) and on where checkpoint
   * identity comes from (native: the server process). Filing native llama.cpp
   * under `jev` would hide all four behind the wrong probe.
   */
  runtime: 'ollama' | 'jev' | 'llamacpp';
  /** Whether the endpoint URL is user-supplied. Always true today. */
  needsUrl: boolean;
  /** Whether a credential is required. */
  needsKey: boolean;
  /** Whether a credential is accepted but optional (self-hosted with auth). */
  optionalKey?: boolean;
  /** Runs on the player's own machine; no account, no egress. */
  isLocal: boolean;
  /** Default endpoint offered in the editor. */
  defaultUrl?: string;
  /** Whether the runtime is managed by the player rather than installed for them. */
  externallyManaged: boolean;
  /** Reference the player can follow. Never a vendor throughput claim. */
  docsUrl: string;
};

/**
 * Decision backends a player may configure.
 *
 * `ollama` is the reuse case: the player already runs Ollama for narration, so
 * the same daemon can serve `/v1/systemone` — but only from 0.35.0, and only
 * with a decision checkpoint pulled. Reusing the daemon does NOT mean reusing a
 * chat model: the checkpoint field is required and separate from the chat
 * connection's model, because `llama3` on the same daemon cannot answer a
 * bounded decision and will not be configured as if it could.
 */
export const DECISION_PROVIDERS: readonly DecisionProviderDescriptor[] = [
  {
    id: 'ollama',
    label: 'Ollama (local)',
    description:
      'Reuse a local Ollama daemon already serving narration. Needs Ollama 0.35.0 or later and a decision checkpoint.',
    runtime: 'ollama',
    needsUrl: true,
    needsKey: false,
    isLocal: true,
    defaultUrl: 'http://127.0.0.1:11434',
    externallyManaged: false,
    docsUrl: 'https://ollama.com/blog/ollama-now-supports-jev-style-decision-models',
  },
  {
    id: 'llamacpp',
    label: 'llama.cpp — decision models',
    description:
      'A llama.cpp server built with native /v1/systemone support (upstream #29818 or later). ' +
      'Requires a purpose-trained decision checkpoint such as Laya, OpenJev, Julia-1, Lev or Kev. ' +
      'A general chat GGUF cannot answer this endpoint.',
    runtime: 'llamacpp',
    needsUrl: true,
    needsKey: false,
    optionalKey: true,
    isLocal: true,
    defaultUrl: 'http://127.0.0.1:8080',
    // A llama-server the player started is theirs. Aikami never stops, reloads
    // or uninstalls a process it did not spawn.
    externallyManaged: true,
    docsUrl: 'https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md',
  },
  {
    id: 'jev-external',
    label: 'Jev-compatible server (local)',
    description:
      'Any server serving the jev-v1 shape, such as laya.cpp over HTTP. Bring your own runtime; Aikami installs nothing.',
    runtime: 'jev',
    needsUrl: true,
    needsKey: false,
    optionalKey: true,
    isLocal: true,
    externallyManaged: true,
    docsUrl: 'https://github.com/NandhaKishorM/laya',
  },
  {
    id: 'jev-hosted',
    label: 'Hosted Jev',
    description:
      'A hosted decision endpoint. Requires an API key; nothing leaves the machine except the question.',
    runtime: 'jev',
    needsUrl: true,
    needsKey: true,
    isLocal: false,
    externallyManaged: true,
    docsUrl: 'https://typesafe.ai/blog/introducing-system-one-models-and-jev',
  },
];

/** Decision provider ids that run on the player's own machine. */
export const LOCAL_DECISION_PROVIDER_IDS: ReadonlySet<string> = new Set(
  DECISION_PROVIDERS.filter((provider) => provider.isLocal).map((provider) => provider.id),
);

/** The registry entry for a decision provider id. */
export const decisionProviderEntry = (registryId: string): DecisionProviderDescriptor | undefined =>
  DECISION_PROVIDERS.find((provider) => provider.id === registryId);

/**
 * Display labels for the decision capability's own surface.
 *
 * Kept beside the registry rather than inline in the view so the strings a
 * player reads have one source and the settings section never embeds a vendor
 * name in markup.
 */
export const DECISION_SECTION_LABELS = {
  title: 'Decisions / System One',
  subtitle: 'Bounded decision scoring for closed gameplay questions.',
  runtime: 'Runtime',
  endpoint: 'Endpoint',
  checkpoint: 'Checkpoint',
  credential: 'API key',
  credentialOptional: 'API key (optional for this endpoint)',
  test: 'Test connection',
  disable: 'Disable',
  save: 'Save',
  remove: 'Remove',
} as const;

/**
 * The three states a decision backend can be in, kept as data so a view cannot
 * collapse them by accident.
 *
 * They are different promises and must stay visually different:
 *
 *   `disabled` — not in use. Nothing is probed and nothing is routed.
 *   `ready`    — endpoint reachable and a sample decision validated. Suitable
 *                for testing and for shadow evaluation. NOT for automatic
 *                gameplay.
 *   `qualified`— additionally cleared the frozen task-quality gate against the
 *                held-out split. Only this state may be selected for automatic
 *                gameplay routing.
 *
 * `ready` never implies `qualified`. Making them visually identical is exactly
 * how "the settings screen said it was connected" turns into a wrong command
 * fired at an NPC.
 */
export const DECISION_BACKEND_STATES = ['disabled', 'ready', 'qualified'] as const;

/** One decision-backend state. */
export type DecisionBackendState = (typeof DECISION_BACKEND_STATES)[number];
