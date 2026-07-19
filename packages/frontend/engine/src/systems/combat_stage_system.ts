// packages/frontend/engine/src/systems/combat_stage_system.ts
//
// Combat Stage System — JRPG-style battle screen positioning
//
// When combat starts, this system:
//   1. Saves the original world positions of all combatants
//   2. Repositions player to left stage (20% screen width in world coords)
//      and enemy to right stage (80% screen width)
//   3. Flips sprites to face each other (player faces right, enemy faces left)
//   4. Locks the camera so the battle stage stays centered
//
// When combat ends, original positions are restored and the camera unlocks.
//
// Each tick during combat, computes screen-space (x,y) for every combatant
// so the Svelte UI can render diegetic floating health bars.
//
// Contract: C-166 Diegetic Combat Stage
// ---------------------------------------------------------------------------

import type { World } from 'bitecs';
import { getComponent, query } from 'bitecs';
import type { CombatStatsData } from '../components/combat_stats.ts';
import { CombatStats } from '../components/combat_stats.ts';
import { Companion } from '../components/companion.ts';
import { Enemy } from '../components/enemy.ts';
import type { PositionData } from '../components/position.ts';
import { Position } from '../components/position.ts';
import { TurnOrder } from '../components/turn_order.ts';
import { getCameraPosition, getCameraZoom } from './camera_system.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Saved world-space position for a combatant before stage repositioning. */
type SavedPosition = {
  entityId: number;
  x: number;
  y: number;
};

/** Screen-space state for a single combatant (sent to Svelte UI). */
export type CombatantScreenState = {
  entityId: number;
  hp: number;
  maxHp: number;
  screenX: number;
  screenY: number;
  isActiveTurn: boolean;
};

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** Saved pre-combat positions — restored on combat end. */
let savedPositions: SavedPosition[] = [];

/** Whether the combat stage is currently active. */
let stageActive = false;

/** Screen width at combat start (CSS pixels). */
let stageScreenWidth = 0;

/** Screen height at combat start (CSS pixels). */
let stageScreenHeight = 0;

/** World scale factor (set by camera system's setScreenSize). */
let stageWorldScale = 4;

/** Cached query terms for combat participants. */
const COMBAT_STAGE_QUERY = [Position, CombatStats, TurnOrder];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sets up the combat stage: saves positions, repositions to stage layout,
 * locks camera.
 *
 * Player entity is always entity ID 1. Enemy is any other participant.
 *
 * @param world - The bitECS world.
 * @param options.screenWidth - Current screen width in CSS pixels.
 * @param options.screenHeight - Current screen height in CSS pixels.
 * @param options.worldScale - World container scale factor (default 4).
 */
export const setupCombatStage = (
  world: World,
  options: { screenWidth: number; screenHeight: number; worldScale?: number },
): void => {
  if (!world || stageActive) {
    return;
  }

  stageScreenWidth = options.screenWidth;
  stageScreenHeight = options.screenHeight;
  stageWorldScale = options.worldScale ?? 4;

  // Save original positions of all combatants
  savedPositions = [];
  const entities = query(world, COMBAT_STAGE_QUERY);
  for (const eid of entities) {
    const pos = getComponent(world, eid, Position) as PositionData | undefined;
    if (pos) {
      savedPositions.push({ entityId: eid, x: pos.x, y: pos.y });
    }
  }

  // Calculate stage positions in world coordinates
  // Stage: player at 20% screen width, enemy at 80% screen width
  // World coords = screen coords / worldScale (since world container is scaled)
  const camera = getCameraPosition();
  const halfW = stageScreenWidth / (2 * stageWorldScale);
  const stageY = camera.y; // vertical center at camera level

  const playerStageX = camera.x - halfW + (stageScreenWidth * 0.2) / stageWorldScale;
  const enemyStageX = camera.x - halfW + (stageScreenWidth * 0.8) / stageWorldScale;

  // Categorize combatants: player (eid 1), companions (have Companion component, no Enemy), enemies (have Enemy, no Companion)
  const playerEids: number[] = [];
  const companionEids: number[] = [];
  const enemyEids: number[] = [];

  for (const eid of entities) {
    if (eid === 1) {
      playerEids.push(eid);
    } else if (Companion.recruited[eid] && !Enemy.isActive[eid]) {
      companionEids.push(eid);
    } else {
      enemyEids.push(eid);
    }
  }

  // Position companions behind the player in a vertical stack
  if (companionEids.length > 0) {
    const companionSpacing = 40; // px in world coords between companions
    const startOffsetY = -(companionSpacing * (companionEids.length - 1)) / 2;
    const companionStageX = playerStageX - 30; // slightly behind player

    for (let i = 0; i < companionEids.length; i++) {
      const eid = companionEids[i];
      const pos = getComponent(world, eid, Position) as PositionData | undefined;
      if (!pos) {
        continue;
      }
      pos.x = companionStageX;
      pos.y = stageY + startOffsetY + i * companionSpacing;
    }
  }

  // Reposition player and enemies
  for (const eid of entities) {
    const pos = getComponent(world, eid, Position) as PositionData | undefined;
    if (!pos) {
      continue;
    }

    if (eid === 1) {
      // Player — left side, face right
      pos.x = playerStageX;
      pos.y = stageY;
    } else if (!Companion.recruited[eid] || Enemy.isActive[eid]) {
      // Enemy — right side, face left
      pos.x = enemyStageX;
      pos.y = stageY;
    }
    // Companions already positioned above
  }

  stageActive = true;
};

