import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/index.ts';
import type { GroupChatData } from '@aikami/schemas/index.ts';
import type { NpcData } from '@aikami/types/index.ts';
import { authService, groupChatService, npcService } from '$services/index.ts';

export type GroupChatListViewModelOptions = BaseViewModelOptions;

export type GroupChatListViewModelInterface = BaseViewModelInterface & {
  readonly groupChats: GroupChatData[];
  readonly availableNpcs: NpcData[];
  readonly isLoading: boolean;

  loadGroupChats(): Promise<void>;
  createGroupChat(name: string, characterIds: string[]): Promise<void>;
  deleteGroupChat(id: string): Promise<void>;
};

class GroupChatListViewModel
  extends BaseViewModel<GroupChatListViewModelOptions>
  implements GroupChatListViewModelInterface
{
  groupChats = $state<GroupChatData[]>([]);
  availableNpcs = $state<NpcData[]>([]);
  isLoading = $state<boolean>(false);

  override async initialize(): Promise<void> {
    this.setAppLoading(true);
    try {
      await this.loadGroupChats();
      this.availableNpcs = await npcService.getAll();
    } catch (err) {
      this.error('initialize', err);
    } finally {
      this.setAppLoading(false);
    }
    super.initialize();
  }

  async loadGroupChats(): Promise<void> {
    this.isLoading = true;
    try {
      this.groupChats = await groupChatService.getGroupChats();
    } catch (err) {
      this.error('loadGroupChats', err);
    } finally {
      this.isLoading = false;
    }
  }

  async createGroupChat(name: string, characterIds: string[]): Promise<void> {
    try {
      await groupChatService.createGroupChat({ name, characterIds });
      await this.loadGroupChats();
    } catch (err) {
      this.error('createGroupChat', err);
    }
  }

  async deleteGroupChat(id: string): Promise<void> {
    try {
      await groupChatService.deleteGroupChat(id);
      await this.loadGroupChats();
    } catch (err) {
      this.error('deleteGroupChat', err);
    }
  }
}

export const getGroupChatListViewModel = (
  options: GroupChatListViewModelOptions,
): GroupChatListViewModelInterface => new GroupChatListViewModel(options);
