import { BaseFrontendClass, type BaseFrontendClassInterface } from '@aikami/frontend/services'
import { npcRepository } from '@aikami/frontend/repositories/npc.ts'
import type { NpcData } from '@aikami/types'

export type NpcServiceInterface = BaseFrontendClassInterface & {
  /**
   * Retrieves all NPCs.
   * @returns A promise that resolves to an array of all NPC data.
   */
  getAll(): Promise<NpcData[]>

  /**
   * Retrieves a single NPC by its ID.
   * @param npcId The ID of the NPC to retrieve.
   * @returns A promise that resolves to the NPC data, or undefined if not found.
   */
  get(npcId: string): Promise<NpcData | undefined>
}

class NpcService extends BaseFrontendClass implements NpcServiceInterface {
  constructor() {
    super({ className: 'NpcService' })
  }

  async getAll(): Promise<NpcData[]> {
    return await npcRepository.getDocumentsByCollection(undefined)
  }

  async get(npcId: string): Promise<NpcData | undefined> {
    return await npcRepository.getDocument({ npcId })
  }
}

export const npcService: NpcServiceInterface = new NpcService()
