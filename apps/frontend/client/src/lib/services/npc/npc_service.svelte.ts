// apps/frontend/client/src/lib/services/npc/npc_service.svelte.ts
//
// NPC service — local-first. Reads and writes NPCs through the local SQLite
// repository (npc_storage). Avatar upload keeps using Firebase Storage
// (unchanged — Storage is out of scope for the Firestore removal).
//
// Contract: C-386b — Firestore Removal, NPCs local-first.

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { NpcCreateData, NpcData } from '@aikami/types';
import { toAppError } from '@aikami/utils';
import { authService, chatStorage, storageService } from '$services';
import { downloadFromUrl } from '../character/character_downloader.ts';
import { importFromJson, importFromPng } from '../character/character_importer.ts';
import { npcStorage } from './npc_storage.svelte.ts';

export type NpcServiceOptions = BaseFrontendClassOptions;

export type NpcServiceInterface = BaseFrontendClassInterface & {
  /**
   * Retrieves all NPCs from the local table.
   * @returns A promise that resolves to an array of NPC data.
   */
  getSystemNpcs(): Promise<NpcData[]>;

  /**
   * Retrieves all NPCs (per-install — uid accepted for API parity).
   * @param uid The user's ID.
   * @returns A promise that resolves to an array of NPC data.
   */
  getUserNpcs(options: { uid: string }): Promise<NpcData[]>;

  /**
   * Retrieves all public NPCs (visibility = 'public').
   * @returns A promise that resolves to an array of public NPC data.
   */
  getPublicNpcs(): Promise<NpcData[]>;

  /**
   * Retrieves a single NPC by its ID.
   * @param options - Configuration object.
   * @param options.npcId The ID of the NPC to retrieve.
   * @returns A promise that resolves to the NPC data, or undefined if not found.
   */
  get(options: { npcId: string }): Promise<NpcData | undefined>;

  /**
   * Creates a new NPC.
   * @param options - Configuration object.
   * @param options.data The NPC data to create.
   * @param options.uid The user's ID who will own this NPC.
   * @returns A promise that resolves to the new NPC's ID.
   */
  createNpc(options: { data: Partial<NpcCreateData>; uid: string }): Promise<string>;

  /**
   * Updates an existing NPC.
   * @param options - Configuration object.
   * @param options.npcId The ID of the NPC to update.
   * @param options.data The update data.
   * @returns A promise that resolves when the update is complete.
   */
  updateNpc(options: { npcId: string; data: Partial<NpcData> }): Promise<void>;

  /**
   * Deletes an NPC and optionally its chat history.
   * @param options - Configuration object.
   * @param options.npcId The ID of the NPC to delete.
   * @param options.deleteChatHistory Whether to also delete chat history (default: true).
   * @returns A promise that resolves when the deletion is complete.
   */
  deleteNpc(options: { npcId: string; deleteChatHistory?: boolean }): Promise<void>;

  /**
   * Forks a system NPC to create a copy.
   * @param options - Configuration object.
   * @param options.systemNpcId The ID of the system NPC to fork.
   * @param options.uid The user's ID who will own the forked NPC.
   * @returns A promise that resolves to the new forked NPC's ID.
   */
  forkNpc(options: { systemNpcId: string; uid: string }): Promise<string>;

  /**
   * Imports an NPC from a local file (PNG or JSON).
   * @param options - Configuration object.
   * @param options.file The file to import.
   * @param options.uid The user's ID who will own this NPC.
   * @returns A promise that resolves to the new NPC's ID.
   */
  importFromFile(options: { file: File; uid: string }): Promise<string>;

  /**
   * Imports an NPC from an external URL (Chub, Risu, etc.).
   * @param options - Configuration object.
   * @param options.url The URL to import from.
   * @param options.uid The user's ID who will own this NPC.
   * @returns A promise that resolves to the new NPC's ID.
   */
  importFromUrl(options: { url: string; uid: string }): Promise<string>;

  /**
   * Uploads an avatar image for an NPC.
   * @param options - Configuration object.
   * @param options.file The image file to upload.
   * @param options.npcId The NPC ID to associate the avatar with.
   * @returns A promise that resolves to the uploaded avatar's URL.
   */
  uploadAvatar(options: { file: File; npcId: string }): Promise<string | undefined>;
};

