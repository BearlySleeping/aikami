// apps/frontend/client/src/lib/views/settings/export/export_view_model.svelte.ts
//
// C-464 AC-8: Export & Data settings tab — export operations, offline mode,
// telemetry opt-out, and delete local data.
//
// Collaborators arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh fixtures. Production wiring lives in
// ./export_composition.ts.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { ChatData, NpcData, PersonaData } from '@aikami/types';
import type { GameSession } from '$types';

// ── Capability contracts ────────────────────────────────────────────────

/** Persisted AI privacy pair (offline mode + telemetry opt-out). */
export type ExportPrivacySettings = {
  offlineMode: boolean;
  telemetryOptOut: boolean;
};

/** The export/storage operations the export tab performs. */
export type ExportServiceCapabilities = {
  listChats(): Promise<ChatData[]>;
  listCompletedSessions(): GameSession[];
  listExportableCharacters(): Promise<Array<NpcData | PersonaData>>;
  exportChatAsJsonl(options: { chat: ChatData; npcName?: string }): Promise<void>;
  exportChatAsPlainText(options: {
    chat: ChatData;
    npcName?: string;
    userName?: string;
  }): Promise<void>;
  exportCharacterAsJson(options: {
    character: NpcData | PersonaData;
    type: 'character' | 'npc' | 'persona';
  }): Promise<void>;
  exportCharacterAsPng(options: {
    character: NpcData | PersonaData;
    type: 'character' | 'npc' | 'persona';
  }): Promise<void>;
  exportSessionAsEpub(options: { session: GameSession }): Promise<void>;
  exportBulkBackup(): Promise<void>;
  downloadDeviceBackup(): Promise<void>;
  restoreDeviceBackup(options: { file: File }): Promise<void>;
  deleteAllLocalData(): Promise<void>;
};

/** Persisted privacy settings read/write. */
export type ExportPrivacyCapabilities = {
  read(): ExportPrivacySettings;
  write(settings: ExportPrivacySettings): void;
};

// ── Types ───────────────────────────────────────────────────────────────

/** A display-ready character entry combining NPCs and personas. */
export type ExportableCharacter = {
  id: string;
  name: string;
  type: 'character' | 'npc' | 'persona';
  avatarUrl?: string;
  source: NpcData | PersonaData;
};

/** A display-ready session entry. */
export type ExportableSession = GameSession;

// ── Interface ───────────────────────────────────────────────────────────

export type ExportViewModelInterface = BaseViewModelInterface & {
  /** All chats available for export. */
  readonly chats: ChatData[];
  /** All characters available for export. */
  readonly characters: ExportableCharacter[];
  /** All completed sessions available for EPUB export. */
  readonly sessions: ExportableSession[];
  /** Whether data is loading. */
  readonly isLoading: boolean;
  /** Backup progress message. */
  readonly backupProgress: string;

  // ── Privacy toggles (C-464 AC-8) ──
  /** Offline mode — when true, no AI calls are attempted. */
  readonly offlineMode: boolean;
  /** Telemetry opt-out. */
  readonly telemetryOptOut: boolean;

  // ── Chat exports ──
  exportChatAsJsonl(chat: ChatData): Promise<void>;
  exportChatAsPlainText(chat: ChatData): Promise<void>;

  // ── Character exports ──
  exportCharacterAsJson(character: ExportableCharacter): Promise<void>;
  exportCharacterAsPng(character: ExportableCharacter): Promise<void>;

  // ── Session exports ──
  exportSessionAsEpub(session: ExportableSession): Promise<void>;

  // ── Bulk backup ──
  exportBulkBackup(): Promise<void>;

  // ── Device backup (local file round-trip) ──
  readonly isBackupBusy: boolean;
  downloadDeviceBackup(): Promise<void>;
  selectRestoreFile(options: { event: Event }): void;
  readonly pendingRestoreName: string | undefined;
  readonly isRestoreDialogOpen: boolean;
  readonly isRestoringBackup: boolean;
  closeRestoreDialog(): void;
  confirmRestoreBackup(): Promise<void>;

  /** Formats a Firestore Timestamp or ISO string to a locale date. */
  formatDate(timestamp: unknown): string;

  // ── Privacy actions (C-464 AC-8) ──
  toggleOfflineMode(): void;
  toggleTelemetry(): void;

  // ── Delete local data (C-464 AC-7) ──
  readonly isDeleteLocalDialogOpen: boolean;
  readonly deleteLocalConfirmText: string;
  readonly isDeletingLocal: boolean;
  openDeleteLocalDialog(): void;
  closeDeleteLocalDialog(): void;
  updateDeleteLocalConfirmText(value: string): void;
  confirmDeleteLocalData(): Promise<void>;
};

