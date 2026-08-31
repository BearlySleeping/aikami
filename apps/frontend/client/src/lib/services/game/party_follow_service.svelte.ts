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

import { BaseFrontendClass } from '@aikami/frontend/services';
import { gameEngineService, partyRosterService } from '$services';
import type { PartyFollowServiceInterface, PartyFollowServiceOptions } from '$types';

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