class NpcService extends BaseFrontendClass<NpcServiceOptions> implements NpcServiceInterface {
  async getSystemNpcs(): Promise<NpcData[]> {
    return await npcStorage.getSystemNpcs();
  }

  async getUserNpcs(options: { uid: string }): Promise<NpcData[]> {
    return await npcStorage.getUserNpcs(options);
  }

  async getPublicNpcs(): Promise<NpcData[]> {
    return await npcStorage.getPublicNpcs();
  }

  async get(options: { npcId: string }): Promise<NpcData | undefined> {
    return await npcStorage.get(options);
  }

  async createNpc(options: { data: Partial<NpcCreateData>; uid: string }): Promise<string> {
    return await npcStorage.createNpc(options);
  }

  async updateNpc(options: { npcId: string; data: Partial<NpcData> }): Promise<void> {
    await npcStorage.updateNpc(options);
  }

  async deleteNpc(options: { npcId: string; deleteChatHistory?: boolean }): Promise<void> {
    const { npcId, deleteChatHistory = true } = options;

    await npcStorage.deleteNpc({ npcId });

    if (deleteChatHistory) {
      const uid = authService.uid;
      if (uid) {
        // Delete the local chat for this NPC+user pair (chat_history rows are
        // removed by deleteChatById in the same transaction).
        const chat = await chatStorage.getChat({ uid, npcId });
        if (chat?.id) {
          await chatStorage.deleteChatById({ chatId: chat.id });
        }
      }
    }
  }

  async forkNpc(options: { systemNpcId: string; uid: string }): Promise<string> {
    return await npcStorage.forkNpc(options);
  }

  async importFromFile(options: { file: File; uid: string }): Promise<string> {
    const { file, uid } = options;

    const { character, avatarFile } = await this._extractCharacterFromFile({ file });

    const npcData: Partial<NpcCreateData> = {
      name: character.name,
      notes: character.description,
      personality: character.personality,
      scenario: character.scenario,
      firstMessage: character.first_mes,
      systemPrompt: character.system_prompt,
    };

    const npcId = await this.createNpc({ data: npcData, uid });

    if (avatarFile) {
      const avatarUrl = await this.uploadAvatar({ file: avatarFile, npcId });
      if (avatarUrl) {
        await this.updateNpc({ npcId, data: { avatarUrl } });
      }
    }

    return npcId;
  }

  async importFromUrl(options: { url: string; uid: string }): Promise<string> {
    const { url, uid } = options;

    const file = await downloadFromUrl({ url });
    return await this.importFromFile({ file, uid });
  }

  async uploadAvatar(options: { file: File; npcId: string }): Promise<string | undefined> {
    const { file, npcId } = options;
    const uid = authService.uid;

    if (!uid) {
      throw toAppError({
        errorType: 'unauthorized',
        errorMessage: 'Cannot upload avatar: User is not logged in.',
      });
    }

    try {
      return await storageService.uploadAvatar({
        file,
        uid: `${uid}/npcs/${npcId}`,
      });
    } catch (error) {
      this.error('uploadAvatar:failed', error);
      return undefined;
    }
  }

  private async _extractCharacterFromFile(options: { file: File }) {
    const { file } = options;

    if (file.type === 'image/png') {
      return await importFromPng({ file });
    }

    if (file.type === 'application/json' || file.name.endsWith('.json')) {
      return await importFromJson({ file });
    }

    throw toAppError({
      errorType: 'invalid-argument',
      errorMessage: 'Unsupported file type. Please upload a PNG or JSON file.',
    });
  }
}

export const npcService: NpcServiceInterface = NpcService.create({
  className: 'NpcService',
});
