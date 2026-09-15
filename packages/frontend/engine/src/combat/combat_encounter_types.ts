// packages/frontend/engine/src/combat/combat_encounter_types.ts
//
// Payload shapes for one encounter start (Combat-04, C-526).
//
// Split out of `combat_encounter_start.ts` so the formation solver and the
// spawner can share the payload without importing the orchestrator back — a
// type-only cycle would work, but a dedicated type module keeps the dependency
// direction one-way and reviewable.
//
// Contract: C-516 AC-1, AC-2; C-526 AC-6, AC-8

import type { CombatEngineKind, CompanionControlMode } from '@aikami/types';
import type { CombatDecisionPolicy } from './combat_ai_perception.ts';
import type { EncounterEnvironment } from './combat_encounter_environment.ts';

/**
 * The pinned environmental pair one encounter runs against (C-531).
 *
 * Re-exported from its owning module so the roster payload and the per-world
 * store can never drift into two shapes.
 */
export type { EncounterEnvironment } from './combat_encounter_environment.ts';

/** Team a participant fights for — mirrors the kernel's `CombatTeam`. */
export type EncounterParticipantTeam = 'player' | 'ally' | 'enemy';

/** Authored combat stats for one participant (adapter-mapped at spawn). */
export type EncounterParticipantStats = {
  hitPoints: number;
  armorClass: number;
  attackBonus: number;
  initiative: number;
  /** Optional per-turn movement allowance; omitted keeps the driver default. */
  movementPerTurn?: number;
};

/** One authored combatant in an encounter roster. */
export type CombatEncounterParticipant = {
  /** Stable authored combatant id — never a runtime eid. */
  combatantId: string;
  team: EncounterParticipantTeam;
  /**
   * Authored grid cell on the battle map.
   *
   * Optional: a main-thread caller that does not know the map layout (the
   * dialogue chip authors stats, not cells) omits it and the engine places the
   * combatant with its deterministic formation rule.
   */
  cell?: { x: number; y: number };
  /**
   * Authored combat stats.
   *
   * Optional for the PLAYER slot: the engine keeps the live player entity's own
   * `CombatStats` (save/class/progression authority) and only attaches the
   * combat components. Enemy and ally slots must carry them.
   */
  stats?: EncounterParticipantStats;
  /** Content-pack NPC id (ally/enemy), used for the `Companion`/`Enemy` tags. */
  npcId?: string;
  /** Display name shown in the sidebar. */
  displayName?: string;
  /** Class ids granting this combatant its ability list. */
  classIds?: string[];
  /** Explicit ability grants; wins over `classIds` when present. */
  abilityIds?: string[];
  /**
   * Reuse this existing runtime entity instead of spawning one.
   *
   * The collision funnel derives its roster from entities the map already
   * spawned, so it must never spawn a second copy of the same enemy.
   */
  reuseEntityId?: number;
  /**
   * Authored character policy for this participant (C-526 AC-8).
   *
   * Personality, role, relationships, fears, risk tolerance and obedience are
   * CONTENT, not kernel state, so they travel with the roster and are pinned
   * onto the encounter's AI coordinator. Absent ⇒ the perception snapshot's
   * neutral defaults apply. Never consulted by the rules kernel.
   */
  policy?: CombatDecisionPolicy;
  /**
   * Projected character-sheet check modifiers, keyed by registered source
   * (an ability key such as `strength` or a skill id such as `athletics`)
   * (C-531 AC-2).
   *
   * The sheet lives on the main thread, so the resolved modifiers travel with
   * the roster and are pinned into the encounter snapshot. Absent ⇒ every
   * check naming a missing source is refused `checkModifierUnavailable`
   * rather than silently rolled unmodified.
   */
  checkModifiers?: Record<string, number>;
  /**
   * Companion control mode (C-526 §12.5) for an `ally` participant.
   *
   * `'direct'` hands the turn to the player; every other mode keeps it
   * AI-driven. Absent ⇒ AI-driven, which is the pre-526 behaviour.
   */
  controlMode?: CompanionControlMode;
};

/** Everything the engine needs to start one encounter. */
export type CombatEncounterRoster = {
  encounterId: string;
  seed: number;
  engine: CombatEngineKind;
  /** Authored participants; a missing cell is solved by the engine. */
  participants: CombatEncounterParticipant[];
  allowNonCombatResolution?: boolean;
  /**
   * Authored battlefield objects and their pinned definition bundle (C-531).
   *
   * Omitted by an encounter that authors no environmental objects, which keeps
   * the empty-environment behaviour of every pre-531 encounter unchanged.
   */
  environment?: EncounterEnvironment;
};

/**
 * What a main-thread caller sends with an encounter start: the authored
 * participants plus their pinned battlefield objects (C-531).
 *
 * The identity (`encounterId`), the seed and the engine are supplied by the
 * start path, so the payload carries only what the content pack owns.
 */
export type EncounterRosterPayload = Pick<CombatEncounterRoster, 'participants' | 'environment'>;

/** A participant whose grid cell is known — the only shape that may spawn. */
export type SolvedEncounterParticipant = CombatEncounterParticipant & {
  cell: { x: number; y: number };
};
