// apps/frontend/pwa/src/lib/views/npc/list/npc-list-view-model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { ChatData, NpcCreateData, NpcData } from '@aikami/types';
import { toAppError, toAppErrorFromUnknownError } from '@aikami/utils';
import { authService, npcChatService, npcService, routerService } from '$services';

export type NpcListViewModelOptions = BaseViewModelOptions;

export type NpcTab = 'all' | 'mine' | 'public' | 'system' | 'chats';

export type NpcListViewModelInterface = BaseViewModelInterface & {
  readonly npcs: NpcData[];
  readonly systemNpcs: NpcData[];
  readonly userNpcs: NpcData[];
  readonly publicNpcs: NpcData[];
  readonly userChats: ChatData[];
  readonly isLoading: boolean;
  readonly isImporting: boolean;
  readonly activeTab: NpcTab;
  readonly editingNpc: NpcData | undefined;
  setActiveTab(tab: NpcTab): void;
  handleFileImport(options: { event: Event }): Promise<void>;
  handleUrlImport(options: { url: string }): Promise<void>;
  createNpc(options: { data: Partial<NpcCreateData> }): Promise<void>;
  handleForkNpc(options: { npcId: string }): Promise<void>;
  handleDeleteNpc(options: { npcId: string }): Promise<void>;
  handleDeleteChat(options: { chatId: string }): Promise<void>;
  navigateToChat(options: { npcId: string; chatId?: string }): Promise<void>;
  openEditModal(options: { npc: NpcData }): void;
  closeEditModal(): void;
  saveNpc(options: { data: Partial<NpcData> }): Promise<void>;
  getOrCreateChat(options: { npcId: string }): Promise<{ id: string }>;
};

