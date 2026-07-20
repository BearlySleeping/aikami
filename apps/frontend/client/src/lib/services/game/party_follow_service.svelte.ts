// apps/frontend/client/src/lib/services/game/party_follow_service.svelte.ts
//
// Party follow service — formation-based companion following via
// SET_ENTITY_VELOCITY bridge commands. Extracted from the C-212
// party-follow sandbox and adapted for production use.
//
// Contract: C-340 Build Party and Companion Gameplay (AC-2)

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { FormationType } from '@aikami/types';
import { partyRosterService } from './party_roster_service.svelte';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PartyFollowServiceOptions = BaseFrontendClassOptions;

export type PartyFollowServiceInterface = BaseFrontendClassInterface & {
  /** Whether the follow tick is running. */
  readonly isActive: boolean;

  /** Current player position (read from engine bridge). */
  readonly playerX: number;
  readonly playerY: number;

  /**
   * Configures the follow service with engine bridge access.
   * Must be called before start().
   */
  configure(options: {
    sendCommand: (command: {
      type: string;
      entityId: number;
      velocity: { x: number; y: number };
    }) => void;
    getNpcEntityId: (npcId: string) => number | undefined;
  }): void;

  /** Starts the follow tick loop. */
  start(): void;

  /** Stops the follow tick loop and zeros all companion velocities. */
  stop(): void;

  /** Pauses the follow tick (e.g. during combat, dialogue). */
  pause(): void;

  /** Resumes the follow tick. */
  resume(): void;

  /** Sets the current player position from a bridge event. */
  setPlayerPosition(x: number, y: number): void;

  /** Updates the formation type. */
  setFormation(formation: FormationType): void;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Tick interval for velocity updates (ms). Matches C-212 sandbox baseline. */
const FOLLOW_TICK_MS = 150;

/** Follower speed in px/s. */
const FOLLOW_SPEED = 80;

/** Formation offsets behind the player for each follower slot. */
const FORMATION_OFFSETS: Record<FormationType, Array<{ dx: number; dy: number }>> = {
  line: [
    { dx: -40, dy: 0 },
    { dx: -56, dy: -24 },
    { dx: -56, dy: 24 },
    { dx: -72, dy: -48 },
    { dx: -72, dy: 48 },
  ],
  column: [
    { dx: -40, dy: 0 },
    { dx: -60, dy: 0 },
    { dx: -80, dy: 0 },
    { dx: -100, dy: 0 },
    { dx: -120, dy: 0 },
  ],
  spread: [
    { dx: -40, dy: -32 },
    { dx: -40, dy: 32 },
    { dx: -60, dy: -48 },
    { dx: -60, dy: 48 },
    { dx: -80, dy: 0 },
  ],
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class PartyFollowService
  extends BaseFrontendClass<PartyFollowServiceOptions>
  implements PartyFollowServiceInterface
{
  _running = $state<boolean>(false);
  playerX = $state<number>(0);
  playerY = $state<number>(0);

  private _paused = false;
  private _sendCommand:
    | ((command: { type: string; entityId: number; velocity: { x: number; y: number } }) => void)
    | undefined;
  private _getNpcEntityId: ((npcId: string) => number | undefined) | undefined;
  private _followInterval: ReturnType<typeof setInterval> | undefined;

  /** Previous frame player position for velocity direction tracking. */
  private _lastPlayerX = 0;
  private _lastPlayerY = 0;

  get isActive(): boolean {
    return this._followInterval !== undefined && !this._paused;
  }

  /** @inheritdoc */
  configure(options: {
    sendCommand: (command: {
      type: string;
      entityId: number;
      velocity: { x: number; y: number };
    }) => void;
    getNpcEntityId: (npcId: string) => number | undefined;
    /** Optional bridge for PLAYER_POSITION_CHANGED events. */
    bridge?: {
      on: (event: string, handler: (data: { x: number; y: number }) => void) => void;
    };
  }): void {
    this._sendCommand = options.sendCommand;
    this._getNpcEntityId = options.getNpcEntityId;

    // C-340: Listen for player position updates from engine bridge
    if (options.bridge) {
      options.bridge.on('PLAYER_POSITION_CHANGED', (event: { x: number; y: number }) => {
        this.setPlayerPosition(event.x, event.y);
      });
    }
  }

  /** @inheritdoc */
  start(): void {
    if (this._followInterval) {
      return;
    }

    this._followInterval = setInterval(() => {
      void this._tickFollowVelocities();
    }, FOLLOW_TICK_MS);

    this.debug('follow:started', { intervalMs: FOLLOW_TICK_MS });
  }

  /** @inheritdoc */
  stop(): void {
    this._stopTick();
    this.debug('follow:stopped');
  }

  /** @inheritdoc */
  pause(): void {
    this._paused = true;
    // Zero all companion velocities when pausing
    this._zeroAllVelocities();
    this.debug('follow:paused');
  }

  /** @inheritdoc */
  resume(): void {
    this._paused = false;
    this.debug('follow:resumed');
  }

  /** @inheritdoc */
  setPlayerPosition(x: number, y: number): void {
    this._lastPlayerX = this.playerX;
    this._lastPlayerY = this.playerY;
    this.playerX = x;
    this.playerY = y;
  }

  /** @inheritdoc */
  setFormation(formation: FormationType): void {
    partyRosterService.formation = formation;
    this.debug('follow:formation-changed', { formation });
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private _stopTick(): void {
    if (this._followInterval) {
      clearInterval(this._followInterval);
      this._followInterval = undefined;
    }
    this._zeroAllVelocities();
  }

  /** Zeros velocity for all active companions. */
  private _zeroAllVelocities(): void {
    const sendCommand = this._sendCommand;
    const getNpcEntityId = this._getNpcEntityId;
    if (!sendCommand || !getNpcEntityId) {
      return;
    }

    for (const member of partyRosterService.members) {
      const eid = getNpcEntityId(member.npcId);
      if (eid !== undefined && eid > 0) {
        sendCommand({
          type: 'SET_ENTITY_VELOCITY',
          entityId: eid,
          velocity: { x: 0, y: 0 },
        });
      }
    }
  }

  /**
   * On each tick, computes formation-based velocities for active companions
   * and dispatches SET_ENTITY_VELOCITY bridge commands.
   */
  private _tickFollowVelocities(): void {
    if (this._paused) {
      return;
    }

    const sendCommand = this._sendCommand;
    const getNpcEntityId = this._getNpcEntityId;
    if (!sendCommand || !getNpcEntityId) {
      return;
    }

    const members = partyRosterService.members;
    if (members.length === 0) {
      return;
    }

    const formation = partyRosterService.formation;
    const offsets = FORMATION_OFFSETS[formation] ?? FORMATION_OFFSETS.line;

    // Compute player movement delta since last tick
    const pdx = this.playerX - this._lastPlayerX;
    const pdy = this.playerY - this._lastPlayerY;

    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      if (!member) {
        continue;
      }

      const eid = getNpcEntityId(member.npcId);
      if (eid === undefined || eid <= 0) {
        continue;
      }

      const offset = offsets[i] ?? offsets[offsets.length - 1] ?? { dx: -40, dy: 0 };

      // Base velocity: mirror the player's movement direction
      let vx = 0;
      let vy = 0;

      if (pdx > 0) {
        vx = FOLLOW_SPEED;
      } else if (pdx < 0) {
        vx = -FOLLOW_SPEED;
      }

      if (pdy > 0) {
        vy = FOLLOW_SPEED;
      } else if (pdy < 0) {
        vy = -FOLLOW_SPEED;
      }

      // Add formation offset correction — followers spread out
      const targetX = this.playerX + offset.dx;
      const targetY = this.playerY + offset.dy;
      const odx = targetX - this.playerX;
      const ody = targetY - this.playerY;

      // Avoid Math.sqrt for perf; use squared distance
      const oDistSq = odx * odx + ody * ody;
      if (oDistSq > 1) {
        const oDist = Math.sqrt(oDistSq);
        vx += (odx / oDist) * FOLLOW_SPEED * 0.3;
        vy += (ody / oDist) * FOLLOW_SPEED * 0.3;
      }

      sendCommand({
        type: 'SET_ENTITY_VELOCITY',
        entityId: eid,
        velocity: { x: vx, y: vy },
      });
    }
  }
}

export const partyFollowService: PartyFollowServiceInterface = PartyFollowService.create({
  className: 'PartyFollowService',
});
