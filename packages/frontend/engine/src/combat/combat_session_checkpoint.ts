// packages/frontend/engine/src/combat/combat_session_checkpoint.ts
//
// One coherent save/checkpoint boundary for a running v2 encounter
// (review F-B / F7).
//
// The save path used to capture several pieces SEPARATELY — the player ECS
// snapshot, the service snapshots, the world-object block and the live combat
// checkpoint. Combat can advance between those reads, so a save could contain
// player/world state from revision N, combat state from revision N+1 and object
// state from a third boundary. Changing the read ORDER does not fix that.
//
// This module provides the read barrier: a monotonic `sessionRevision` that
// advances on every ACCEPTED combat transition, plus one atomic payload that
// carries every combat-related durable fact for the encounter. The client
// captures the ECS snapshot between two readings of `sessionRevision` and
// retries until they agree, so all captured data provably belongs to the same
// accepted command boundary.
//
// The payload is also the durable checkpoint a restore needs: rules/schema
// version, encounter and run identity, the authoritative state, the accepted
// command journal (replay + idempotency), the initial retry checkpoint (which
// carries the stable actor bindings), any pending reaction window and any
// settlement.
//
// Contract: C-532 AC-4/AC-5/AC-6, C-531 AC-7

import type {
  CombatState,
  CompanionControlMode,
  EncounterSettlement,
  ReactionWindow,
} from '@aikami/types';
import type { World } from 'bitecs';
import type { CombatCommandJournal } from './combat_command_envelope.ts';
import { getCombatCommandJournal } from './combat_command_envelope.ts';
import type { PersistedEncounterRetryRecord } from './combat_encounter_retry.ts';
import { captureRetryCheckpoint } from './combat_encounter_retry.ts';
import { peekEncounterRunId } from './combat_run_identity.ts';
import { getLiveV2CombatState } from './combat_v2_state.ts';
import type { WorldObjectState } from './combat_world_object_state.ts';
import { getWorldObjectState } from './combat_world_object_state.ts';

/**
 * A stable, non-eid binding from an authored combatant to the authored content
 * it was spawned from.
 *
 * Restoration must never depend on a raw runtime eid: eids are recycled and
 * differ per world. The authored npc/class ids are what a reload re-binds
 * against.
 */
export type CombatActorBinding = {
  combatantId: string;
  team: string;
  controlMode?: CompanionControlMode;
  /** Content-pack NPC id the actor was spawned from, when authored. */
  authoredNpcId?: string;
  /** Class ids granting the actor's ability list, when authored. */
  authoredClassIds?: string[];
};

/** Everything durable about one running v2 encounter, captured atomically. */
export type CombatSessionCheckpoint = {
  /** Wire version of the nested `CombatState` (migration input). */
  schemaVersion: number;
  /** Kernel rules version the state was produced under. */
  rulesVersion: string;
  encounterId: string;
  encounterRunId: string;
  /** The authoritative state revision. */
  stateRevision: number;
  /** The accepted-command boundary this capture belongs to. */
  sessionRevision: number;
  /** The live kernel state, or `null` between encounters. */
  state: CombatState | null;
  /** The accepted-command journal (replay input + idempotency). */
  journal: CombatCommandJournal | null;
  /**
   * The INITIAL encounter checkpoint: participants, control metadata, authored
   * stats, depth/rules inputs and the opening environmental pair. This is what
   * RETRY restores — never the end-of-fight overlay.
   */
  initialCheckpoint: PersistedEncounterRetryRecord | null;
  /** A pending reaction window, when the encounter is suspended on one. */
  pendingReaction: ReactionWindow | null;
  /** The terminal settlement, when the encounter has settled. */
  settlement: EncounterSettlement | null;
  /** Stable authored actor bindings for restoration. */
  actorBindings: CombatActorBinding[];
  /** The committed world-object block, when authored objects exist. */
  worldObjects: WorldObjectState | null;
};

type SessionState = { revision: number; encounterId: string | null };

const sessions = new WeakMap<World, SessionState>();

const sessionFor = (world: World): SessionState => {
  const existing = sessions.get(world);
  if (existing !== undefined) {
    return existing;
  }
  const created: SessionState = { revision: 0, encounterId: null };
  sessions.set(world, created);
  return created;
};

/** The current accepted-command boundary id for this world. */
export const getCombatSessionRevision = (world: World): number => sessionFor(world).revision;

/** The encounter the current boundary belongs to, or `null`. */
export const getCombatSessionEncounterId = (world: World): string | null =>
  sessionFor(world).encounterId ?? null;

/**
 * Advances the boundary by one for an ACCEPTED transition.
 *
 * Called only from the accepted-transition commit path — a rejected command
 * changes no boundary, so the barrier never reports a change that did not
 * happen.
 */
export const bumpCombatSessionRevision = (world: World, encounterId: string): number => {
  const session = sessionFor(world);
  session.revision += 1;
  session.encounterId = encounterId;
  return session.revision;
};

/**
 * Installs a boundary from a restore.
 *
 * A restored session continues the recorded boundary rather than restarting at
 * zero, so a save taken after the restore is distinguishable from the save that
 * produced it.
 */
export const setCombatSessionRevision = (options: {
  world: World;
  encounterId: string;
  revision: number;
}): void => {
  const session = sessionFor(options.world);
  session.revision = options.revision;
  session.encounterId = options.encounterId;
};

