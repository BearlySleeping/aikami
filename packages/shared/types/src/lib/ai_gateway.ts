// packages/shared/types/src/lib/ai_gateway.ts
//
// AI Provider Gateway types — derived from @aikami/schemas.
// Contract: C-320 AC-1

import type {
  AiCapabilitySchema,
  AiChatMessageSchema,
  AiDetectionResultSchema,
  AiGatewayCapabilityConfigSchema,
  AiGatewayErrorCodeSchema,
  AiGatewayErrorSchema,
  AiGatewayModeConfigSchema,
  AiModeResolutionSchema,
  AiModeSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

/** Which adapter family serves a capability: 'offline' | 'byok' | 'service'. */
export type AiMode = Static<typeof AiModeSchema>;

/** The three AI capabilities behind the gateway: 'text' | 'image' | 'voice'. */
export type AiCapability = Static<typeof AiCapabilitySchema>;

/** Normalized gateway error codes across all modes/capabilities. */
export type AiGatewayErrorCode = Static<typeof AiGatewayErrorCodeSchema>;

/** Typed error shape surfaced by every gateway call. */
export type AiGatewayError = Static<typeof AiGatewayErrorSchema>;

/** Per-capability resolved routing, computed once at the gateway boundary. */
export type AiModeResolution = Static<typeof AiModeResolutionSchema>;

/** Detection result per capability (convertible to existing DetectionStatus). */
export type AiDetectionResult = Static<typeof AiDetectionResultSchema>;

/** A single chat message in a gateway text-generation request. */
export type AiChatMessage = Static<typeof AiChatMessageSchema>;

/** Per-capability gateway routing configuration. */
export type AiGatewayCapabilityConfig = Static<typeof AiGatewayCapabilityConfigSchema>;

/** Full gateway mode configuration — one optional entry per capability. */
export type AiGatewayModeConfig = Static<typeof AiGatewayModeConfigSchema>;
