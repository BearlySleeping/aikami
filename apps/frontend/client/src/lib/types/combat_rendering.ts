// apps/frontend/client/src/lib/types/combat_rendering.ts
//
// Client-local types for combat screen-space rendering (PixiJS canvas overlay).

/** Screen-space state for a combatant — used by diegetic health bars (C-166). */
export type CombatantScreenState = {
  readonly entityId: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly screenX: number;
  readonly screenY: number;
  readonly isActiveTurn: boolean;
};

/** Floating damage/healing text instance rendered over the game canvas. */
export type FloatingTextInstance = {
  readonly id: number;
  readonly amount: number;
  readonly x: number;
  readonly y: number;
  readonly isCritical: boolean;
};
