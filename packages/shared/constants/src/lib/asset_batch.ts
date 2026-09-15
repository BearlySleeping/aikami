// packages/shared/constants/src/lib/asset_batch.ts
//
// C-519: the declared vocabulary of the durable asset-batch runner — the
// provider-profile registry, the job-kind → recipe map, the budget defaults
// and the documented CLI exit codes.
//
// It lives in the shared constants package (not in `@aikami/local-ai` or the
// runner host) because the portable core, the host store and the CLI all read
// the same declarations, and a second copy would drift.
//
// 🔴 No provider is invented here. A profile is either reachable on this host
// with a shipped engine, or it is declared `unavailable` so the plan returns a
// structured blocker instead of silently choosing a different provider.
//
// Contract: C-519 Durable asset jobs and batch execution
/** biome-ignore-all lint/style/useNamingConvention: registry keys are the brief's own snake_case vocabulary (job kinds, provider profile ids), not TypeScript identifiers */

/** The two declared brief phases. */
export type AssetBatchPhase = 'slice' | 'expansion';

/** Every declared brief phase, in plan order. */
export const ASSET_BATCH_PHASES: readonly AssetBatchPhase[] = ['slice', 'expansion'];

/** The job kinds the authored brief may carry. */
export type AssetBatchJobKind =
  | 'prop'
  | 'prop_state'
  | 'portrait'
  | 'expression'
  | 'music'
  | 'ambient'
  | 'sfx';

/**
 * Job kind → recipe id.
 *
 * A `prop_state` job edits an accepted base and still produces a prepared
 * image prop; a `tileset` recipe exists but no brief job kind resolves to it.
 */
export const ASSET_BATCH_JOB_RECIPES: Readonly<Record<AssetBatchJobKind, string>> = {
  prop: 'prop',
  prop_state: 'prop',
  portrait: 'portrait',
  expression: 'expression',
  music: 'music',
  ambient: 'ambient',
  sfx: 'sfx',
};

/** How a resolved provider profile reaches its bytes. */
export type GenerationProviderMode = 'local' | 'hosted' | 'import' | 'unavailable';

/** One declared provider profile. */
export type GenerationProviderProfile = {
  /** The profile id used by `providerPreferences` in the brief. */
  id: string;
  label: string;
  mode: GenerationProviderMode;
  /** `image` or `audio` — a profile only serves jobs of its own modality. */
  modality: 'image' | 'audio';
  /**
   * The local engine that serves this profile. Absent for hosted, import and
   * unavailable profiles — a profile that cannot dispatch must not name a
   * transport the runner would then dial.
   */
  engineId?: 'sdcpp' | 'comfyui' | 'ace-step';
  /**
   * Declared spend estimate for one candidate, in USD. The plan compares it
   * against `execution.hostedBudgetUsd`; `0` means "local, no spend".
   */
  estimatedSpendUsdPerCandidate: number;
  /**
   * True when the profile's intended-use/rights decision is still open. This
   * is a *release* gate (the brief lists it under `releaseGates`), so it is
   * reported as a warning — it never blocks a local run.
   */
  requiresRightsDecision: boolean;
  /**
   * C-521: the wire protocol the profile's engine speaks, for audio profiles.
   * `ace-step-v1` is the synchronous `/generate` server; `ace-step-v1.5` is the
   * `release_task`/`query_result` flow. Absent for image profiles.
   */
  protocol?: 'ace-step-v1' | 'ace-step-v1.5';
  /** C-521: the pinned manifest model id this profile dispatches to. */
  modelId?: string;
  /**
   * C-521: which brief job kinds this profile may serve. A profile that does
   * not list a kind must never be chosen for it — that is what stops an SFX
   * brief silently falling back to the music model.
   */
  jobKinds?: readonly AssetBatchJobKind[];
  /**
   * C-521: whether the model's licence/intended-use decision is *resolved*
   * (not merely required). A profile whose licence is unresolved cannot serve
   * a generation kind on its own.
   */
  licenseResolved?: boolean;
  note: string;
};

