// packages/shared/schemas/src/lib/domain/providers_config.ts
//
// TypeBox schemas for the Provider / Connection / Role AI configuration model
// (C-481). Replaces the flat ConnectionEntry model with three separated types:
// AiProvider (credential+host), AiConnection (model+params), and
// RoleAssignments (which connection for which job).
//
// V3 adds routing (defaults + overrides) and capability-discriminated params.
//
// Contracts: C-463, C-481

import Type, { type Static } from 'typebox';

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

/** How a provider was sourced. */
export const ProviderSourceSchema = Type.Union([
  Type.Literal('env'),
  Type.Literal('stored'),
  Type.Literal('detected'),
]);

/**
 * AI capability category.
 *
 * `decision` is its own capability and NOT a flavour of `text`. A decision
 * checkpoint answers bounded closed questions and cannot narrate, and a chat
 * model cannot score them: sharing one capability would let the settings UI
 * assign a decision backend to dialogue and a chat model to decisions, which is
 * the exact conflation the decision subsystem refuses everywhere else.
 */
export const ConnectionCapabilitySchema = Type.Union([
  Type.Literal('text'),
  Type.Literal('image'),
  Type.Literal('voice'),
  Type.Literal('decision'),
]);

/** AI role — what the game uses a connection FOR. */
export const AiRoleSchema = Type.Union([
  // Text roles
  Type.Literal('narration'),
  Type.Literal('dialogue'),
  Type.Literal('summarization'),
  Type.Literal('structured'),
  // Image roles
  Type.Literal('portrait'),
  Type.Literal('scene'),
  // Voice roles
  Type.Literal('narrator-voice'),
  Type.Literal('npc-voice'),
  // Decision role — bounded, closed-question scoring (System One / Jev)
  Type.Literal('decisions'),
]);

// ---------------------------------------------------------------------------
// Params (carried by AiConnection.params, discriminated on capability)
// ---------------------------------------------------------------------------

/** Schema for a named voice archetype mapping. */
export const VoiceArchetypeSchema = Type.Object({
  id: Type.String(),
  label: Type.String(),
  voiceId: Type.String(),
});

/**
 * Whether a request may use the model's reasoning ("thinking") channel.
 *
 * `default` leaves it to the provider, which is correct for every
 * player-facing creative task. `none` asks for the reasoning channel to be
 * switched off for a request that is a bounded mechanical extraction — the
 * reasoning spends the whole budget and returns nothing the consumer reads
 * (issue #382, C-401 call 2).
 *
 * It is a SEMANTIC preference, not a wire field. Providers spell the control
 * differently (`think: false` on Ollama's native API, `reasoning_effort:
 * "none"` on the OpenAI-compatible surface), and only the adapter knows which
 * spelling its provider honours. A provider that cannot honour it ignores the
 * request rather than failing it.
 */
export const AiReasoningSchema = Type.Union([Type.Literal('default'), Type.Literal('none')]);
export type AiReasoning = Static<typeof AiReasoningSchema>;

/** Generation parameters for text connections. */
export const TextParamsSchema = Type.Object({
  temperature: Type.Number(),
  topP: Type.Number(),
  topK: Type.Number(),
  repetitionPenalty: Type.Number(),
  presencePenalty: Type.Number(),
  maxTokens: Type.Number(),
  contextSize: Type.Number(),
});

/** Image-generation-specific connection options. */
export const ImageParamsSchema = Type.Object({
  checkpoint: Type.String(),
  width: Type.Number(),
  height: Type.Number(),
  steps: Type.Number(),
  cfg: Type.Number(),
});

/** Voice/TTS-specific connection options. */
export const VoiceParamsSchema = Type.Object({
  voiceId: Type.String(),
  speed: Type.Number(),
  pitch: Type.Number(),
  /** Named-role → this provider's voice id, e.g. "Female — warm" -> "af_bella". */
  archetypes: Type.Optional(Type.Array(VoiceArchetypeSchema)),
});