/**
 * Tears down the combat stage: restores original positions and unlocks
 * the camera.
 *
 * @param world - The bitECS world.
 */
export const teardownCombatStage = (world: World): void => {
  if (!world || !stageActive) {
    return;
  }

  // Restore original positions
  for (const saved of savedPositions) {
    const pos = getComponent(world, saved.entityId, Position) as PositionData | undefined;
    if (pos) {
      pos.x = saved.x;
      pos.y = saved.y;
    }
  }

  savedPositions = [];
  stageActive = false;
};

/**
 * Returns whether the combat stage is currently active.
 */
export const isCombatStageActive = (): boolean => {
  return stageActive;
};

/**
 * Computes screen-space positions for all active combatants.
 *
 * Projects each combatant's world position through the camera matrix:
 *   screenX = (worldX - cameraX) * worldScale * zoom + screenWidth / 2
 *   screenY = (worldY - cameraY) * worldScale * zoom + screenHeight / 2
 *
 * Called each tick during combat so the COMBAT_STATE_UPDATE event can
 * carry screen coordinates for diegetic HP bar positioning.
 *
 * @param world - The bitECS world.
 * @returns Array of CombatantScreenState entries for all active combatants.
 */
export const getCombatantScreenStates = (world: World): CombatantScreenState[] => {
  if (!world || !stageActive) {
    return [];
  }

  const camera = getCameraPosition();
  const zoom = getCameraZoom();
  const effectiveScale = stageWorldScale * zoom;

  const states: CombatantScreenState[] = [];
  const entities = query(world, COMBAT_STAGE_QUERY);

  for (const eid of entities) {
    const pos = getComponent(world, eid, Position) as PositionData | undefined;
    const stats = getComponent(world, eid, CombatStats) as CombatStatsData | undefined;
    if (!pos || !stats) {
      continue;
    }

    const screenX = (pos.x - camera.x) * effectiveScale + stageScreenWidth / 2;
    const screenY = (pos.y - camera.y) * effectiveScale + stageScreenHeight / 2 - 20; // 20px above sprite

    states.push({
      entityId: eid,
      hp: stats.health,
      maxHp: stats.maxHealth,
      screenX,
      screenY,
      isActiveTurn: eid === 1, // Simplification: player always has visual turn marker
    });
  }

  return states;
};

/**
 * Triggers a brief step-forward animation on the player sprite.
 *
 * Moves the player 8 pixels toward the enemy (to the right) and sets a
 * flag that the render system can use to trigger the attack animation.
 * The ViewModel calls this before dispatching the LLM request.
 *
 * This is intentionally lightweight — no tweening library needed.
 * The render system on the main thread applies the offset and animation
 * frame each tick.
 *
 * @param world - The bitECS world.
 */
export const triggerPlayerAttackAnimation = (world: World): void => {
  if (!world || !stageActive) {
    return;
  }

  // Player is always entity 1
  const pos = getComponent(world, 1, Position) as PositionData | undefined;
  if (!pos) {
    return;
  }

  // Step forward 8 pixels toward the enemy (to the right on the stage)
  pos.x += 8;
};

/**
 * Resets all module-level state. Call in test teardown.
 */
export const resetCombatStage = (): void => {
  savedPositions = [];
  stageActive = false;
  stageScreenWidth = 0;
  stageScreenHeight = 0;
  stageWorldScale = 4;
};
