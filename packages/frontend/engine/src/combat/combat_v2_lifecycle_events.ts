// packages/frontend/engine/src/combat/combat_v2_lifecycle_events.ts
//
// `CombatTurnChangedEvent` / `CombatStartedEvent` moved here out of `types.ts`
// (which is on the source-file-size guard's grandfathered baseline). Behaviour
// is identical — the `GameEvent` union composes them by reference — and the
// declarations now live with the rest of the combat bridge vocabulary.
//
// Contract: C-514 AC-4, C-516 AC-5, C-532

import type { CombatEngineKind } from '@aikami/types';

export type CombatTurnChangedEvent = {
      /**
       * Emitted when the turn manager system advances combat to the next entity.
       * The UI (CombatViewModel) listens for this event to update health bars,
       * turn order displays, and status effects.
       */
      type: 'TURN_CHANGED';
      /** The entity ID that now has the active turn. */
      currentEntityId: number;
      /** All entity IDs currently participating in combat (alive + active). */
      activeEntities: number[];
      /**
       * The combat state revision this turn belongs to (C-516). The UI binds
       * its preview requests to the last revision it was told about, so a
       * preview can never answer for a superseded state.
       */
      stateRevision?: number;
      /**
       * Authored combatant id of the active actor, and a per-entity
       * authored-id map for the participants (C-532, review F4).
       *
       * The client needs the AUTHORED id to consult companion control modes
       * (keyed by authored id) and to decide whether the client owns the turn.
       * Inferring it from an eid is exactly the duplication this replaces.
       */
      activeCombatantId?: string;
      /** Every participating entity's authored combatant id, keyed by entity id. */
      combatantIdsByEntity?: Record<string, string>;
      /**
       * The execution run identity this turn belongs to (review F-B).
       *
       * The client binds its command-admission envelope to it, so a command
       * confirmed during one run cannot be admitted after a retry replaced the
       * run — even when the authored encounter id and revision repeat.
       */
      encounterRunId?: string;
      /**
       * The deterministic turn identity this turn belongs to (review F-B).
       *
       * `turnId` distinguishes two turns at the same revision; the engine
       * refuses a command bound to a turn that is no longer active.
       */
      turnId?: string;
    }

export type CombatStartedEvent = {
      /**
       * Emitted when combat is first initialized.
       * Carries the initial turn entity and full participant list.
       */
      type: 'COMBAT_STARTED';
      /** All entity IDs participating in the combat encounter. */
      participantIds: number[];
      /** The entity ID that has the first turn. */
      firstTurnEntityId: number;
      /**
       * Resolver pinned for this encounter (C-516 AC-1). Additive: every
       * pre-existing consumer keeps working when it is absent.
       */
      engine?: CombatEngineKind;
      /**
       * Runtime eid of the PLAYER in this encounter (C-516 AC-5).
       *
       * The world assigns entity ids at spawn time, so the player is not always
       * entity 1 — the UI must learn which participant it controls instead of
       * assuming. Additive: absent means the historical `1`.
       */
      playerEntityId?: number;
      /** The enemy entity ID that triggered the encounter. */
      enemyId?: number;
      /** Display name of the enemy (e.g. "Goblin"). */
      enemyName?: string;
      /** Current hit points of the enemy that triggered the encounter. */
      enemyHp?: number;
      /** Maximum hit points of the enemy that triggered the encounter. */
      enemyMaxHp?: number;
      /** Combat seed for deterministic replay (C-330 AC-1). */
      combatSeed?: number;
      /** Content pack encounter ID (null for ad-hoc encounters). */
      encounterId?: string | null;
      /**
       * Execution-run identity for THIS attempt (review F9).
       *
       * The authored encounter id recurs on retry, so presentation and
       * consequence callbacks bind to this instead. Additive: absent means the
       * legacy engine, which reports none.
       */
      encounterRunId?: string;
      /** Whether non-combat resolution is available. */
      allowNonCombatResolution?: boolean;
      /** Non-combat skill check definition (if allowNonCombatResolution). */
      nonCombatSkillCheck?: {
        skill: string;
        dc: number;
        statModifier: 'strength' | 'dexterity' | 'intelligence' | 'charisma' | 'wisdom';
        successDialogueKey: string;
        failureDialogueKey: string;
      };
    }
