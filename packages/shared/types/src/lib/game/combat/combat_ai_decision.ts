// packages/shared/types/src/lib/game/combat/combat_ai_decision.ts
//
// AI combat decision / narration domain types — derived from the TypeBox
// schemas in `@aikami/schemas` via `Static<>`.
//
// Contract: C-526 AC-1, AC-3, AC-6, AC-7, AC-11

import type {
  AiCombatDecisionBatchDraftSchema,
  AiCombatDecisionDraftSchema,
  AiCombatDecisionSchema,
  CandidatePositionContextSchema,
  CapabilityContextSchema,
  CombatActorContextSchema,
  CombatAiConfidenceSchema,
  CombatAiDecisionRecordSchema,
  CombatAiDegradedReasonSchema,
  CombatAiSourceSchema,
  CombatCoverSchema,
  CombatDecisionContextSchema,
  VisibleObjectContextSchema,
  CombatDifficultySchema,
  CombatHealthBandSchema,
  CombatMoraleSchema,
  CombatNarrationDraftSchema,
  CombatNarrationResultSchema,
  CombatNarrationSourceSchema,
  CombatObedienceSchema,
  CombatObjectiveContextSchema,
  CombatRelationshipStanceSchema,
  CombatRiskSchema,
  CombatRiskToleranceSchema,
  CompanionControlModeSchema,
  NarrationFactRefSchema,
  ReachableTargetContextSchema,
  RecentEventContextSchema,
  VisibleCombatantContextSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';
import type { CombatEvent } from './combat_event';

export type CombatAiConfidence = Static<typeof CombatAiConfidenceSchema>;
export type CombatRelationshipStance = Static<typeof CombatRelationshipStanceSchema>;
export type CombatHealthBand = Static<typeof CombatHealthBandSchema>;
export type CombatCover = Static<typeof CombatCoverSchema>;
export type CombatRisk = Static<typeof CombatRiskSchema>;
export type CombatMorale = Static<typeof CombatMoraleSchema>;
export type CombatRiskTolerance = Static<typeof CombatRiskToleranceSchema>;
export type CombatObedience = Static<typeof CombatObedienceSchema>;
export type CombatDifficulty = Static<typeof CombatDifficultySchema>;
export type CombatAiDegradedReason = Static<typeof CombatAiDegradedReasonSchema>;
export type CombatAiSource = Static<typeof CombatAiSourceSchema>;
export type CombatNarrationSource = Static<typeof CombatNarrationSourceSchema>;
export type CompanionControlMode = Static<typeof CompanionControlModeSchema>;

export type AiCombatDecision = Static<typeof AiCombatDecisionSchema>;
export type AiCombatDecisionDraft = Static<typeof AiCombatDecisionDraftSchema>;
export type AiCombatDecisionBatchDraft = Static<typeof AiCombatDecisionBatchDraftSchema>;

export type CombatActorContext = Static<typeof CombatActorContextSchema>;
export type CombatObjectiveContext = Static<typeof CombatObjectiveContextSchema>;
export type VisibleCombatantContext = Static<typeof VisibleCombatantContextSchema>;
export type CapabilityContext = Static<typeof CapabilityContextSchema>;
export type ReachableTargetContext = Static<typeof ReachableTargetContextSchema>;
export type CandidatePositionContext = Static<typeof CandidatePositionContextSchema>;
export type RecentEventContext = Static<typeof RecentEventContextSchema>;
export type CombatDecisionContext = Static<typeof CombatDecisionContextSchema>;
export type VisibleObjectContext = Static<typeof VisibleObjectContextSchema>;

export type CombatAiDecisionRecord = Static<typeof CombatAiDecisionRecordSchema>;
export type CombatNarrationResult = Static<typeof CombatNarrationResultSchema>;
export type CombatNarrationDraft = Static<typeof CombatNarrationDraftSchema>;

/** One mechanical claim the narrator makes, as a reference to a resolved fact. */
export type NarrationFactRef = Static<typeof NarrationFactRefSchema>;

// ---------------------------------------------------------------------------
// Service request/result contracts (client ↔ engine)
// ---------------------------------------------------------------------------

export type CombatAiDecisionRequest = {
  decisionId: string;
  encounterId: string;
  actorId: string;
  /** The revision the context was built against. */
  basedOnRevision: number;
  context: CombatDecisionContext;
};

/**
 * The AI decision service's answer: a decision with client-minted envelope
 * identity, or a typed degradation reason. Both carry the telemetry record.
 */
export type CombatAiDecisionResult =
  | {
      ok: true;
      decision: AiCombatDecision;
      latencyMs: number;
      record: CombatAiDecisionRecord;
      provider?: string;
      model?: string;
    }
  | {
      ok: false;
      reason: CombatAiDegradedReason;
      latencyMs: number;
      record: CombatAiDecisionRecord;
      provider?: string;
      model?: string;
    };

/** One narration request for a resolved action. */
export type CombatNarrationRequest = {
  narrationId: string;
  encounterId: string;
  basedOnRevision: number;
  /** The resolved kernel events — the ONLY input to narration. */
  events: CombatEvent[];
  /** Authored combatant id → display name. */
  names?: Record<string, string>;
};