// ── Options ─────────────────────────────────────────────────────────────

export type ExportViewModelOptions = BaseViewModelOptions & {
  /** Export/storage operations capability. */
  service: ExportServiceCapabilities;
  /** Persisted privacy settings capability. */
  privacy: ExportPrivacyCapabilities;
};

// ── Implementation ──────────────────────────────────────────────────────

export class ExportViewModel
  extends BaseViewModel<ExportViewModelOptions>
  implements ExportViewModelInterface
{
  private readonly _service: ExportServiceCapabilities;
  private readonly _privacy: ExportPrivacyCapabilities;

  chats: ChatData[] = $state([]);
  characters: ExportableCharacter[] = $state([]);
  sessions: ExportableSession[] = $state([]);
  isLoading = $state(false);
  backupProgress = $state('');

  // ── Device backup (local file round-trip) ──
  isBackupBusy = $state(false);
  isRestoreDialogOpen = $state(false);
  isRestoringBackup = $state(false);
  private _pendingRestoreFile: File | undefined;

  // ── Privacy toggles (C-464 AC-8) ──
  offlineMode = $state<boolean>(false);
  telemetryOptOut = $state<boolean>(false);

  // ── Delete local data (C-464 AC-7) ──
  isDeleteLocalDialogOpen = $state(false);
  deleteLocalConfirmText = $state('');
  isDeletingLocal = $state(false);

  constructor(options: ExportViewModelOptions) {
    super(options);
    this._service = options.service;
    this._privacy = options.privacy;
  }

  override async initialize(): Promise<void> {
    this.isLoading = true;
    try {
      await this._loadData();
    } finally {
      this.isLoading = false;
    }
    await super.initialize();
  }

  // ── Chat exports ────────────────────────────────────────────────────

  async exportChatAsJsonl(chat: ChatData): Promise<void> {
    await this._service.exportChatAsJsonl({ chat });
  }

  async exportChatAsPlainText(chat: ChatData): Promise<void> {
    await this._service.exportChatAsPlainText({ chat });
  }

  // ── Character exports ───────────────────────────────────────────────

  async exportCharacterAsJson(character: ExportableCharacter): Promise<void> {
    await this._service.exportCharacterAsJson({
      character: character.source,
      type: character.type,
    });
  }

  async exportCharacterAsPng(character: ExportableCharacter): Promise<void> {
    await this._service.exportCharacterAsPng({
      character: character.source,
      type: character.type,
    });
  }

  // ── Session exports ─────────────────────────────────────────────────

  async exportSessionAsEpub(session: ExportableSession): Promise<void> {
    await this._service.exportSessionAsEpub({ session });
  }

  // ── Bulk backup ─────────────────────────────────────────────────────

  async exportBulkBackup(): Promise<void> {
    await this._service.exportBulkBackup();
  }

  get pendingRestoreName(): string | undefined {
    return this._pendingRestoreFile?.name;
  }

  async downloadDeviceBackup(): Promise<void> {
    this.isBackupBusy = true;
    try {
      await this._service.downloadDeviceBackup();
    } catch (error) {
      this.error('downloadDeviceBackup', error);
      this.errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      this.isBackupBusy = false;
    }
  }

  selectRestoreFile(options: { event: Event }): void {
    const target = options.event.target as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    if (!file) {
      return;
    }
    this._pendingRestoreFile = file;
    this.isRestoreDialogOpen = true;
  }

  closeRestoreDialog(): void {
    this.isRestoreDialogOpen = false;
    this._pendingRestoreFile = undefined;
  }

  async confirmRestoreBackup(): Promise<void> {
    const file = this._pendingRestoreFile;
    if (!file) {
      return;
    }
    this.isRestoringBackup = true;
    try {
      await this._service.restoreDeviceBackup({ file });
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    } catch (error) {
      this.error('confirmRestoreBackup', error);
      this.errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      this.isRestoringBackup = false;
      this.closeRestoreDialog();
    }
  }

  formatDate(timestamp: unknown): string {
    if (!timestamp) {
      return '\u2014';
    }
    if (timestamp instanceof Date) {
      return timestamp.toLocaleDateString();
    }
    if (
      typeof timestamp === 'object' &&
      timestamp !== null &&
      'toDate' in timestamp &&
      typeof (timestamp as { toDate: () => Date }).toDate === 'function'
    ) {
      return (timestamp as { toDate: () => Date }).toDate().toLocaleDateString();
    }
    return '\u2014';
  }

  // ── Privacy actions (C-464 AC-8) ──

  toggleOfflineMode(): void {
    this.offlineMode = !this.offlineMode;
    this._persistPrivacySettings();
    this.debug('toggleOfflineMode', { offlineMode: this.offlineMode });
  }

  toggleTelemetry(): void {
    this.telemetryOptOut = !this.telemetryOptOut;
    this._persistPrivacySettings();
    this.debug('toggleTelemetry', { telemetryOptOut: this.telemetryOptOut });
  }

  // ── Delete local data (C-464 AC-7) ──

  openDeleteLocalDialog(): void {
    this.deleteLocalConfirmText = '';
    this.isDeleteLocalDialogOpen = true;
  }

  closeDeleteLocalDialog(): void {
    this.isDeleteLocalDialogOpen = false;
    this.deleteLocalConfirmText = '';
  }

  updateDeleteLocalConfirmText(value: string): void {
    this.deleteLocalConfirmText = value;
  }

  async confirmDeleteLocalData(): Promise<void> {
    if (this.deleteLocalConfirmText !== 'DELETE') {
      return;
    }
    this.isDeletingLocal = true;
    try {
      await this._service.deleteAllLocalData();
      localStorage.clear();
      window.location.reload();
    } catch (error) {
      this.error('confirmDeleteLocalData', error);
    } finally {
      this.isDeletingLocal = false;
    }
  }

  private _persistPrivacySettings(): void {
    this._privacy.write({
      offlineMode: this.offlineMode,
      telemetryOptOut: this.telemetryOptOut,
    });
  }

  // ── Internal ────────────────────────────────────────────────────────

  async _loadData(): Promise<void> {
    const [chats, exportableCharacters, sessions] = await Promise.all([
      this._loadChats(),
      this._loadCharacters(),
      this._loadSessions(),
    ]);
    this.chats = chats;
    this.characters = exportableCharacters;
    this.sessions = sessions;

    // Load persisted privacy settings (C-464 AC-8: keep the same key)
    this._loadPrivacySettings();
  }

  private _loadPrivacySettings(): void {
    const settings = this._privacy.read();
    this.offlineMode = settings.offlineMode;
    this.telemetryOptOut = settings.telemetryOptOut;
  }

  async _loadChats(): Promise<ChatData[]> {
    try {
      return await this._service.listChats();
    } catch (error) {
      this.error('_loadChats failed', error);
      return [];
    }
  }

  async _loadCharacters(): Promise<ExportableCharacter[]> {
    try {
      const raw = await this._service.listExportableCharacters();
      return raw.map((source) => {
        const isPersona = 'uid' in source && !('faction' in source);
        return {
          id: ((source as Record<string, unknown>).id as string) || '',
          name: ((source as Record<string, unknown>).name as string) || 'Unnamed',
          type: isPersona ? ('persona' as const) : ('npc' as const),
          avatarUrl: (source as NpcData).avatarUrl,
          source,
        };
      });
    } catch (error) {
      this.error('_loadCharacters failed', error);
      return [];
    }
  }

  async _loadSessions(): Promise<ExportableSession[]> {
    try {
      return this._service.listCompletedSessions();
    } catch (error) {
      this.error('_loadSessions failed', error);
      return [];
    }
  }
}

/**
 * Builds the export ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getExportViewModel` in ./export_composition.ts.
 */
export const createExportViewModel = (options: ExportViewModelOptions): ExportViewModelInterface =>
  ExportViewModel.create(options);
