// packages/shared/schemas/src/lib/ai_gateway.ts
//
// AI Provider Gateway contract schemas — the shared shapes for the unified
// AI dispatch layer (offline / byok / service) built by C-320.
// Types are derived via Static<> in @aikami/types.
// Contract: C-320 AC-1

import Type from 'typebox';

/** Which adapter family serves a capability. */
export const AiModeSchema = Type.Union([
  Type.Literal('offline'),
  Type.Literal('byok'),
  Type.Literal('service'),
]);

/** The three AI capabilities behind the gateway. */
export const AiCapabilitySchema = Type.Union([
  Type.Literal('text'),
  Type.Literal('image'),
  Type.Literal('voice'),
]);

/** Normalized gateway error codes across all modes/capabilities. */
export const AiGatewayErrorCodeSchema = Type.Union([
  Type.Literal('provider_unreachable'),
  Type.Literal('not_configured'),
  Type.Literal('auth_failed'),
  Type.Literal('rate_limited'),
  Type.Literal('cancelled'),
  Type.Literal('timeout'),
  Type.Literal('invalid_response'),
  Type.Literal('mode_unavailable'),
]);

/** Typed error shape surfaced by every gateway call. */
export const AiGatewayErrorSchema = Type.Object({
  /** Machine-readable normalized error code. */
  code: AiGatewayErrorCodeSchema,
  /** Which capability the failing call targeted. */
  capability: AiCapabilitySchema,
  /** Which mode served (or failed to serve) the call. */
  mode: AiModeSchema,
  /** Provider id when known (e.g. 'ollama', 'openrouter'). */
  provider: Type.Optional(Type.String()),
  /** Human-readable message. Never contains secrets. */
  message: Type.String(),
  /** Whether retrying the call may succeed. */
  retryable: Type.Boolean(),
});

/** Per-capability resolved routing, computed once at the gateway boundary. */
export const AiModeResolutionSchema = Type.Object({
  capability: AiCapabilitySchema,
  mode: AiModeSchema,
  /** Provider id, e.g. 'ollama' | 'openrouter' | 'comfyui' | 'kokoro' | 'aikami_service'. */
  provider: Type.String(),
  /** Base endpoint URL, when the provider needs one. */
  endpoint: Type.Optional(Type.String()),
  /** Model id, when the capability is model-addressable. */
  model: Type.Optional(Type.String()),
});

/** Detection result per capability (convertible to existing DetectionStatus). */
export const AiDetectionResultSchema = Type.Object({
  capability: AiCapabilitySchema,
  /** Whether the capability can serve calls right now. */
  available: Type.Boolean(),
  /** Mode that would serve the capability, when known. */
  mode: Type.Optional(AiModeSchema),
  /** Provider id that answered the detection, when known. */
  provider: Type.Optional(Type.String()),
  /** Human-readable diagnostic detail. Never contains secrets. */
  detail: Type.Optional(Type.String()),
  /** ISO timestamp of when the check completed. */
  checkedAt: Type.String(),
});

/** A single chat message in a gateway text-generation request. */
export const AiChatMessageSchema = Type.Object({
  role: Type.Union([Type.Literal('user'), Type.Literal('assistant'), Type.Literal('system')]),
  content: Type.String(),
});

/** Per-capability gateway routing configuration. */
export const AiGatewayCapabilityConfigSchema = Type.Object({
  mode: AiModeSchema,
  provider: Type.String(),
  endpoint: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
});

/**
 * Full gateway mode configuration — one optional entry per capability.
 * `serviceActivated` gates the hosted `service` mode (Phase 5); resolving
 * `service` while it is false yields a `mode_unavailable` gateway error.
 */
export const AiGatewayModeConfigSchema = Type.Object({
  text: Type.Optional(AiGatewayCapabilityConfigSchema),
  image: Type.Optional(AiGatewayCapabilityConfigSchema),
  voice: Type.Optional(AiGatewayCapabilityConfigSchema),
  serviceActivated: Type.Optional(Type.Boolean()),
});
