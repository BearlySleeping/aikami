// apps/frontend/client/src/lib/views/character/npc/list/npc_list_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { ChatData, NpcCreateData, NpcData } from '@aikami/types';
import { toAppError, toAppErrorFromUnknownError } from '@aikami/utils';
import { authService, chatStorage, npcService, routerService } from '$services';

export type NpcListViewModelOptions = BaseViewModelOptions;

export type NpcTab = 'all' | 'mine' | 'public' | 'system' | 'chats';

/** Typed edit-field update accepted by the NPC list ViewModel. */
export type NpcFieldUpdate =
  | {
      field: 'name' | 'occupation' | 'race' | 'class' | 'personality' | 'notes';
      value: string;
    }
  | { field: 'level'; value: number }
  | { field: 'visibility'; value: 'private' | 'public' };

/** Tab metadata rendered by the NPC list view. */
export type NpcTabItem = { key: NpcTab; label: string };

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
  readonly tabs: readonly NpcTabItem[];
  urlInput: string;
  showUrlModal: boolean;
  showCreateModal: boolean;
  editName: string;
  editRace: string;
  editClass: string;
  editLevel: number;
  editOccupation: string;
  editPersonality: string;
  editNotes: string;
  editVisibility: 'private' | 'public';
  setActiveTab(tab: NpcTab): void;
  getTabCount(tab: NpcTab): number;
  handleFileChange(options: { event: Event }): Promise<void>;
  handleUrlSubmit(): Promise<void>;
  openUrlModal(): void;
  closeUrlModal(): void;
  openCreateModal(): void;
  closeCreateModal(): void;
  handleUrlModalKeydown(options: { event: KeyboardEvent }): void;
  handleCreateModalKeydown(options: { event: KeyboardEvent }): void;
  handleEditModalKeydown(options: { event: KeyboardEvent }): void;
  createNpc(options: { data: Partial<NpcCreateData> }): Promise<void>;
  handleForkNpc(options: { npcId: string }): Promise<void>;
  handleDeleteNpc(options: { npcId: string }): Promise<void>;
  handleDeleteChat(options: { chatId: string }): Promise<void>;
  navigateToChat(options: { npcId: string; chatId?: string }): Promise<void>;
  openEditForm(options: { npc: NpcData }): void;
  closeEditModal(): void;
  saveField(options: NpcFieldUpdate): Promise<void>;
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
  urlInput = $state('');
  showUrlModal = $state(false);
  showCreateModal = $state(false);
  editName = $state('');
  editRace = $state('');
  editClass = $state('');
  editLevel = $state(1);
  editOccupation = $state('');
  editPersonality = $state('');
  editNotes = $state('');
  editVisibility = $state<'private' | 'public'>('private');
  private _isSaving = false;

  readonly tabs: readonly NpcTabItem[] = [
    { key: 'all', label: 'All' },
    { key: 'mine', label: 'My NPCs' },
    { key: 'public', label: 'Public' },
    { key: 'system', label: 'System' },
  ];

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
    this.activeTab = tab;
    this.npcs = this._getFilteredNpcs();
  }

  getTabCount(tab: NpcTab): number {
    switch (tab) {
      case 'all':
        return this.systemNpcs.length + this.userNpcs.length;
      case 'mine':
        return this.userNpcs.length;
      case 'public':
        return this.publicNpcs.length;
      case 'system':
        return this.systemNpcs.length;
      default:
        return 0;
    }
  }

  async handleFileChange(options: { event: Event }): Promise<void> {
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
      this.log('handleFileChange', 'NPCs imported successfully');
    } catch (error) {
      this.error('handleFileChange failed', error);
      const appError = toAppErrorFromUnknownError(error);
      this.errorMessage = appError.message;
    } finally {
      this.isImporting = false;
      target.value = '';
    }
  }

  async handleUrlSubmit(): Promise<void> {
    const url = this.urlInput.trim();
    if (!url) {
      return;
    }
    this.urlInput = '';
    this.showUrlModal = false;

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

  openUrlModal(): void {
    this.showUrlModal = true;
  }

  closeUrlModal(): void {
    this.showUrlModal = false;
  }

  openCreateModal(): void {
    this.showCreateModal = true;
  }

  closeCreateModal(): void {
    this.showCreateModal = false;
  }

  handleUrlModalKeydown(options: { event: KeyboardEvent }): void {
    if (options.event.key === 'Enter') {
      this.closeUrlModal();
    }
  }

  handleCreateModalKeydown(options: { event: KeyboardEvent }): void {
    if (options.event.key === 'Enter') {
      this.closeCreateModal();
    }
  }

  handleEditModalKeydown(options: { event: KeyboardEvent }): void {
    if (options.event.key === 'Enter') {
      this.closeEditModal();
    }
  }

  async createNpc(options: { data: Partial<NpcCreateData> }): Promise<void> {
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
    const { npcId, chatId } = options;
    let finalChatId = chatId;

    if (!finalChatId) {
      const chat = await this.getOrCreateChat({ npcId });
      finalChatId = chat.id;
    }
    return routerService.goToRoute('game', {
      pathParameters: undefined,
      queryParameters: undefined,
    });
  }

  async handleDeleteChat(options: { chatId: string }): Promise<void> {
    const { chatId } = options;

    this.isLoading = true;
    try {
      await chatStorage.deleteChatById({ chatId });
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
    return chatStorage.getOrCreateChat({
      uid,
      npcId: npc.id,
      npcName: npc.name,
      npcAvatarUrl: npc.avatarUrl,
    });
  }

  openEditForm(options: { npc: NpcData }): void {
    const { npc } = options;
    this.editName = npc.name || '';
    this.editRace = npc.race || '';
    this.editClass = npc.class || '';
    this.editLevel = npc.level || 1;
    this.editOccupation = npc.occupation || '';
    this.editPersonality = npc.personality || '';
    this.editNotes = npc.notes || '';
    this.editVisibility = npc.visibility || 'private';
    this.editingNpc = npc;
  }

  closeEditModal(): void {
    this.editingNpc = undefined;
  }

  async saveField(options: NpcFieldUpdate): Promise<void> {
    if (this._isSaving) {
      return;
    }
    this._isSaving = true;
    try {
      await this.saveNpc({ data: { [options.field]: options.value } });
    } finally {
      this._isSaving = false;
    }
  }

  async saveNpc(options: { data: Partial<NpcData> }): Promise<void> {
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
  NpcListViewModel.create(options);
