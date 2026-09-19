// apps/frontend/client/src/lib/views/dev/combat/inspector/combat_debug_inspector.ts
//
// Pure, read-only projections of the authoritative `CombatState` (and the
// workspace's recorded controller records) into the six inspector tabs of the
// combat debug workspace: context, actor, action, objects, reactions, AI.
//
// This module is deliberately environment-free: no `$services`, no runes, no
// DOM, no network, no clock reads. The workspace ViewModel and headless Bun
// tests both import it, so it may only depend on domain types and pure helpers.
// Selectors never repair state — they detect and describe, and the dev
// assertions report violations rather than mutating them away.
//
// The domain-state selectors (context, objects/objectives, reactions,
// assertions) live in `combat_debug_inspector_selectors.ts`; this entry module
// re-exports them so consumers have one import site, alongside the actor,
// action and AI projections that belong to the workspace's own recorded facts.
//
// Contract: combat debug workspace (execution prompt §3, §5)

import type { CombatState, ParticipationState, TurnBudget } from '@aikami/types';
import type { CombatDebugControllerRecord } from '../types/combat_debug_types.ts';

export * from './combat_debug_inspector_selectors.ts';

// ---------------------------------------------------------------------------
// Actor tab
// ---------------------------------------------------------------------------

/**
 * One combatant's inspector projection.
 *
 * `initiative` is read from the combatant record (the authoritative per-actor
 * value); `state.initiative.order` is only the sorted snapshot the turn loop
 * advances over. `participation` is absent when the record has no entry — the
 * inspector shows "no participation record" rather than inventing morale.
 */
export type CombatDebugActorSummary = {
  readonly combatantId: string;
  readonly name: string;
  readonly team: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly position: { readonly x: number; readonly y: number };
  readonly initiative: number | undefined;
  readonly movementRemaining: number;
  readonly actionAvailable: boolean;
  readonly quickActionAvailable: boolean;
  readonly reactionAvailable: boolean;
  readonly downed: boolean;
  readonly defeated: boolean;
  readonly controlMode: string | undefined;
  readonly abilityIds: readonly string[];
  readonly participation:
    | { readonly morale: number | undefined; readonly broken: boolean | undefined }
    | undefined;
};

/** Options for {@link buildCombatDebugActorSummary}. */
export type BuildCombatDebugActorSummaryOptions = {
  readonly state: CombatState;
  readonly combatantId: string;
};

/**
 * Projects one combatant, or `undefined` for an unknown id. `broken` is derived
 * from the pinned morale rules' `breakThreshold`: the crossing itself never
 * removes an actor, it only *permits* an authored response, so this is purely
 * an inspector flag.
 */
export const buildCombatDebugActorSummary = (
  options: BuildCombatDebugActorSummaryOptions,
): CombatDebugActorSummary | undefined => {
  const { state, combatantId } = options;
  const combatant = state.combatants[combatantId];
  if (!combatant) {
    return undefined;
  }

  const participation: ParticipationState | undefined = state.participation[combatantId];
  const budget: TurnBudget = combatant.budget;

  return {
    combatantId: combatant.combatantId,
    name: combatant.name,
    team: combatant.team,
    hp: combatant.hp,
    maxHp: combatant.maxHp,
    position: { x: combatant.position.x, y: combatant.position.y },
    initiative: combatant.initiative,
    movementRemaining: budget.movementRemaining,
    actionAvailable: budget.actionAvailable,
    quickActionAvailable: budget.quickActionAvailable,
    reactionAvailable: budget.reactionAvailable,
    downed: combatant.downed,
    defeated: combatant.defeated,
    controlMode: combatant.controlMode,
    abilityIds: [...combatant.abilityIds],
    participation:
      participation === undefined
        ? undefined
        : {
            morale: participation.morale,
            broken: participation.morale <= state.moraleRules.breakThreshold,
          },
  };
};

// ---------------------------------------------------------------------------
// Action tab
// ---------------------------------------------------------------------------

/**
 * The pending / last action projection.
 *
 * There is no authoritative "last command" record on `CombatState` — commands
 * live on the bridge/event log. This shape exists so the ViewModel can hand the
 * workspace's pending-or-last command facts to the action tab without leaking
 * its own reactive shape, and so every field is explicitly `undefined` rather
 * than absent when the workspace has not observed a command yet.
 */
export type CombatDebugActionSummary = {
  readonly commandId: string | undefined;
  readonly revision: number | undefined;
  readonly semanticIntent: string | undefined;
  readonly groundedKind: string | undefined;
  readonly acknowledgement: 'accepted' | 'rejected' | undefined;
  readonly rejectionCode: string | undefined;
  readonly resultingRevision: number | undefined;
  readonly warnings: readonly string[];
};

/** Options for {@link buildCombatDebugActionSummary}. */
export type BuildCombatDebugActionSummaryOptions = {
  readonly commandId?: string;
  readonly revision?: number;
  readonly semanticIntent?: string;
  readonly groundedKind?: string;
  readonly acknowledgement?: 'accepted' | 'rejected';
  readonly rejectionCode?: string;
  readonly resultingRevision?: number;
  readonly warnings?: readonly string[];
};

/**
 * Normalizes the pending/last action into a plain readonly record. Warnings are
 * copied so the projection cannot alias a caller's reactive array.
 */
export const buildCombatDebugActionSummary = (
  options: BuildCombatDebugActionSummaryOptions = {},
): CombatDebugActionSummary => ({
  commandId: options.commandId,
  revision: options.revision,
  semanticIntent: options.semanticIntent,
  groundedKind: options.groundedKind,
  acknowledgement: options.acknowledgement,
  rejectionCode: options.rejectionCode,
  resultingRevision: options.resultingRevision,
  warnings: options.warnings === undefined ? [] : [...options.warnings],
});

// ---------------------------------------------------------------------------
// AI tab
// ---------------------------------------------------------------------------

/** The AI tab's aggregate over the workspace's recorded controller records. */
export type CombatDebugAiSummary = {
  readonly records: readonly CombatDebugControllerRecord[];
  readonly providerUsedCount: number;
  readonly degradedCount: number;
};

/**
 * Counts the two things a reader of the AI tab needs at a glance without
 * expanding every row: how many decisions went through a real provider, and how
 * many degraded (a recorded `failureCode`). A degraded record is one the
 * controller had to fall back from, which is diagnostic, never a repair.
 */
export const buildCombatDebugAiSummary = (
  records: readonly CombatDebugControllerRecord[],
): CombatDebugAiSummary => {
  let providerUsedCount = 0;
  let degradedCount = 0;
  for (const record of records) {
    if (record.providerUsed) {
      providerUsedCount += 1;
    }
    if (record.failureCode !== undefined) {
      degradedCount += 1;
    }
  }
  return { records: [...records], providerUsedCount, degradedCount };
};
