// apps/frontend/client/src/lib/services/game/game_save_combat_preflight.ts
//
// Validate → migrate → plan for a persisted combat checkpoint (review F-B/F7).
//
// Before this module the load path could restore the player/world state and only
// THEN discover that the nested combat checkpoint was corrupt, used an
// unsupported rules version, or failed to migrate. A failed load therefore left
// the running game partially changed.
//
// Preflight runs entirely on the PARSED save, before any runtime mutation:
//
//   parse → validate → compatibility check → migrate → restoration plan → apply
//
// A refusal here means nothing in the live world was touched and the stored save
// is preserved verbatim.
//
// Contract: C-532 AC-6

import type { CombatSessionCheckpoint } from '@aikami/frontend/engine';
import { CombatStateSchema, migrateCombatStateToCurrentVersion } from '@aikami/schemas';
import type { CombatState } from '@aikami/types';
import { COMBAT_RULES_VERSION, isSupportedCombatRulesVersion } from '@aikami/utils';
import { Value } from 'typebox/value';

/** Why a persisted combat checkpoint cannot be restored. */
type CombatPreflightRejection =
  /** The block's own shape is not a checkpoint this build understands. */
  | 'invalidCheckpoint'
  /** The nested `CombatState` failed schema validation after migration. */
  | 'invalidState'
  /** The state's rules version is not one this build may execute. */
  | 'unsupportedRulesVersion'
  /** The state has no encounter identity, so it cannot be bound to a session. */
  | 'missingEncounterIdentity';

/** The validated, migrated checkpoint a restore may install. */
type CombatRestorationPlan = {
  checkpoint: CombatSessionCheckpoint;
  /** The migrated authoritative state. */
  state: CombatState;
  /** The migration actually applied, when the save predates the current wire. */
  migratedFrom: number | null;
};

type CombatPreflightResult =
  | { ok: true; plan: CombatRestorationPlan | null }
  | { ok: false; reason: CombatPreflightRejection; detail: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/**
 * Reads the checkpoint's non-mechanical fields defensively.
 *
 * No cast is used: every field is narrowed from `unknown`, and the mechanical
 * payload (`state`) is validated separately with the real `CombatStateSchema`.
 * A field of the wrong shape is dropped rather than trusted.
 */
const readCheckpointEnvelope = (
  record: Record<string, unknown>,
): Pick<
  CombatSessionCheckpoint,
  | 'rulesVersion'
  | 'encounterId'
  | 'encounterRunId'
  | 'stateRevision'
  | 'sessionRevision'
  | 'schemaVersion'
  | 'journal'
  | 'initialCheckpoint'
  | 'pendingReaction'
  | 'settlement'
  | 'actorBindings'
  | 'worldObjects'
> => ({
  rulesVersion: isNonEmptyString(record.rulesVersion) ? record.rulesVersion : '',
  encounterId: isNonEmptyString(record.encounterId) ? record.encounterId : '',
  encounterRunId: isNonEmptyString(record.encounterRunId) ? record.encounterRunId : '',
  stateRevision: typeof record.stateRevision === 'number' ? record.stateRevision : 0,
  sessionRevision: typeof record.sessionRevision === 'number' ? record.sessionRevision : 0,
  schemaVersion: typeof record.schemaVersion === 'number' ? record.schemaVersion : 0,
  journal: (record.journal as CombatSessionCheckpoint['journal']) ?? null,
  initialCheckpoint:
    (record.initialCheckpoint as CombatSessionCheckpoint['initialCheckpoint']) ?? null,
  pendingReaction: (record.pendingReaction as CombatSessionCheckpoint['pendingReaction']) ?? null,
  settlement: (record.settlement as CombatSessionCheckpoint['settlement']) ?? null,
  actorBindings: Array.isArray(record.actorBindings)
    ? (record.actorBindings as CombatSessionCheckpoint['actorBindings'])
    : [],
  worldObjects: (record.worldObjects as CombatSessionCheckpoint['worldObjects']) ?? null,
});

/**
 * Validates, checks compatibility with, and migrates a persisted combat
 * checkpoint without touching the running game.
 *
 * @returns `plan: null` when the save carries no live encounter (a valid state
 *   of affairs, not a failure).
 */
export const preflightCombatCheckpoint = (options: {
  checkpoint: unknown;
  /** The rules version this build executes. Defaults to the kernel's. */
  currentRulesVersion?: string;
}): CombatPreflightResult => {
  const raw = options.checkpoint;
  if (raw === undefined || raw === null) {
    return { ok: true, plan: null };
  }
  if (!isRecord(raw)) {
    return {
      ok: false,
      reason: 'invalidCheckpoint',
      detail: 'the combat block is not an object',
    };
  }
  const envelope = readCheckpointEnvelope(raw);
  if (!isNonEmptyString(envelope.rulesVersion)) {
    return {
      ok: false,
      reason: 'invalidCheckpoint',
      detail: 'the combat block has no rules version',
    };
  }
  // No live state means the save was taken between encounters. That is valid,
  // and it must NOT be treated as a checkpoint to restore.
  const stateInput = raw.state;
  if (stateInput === undefined || stateInput === null) {
    return { ok: true, plan: null };
  }

  // Compatibility is decided BEFORE migration or mutation. An unsupported
  // historical rules version is refused rather than executed under today's
  // kernel.
  const currentRulesVersion = options.currentRulesVersion ?? COMBAT_RULES_VERSION;
  if (
    envelope.rulesVersion !== currentRulesVersion &&
    !isSupportedCombatRulesVersion(envelope.rulesVersion)
  ) {
    return {
      ok: false,
      reason: 'unsupportedRulesVersion',
      detail: `unsupported combat rules version "${envelope.rulesVersion}" (current "${currentRulesVersion}")`,
    };
  }

  const declaredSchemaVersion = isRecord(stateInput)
    ? (stateInput.schemaVersion as number | undefined)
    : undefined;
  const migrated = migrateCombatStateToCurrentVersion(stateInput);
  if (!Value.Check(CombatStateSchema, migrated)) {
    return {
      ok: false,
      reason: 'invalidState',
      detail: 'the nested combat state failed schema validation after migration',
    };
  }
  const state = migrated as CombatState;

  if (!isNonEmptyString(state.encounterId) || !isNonEmptyString(state.encounterRunId)) {
    return {
      ok: false,
      reason: 'missingEncounterIdentity',
      detail: 'the combat state has no encounter or execution-run identity',
    };
  }
  if (state.rulesVersion !== currentRulesVersion) {
    return {
      ok: false,
      reason: 'unsupportedRulesVersion',
      detail: `unsupported combat rules version "${state.rulesVersion}" in the nested state (current "${currentRulesVersion}")`,
    };
  }

  const migratedFrom =
    declaredSchemaVersion !== undefined && declaredSchemaVersion !== state.schemaVersion
      ? declaredSchemaVersion
      : null;

  return {
    ok: true,
    plan: {
      checkpoint: {
        ...envelope,
        schemaVersion: state.schemaVersion,
        state,
        rulesVersion: state.rulesVersion,
        encounterId: state.encounterId,
        encounterRunId: state.encounterRunId,
        stateRevision: state.stateRevision,
      },
      state,
      migratedFrom,
    },
  };
};
