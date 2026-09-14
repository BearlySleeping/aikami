// apps/frontend/client/src/lib/views/combat/combat_companion_preview.ts
//
// Companion control-mode types and pure preview projections (C-526 AC-6).
//
// Extracted from `combat_companion_flow.svelte.ts` so the flow stays under the
// source-file-size hard limit. Everything here is pure: the proposal/decision
// shapes the sidebar renders and the projection from a compiled plan into the
// SAME `CombatIntentPreview` the player's own language plans use.
//
// Contract: C-526 AC-6

import type { EngineBridge } from '@aikami/frontend/engine';
import type { CombatState, CompanionControlMode, CompiledPlan, IntentStep } from '@aikami/types';
import type { CombatIntentPreview } from './types/combat_direct_control.ts';

/** One companion's persisted preference. */
export type CompanionModePreference = {
  mode: CompanionControlMode;
  /** Standing goal for `intent` mode; empty for the other modes. */
  intent: string;
};

/** A decision awaiting the player's approval. */
export type CompanionProposal = {
  combatantId: string;
  /** The engine's decision request id — the ONLY id that may be submitted. */
  requestId: string;
  basedOnRevision: number;
  mode: CompanionControlMode;
  /** The step currently being previewed. */
  stepIndex: number;
  /** The full intent the player is approving (originally the model's). */
  steps: IntentStep[];
  fallback: IntentStep[];
  /** The compiled, uncommitted plan for the current step. */
  plan: CompiledPlan;
  preview: CombatIntentPreview;
  /** Editable target choices for a `use_ability` step. */
  targets: Array<{ combatantId: string; name: string }>;
  /** The standing goal the plan was produced under, when in `intent` mode. */
  intent: string;
};

export type CompanionDecisionState =
  | { status: 'idle' }
  | { status: 'awaiting_approval'; proposal: CompanionProposal }
  /**
   * One step committed; the engine is activating it and (when more remain) has
   * been asked to re-request the next decision at the new revision.
   */
  | { status: 'partially_committed'; combatantId: string; remainingSteps: number }
  /**
   * The player must choose what happens next: Replan, Take Control or End Turn.
   *
   * Reached when a plan cannot be compiled, the revision moved on, or the
   * player declined. The engine's request stays open (a companion turn has no
   * model deadline), so the surface is actionable rather than an invisible wait.
   */
  | {
      status: 'recovery';
      combatantId: string;
      reason: 'uncompilable' | 'stale' | 'declined';
      requestId: string;
      basedOnRevision: number;
    }
  | { status: 'declined'; combatantId: string; reason: 'player' | 'stale' | 'withdrawn' };

export const IDLE_COMPANION_DECISION: CompanionDecisionState = { status: 'idle' };

/**
 * Whether a produced AI decision for this actor must be approved by the player.
 *
 * Every companion mode except `direct` requires confirmation in this release;
 * `direct` never reaches this layer at all because the engine gives the turn to
 * the player.
 */
export const companionRequiresApproval = (mode: CompanionControlMode | undefined): boolean =>
  mode !== undefined && mode !== 'direct';

/** Projects a compiled companion plan into the SAME preview shape the sidebar renders. */
export const toCompanionPreview = (plan: CompiledPlan): CombatIntentPreview => {
  const command = plan.command;
  const destination = command.kind === 'move' ? (command.path.at(-1) ?? null) : null;
  const hitChance = plan.forecast.hitChance;
  return {
    planId: plan.planId,
    commandKind: command.kind,
    destination,
    movementCost: plan.forecast.movementCost ?? null,
    hitPercentage: hitChance === undefined ? null : Math.round(hitChance * 100),
    damageMinimum: plan.forecast.damageRange?.minimum ?? null,
    damageMaximum: plan.forecast.damageRange?.maximum ?? null,
    path: command.kind === 'move' ? command.path.map((cell) => ({ x: cell.x, y: cell.y })) : [],
    warnings: [...plan.warnings],
    assumptions: [...plan.assumptions],
    requiresConfirmation: true,
  };
};

/** Whether a compiled candidate's command targets `combatantId`. */
export const commandTargets = (plan: CompiledPlan, combatantId: string | undefined): boolean => {
  if (combatantId === undefined) {
    return false;
  }
  const command = plan.command;
  return command.kind === 'useAbility' && command.targetIds.includes(combatantId);
};

/** Every living combatant the acting companion could legally target instead. */
export const editableTargets = (
  state: CombatState,
  actorId: string,
): Array<{ combatantId: string; name: string }> =>
  Object.values(state.combatants)
    .filter((combatant) => combatant.combatantId !== actorId && !combatant.defeated)
    .sort((left, right) => (left.combatantId < right.combatantId ? -1 : 1))
    .map((combatant) => ({ combatantId: combatant.combatantId, name: combatant.name }));

/** The bridge slice the companion flow uses. */
export type CombatCompanionFlowBridge = Pick<EngineBridge, 'send' | 'on'>;

/** Everything the companion flow needs from its owner (C-526 AC-6). */
export type CombatCompanionFlowDeps = {
  bridge(): CombatCompanionFlowBridge | undefined;
  /** The persisted preference for a companion, or undefined for a non-companion. */
  preferenceFor(combatantId: string): CompanionModePreference | undefined;
  /** Persists a preference change (party roster + policy seam). */
  persistPreference(change: { combatantId: string; preference: CompanionModePreference }): void;
  readRevision(): number;
  readEncounterId(): string;
  /** Display name for a combatant, for the proposal header. */
  displayNameFor(combatantId: string): string;
  /** Appends one narration line to the combat log. */
  appendLog(text: string): void;
  snapshotDeadlineMs?: number;
  debug?(event: string, data?: Record<string, unknown>): void;
};