/**
 * The declared provider profiles.
 *
 * `stable_audio_open_1_0_profile` is declared but not shipped: no stable-audio
 * engine exists in this repository, and claiming one would fabricate a
 * capability. Jobs whose group resolves only to it fall back to the group's
 * explicit next entry, exactly as `providerFallbackPolicy: explicit_only`
 * requires.
 */
export const GENERATION_PROVIDER_PROFILES: Readonly<Record<string, GenerationProviderProfile>> = {
  flux2_klein_base4b_comfy_profile: {
    id: 'flux2_klein_base4b_comfy_profile',
    label: 'FLUX.2 Klein 4B (ComfyUI)',
    mode: 'local',
    modality: 'image',
    engineId: 'comfyui',
    estimatedSpendUsdPerCandidate: 0,
    requiresRightsDecision: true,
    note: 'Local ComfyUI image profile; requires a recorded intended-use/rights decision before publication.',
  },
  existing_sdcpp_profile_if_required_capabilities_pass: {
    id: 'existing_sdcpp_profile_if_required_capabilities_pass',
    label: 'sd.cpp (existing local image engine)',
    mode: 'local',
    modality: 'image',
    engineId: 'sdcpp',
    estimatedSpendUsdPerCandidate: 0,
    requiresRightsDecision: false,
    note: 'The shipped C-510 image path; selected only when the compiled request passes capability validation.',
  },
  ace_step_15_2b_turbo_profile: {
    id: 'ace_step_15_2b_turbo_profile',
    label: 'ACE-Step v1.5 2B turbo (local audio)',
    mode: 'local',
    modality: 'audio',
    engineId: 'ace-step',
    protocol: 'ace-step-v1.5',
    modelId: 'audio-ace-step-v15-2b-turbo',
    // A music model. Ambience may reach it only as a DECLARED fallback — see
    // `AUDIO_JOB_KIND_SOURCES` in @aikami/local-ai. It may never serve `sfx`.
    jobKinds: ['music'],
    licenseResolved: true,
    estimatedSpendUsdPerCandidate: 0,
    requiresRightsDecision: false,
    note: 'C-521: the versioned release_task/query_result audio engine. Replaces the v1 profile as the default for music and ambience.',
  },
  ace_step_v1_3_5b_profile: {
    id: 'ace_step_v1_3_5b_profile',
    label: 'ACE-Step v1 3.5B (local audio, rollback)',
    mode: 'local',
    modality: 'audio',
    engineId: 'ace-step',
    protocol: 'ace-step-v1',
    modelId: 'audio-ace-step-v1-3.5b',
    jobKinds: ['music'],
    licenseResolved: true,
    estimatedSpendUsdPerCandidate: 0,
    requiresRightsDecision: false,
    note: 'The shipped C-511 audio path, retained for rollback. ACE-Step v1 reports capabilities.cancel === false and writes to a server-side path.',
  },
  stable_audio_open_1_0_profile: {
    id: 'stable_audio_open_1_0_profile',
    label: 'Stable Audio Open 1.0',
    mode: 'unavailable',
    modality: 'audio',
    jobKinds: ['sfx', 'ambient'],
    licenseResolved: false,
    estimatedSpendUsdPerCandidate: 0,
    requiresRightsDecision: true,
    note: 'C-521: the declared SFX/ambient model. It is NOT installed in this repository (no stable-audio engine, and its licence/intended-use decision is unresolved), so SFX generation is refused with a typed reason rather than falling back to a music model.',
  },
  owned_or_appropriately_licensed_recording_import: {
    id: 'owned_or_appropriately_licensed_recording_import',
    label: 'Owned/licensed recording import',
    mode: 'import',
    modality: 'audio',
    jobKinds: ['sfx', 'ambient'],
    licenseResolved: true,
    estimatedSpendUsdPerCandidate: 0,
    requiresRightsDecision: true,
    note: 'C-521: bytes arrive out of band and enter the same finishing/analysis path as a generated master. No import transport is shipped here, so an import-only job is a structured blocker.',
  },
  hosted_image_profile: {
    id: 'hosted_image_profile',
    label: 'Hosted image provider (declared ceiling only)',
    mode: 'hosted',
    modality: 'image',
    estimatedSpendUsdPerCandidate: 0.04,
    requiresRightsDecision: true,
    note: 'A declared hosted ceiling. No hosted provider is wired in C-519; a request is refused unless the run budget covers the declared estimate.',
  },
  hosted_audio_profile: {
    id: 'hosted_audio_profile',
    label: 'Hosted audio provider (declared ceiling only)',
    mode: 'hosted',
    modality: 'audio',
    estimatedSpendUsdPerCandidate: 0.12,
    requiresRightsDecision: true,
    note: 'A declared hosted ceiling. No hosted provider is wired in C-519; a request is refused unless the run budget covers the declared estimate.',
  },
};

