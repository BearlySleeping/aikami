// apps/frontend/client/src/lib/views/character/persona/list/persona_list_view_model.svelte.ts
//
// ViewModel for the Persona List screen. Loads personas from localStorage
// and the local personas table (C-386b), supports selection (→ /game),
// deletion, active persona management, and navigation to persona creation.
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { PersonaData } from '@aikami/types';
import { toAppError } from '@aikami/utils';
import {
  compileCardToPersona,
  hasDeclaredAbilityScores,
} from '$lib/services/character/card_compiler.ts';
import { importFromJson, importFromPng } from '$lib/services/character/character_importer.ts';
import {
  authService,
  campaignService,
  equipmentService,
  gameModeService,
  inventoryService,
  lorebookStore,
  personaService,
  playerStateService,
  routerService,
  storageService,
  worldStateService,
} from '$services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A saved persona entry from localStorage. */
export type SavedPersona = {
  persona: PersonaData;
  avatarUrl: string;
  savedAt: string;
};

export type PersonaListViewModelOptions = BaseViewModelOptions;

export type PersonaListViewModelInterface = BaseViewModelInterface & {
  /** All saved personas (localStorage + Firestore merged, sorted newest first). */
  readonly personas: readonly SavedPersona[];

  /** Whether the list of personas is empty. */
  readonly isEmpty: boolean;

  /** Whether personas are being loaded from Firestore. */
  readonly isLoading: boolean;

  /** Whether a card import is in flight. */
  readonly isImporting: boolean;

  /** Import summary message (C-439 AC-4). */
  readonly importSummary: string | undefined;

  /** Clears the import summary after it has been read. */
  clearImportSummary(): void;

  /** Selects a persona and navigates to /game to start playing. */
  selectPersona(options: { id: string }): Promise<void>;

  /** Deletes a persona from localStorage. */
  deletePersona(options: { id: string }): void;

  /** Navigates to persona creation. */
  createPersona(): Promise<void>;

  /** Navigates back to the start menu. */
  goBack(): Promise<void>;

  /** Sets a persona as the active one (game-style). */
  setActivePersona(personaId: string): Promise<void>;

  /**
   * Imports a SillyTavern V2/V3 character card (PNG or JSON) as a persona.
   * Compiles the card into PersonaSheetSchema fields with inferred ability
   * scores and upserts it into the local personas table (C-419 AC-1/AC-2).
   */
  handleFileImport(options: { event: Event }): Promise<void>;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class PersonaListViewModel
  extends BaseViewModel<PersonaListViewModelOptions>
  implements PersonaListViewModelInterface
{
  personas: SavedPersona[] = $state([]);
  isLoading = $state(false);
  isImporting = $state(false);
  importSummary: string | undefined = $state();

  get isEmpty(): boolean {
    return this.personas.length === 0;
  }

  override async initialize(): Promise<void> {
    this.debug('initialize');
    this.isLoading = true;

    try {
      // Load from localStorage (always available)
      this._loadFromStorage();

      // Wait for Firebase Auth to resolve before checking uid.
      // On direct refresh, auth may not be ready yet (IndexedDB read).
      // authService.initialize() is idempotent — returns immediately if already ready.
      await authService.initialize();

      // Load from the local personas table (C-386b) — personas are per-install.
      await this._loadFromLocalTable();
    } catch (error) {
      this.warn('initialize:partial-load-failed', error);
    } finally {
      this.isLoading = false;
    }

    await super.initialize();
  }

  /** @inheritdoc */
  async selectPersona(options: { id: string }): Promise<void> {
    const { id } = options;
    const persona = this.personas.find((p) => p.persona.id === id);
    if (!persona) {
      this.warn('selectPersona:not-found', { id });
      return;
    }

    this.debug('selectPersona', { id, name: persona.persona.name });

    // Always create a fresh campaign when selecting a persona.
    // This ensures the campaign is in 'creating' state before completeSetup(),
    // even if a previous campaign was left in 'playing' state (e.g., after
    // pressing back from a game session).
    try {
      await campaignService.startNewCampaign({ contentPackId: 'emberwatch' });
    } catch (error) {
      this.error('selectPersona:start-campaign-failed', error);
      return;
    }

    // Set as active persona if logged in, so Firestore-aware game init can find it
    try {
      await personaService.setActivePersona(id);
    } catch (error) {
      // Non-critical — localStorage fallback in GameViewModel handles this
      this.debug('selectPersona:setActivePersona-failed', error);
    }

    // Clear any stale state from a previous play session
    playerStateService.reset();
    inventoryService.reset();
    equipmentService.reset();
    gameModeService.reset();
    worldStateService.reset();

    // Transition campaign from creating → playing before the game boot loads it
    campaignService.completeSetup();

    await routerService.goToRoute('game', {
      queryParameters: undefined,
      pathParameters: undefined,
    });
  }

  /** @inheritdoc */
  deletePersona(options: { id: string }): void {
    const { id } = options;
    const updated = this.personas.filter((p) => p.persona.id !== id);
    this.personas = updated;
    this._saveToStorage(updated);
    this.debug('deletePersona', { id, remaining: updated.length });
  }

  /** @inheritdoc */
  async createPersona(): Promise<void> {
    await routerService.goToRoute('setup', {
      queryParameters: undefined,
      pathParameters: undefined,
    });
  }

  /** @inheritdoc */
  async goBack(): Promise<void> {
    await routerService.navigateToApp();
  }

  /** @inheritdoc */
  async setActivePersona(personaId: string): Promise<void> {
    try {
      await personaService.setActivePersona(personaId);

      // Refresh to get updated active states
      await this._loadFromLocalTable();
    } catch (error) {
      this.error('setActivePersona', error);
    }
  }

  /** @inheritdoc */
  async handleFileImport(options: { event: Event }): Promise<void> {
    const { event } = options;
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];

    if (!file) {
      return;
    }

    this.isImporting = true;

    try {
      // Reuse the shared card parser (V1/V2/V3/RisuAI/Aikami) — C-419 AC-1/2.
      const { character, avatarFile, lorebook } = await this._extractCharacter({ file });

      // Compile into PersonaSheetSchema fields, inferring ability scores.
      const sheet = compileCardToPersona({ character });
      const personaId = crypto.randomUUID();

      const persona: PersonaData = {
        id: personaId,
        name: sheet.name,
        background: sheet.background,
        personalityTraits: sheet.personalityTraits,
        notes: sheet.notes,
        abilityScores: sheet.abilityScores,
        isActive: false,
      };

      let avatarUrl = '';
      if (avatarFile) {
        try {
          avatarUrl = (await this._uploadAvatar({ file: avatarFile, personaId })) ?? '';
        } catch (error) {
          this.warn('handleFileImport:avatar-upload-failed', error);
        }
      }
      persona.avatarUrl = avatarUrl || undefined;

      // Upsert into the local personas table + localStorage mirror.
      await personaService.updatePersona(personaId, persona);
      await this._loadFromLocalTable();

      // C-439 AC-3: Create lorebook from imported card's character_book
      if (lorebook && lorebook.entries.length > 0) {
        let lorebookId: string | undefined;
        try {
          lorebookId = lorebookStore.addLorebook({
            name: lorebook.name,
            description: lorebook.description,
          });
          // Add all entries atomically - if any fails, roll back the lorebook
          for (const entry of lorebook.entries) {
            lorebookStore.addEntry({ lorebookId, entry });
          }
          // C-439 AC-4: Surface import summary
          const { summary } = lorebook;
          const parts: string[] = [];
          parts.push(`${summary.imported} of ${summary.total} lore entries imported`);
          if (summary.skipped > 0) {
            parts.push(`${summary.skipped} skipped`);
            for (const reason of summary.skippedReasons) {
              parts.push(reason);
            }
          }
          this.importSummary = parts.join(' — ');
          this.info('handleFileImport:lorebook-created', {
            lorebookId,
            name: lorebook.name,
            entries: lorebook.entries.length,
            summary,
          });
        } catch (error) {
          // Roll back the lorebook if it was created but entry insertion failed
          if (lorebookId) {
            try {
              lorebookStore.deleteLorebook(lorebookId);
            } catch (rollbackError) {
              this.warn('handleFileImport:lorebook-rollback-failed', rollbackError);
            }
          }
          this.warn('handleFileImport:lorebook-creation-failed', error);
          this.importSummary = 'Character imported, but its lorebook could not be created.';
        }
      } else if (lorebook && lorebook.entries.length === 0) {
        this.importSummary = 'Character imported. The card had no importable lore entries.';
      }

      this.info('handleFileImport', {
        personaId,
        name: sheet.name,
        abilityScoresInferred: !hasDeclaredAbilityScores({ character }),
      });
    } catch (error) {
      this.error('handleFileImport:failed', error);
      this.errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      this.isImporting = false;
      target.value = '';
    }
  }

  /** @inheritdoc */
  clearImportSummary(): void {
    this.importSummary = undefined;
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private async _extractCharacter(options: { file: File }) {
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

  private async _uploadAvatar(options: {
    file: File;
    personaId: string;
  }): Promise<string | undefined> {
    const { file, personaId } = options;
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
        uid: `${uid}/personas/${personaId}`,
      });
    } catch (error) {
      this.warn('_uploadAvatar:failed', error);
      return undefined;
    }
  }

  private _loadFromStorage(): void {
    try {
      const stored = localStorage.getItem('aikami-characters');
      if (stored) {
        const parsed = JSON.parse(stored) as SavedPersona[];
        // Sort newest first
        this.personas = parsed.sort(
          (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
        );
      }
    } catch (error) {
      this.warn('_loadFromStorage:failed', error);
    }
  }

  private async _loadFromLocalTable(): Promise<void> {
    try {
      const localPersonas = await personaService.getPersonas('local');

      if (localPersonas.length > 0) {
        // Merge local-table personas into the local list
        // Local-table personas take precedence for matching IDs
        const mergedMap = new Map<string, SavedPersona>();

        // Start with localStorage personas
        for (const sp of this.personas) {
          mergedMap.set(sp.persona.id, sp);
        }

        // Overlay local-table personas (more authoritative)
        for (const fp of localPersonas) {
          if (!fp.id) {
            continue;
          }
          const existing = mergedMap.get(fp.id);
          mergedMap.set(fp.id, {
            persona: fp,
            avatarUrl: fp.avatarUrl || existing?.avatarUrl || '',
            savedAt: existing?.savedAt || new Date().toISOString(),
          });
        }

        // Convert back to sorted array
        this.personas = Array.from(mergedMap.values()).sort(
          (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
        );
      }
    } catch (error) {
      this.warn('_loadFromLocalTable:failed', error);
    }
  }

  private _saveToStorage(personas: SavedPersona[]): void {
    try {
      localStorage.setItem('aikami-characters', JSON.stringify(personas));
    } catch (error) {
      this.error('_saveToStorage:failed', error);
    }
  }
}

export const getPersonaListViewModel = (
  options: PersonaListViewModelOptions,
): PersonaListViewModelInterface => PersonaListViewModel.create(options);
