// packages/shared/schemas/src/lib/capability.ts
//
// Capability detection schemas — used by the pre-game capability screen
// to describe what AI providers are available right now.
// Contract: C-318 AC-1

import Type from 'typebox';

/** Detection outcome for a single provider category. */
export const DetectionStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('detected'),
  Type.Literal('not_found'),
  Type.Literal('configured'),
  Type.Literal('error'),
  Type.Literal('skipped'),
]);

/** Full capability snapshot produced by provider detection. */
export const CapabilitySnapshotSchema = Type.Object({
  /** Whether detection has completed. */
  isComplete: Type.Boolean(),
  /** Text AI detection status. */
  textStatus: DetectionStatusSchema,
  /** Detected text provider ID (e.g. 'ollama', 'openrouter'), or undefined. */
  textProviderId: Type.Optional(Type.String()),
  /** Detected text model name, or undefined. */
  textModelName: Type.Optional(Type.String()),
  /** Image AI detection status. */
  imageStatus: DetectionStatusSchema,
  /** Voice AI detection status. */
  voiceStatus: DetectionStatusSchema,
  /** Timestamp of detection completion. */
  detectedAt: Type.Optional(Type.String({ format: 'date-time' })),
  /** Human-readable summary for the capability screen. */
  summary: Type.String(),
});

/** Degradation mode for a feature when AI is unavailable. */
export const DegradationModeSchema = Type.Union([
  Type.Literal('full_ai'),
  Type.Literal('authored_fallback'),
  Type.Literal('template_fallback'),
  Type.Literal('static'),
  Type.Literal('disabled'),
]);
