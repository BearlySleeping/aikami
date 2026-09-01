// apps/frontend/client/src/lib/services/game/party_follow_service.svelte.ts
//
// Party follow service — synchronizes recruited companions with the ECS
// movement system. Extracted from the C-212 sandbox
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
import { gameEngineService } from './game_engine_service.svelte';
import { partyRosterService } from './party_roster_service.svelte.ts';

/** Construction options for the party-follow lifecycle service. */
export type PartyFollowServiceOptions = BaseFrontendClassOptions;

/** Client lifecycle contract for synchronizing party membership with the engine. */
export type PartyFollowServiceInterface = BaseFrontendClassInterface & {
  /** Whether party-follow synchronization is active. */
  readonly isRunning: boolean;
  /** Enables party-follow synchronization. */
  start(): void;
  /** Disables party-follow synchronization. */
  stop(): void;
  /** Re-applies recruited party members after a map load. */
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

  private _lastKnownEids = new Map<string, number>();

  /** @inheritdoc */
  start(): void {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    this.debug('start');
  }

  /** @inheritdoc */
  stop(): void {
    this.isRunning = false;
    this.debug('stop');
  }

  /** @inheritdoc */
  onMapLoaded(): void {
    if (!this.isRunning) {
      return;
    }

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
}

export const partyFollowService: PartyFollowServiceInterface = PartyFollowService.create({
  className: 'PartyFollowService',
});
