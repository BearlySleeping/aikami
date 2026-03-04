import { groupChatRepository } from '@aikami/frontend/repositories/group-chat.ts';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { GroupChatData } from '@aikami/schemas';
import { authService } from '$services';
import { npcService } from './npc.svelte.ts';

export type GroupChatServiceOptions = BaseFrontendClassOptions;

export type GroupChatServiceInterface = BaseFrontendClassInterface & {
  getGroupChats(): Promise<GroupChatData[]>;
  getGroupChat(id: string): Promise<GroupChatData | null>;
  createGroupChat(data: { name: string; characterIds: string[] }): Promise<string>;
  updateGroupChat(id: string, data: Partial<GroupChatData>): Promise<void>;
  deleteGroupChat(id: string): Promise<void>;
  addCharacterToGroup(groupChatId: string, characterId: string): Promise<void>;
  removeCharacterFromGroup(groupChatId: string, characterId: string): Promise<void>;
};

class GroupChatService
  extends BaseFrontendClass<GroupChatServiceOptions>
  implements GroupChatServiceInterface
{
  async getGroupChats(): Promise<GroupChatData[]> {
    const user = authService.currentUser;
    if (!user) return [];
    return await groupChatRepository.getDocumentsByCollection({ uid: user.id });
  }

  async getGroupChat(id: string): Promise<GroupChatData | null> {
    const user = authService.currentUser;
    if (!user) return null;
    try {
      const result = await groupChatRepository.getDocument({ uid: user.id, groupChatId: id });
      return result ?? null;
    } catch {
      return null;
    }
  }

  async createGroupChat(data: { name: string; characterIds: string[] }): Promise<string> {
    const user = authService.currentUser;
    if (!user) throw new Error('User not authenticated');

    return await groupChatRepository.addDocument({
      getCollectionPathArgument: { uid: user.id },
      createData: {
        name: data.name,
        characterIds: data.characterIds,
        uid: user.id,
        replyMode: 'sequential',
      },
    });
  }

  async updateGroupChat(id: string, data: Partial<GroupChatData>): Promise<void> {
    const user = authService.currentUser;
    if (!user) throw new Error('User not authenticated');

    await groupChatRepository.updateDocument({
      getDocumentPathArgument: { uid: user.id, groupChatId: id },
      updateData: data,
    });
  }

  async deleteGroupChat(id: string): Promise<void> {
    const user = authService.currentUser;
    if (!user) throw new Error('User not authenticated');

    await groupChatRepository.deleteDocument({ uid: user.id, groupChatId: id });
  }

  async addCharacterToGroup(groupChatId: string, characterId: string): Promise<void> {
    const groupChat = await this.getGroupChat(groupChatId);
    if (!groupChat) throw new Error('Group chat not found');

    if (!groupChat.characterIds.includes(characterId)) {
      await this.updateGroupChat(groupChatId, {
        characterIds: [...groupChat.characterIds, characterId],
      });
    }
  }

  async removeCharacterFromGroup(groupChatId: string, characterId: string): Promise<void> {
    const groupChat = await this.getGroupChat(groupChatId);
    if (!groupChat) throw new Error('Group chat not found');

    await this.updateGroupChat(groupChatId, {
      characterIds: groupChat.characterIds.filter((id) => id !== characterId),
    });
  }
}

export const groupChatService: GroupChatServiceInterface = new GroupChatService({
  className: 'GroupChatService',
});
