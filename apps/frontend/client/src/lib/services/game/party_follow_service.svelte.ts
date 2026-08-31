// apps/frontend/client/src/lib/services/game/party_follow_service.svelte.ts
//
// Party follow service — drives companion formation movement during
// exploration. Extracted from the C-212 sandbox
// (apps/frontend/client/src/lib/views/dev/sandbox/party_follow/) into a
// production service: reads the active party roster instead of a hardcoded
// NPC list, and resolves companion entity IDs from the live GameWorld
// instead of a dev-only npcMeta cast.
//
// Contract: C-340 Build Party and Companion Gameplay (AC-2)

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { FormationType } from '@aikami/types';
import { gameEngineService, gameOverlayService, partyRosterService } from '$services';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Tick interval for follow velocity updates (ms). C-212 baseline. */
const FOLLOW_TICK_MS = 150;

/** Follower speed in px/s. */
const FOLLOW_SPEED = 80;

/** Spacing between formation slots, in pixels. */
const SLOT_SPACING = 32;

/** Base offsets for the first three 'line' formation slots (C-212 default). */
const LINE_BASE_OFFSETS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: -40, dy: 0 },
  { dx: -56, dy: -24 },
  { dx: -56, dy: 24 },
];

/**
 * Computes the formation offset (relative to the player) for a companion
 * at the given roster index. Companions beyond the base slot count form
 * additional rows further behind the player at the same stagger pattern.
 */
