// packages/frontend/engine/src/components/companion.ts
//
// Companion ECS component — identifies recruitable NPCs that can join
// the player's party and participate in combat/follow/formation.
//
// Contract: C-340 Build Party and Companion Gameplay

import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// Component definition — SoA arrays
// ---------------------------------------------------------------------------

export const Companion = {
  /** String handle (npcId) — content pack identifier for this companion. */
  npcId: [] as string[],
  /** Approval score at entity level (mirrors roster data, -100 to 100). */
  approval: [] as number[],
  /** Whether this companion has been recruited vs spawned-but-unrecruited. */
  recruited: [] as boolean[],
  /**
   * Companion control mode (C-526 §12.5).
   *
   * `'direct'` means the PLAYER owns this companion's turn, so the AI turn
   * runner must not consume it. Every other mode leaves the turn AI-driven —
   * a persisted player preference, never a separate rules path.
   */
  controlMode: [] as string[],
};

export type CompanionData = {
  npcId: string;
  approval: number;
  recruited: boolean;
  /** Companion control mode; absent means the AI owns the turn. */
  controlMode?: string;
};

// ---------------------------------------------------------------------------
// Observer registration
// ---------------------------------------------------------------------------

export const registerCompanionObservers = (world: World): void => {
  observe(world, onSet(Companion), (eid: number, params: Partial<CompanionData>) => {
    if (params.npcId !== undefined) {
      Companion.npcId[eid] = params.npcId;
    }
    if (params.approval !== undefined) {
      Companion.approval[eid] = params.approval;
    }
    if (params.recruited !== undefined) {
      Companion.recruited[eid] = params.recruited;
    }
    if (params.controlMode !== undefined) {
      Companion.controlMode[eid] = params.controlMode;
    }
  });

  observe(
    world,
    onGet(Companion),
    (eid: number): CompanionData => ({
      npcId: Companion.npcId[eid] ?? '',
      approval: Companion.approval[eid] ?? 0,
      recruited: Companion.recruited[eid] ?? false,
      controlMode: Companion.controlMode[eid],
    }),
  );
};
