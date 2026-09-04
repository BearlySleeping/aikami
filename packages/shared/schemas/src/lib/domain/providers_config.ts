// packages/shared/schemas/src/lib/domain/providers_config.ts
//
// TypeBox schemas for the Provider / Connection / Role AI configuration model
// (C-463). Replaces the flat ConnectionEntry model with three separated types:
// AiProvider (credential+host), AiConnection (model+params), and
// RoleAssignments (which connection for which job).
//
// Contract: C-463

import Type from 'typebox';

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

/** How a provider was sourced. */
export const ProviderSourceSchema = Type.Union([
  Type.Literal('env'),
  Type.Literal('stored'),
  Type.Literal('detected'),
]);

/** AI capability category. */
export const ConnectionCapabilitySchema = Type.Union([
  Type.Literal('text'),
  Type.Literal('image'),
  Type.Literal('voice'),
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
]);

// ---------------------------------------------------------------------------
// Params (carried by AiConnection.params, discriminated on capability)
// ---------------------------------------------------------------------------

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

/** Schema for a named voice archetype mapping. */
export const VoiceArchetypeSchema = Type.Object({
  id: Type.String(),
  label: Type.String(),
  voiceId: Type.String(),
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
  params: Type.Union([TextParamsSchema, ImageParamsSchema, VoiceParamsSchema]),
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