const getFormationOffset = (
  formation: FormationType,
  index: number,
): { dx: number; dy: number } => {
  if (formation === 'column') {
    // Tight single file directly behind the player.
    return { dx: -SLOT_SPACING - index * SLOT_SPACING, dy: 0 };
  }

  if (formation === 'spread') {
    // Fan out behind the player, alternating left/right per row.
    const row = Math.floor(index / 2);
    const side = index % 2 === 0 ? -1 : 1;
    return {
      dx: -SLOT_SPACING - row * SLOT_SPACING,
      dy: side * (SLOT_SPACING + row * 16),
    };
  }

  // 'line' (default) — staggered column behind the player.
  const base = LINE_BASE_OFFSETS[index % LINE_BASE_OFFSETS.length] ?? { dx: -40, dy: 0 };
  const rowDepth = Math.floor(index / LINE_BASE_OFFSETS.length) * SLOT_SPACING;
  return { dx: base.dx - rowDepth, dy: base.dy };
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PartyFollowServiceOptions = BaseFrontendClassOptions;

export type PartyFollowServiceInterface = BaseFrontendClassInterface & {
  /** Whether the follow tick is currently running. */
  readonly isRunning: boolean;

  /** Starts the follow tick loop. Idempotent — safe to call repeatedly. */
  start(): void;

  /** Stops the follow tick loop and zeroes any in-flight companion velocity. */
  stop(): void;

  /**
   * Re-applies the `recruited` flag to companion entities on the newly
   * loaded map for every active roster member found there. Content packs
   * that place the same companion spawn point on multiple maps would
   * otherwise reset to `recruited: false` on each load.
   */
  onMapLoaded(): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class PartyFollowService
  extends BaseFrontendClass<PartyFollowServiceOptions>
  implements PartyFollowServiceInterface
{
  isRunning = $state<boolean>(false);

  private _tickInterval: ReturnType<typeof setInterval> | undefined;
  private _lastPlayerX = 0;
  private _lastPlayerY = 0;
  private _lastKnownEids = new Map<string, number>();

  /** @inheritdoc */
  start(): void {
    if (this._tickInterval) {
      return;
    }
    const initialPos = gameEngineService.getPlayerPosition();
    this._lastPlayerX = initialPos?.x ?? 0;
    this._lastPlayerY = initialPos?.y ?? 0;

    this._tickInterval = setInterval(() => {
      this._tick();
    }, FOLLOW_TICK_MS);
    this.isRunning = true;
    this.debug('start');
  }

  /** @inheritdoc */
  stop(): void {
    if (this._tickInterval) {
      clearInterval(this._tickInterval);
      this._tickInterval = undefined;
    }
    this.isRunning = false;
    this._zeroAllCompanionVelocity();
    this.debug('stop');
  }

  /** @inheritdoc */
  onMapLoaded(): void {
    this._lastKnownEids.clear();

    for (const member of partyRosterService.members) {
      const entityId = gameEngineService.getEntityIdForNpc(member.npcId);
      if (entityId === undefined) {
        // Companion has no spawn point on this map — they simply don't
        // appear until the player returns to a map where they're placed.
        continue;
      }
      this._lastKnownEids.set(member.npcId, entityId);
      gameEngineService.sendCommand({
        type: 'SET_COMPANION_RECRUITED',
        entityId,
        recruited: true,
      });
    }
    this.debug('onMapLoaded', { resolvedCount: this._lastKnownEids.size });
  }

  override async dispose(): Promise<void> {
    this.stop();
    await super.dispose();
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * On each tick, sends SET_ENTITY_VELOCITY for every active party member
   * whose entity is resolvable on the current map. Paused (skipped) while
   * any overlay is open — dialogue and combat handle companion positioning
   * themselves (C-338 combat staging).
   *
   * Velocity is derived from the player's movement direction since the last
   * tick, plus a small pull toward the companion's formation offset — the
   * same approach as the C-212 sandbox. The worker's movement_system
   * applies collision detection, so followers slide along walls.
   */
  private _tick(): void {
    if (gameOverlayService.activeOverlay !== 'NONE') {
      return;
    }

    const playerPos = gameEngineService.getPlayerPosition();
    if (!playerPos) {
      return;
    }

    const members = partyRosterService.members;
    if (members.length === 0) {
      this._lastPlayerX = playerPos.x;
      this._lastPlayerY = playerPos.y;
      return;
    }

    const pdx = playerPos.x - this._lastPlayerX;
    const pdy = playerPos.y - this._lastPlayerY;
    this._lastPlayerX = playerPos.x;
    this._lastPlayerY = playerPos.y;

    let vx = 0;
    if (pdx > 0) {
      vx = FOLLOW_SPEED;
    } else if (pdx < 0) {
      vx = -FOLLOW_SPEED;
    }
    let vy = 0;
    if (pdy > 0) {
      vy = FOLLOW_SPEED;
    } else if (pdy < 0) {
      vy = -FOLLOW_SPEED;
    }

    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      const entityId =
        this._lastKnownEids.get(member.npcId) ?? gameEngineService.getEntityIdForNpc(member.npcId);
      if (entityId === undefined) {
        continue;
      }
      this._lastKnownEids.set(member.npcId, entityId);

      const offset = getFormationOffset(partyRosterService.formation, i);
      const targetX = playerPos.x + offset.dx;
      const targetY = playerPos.y + offset.dy;
      const odx = targetX - playerPos.x;
      const ody = targetY - playerPos.y;
      const oDist = Math.sqrt(odx * odx + ody * ody);

      let mvx = vx;
      let mvy = vy;
      if (oDist > 1) {
        mvx += (odx / oDist) * FOLLOW_SPEED * 0.3;
        mvy += (ody / oDist) * FOLLOW_SPEED * 0.3;
      }

      gameEngineService.sendCommand({
        type: 'SET_ENTITY_VELOCITY',
        entityId,
        velocity: { x: mvx, y: mvy },
      });
    }
  }

  private _zeroAllCompanionVelocity(): void {
    for (const eid of this._lastKnownEids.values()) {
      gameEngineService.sendCommand({
        type: 'SET_ENTITY_VELOCITY',
        entityId: eid,
        velocity: { x: 0, y: 0 },
      });
    }
  }
}

export const partyFollowService: PartyFollowServiceInterface = PartyFollowService.create({
  className: 'PartyFollowService',
});
