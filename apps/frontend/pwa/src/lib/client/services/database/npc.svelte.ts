import { npcRepository } from '@aikami/frontend/repositories/npc.ts';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/index.ts';
import type { NpcData } from '@aikami/types/index.ts';

export type NpcServiceOptions = BaseFrontendClassOptions;

export type NpcServiceInterface = BaseFrontendClassInterface & {
  /**
   * Retrieves all NPCs.
   * @returns A promise that resolves to an array of all NPC data.
   */
  getAll(): Promise<NpcData[]>;

  /**
   * Retrieves a single NPC by its ID.
   * @param npcId The ID of the NPC to retrieve.
   * @returns A promise that resolves to the NPC data, or undefined if not found.
   */
  get(npcId: string): Promise<NpcData | undefined>;
};

class NpcService extends BaseFrontendClass<NpcServiceOptions> implements NpcServiceInterface {
  async getAll(): Promise<NpcData[]> {
    return await npcRepository.getDocumentsByCollection(undefined);
  }

  async get(npcId: string): Promise<NpcData | undefined> {
    return await npcRepository.getDocument({ npcId });
  }
}

export const npcService: NpcServiceInterface = new NpcService({
  className: 'NpcService',
});