class NpcListViewModel
  extends BaseViewModel<NpcListViewModelOptions>
  implements NpcListViewModelInterface
{
  npcs = $state<NpcData[]>([]);
  systemNpcs = $state<NpcData[]>([]);
  userNpcs = $state<NpcData[]>([]);
  publicNpcs = $state<NpcData[]>([]);
  userChats = $state<ChatData[]>([]);
  isLoading = $state<boolean>(false);
  isImporting = $state<boolean>(false);
  activeTab = $state<NpcTab>('all');
  editingNpc = $state<NpcData | undefined>(undefined);

  get currentUserId(): string | undefined {
    return authService.currentUser?.id;
  }

  override async initialize(): Promise<void> {
    this.setAppLoading(true);

    try {
      const uid = this.currentUserId;

      const [systemNpcs, userNpcs, publicNpcs] = await Promise.all([
        npcService.getSystemNpcs(),
        uid ? npcService.getUserNpcs({ uid }) : Promise.resolve([]),
        npcService.getPublicNpcs(),
      ]);

      this.systemNpcs = systemNpcs;
      this.userNpcs = userNpcs;
      this.publicNpcs = publicNpcs;
      this.npcs = this._getFilteredNpcs();

      this.log(
        'initialize',
        `NPCs loaded - System: ${systemNpcs.length}, User: ${userNpcs.length}, Public: ${publicNpcs.length}`,
      );
    } catch (error) {
      this.error('initialize', error);
      const appError = toAppErrorFromUnknownError(error);
      this.errorMessage = appError.message;
    }

    this.setAppLoading(false);
    return super.initialize();
  }

  setActiveTab(tab: NpcTab): void {
    this.debug('setActiveTab', tab);
    this.activeTab = tab;
    this.npcs = this._getFilteredNpcs();
  }

  async handleFileImport(options: { event: Event }): Promise<void> {
    this.debug('handleFileImport', options);
    const { event } = options;
    const target = event.target as HTMLInputElement;

    if (!target.files) {
      return;
    }

    const uid = this.currentUserId;
    if (!uid) {
      this.errorMessage = 'You must be logged in to import NPCs';
      return;
    }

    this.isImporting = true;

    try {
      for (const file of target.files) {
        await npcService.importFromFile({ file, uid });
      }

      await this._refreshNpcs();
      this.log('handleFileImport', 'NPCs imported successfully');
    } catch (error) {
      this.error('handleFileImport failed', error);
      const appError = toAppErrorFromUnknownError(error);
      this.errorMessage = appError.message;
    } finally {
      this.isImporting = false;
      target.value = '';
    }
  }

  async handleUrlImport(options: { url: string }): Promise<void> {
    this.debug('handleUrlImport', options);
    const { url } = options;

    const uid = this.currentUserId;
    if (!uid) {
      this.errorMessage = 'You must be logged in to import NPCs';
      return;
    }

    this.isImporting = true;

    try {
      await npcService.importFromUrl({ url, uid });
      await this._refreshNpcs();
      this.log('handleUrlImport', 'NPC imported successfully from URL');
    } catch (error) {
      this.error('handleUrlImport failed', error);
      const appError = toAppErrorFromUnknownError(error);
      this.errorMessage = appError.message;
    } finally {
      this.isImporting = false;
    }
  }

  async createNpc(options: { data: Partial<NpcCreateData> }): Promise<void> {
    this.debug('createNpc', options);
    const { data } = options;

    const uid = this.currentUserId;
    if (!uid) {
      throw toAppError({
        errorType: 'unauthorized',
        errorMessage: 'You must be logged in to create NPCs',
      });
    }

    this.isLoading = true;

    try {
      await npcService.createNpc({ data, uid });
      await this._refreshNpcs();
      this.log('createNpc', 'NPC created successfully');
    } catch (error) {
      this.error('createNpc failed', error);
      const appError = toAppErrorFromUnknownError(error);
      this.errorMessage = appError.message;
      throw appError;
    } finally {
      this.isLoading = false;
    }
  }

  async handleForkNpc(options: { npcId: string }): Promise<void> {
    this.debug('handleForkNpc', options);
    const { npcId } = options;

    const uid = this.currentUserId;
    if (!uid) {
      this.errorMessage = 'You must be logged in to fork NPCs';
      return;
    }

    this.isLoading = true;

    try {
      await npcService.forkNpc({ systemNpcId: npcId, uid });
      await this._refreshNpcs();
      this.log('handleForkNpc', 'NPC forked successfully');
    } catch (error) {
      this.error('handleForkNpc failed', error);
      const appError = toAppErrorFromUnknownError(error);
      this.errorMessage = appError.message;
    } finally {
      this.isLoading = false;
    }
  }

  async handleDeleteNpc(options: { npcId: string }): Promise<void> {
    this.debug('handleDeleteNpc', options);
    const { npcId } = options;

    this.isLoading = true;

    try {
      await npcService.deleteNpc({ npcId, deleteChatHistory: true });
      await this._refreshNpcs();
      this.log('handleDeleteNpc', 'NPC deleted successfully');
    } catch (error) {
      this.error('handleDeleteNpc failed', error);
      const appError = toAppErrorFromUnknownError(error);
      this.errorMessage = appError.message;
    } finally {
      this.isLoading = false;
    }
  }

  async navigateToChat(options: { npcId: string; chatId?: string }): Promise<void> {
    this.debug('navigateToChat', options);
    const { npcId, chatId } = options;
    let finalChatId = chatId;

    if (!finalChatId) {
      const chat = await this.getOrCreateChat({ npcId });
      finalChatId = chat.id;
    }
    return routerService.goToRoute('chat', {
      pathParameters: { chatId: finalChatId },
      queryParameters: { npcId },
    });
  }

  async handleDeleteChat(options: { chatId: string }): Promise<void> {
    this.debug('handleDeleteChat', options);
    const { chatId } = options;

    this.isLoading = true;
    try {
      await npcChatService.deleteChatById({ chatId });
      this.userChats = this.userChats.filter((c) => c.id !== chatId);
      this.log('handleDeleteChat', 'Chat deleted successfully');
    } catch (error) {
      this.error('handleDeleteChat failed', error);
      const appError = toAppErrorFromUnknownError(error);
      this.errorMessage = appError.message;
    } finally {
      this.isLoading = false;
    }
  }

  async getOrCreateChat(options: { npcId: string }): Promise<{ id: string }> {
    this.debug('getOrCreateChat', options);
    const { npcId } = options;
    const uid = this.currentUserId;
    if (!uid) {
      throw toAppError({
        errorType: 'unauthorized',
        errorMessage: 'You must be logged in to chat',
      });
    }
    const npc = await npcService.get({ npcId });
    if (!npc) {
      throw toAppError({
        errorType: 'not-found',
        errorMessage: 'NPC not found',
      });
    }
    return npcChatService.getOrCreateChat({
      uid,
      npcId: npc.id,
      npcName: npc.name,
      npcAvatarUrl: npc.avatarUrl,
    });
  }

  openEditModal(options: { npc: NpcData }): void {
    this.debug('openEditModal', options);
    this.editingNpc = options.npc;
  }

  closeEditModal(): void {
    this.debug('closeEditModal');
    this.editingNpc = undefined;
  }

  async saveNpc(options: { data: Partial<NpcData> }): Promise<void> {
    this.debug('saveNpc', options);
    const { data } = options;

    if (!this.editingNpc) {
      return;
    }

    this.isLoading = true;

    try {
      await npcService.updateNpc({ npcId: this.editingNpc.id, data });
      await this._refreshNpcs();
      this.editingNpc = undefined;
      this.log('saveNpc', 'NPC saved successfully');
    } catch (error) {
      this.error('saveNpc failed', error);
      const appError = toAppErrorFromUnknownError(error);
      this.errorMessage = appError.message;
      throw appError;
    } finally {
      this.isLoading = false;
    }
  }

  private async _refreshNpcs(): Promise<void> {
    const uid = this.currentUserId;

    const [systemNpcs, userNpcs, publicNpcs] = await Promise.all([
      npcService.getSystemNpcs(),
      uid ? npcService.getUserNpcs({ uid }) : Promise.resolve([]),
      npcService.getPublicNpcs(),
    ]);

    this.systemNpcs = systemNpcs;
    this.userNpcs = userNpcs;
    this.publicNpcs = publicNpcs;
    this.npcs = this._getFilteredNpcs();
  }

  private _getFilteredNpcs(): NpcData[] {
    switch (this.activeTab) {
      case 'system':
        return this.systemNpcs;
      case 'mine':
        return this.userNpcs;
      case 'public':
        return this.publicNpcs;
      default: {
        const combined = [...this.systemNpcs, ...this.userNpcs];
        // Create a Map with the ID as the key to automatically strip out duplicates
        return Array.from(new Map(combined.map((npc) => [npc.id, npc])).values());
      }
    }
  }
}

export const getNpcListViewModel = (options: NpcListViewModelOptions): NpcListViewModelInterface =>
  new NpcListViewModel(options);