/** Forgets the boundary (encounter teardown / retry / test isolation). */
export const clearCombatSessionRevision = (world: World): void => {
  sessions.delete(world);
};

/** Derives the authored actor bindings from the recorded initial checkpoint. */
const actorBindingsFor = (options: {
  state: CombatState;
  initial: PersistedEncounterRetryRecord | null;
}): CombatActorBinding[] => {
  const authored = new Map(
    (options.initial?.participants ?? []).map((participant) => [
      participant.combatantId,
      participant,
    ]),
  );
  return Object.values(options.state.combatants)
    .map((combatant) => {
      const participant = authored.get(combatant.combatantId);
      return {
        combatantId: combatant.combatantId,
        team: combatant.team,
        ...(combatant.controlMode === undefined ? {} : { controlMode: combatant.controlMode }),
        ...(participant?.npcId === undefined ? {} : { authoredNpcId: participant.npcId }),
        ...(participant?.classIds === undefined ? {} : { authoredClassIds: participant.classIds }),
      } satisfies CombatActorBinding;
    })
    .sort((a, b) => (a.combatantId < b.combatantId ? -1 : 1));
};

/**
 * Builds the atomic checkpoint for this world.
 *
 * `null` when no v2 encounter is running — the caller then omits the block
 * rather than stamping a save as in-combat.
 */
export const buildCombatSessionCheckpoint = (world: World): CombatSessionCheckpoint | null => {
  const state = getLiveV2CombatState(world);
  if (state === null) {
    return null;
  }
  const session = sessionFor(world);
  // The DURABLE checkpoint: `captureRetryCheckpoint` strips the runtime eids,
  // which are meaningless outside the session that allocated them.
  const initial = captureRetryCheckpoint(world);
  const pendingWindow = state.reaction.windows.find((window) => window.status === 'open') ?? null;
  const worldObjects = getWorldObjectState(world);
  return {
    schemaVersion: state.schemaVersion,
    rulesVersion: state.rulesVersion,
    encounterId: state.encounterId,
    encounterRunId: state.encounterRunId,
    stateRevision: state.stateRevision,
    sessionRevision: session.revision,
    state: structuredClone(state),
    journal: getCombatCommandJournal(world, state.encounterId),
    initialCheckpoint: initial,
    pendingReaction: pendingWindow === null ? null : structuredClone(pendingWindow),
    settlement: state.settlement === null ? null : structuredClone(state.settlement),
    actorBindings: actorBindingsFor({ state, initial }),
    worldObjects: worldObjects === undefined ? null : structuredClone(worldObjects),
  };
};

/**
 * Whether the engine's current boundary still equals `sessionRevision`.
 *
 * The read barrier's second half: after capturing the ECS snapshot the client
 * re-reads this. Agreement proves the ECS snapshot and the combat checkpoint
 * describe the same accepted command boundary.
 */
export const combatSessionIsStable = (options: {
  world: World;
  sessionRevision: number;
}): boolean => sessionFor(options.world).revision === options.sessionRevision;

/**
 * The run identity the engine currently has allocated for an encounter.
 *
 * Exposed so a checkpoint can assert that the recorded run identity is the one
 * the engine still holds (a stale run must never be restored over a live one).
 */
export const peekCheckpointRunId = (world: World, encounterId: string): string | null =>
  peekEncounterRunId(world, encounterId);

// ---------------------------------------------------------------------------
// Bridge command + event contract
// ---------------------------------------------------------------------------

/**
 * Asks the engine for one ATOMIC save/checkpoint capture (review F-B).
 *
 * The save path must not read the ECS snapshot, the combat checkpoint and the
 * world-object block as three independent reads: combat can advance between
 * them, producing a save whose parts belong to different command boundaries.
 * This request captures every combat-related durable fact in ONE worker turn
 * and reports the accepted-command boundary it belongs to; the client captures
 * the ECS snapshot and re-reads the boundary until it agrees.
 */
export type CombatSessionCheckpointRequestedCommand = {
  type: 'COMBAT_SESSION_CHECKPOINT_REQUESTED';
  /** Client-minted correlation id — never reused. */
  requestId: string;
};

/**
 * The engine's answer to {@link CombatSessionCheckpointRequestedCommand}.
 *
 * `checkpoint` is `null` when no v2 encounter is running, which is distinct
 * from a timeout: the caller then omits the combat block entirely instead of
 * stamping a save as in-combat.
 */
export type CombatSessionCheckpointReadyEvent = {
  type: 'COMBAT_SESSION_CHECKPOINT_READY';
  requestId: string;
  /** The accepted-command boundary this capture belongs to. */
  sessionRevision: number;
  /** The atomic payload, or `null` between encounters. */
  checkpoint: CombatSessionCheckpoint | null;
  /** World-object persistence outlives the nullable live encounter checkpoint. */
  worldObjects: WorldObjectState | null;
};

/**
 * Asks the engine to re-read only the accepted-command boundary id.
 *
 * The second half of the save read barrier: the client captures the ECS
 * snapshot between two boundary readings and only commits the save when they
 * agree, so all captured data provably belongs to one accepted boundary.
 */
export type CombatSessionRevisionRequestedCommand = {
  type: 'COMBAT_SESSION_REVISION_REQUESTED';
  requestId: string;
};

/** The engine's answer to {@link CombatSessionRevisionRequestedCommand}. */
export type CombatSessionRevisionReadyEvent = {
  type: 'COMBAT_SESSION_REVISION_READY';
  requestId: string;
  sessionRevision: number;
};
