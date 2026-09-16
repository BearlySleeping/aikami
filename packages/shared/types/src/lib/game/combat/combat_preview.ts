// packages/shared/types/src/lib/game/combat/combat_preview.ts
//
// Tactical query + preview domain types — derived from the TypeBox schemas in
// `@aikami/schemas` via `Static<>`.
//
// Contract: C-515 AC-3, AC-4, AC-5

import type {
  ActionForecastSchema,
  ActionQuerySchema,
  CombatPreviewFailureSchema,
  CombatPreviewQuerySchema,
  CombatPreviewRequestSchema,
  CombatPreviewResultSchema,
  CombatPreviewSuccessSchema,
  CombatPreviewWarningSchema,
  EnvironmentalForecastEffectSchema,
  ForecastCheckOutcomeSchema,
  LegalActionsSchema,
  LegalMoveQuerySchema,
  LegalTargetQuerySchema,
  ObjectiveEffectForecastSchema,
  ReactionRiskForecastSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

export type ReactionRiskForecast = Static<typeof ReactionRiskForecastSchema>;
export type ObjectiveEffectForecast = Static<typeof ObjectiveEffectForecastSchema>;
export type LegalMoveQuery = Static<typeof LegalMoveQuerySchema>;
export type LegalTargetQuery = Static<typeof LegalTargetQuerySchema>;
export type ActionQuery = Static<typeof ActionQuerySchema>;
export type CombatPreviewQuery = Static<typeof CombatPreviewQuerySchema>;
export type CombatPreviewRequest = Static<typeof CombatPreviewRequestSchema>;
export type CombatPreviewWarning = Static<typeof CombatPreviewWarningSchema>;
export type EnvironmentalForecastEffect = Static<typeof EnvironmentalForecastEffectSchema>;
export type ForecastCheckOutcome = Static<typeof ForecastCheckOutcomeSchema>;
export type ActionForecast = Static<typeof ActionForecastSchema>;
export type LegalActions = Static<typeof LegalActionsSchema>;
export type CombatPreviewSuccess = Static<typeof CombatPreviewSuccessSchema>;
export type CombatPreviewFailure = Static<typeof CombatPreviewFailureSchema>;
export type CombatPreviewResult = Static<typeof CombatPreviewResultSchema>;
