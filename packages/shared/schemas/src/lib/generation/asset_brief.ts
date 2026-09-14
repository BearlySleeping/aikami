// packages/shared/schemas/src/lib/generation/asset_brief.ts
//
// C-519: the TypeBox implementation of the authored asset brief
// (`docs/plans/emberwatch_asset_brief.schema.json`, `$id`
// `urn:aikami:asset-brief:1`).
//
// The brief is a *production* input, not a ContentPackManifest: every boundary
// is validated strictly before the runner touches an engine, a model or the
// staging tree, so an unknown field, a missing required field or an
// unsupported provider policy fails at plan time instead of halfway through a
// paid batch.
//
// The shipped JSON Schema marks every object `additionalProperties: false`;
// this implementation keeps that strictness (unknown keys are rejected) and
// keeps the explicit `null` placeholders the authored brief uses for
// `sha256`, `variant`, `targetCanvas`, `audio` and the `measured*` fields —
// a null there means "not resolved yet", never "resolved to nothing".
//
// Contract: C-519 Durable asset jobs and batch execution

import { type Static, Type } from 'typebox';

export const AssetBriefBaselineSchema = Type.Object(
  {
    repository: Type.String({ minLength: 1 }),
    commit: Type.String({ minLength: 1 }),
    packId: Type.String({ minLength: 1 }),
    packVersion: Type.String({ minLength: 1 }),
    reviewedAt: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const AssetBriefExecutionSchema = Type.Object(
  {
    defaultMode: Type.Literal('plan'),
    defaultPhase: Type.Literal('slice'),
    requiresRunnerContract: Type.String({ minLength: 1 }),
    gpuConcurrency: Type.Literal(1),
    candidateLimitPerItem: Type.Literal(2),
    hostedBudgetUsd: Type.Number({ minimum: 0 }),
    autoAccept: Type.Literal(false),
    autoPublish: Type.Literal(false),
    unresolvedReferencePolicy: Type.Literal('block_required_inputs'),
    providerFallbackPolicy: Type.Literal('explicit_only'),
  },
  { additionalProperties: false },
);

export const AssetBriefStyleSchema = Type.Object(
  {
    gridPixels: Type.Integer({ minimum: 1 }),
    view: Type.String({ minLength: 1 }),
    palette: Type.String({ minLength: 1 }),
    lighting: Type.String({ minLength: 1 }),
    rules: Type.Array(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export const AssetBriefAudioDirectionSchema = Type.Object(
  {
    motif: Type.String({ minLength: 1 }),
    voices: Type.String({ minLength: 1 }),
    mixTargets: Type.String({ minLength: 1 }),
    loopReviewRepeats: Type.Integer({ minimum: 1 }),
    note: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const AssetBriefPreserveSchema = Type.Object(
  {
    mapIds: Type.Array(Type.String({ minLength: 1 })),
    npcIds: Type.Array(Type.String({ minLength: 1 })),
    questIds: Type.Array(Type.String({ minLength: 1 })),
    mapExtents: Type.Record(
      Type.String(),
      Type.Array(Type.Integer({ minimum: 1 }), { minItems: 2, maxItems: 2 }),
    ),
    invariants: Type.Array(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export const AssetBriefExperimentalProviderSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    defaultEnabled: Type.Literal(false),
    requires: Type.Array(Type.String({ minLength: 1 })),
    note: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const AssetBriefReferenceSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    kind: Type.String({ minLength: 1 }),
    locator: Type.String({ minLength: 1 }),
    resolution: Type.Union([Type.Literal('required'), Type.Literal('optional')]),
    sha256: Type.Union([Type.String({ pattern: '^[a-f0-9]{64}$' }), Type.Null()]),
    note: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const AssetBriefJobBindingSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal('prop'),
      Type.Literal('ending_prop'),
      Type.Literal('npc_portrait'),
      Type.Literal('npc_expression'),
      Type.Literal('audio_cue'),
    ]),
    mapIds: Type.Array(Type.String({ minLength: 1 })),
    targetIds: Type.Array(Type.String({ minLength: 1 })),
    mode: Type.Literal('proposed_pending_validation'),
    variant: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);

export const AssetBriefJobAudioSchema = Type.Union([
  Type.Object(
    {
      durationSeconds: Type.Number({ exclusiveMinimum: 0 }),
      loop: Type.Boolean(),
      channels: Type.Union([Type.Literal('mono'), Type.Literal('stereo')]),
      instrumental: Type.Boolean(),
      requestedBpm: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
      requestedKey: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
      measuredBpm: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
      measuredKey: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    },
    { additionalProperties: false },
  ),
  Type.Null(),
]);

export const AssetBriefJobSchema = Type.Object(
  {
    id: Type.String({ pattern: '^[a-z][a-z0-9_]*$', maxLength: 148 }),
    phase: Type.Union([Type.Literal('slice'), Type.Literal('expansion')]),
    kind: Type.Union([
      Type.Literal('prop'),
      Type.Literal('prop_state'),
      Type.Literal('portrait'),
      Type.Literal('expression'),
      Type.Literal('music'),
      Type.Literal('ambient'),
      Type.Literal('sfx'),
    ]),
    action: Type.Union([
      Type.Literal('generate_if_missing'),
      Type.Literal('edit'),
      Type.Literal('import'),
    ]),
    subject: Type.String({ minLength: 1 }),
    providerPreference: Type.String({ minLength: 1 }),
    preparationProfile: Type.String({ minLength: 1 }),
    referenceIds: Type.Array(Type.String({ minLength: 1 })),
    candidateLimit: Type.Integer({ minimum: 1, maximum: 2 }),
    dependsOn: Type.Array(Type.String({ minLength: 1 })),
    binding: AssetBriefJobBindingSchema,
    targetCanvas: Type.Union([
      Type.Array(Type.Integer({ minimum: 1 }), { minItems: 2, maxItems: 2 }),
      Type.Null(),
    ]),
    audio: AssetBriefJobAudioSchema,
    releaseGates: Type.Array(Type.String({ minLength: 1 })),
    status: Type.Literal('planned'),
  },
  { additionalProperties: false },
);

export const AssetBriefSummarySchema = Type.Object(
  {
    sliceItems: Type.Integer({ minimum: 1 }),
    expansionItems: Type.Integer({ minimum: 1 }),
    totalItems: Type.Integer({ minimum: 1 }),
    maxCandidates: Type.Integer({ minimum: 1 }),
    maxRequestedAudioSecondsPerCandidatePass: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const AssetBriefSchema = Type.Object(
  {
    $schema: Type.String({ minLength: 1 }),
    format: Type.Literal('aikami.asset-brief'),
    formatVersion: Type.Literal(1),
    id: Type.String({ minLength: 1, maxLength: 135 }),
    status: Type.Literal('proposed'),
    baseline: AssetBriefBaselineSchema,
    execution: AssetBriefExecutionSchema,
    style: AssetBriefStyleSchema,
    audioDirection: AssetBriefAudioDirectionSchema,
    preserve: AssetBriefPreserveSchema,
    reuseBeforeGenerate: Type.Array(Type.String({ minLength: 1 })),
    providerPreferences: Type.Record(Type.String(), Type.Array(Type.String({ minLength: 1 }))),
    experimentalProviders: Type.Array(AssetBriefExperimentalProviderSchema),
    preparationProfiles: Type.Record(Type.String(), Type.String({ minLength: 1 })),
    references: Type.Array(AssetBriefReferenceSchema),
    jobs: Type.Array(AssetBriefJobSchema),
    summary: AssetBriefSummarySchema,
    releaseGates: Type.Array(Type.String({ minLength: 1 })),
    notes: Type.Array(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

/** The authored asset brief (Emberwatch brief v1 is the production instance). */
export type AssetBrief = Static<typeof AssetBriefSchema>;