/**
 * Which runtime serves a decision endpoint.
 *
 * `ollama` is asked for `/api/version` and must clear the dialect's floor.
 * `jev` is any externally managed Jev-compatible server (laya.cpp's HTTP route,
 * a hosted Jev API) and is never asked for an Ollama route it may not serve.
 */
export const DecisionRuntimeSchema = Type.Union([Type.Literal('ollama'), Type.Literal('jev')]);

/**
 * A recorded workload qualification (C-568).
 *
 * `qualifiedForGameplay: true` alone is NOT a qualification. It says the player
 * ticked a box; it says nothing about WHICH task, at WHICH task version, over
 * WHICH wire dialect, answered by WHICH checkpoint. The first consumer treated
 * that boolean as a current-version qualification, which manufactured the one
 * piece of evidence the routing gate exists to require.
 *
 * This record carries the four things that must match before a decision backend
 * may answer automatically, plus provenance for the record itself so a stale one
 * is identifiable rather than merely wrong.
 *
 * Absent in practice: nothing in this build writes it, because no shipped
 * measurement has cleared the gate. Its absence means FAIL CLOSED.
 */
export const DecisionQualificationEvidenceSchema = Type.Object(
  {
    /** Task the measurement scored. */
    taskId: Type.String({ minLength: 1 }),
    /** Task contract version the measurement was taken against. */
    taskVersion: Type.Integer({ minimum: 1 }),
    /** Wire dialect the measurement was taken over. */
    dialect: Type.String({ minLength: 1 }),
    /** Checkpoint that actually answered. */
    checkpoint: Type.String({ minLength: 1 }),
    /** ISO timestamp of the measurement, for identifying a stale record. */
    measuredAt: Type.Optional(Type.String()),
    /** Run identifier of the measurement, when it produced one. */
    runId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/**
 * Decision-connection parameters.
 *
 * Carries the checkpoint plus the routing facts the adapter needs. Deliberately
 * NOT generation parameters: a decision model has no temperature, no context
 * window to tune and no prose to shape. It has a checkpoint, a runtime and an
 * endpoint, and pretending otherwise is how a chat model ends up configured as a
 * decision model.
 */
export const DecisionParamsSchema = Type.Object({
  /** Checkpoint / model identity, reported verbatim in provenance. */
  checkpoint: Type.String({ minLength: 1 }),
  /** Which runtime serves this endpoint. Decides which probes are legitimate. */
  runtime: DecisionRuntimeSchema,
  /** Languages the checkpoint declares. Anything else must abstain. */
  languages: Type.Optional(Type.Array(Type.Union([Type.Literal('en'), Type.Literal('multi')]))),
  /**
   * Whether the player has opted this backend into automatic tasks at all.
   *
   * A MASTER SWITCH, not a qualification: it can only ever narrow what the
   * versioned {@link DecisionQualificationEvidenceSchema} record permits.
   */
  qualifiedForGameplay: Type.Optional(Type.Boolean()),
  /**
   * The measured qualification this connection relies on.
   *
   * Routing requires this AND a matching current task/version/dialect/
   * checkpoint. With it absent, automatic routing is refused.
   */
  qualification: Type.Optional(DecisionQualificationEvidenceSchema),
});

// ---------------------------------------------------------------------------
// AiProvider — one credential + host. Created once per account.
// ---------------------------------------------------------------------------

/** Schema for AiProvider. */
export const AiProviderSchema = Type.Object({
  /** Unique provider identifier. */
  id: Type.String({ format: 'uuid' }),
  /** Key into TEXT_PROVIDERS / VOICE_PROVIDERS / IMAGE_PROVIDERS. */
  registryId: Type.String(),
  /** User-facing name, defaulted from the registry label. */
  label: Type.String(),
  /** Vault-encrypted API key. Absent for keyless local providers. */
  credential: Type.Optional(Type.String()),
  /** Required iff the registry entry sets needsUrl. */
  baseUrl: Type.Optional(Type.String()),
  /** How this provider was sourced — drives the badge. */
  source: ProviderSourceSchema,
  /** Result of the last explicit Test, for the health dot. Never auto-probed. */
  lastVerifiedAt: Type.Optional(Type.String({ format: 'date-time' })),
});

// ---------------------------------------------------------------------------
// AiConnection — a usable configuration. Many per provider.
// ---------------------------------------------------------------------------

/** Schema for AiConnection. */
export const AiConnectionSchema = Type.Object({
  /** Unique connection identifier. */
  id: Type.String({ format: 'uuid' }),
  /** Reference to the AiProvider this connection uses. */
  providerId: Type.String({ format: 'uuid' }),
  /** AI capability this connection serves. */
  capability: ConnectionCapabilitySchema,
  /** Human-readable name. */
  label: Type.String(),
  /** Model identifier (e.g. 'anthropic/claude-3-opus', 'sd_xl_base_1.0'). */
  model: Type.String(),
  /** Discriminated on capability. No credential field — that lives on the provider. */
  params: Type.Union([
    TextParamsSchema,
    ImageParamsSchema,
    VoiceParamsSchema,
    DecisionParamsSchema,
  ]),
  /** ISO timestamp of creation. */
  createdAt: Type.String({ format: 'date-time' }),
  /** ISO timestamp of last update. */
  updatedAt: Type.String({ format: 'date-time' }),
});

// ---------------------------------------------------------------------------
// RoleAssignments — what the game uses a connection FOR.
// ---------------------------------------------------------------------------

/** Schema for RoleAssignments — a map from AiRole to ConnectionId. */
export const RoleAssignmentsSchema = Type.Partial(
  Type.Record(AiRoleSchema, Type.String({ format: 'uuid' })),
);

// ---------------------------------------------------------------------------
// Routing — capability defaults and role overrides
// ---------------------------------------------------------------------------

/**
 * Routing schema: sparse capability defaults and sparse role overrides.
 *
 * - An absent override inherits its capability default.
 * - A connection ID pins that role to a specific connection.
 * - `null` explicitly disables that role.
 * - A missing default means that capability is unavailable.
 * - Reset-to-default removes the override; disable writes `null`.
 */
const RoutingTargetSchema = Type.Union([Type.String({ format: 'uuid' }), Type.Null()]);

/** Schema for role overrides — allows null to explicitly disable a role. */
export const RoleOverridesSchema = Type.Partial(
  Type.Object({
    narration: RoutingTargetSchema,
    dialogue: RoutingTargetSchema,
    summarization: RoutingTargetSchema,
    structured: RoutingTargetSchema,
    portrait: RoutingTargetSchema,
    scene: RoutingTargetSchema,
    'narrator-voice': RoutingTargetSchema,
    'npc-voice': RoutingTargetSchema,
    decisions: RoutingTargetSchema,
  }),
  { additionalProperties: false },
);

/** Routing schema: sparse capability defaults and sparse role overrides. */
export const RoutingSchema = Type.Object(
  {
    /** Per-capability default connection IDs. Sparse — absent means unavailable. */
    defaults: Type.Optional(
      Type.Partial(
        Type.Object({
          text: RoutingTargetSchema,
          image: RoutingTargetSchema,
          voice: RoutingTargetSchema,
          decision: RoutingTargetSchema,
        }),
        { additionalProperties: false },
      ),
    ),
    /** Per-role overrides. Sparse — absent inherits from capability default. */
    overrides: Type.Optional(RoleOverridesSchema),
  },
  { additionalProperties: false },
);

/** Routing type. */
export type Routing = Static<typeof RoutingSchema>;

// ---------------------------------------------------------------------------
// V3 vault payload
// ---------------------------------------------------------------------------

/**
 * Schema for the v3 vault payload. Adds `routing` alongside the v2 fields.
 * `voiceApiKey` and `imageApiKey` are removed — keys live on providers only.
 * `legacy` is removed — v3 has its own recovery snapshot.
 */
export const VaultPayloadV3Schema = Type.Object({
  /** Schema version for migration detection. 3 = current. */
  schemaVersion: Type.Literal(3),
  /** All providers with their credentials. */
  providers: Type.Array(AiProviderSchema),
  /** All connections referencing providers. */
  connections: Type.Array(AiConnectionSchema),
  /** Role assignments (which connection for which job) — for backward compat. */
  roles: RoleAssignmentsSchema,
  /** Routing — capability defaults and role overrides. */
  routing: RoutingSchema,
  /** User-defined generation parameter presets (built-in presets merged on load). */
  userPresets: Type.Optional(Type.Array(Type.Any())),
  /**
   * Encrypted pre-upgrade snapshot for rollback. Stored alongside the active
   * payload, not inside it. Only present during the v2→v3 migration window.
   */
  recoverySnapshot: Type.Optional(Type.Any()),
});

// ---------------------------------------------------------------------------
// V2 vault payload
// ---------------------------------------------------------------------------

/** Schema for the v2 vault payload (top-level shape after migration). */
export const VaultPayloadV2Schema = Type.Object({
  /** Schema version for migration detection. 2 = current. */
  schemaVersion: Type.Literal(2),
  /** All providers with their credentials. */
  providers: Type.Array(AiProviderSchema),
  /** All connections referencing providers. */
  connections: Type.Array(AiConnectionSchema),
  /** Role assignments (which connection for which job). */
  roles: RoleAssignmentsSchema,
  /** User-defined generation parameter presets (built-in presets merged on load). */
  userPresets: Type.Optional(Type.Array(Type.Any())),
  /** Vault-held voice provider key. */
  voiceApiKey: Type.Optional(Type.String()),
  /** Vault-held image provider key. */
  imageApiKey: Type.Optional(Type.String()),
  /**
   * Verbatim v1 payload, written for rollback only. The loader must never
   * depend on it for normal operation — see `_absorbLegacyConnections`.
   */
  legacy: Type.Optional(Type.Any()),
});

// ---------------------------------------------------------------------------
// V1 vault payload (pre-migration)
// ---------------------------------------------------------------------------

/** V1 connection entry shape as stored in vault. */
export const V1ConnectionSchema = Type.Object({
  id: Type.String(),
  provider: Type.String(),
  capability: Type.Optional(Type.String()),
  name: Type.String(),
  apiKey: Type.Optional(Type.String()),
  baseUrl: Type.Optional(Type.String()),
  model: Type.String(),
  generationParams: Type.Object({
    temperature: Type.Number(),
    topP: Type.Number(),
    topK: Type.Number(),
    repetitionPenalty: Type.Number(),
    presencePenalty: Type.Number(),
    maxTokens: Type.Number(),
    contextSize: Type.Number(),
  }),
  isDefault: Type.Boolean(),
  source: Type.Optional(Type.String()),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  imageOptions: Type.Optional(
    Type.Object({
      checkpoint: Type.String(),
      width: Type.Number(),
      height: Type.Number(),
      steps: Type.Number(),
      cfg: Type.Number(),
    }),
  ),
  voiceOptions: Type.Optional(
    Type.Object({
      voiceId: Type.String(),
      speed: Type.Number(),
      pitch: Type.Number(),
    }),
  ),
});

/** V1 vault payload shape. */
export const V1VaultPayloadSchema = Type.Object({
  connections: Type.Optional(Type.Array(V1ConnectionSchema)),
  defaultConnectionId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  defaultByCapability: Type.Optional(
    Type.Record(Type.String(), Type.Union([Type.String(), Type.Null()])),
  ),
  voiceApiKey: Type.Optional(Type.String()),
  imageApiKey: Type.Optional(Type.String()),
  userPresets: Type.Optional(Type.Array(Type.Any())),
});
