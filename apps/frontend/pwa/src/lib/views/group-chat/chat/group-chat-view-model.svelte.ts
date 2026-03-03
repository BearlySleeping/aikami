import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/index.ts';
import type { GroupChatData } from '@aikami/schemas/index.ts';
import type { NpcData } from '@aikami/types/index.ts';
import { authService, groupChatService, npcService } from '$services/index.ts';

export type GroupChatViewModelOptions = BaseViewModelOptions & {
  groupChatId: string;
};

export type GroupChatMessage = {
  id: string;
  characterId: string;
  characterName: string;
  sender: 'user' | 'character';
  text: string;
  timestamp: Date;
};

export type GroupChatViewModelInterface = BaseViewModelInterface & {
  readonly groupChat: GroupChatData | null;
  readonly characters: NpcData[];
  readonly messages: GroupChatMessage[];
  readonly isLoading: boolean;
  readonly isSending: boolean;

  sendMessage(text: string): Promise<void>;
  loadMessages(): Promise<void>;
};

class GroupChatViewModel
  extends BaseViewModel<GroupChatViewModelOptions>
  implements GroupChatViewModelInterface
{
  groupChat = $state<GroupChatData | null>(null);
  characters = $state<NpcData[]>([]);
  messages = $state<GroupChatMessage[]>([]);
  isLoading = $state(false);
  isSending = $state(false);
  currentSpeakerIndex = $state(0);

  override async initialize(): Promise<void> {
    this.setAppLoading(true);
    try {
      const { groupChatId } = this._options;
      this.groupChat = await groupChatService.getGroupChat(groupChatId);

      if (this.groupChat) {
        const allNpcs = await npcService.getAll();
        this.characters = allNpcs.filter((npc) => this.groupChat!.characterIds.includes(npc.id));
      }
    } catch (err) {
      this.error('initialize', err);
    } finally {
      this.setAppLoading(false);
    }
    super.initialize();
  }

  async loadMessages(): Promise<void> {
    this.isLoading = true;
    try {
      // TODO: Load messages from repository
      this.messages = [];
    } catch (err) {
      this.error('loadMessages', err);
    } finally {
      this.isLoading = false;
    }
  }

  async sendMessage(text: string): Promise<void> {
    if (!text.trim() || this.isSending || !this.groupChat) return;

    this.isSending = true;

    try {
      const user = authService.currentUser;
      if (!user) return;

      const userMessage: GroupChatMessage = {
        id: crypto.randomUUID(),
        characterId: 'user',
        characterName: 'You',
        sender: 'user',
        text,
        timestamp: new Date(),
      };
      this.messages = [...this.messages, userMessage];

      const currentCharacter = this.characters[this.currentSpeakerIndex];
      if (currentCharacter) {
        const aiResponse = await this.getAIResponse(text, currentCharacter);
        const aiMessage: GroupChatMessage = {
          id: crypto.randomUUID(),
          characterId: currentCharacter.id,
          characterName: currentCharacter.name,
          sender: 'character',
          text: aiResponse,
          timestamp: new Date(),
        };
        this.messages = [...this.messages, aiMessage];

        if (this.groupChat.replyMode === 'sequential') {
          this.currentSpeakerIndex = (this.currentSpeakerIndex + 1) % this.characters.length;
        }
      }
    } catch (err) {
      this.error('sendMessage', err);
    } finally {
      this.isSending = false;
    }
  }

  private async getAIResponse(userText: string, character: NpcData): Promise<string> {
    const systemPrompt = character.notes || '';
    const context = `You are ${character.name}. ${character.occupation || ''}`;

    // TODO: Integrate with AI service
    return `[${character.name} responds to: "${userText}"]`;
  }
}

export const getGroupChatViewModel = (
  options: GroupChatViewModelOptions,
): GroupChatViewModelInterface => new GroupChatViewModel(options);