/**
 * The local provider profile that serves a recipe's declared engine.
 *
 * 🔴 Resolved from the registry, never hardcoded at a call site. C-522's client
 * studio shipped `local-sdcpp` — an id in no registry — so the runner's
 * `profileForItem` resolved nothing and every dispatch became a
 * `provider_unavailable` blocker before any engine was dialled. A lookup cannot
 * drift that way, and `undefined` is an honest "no such profile" that a caller
 * can turn into a typed refusal instead of a fabricated capability.
 *
 * Deterministic: the lowest id among the local profiles of that modality whose
 * engine matches. The tie-break is load-bearing for audio, where both ACE-Step
 * profiles serve `ace-step` and the v1.5 turbo profile is the documented
 * default for music and ambience.
 *
 * @param options.engineId - The engine the recipe declares.
 * @param options.modality - The media kind the recipe produces.
 * @returns The profile, or `undefined` when no local profile serves that pair.
 */
export const localProviderProfileForEngine = (options: {
  engineId: NonNullable<GenerationProviderProfile['engineId']>;
  modality: GenerationProviderProfile['modality'];
}): GenerationProviderProfile | undefined =>
  Object.values(GENERATION_PROVIDER_PROFILES)
    .filter(
      (profile) =>
        profile.mode === 'local' &&
        profile.modality === options.modality &&
        profile.engineId === options.engineId,
    )
    .sort((a, b) => a.id.localeCompare(b.id))[0];

/**
 * The declared budget ceilings used when a brief does not state its own.
 *
 * `candidateLimitPerItem`, `maxCandidatesPerRun` and
 * `maxRequestedAudioSecondsPerCandidatePass` come from the brief's `execution`
 * and `summary` blocks; the duration/pixel/retained-bytes ceilings are
 * runner-level and can be overridden per invocation.
 */
export const DEFAULT_GENERATION_BUDGET = {
  gpuConcurrency: 1,
  maxDurationSeconds: 3_600,
  maxPixels: 64 * 1024 * 1024,
  maxRetainedBytes: 4 * 1024 * 1024 * 1024,
} as const;

/**
 * Documented CLI exit codes.
 *
 * A blocked plan is deliberately distinct from an internal error: an LLM or
 * script caller must be able to tell "the brief says no" from "the runner
 * broke".
 */
export const GENERATION_BATCH_EXIT_CODES = {
  /** The requested operation completed. */
  OK: 0,
  /** An unexpected internal error (bug, unreadable store, engine crash). */
  INTERNAL_ERROR: 1,
  /** The plan is blocked (unresolved required input, unavailable provider). */
  BLOCKED_PLAN: 2,
  /** A declared budget ceiling would be exceeded. */
  BUDGET_REFUSED: 3,
  /** Invalid invocation: unknown flag, bad value, malformed or invalid brief. */
  INVALID_INVOCATION: 4,
  /** Job-state conflict: already claimed, unknown run, unresolved reconciliation. */
  CLAIM_CONFLICT: 5,
} as const;

/** One documented exit code. */
export type GenerationBatchExitCode =
  (typeof GENERATION_BATCH_EXIT_CODES)[keyof typeof GENERATION_BATCH_EXIT_CODES];

/** The default run-record/staging root, relative to `apps/backend/image`. */
export const DEFAULT_BATCH_RUNS_DIR_RELATIVE = 'src/output/runs';

/** The legacy staging root `generate:asset` writes into, relative to `apps/backend/image`. */
export const DEFAULT_BATCH_LEGACY_OUT_DIR_RELATIVE = 'src/output/generated';

/** The namespaced subdirectory the batch runner stages into, inside a run. */
export const BATCH_STAGED_DIRNAME = 'staged';
