// apps/frontend/client/src/lib/services/npc/npc_awareness_service.svelte.ts
//
// NPC awareness service — resolves NPC IDs from the current scene/location
// into structured context data for GM prompt assembly and multi-NPC turn
// generation. Reads from worldStateService.currentLocation.npcIds and
// npcService to hydrate NPC details.
//
// Contract: C-456 Group Chat & Systemic NPC Interactions (AC-2)

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { GmNpcContext } from '../gm/gm_types';
// Direct imports to avoid barrel circular dependency — see gm_prompt_service.svelte.ts
import { npcService } from './npc_service.svelte.ts';
import { partyRosterService } from '../game/party_roster_service.svelte.ts';
import { worldStateService } from '../game/world_state_service.svelte.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Construction options for the NPC awareness service singleton. */
export type NpcAwarenessServiceOptions = BaseFrontendClassOptions;

/** Public contract for resolving nearby NPC identities and prompt context. */
export type NpcAwarenessServiceInterface = BaseFrontendClassInterface & {
  /**
   * Returns NPC IDs present in the current scene/location.
   * Reads from worldStateService.currentLocation.npcIds.
   */
  readonly nearbyNpcIds: readonly string[];

  /**
   * Returns structured context for NPCs present in the current scene,
   * excluding any NPC that is already a party member (dedup by npcId).
   * Falls back to empty array when location or NPC data is unavailable.
   */
  getNearbyNpcContext(): Promise<readonly GmNpcContext[]>;

  /**
   * Returns the personality description for a given NPC ID.
   * Resolves from npcService data, falling back to a generic description.
   */
  getNpcPersonality(npcId: string): Promise<string>;

  /**
   * Returns the NPC display name for a given NPC ID.
   */
  getNpcName(npcId: string): Promise<string>;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class NpcAwarenessService
  extends BaseFrontendClass<NpcAwarenessServiceOptions>
  implements NpcAwarenessServiceInterface
{
  get nearbyNpcIds(): readonly string[] {
    const location = worldStateService.currentLocation;
    if (!location?.npcIds || location.npcIds.length === 0) {
      return [];
    }
    return location.npcIds;
  }

  /** @inheritdoc */
  async getNearbyNpcContext(): Promise<readonly GmNpcContext[]> {
    const npcIds = this.nearbyNpcIds;
    if (npcIds.length === 0) {
      return [];
    }

    // Build a set of party member NPC IDs for dedup
    const partyNpcIds = new Set(partyRosterService.members.map((m) => m.npcId));

    const results: GmNpcContext[] = [];

    for (const npcId of npcIds) {
      // Skip party members — they appear in the [PARTY MEMBERS] section
      if (partyNpcIds.has(npcId)) {
        continue;
      }

      try {
        const npc = await npcService.get({ npcId });
        if (!npc) {
          continue;
        }

        results.push({
          id: npc.id,
          name: npc.name ?? npcId,
          persona: npc.personality ?? npc.notes ?? 'Unknown',
          relationship: npc.faction ?? 'Unknown',
          currentActivity: npc.occupation ?? 'Present',
        });
      } catch {
        // Skip NPCs that fail to load — degrade gracefully
        this.debug('getNearbyNpcContext:failed-to-load', { npcId });
      }
    }

    return results;
  }

  /** @inheritdoc */
  async getNpcPersonality(npcId: string): Promise<string> {
    try {
      const npc = await npcService.get({ npcId });
      if (npc?.personality) {
        return npc.personality;
      }
      if (npc?.notes) {
        return npc.notes;
      }
    } catch {
      // Fall through to default
    }
    return 'Unknown';
  }

  /** @inheritdoc */
  async getNpcName(npcId: string): Promise<string> {
    try {
      const npc = await npcService.get({ npcId });
      if (npc?.name) {
        return npc.name;
      }
    } catch {
      // Fall through
    }
    return npcId;
  }
}

export const npcAwarenessService: NpcAwarenessServiceInterface =
  NpcAwarenessService.create({
    className: 'NpcAwarenessService',
  }) as NpcAwarenessServiceInterface;
