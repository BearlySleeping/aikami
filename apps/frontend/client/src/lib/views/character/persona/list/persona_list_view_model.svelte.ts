// apps/frontend/client/src/lib/views/character/persona/list/persona_list_view_model.svelte.ts
//
// ViewModel for the Persona List screen. Loads personas from the local
// personas table (C-386b), supports selection (→ /game), deletion, active
// persona management, and navigation to persona creation.
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { PersonaData } from '@aikami/types';
import { toAppError } from '@aikami/utils';
import type {
  AuthServiceInterface,
  CampaignServiceInterface,
  compileCardToPersona,
  hasDeclaredAbilityScores,
  importFromJson,
  importFromPng,
  lorebookStore,
  PersonaServiceInterface,
  RouterServiceInterface,
  StorageServiceInterface,
} from '$services';

// ---------------------------------------------------------------------------
// Capability contracts
// ---------------------------------------------------------------------------

/** Per-install persona persistence. */
export type PersonaListPersonaCapabilities = Pick<
  PersonaServiceInterface,
  'getPersonas' | 'setActivePersona' | 'updatePersona' | 'deletePersona'
>;

/** Identity used for avatar uploads. */
export type PersonaListAuthCapabilities = Pick<AuthServiceInterface, 'initialize' | 'uid'>;

/** Avatar storage. */
export type PersonaListStorageCapabilities = Pick<StorageServiceInterface, 'uploadAvatar'>;

/** Campaign lifecycle around entering play. */
export type PersonaListCampaignCapabilities = Pick<
  CampaignServiceInterface,
  'startNewCampaign' | 'completeSetup'
>;

/** Navigation used by persona selection and creation. */
export type PersonaListRouterCapabilities = Pick<
  RouterServiceInterface,
  'goToRoute' | 'navigateToApp'
>;

/** Resets the transient game-mode state before entering play. */
export type PersonaListGameStateCapabilities = {
  resetAll(): void;
};

/** Card parsing/compilation used by character-card import. */
export type PersonaListCardCapabilities = {
  compileCardToPersona: typeof compileCardToPersona;
  hasDeclaredAbilityScores: typeof hasDeclaredAbilityScores;
  importFromJson: typeof importFromJson;
  importFromPng: typeof importFromPng;
};

/** Lorebook persistence used when a card carries a character_book. */
export type PersonaListLorebookCapabilities = Pick<
  typeof lorebookStore,
  'addLorebook' | 'addEntry' | 'deleteLorebook'
>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A persona entry presented by the list. */
export type SavedPersona = {
  persona: PersonaData;
  avatarUrl: string;
  savedAt: string;
};

export type PersonaListViewModelOptions = BaseViewModelOptions & {
  /** Per-install persona persistence. */
  personas: PersonaListPersonaCapabilities;
  /** Identity capability. */
  auth: PersonaListAuthCapabilities;
  /** Avatar storage capability. */
  storage: PersonaListStorageCapabilities;
  /** Campaign lifecycle capability. */
  campaign: PersonaListCampaignCapabilities;
  /** Navigation capability. */
  router: PersonaListRouterCapabilities;
  /** Game-mode reset capability. */
  gameState: PersonaListGameStateCapabilities;
  /** Card parsing/compilation capability. */
  cards: PersonaListCardCapabilities;
  /** Lorebook persistence capability. */
  lorebook: PersonaListLorebookCapabilities;
};

export type PersonaListViewModelInterface = BaseViewModelInterface & {
  /** All saved personas from the local table, sorted newest first. */
  readonly personas: readonly SavedPersona[];

  /** Whether the list of personas is empty. */
  readonly isEmpty: boolean;

  /** Whether personas are being loaded from the local table. */
  readonly isLoading: boolean;

  /** Whether a card import is in flight. */
  readonly isImporting: boolean;

  /** Import summary message (C-439 AC-4). */
  readonly importSummary: string | undefined;

  /** Clears the import summary after it has been read. */
  clearImportSummary(): void;

  /** Selects a persona and navigates to /game to start playing. */
  selectPersona(options: { id: string }): Promise<void>;

  /** Deletes a persona. */
  deletePersona(options: { id: string }): Promise<void>;

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
  private readonly _personas: PersonaListPersonaCapabilities;
  private readonly _auth: PersonaListAuthCapabilities;
  private readonly _storage: PersonaListStorageCapabilities;
  private readonly _campaign: PersonaListCampaignCapabilities;
  private readonly _router: PersonaListRouterCapabilities;
  private readonly _gameState: PersonaListGameStateCapabilities;
  private readonly _cards: PersonaListCardCapabilities;
  private readonly _lorebook: PersonaListLorebookCapabilities;

  personas: SavedPersona[] = $state([]);
  isLoading = $state(false);
  isImporting = $state(false);
  importSummary: string | undefined = $state();

  constructor(options: PersonaListViewModelOptions) {
    super(options);
    this._personas = options.personas;
    this._auth = options.auth;
    this._storage = options.storage;
    this._campaign = options.campaign;
    this._router = options.router;
    this._gameState = options.gameState;
    this._cards = options.cards;
    this._lorebook = options.lorebook;
  }

  get isEmpty(): boolean {
    return this.personas.length === 0;
  }

  override async initialize(): Promise<void> {
    this.debug('initialize');
    this.isLoading = true;

    try {
      // Load from the local personas table (C-386b) — personas are per-install.
      // This also runs the one-time legacy localStorage import.
      await this._loadFromLocalTable();

      // Wait for Firebase Auth to resolve before checking uid.
      // On direct refresh, auth may not be ready yet (IndexedDB read).
      // this._auth.initialize() is idempotent — returns immediately if already ready.
      await this._auth.initialize();
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
      await this._campaign.startNewCampaign({ contentPackId: 'emberwatch' });
    } catch (error) {
      this.error('selectPersona:start-campaign-failed', error);
      return;
    }

    // Set as active persona if logged in, so Firestore-aware game init can find it
    try {
      await this._personas.setActivePersona(id);
    } catch (error) {
      // Non-critical — boot resolves the active persona from the local table.
      this.debug('selectPersona:setActivePersona-failed', error);
    }

    // Clear any stale state from a previous play session
    this._gameState.resetAll();

    // Transition campaign from creating → playing before the game boot loads it
    this._campaign.completeSetup();

    await this._router.goToRoute('game', {
      queryParameters: undefined,
      pathParameters: undefined,
    });
  }

  /** @inheritdoc */
  async deletePersona(options: { id: string }): Promise<void> {
    const { id } = options;
    try {
      await this._personas.deletePersona(id);
      await this._loadFromLocalTable();
      this.debug('deletePersona', { id, remaining: this.personas.length });
    } catch (error) {
      this.error('deletePersona', error);
    }
  }

  /** @inheritdoc */
  async createPersona(): Promise<void> {
    await this._router.goToRoute('newCampaign', {
      queryParameters: undefined,
      pathParameters: undefined,
    });
  }

  /** @inheritdoc */
  async goBack(): Promise<void> {
    await this._router.navigateToApp();
  }

  /** @inheritdoc */
  async setActivePersona(personaId: string): Promise<void> {
    try {
      await this._personas.setActivePersona(personaId);

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
      const sheet = this._cards.compileCardToPersona({ character });
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

      // Upsert into the authoritative local personas table.
      await this._personas.updatePersona(personaId, persona);
      await this._loadFromLocalTable();

      // C-439 AC-3: Create lorebook from imported card's character_book
      if (lorebook && lorebook.entries.length > 0) {
        let lorebookId: string | undefined;
        try {
          lorebookId = this._lorebook.addLorebook({
            name: lorebook.name,
            description: lorebook.description,
          });
          // Add all entries atomically - if any fails, roll back the lorebook
          for (const entry of lorebook.entries) {
            this._lorebook.addEntry({ lorebookId, entry });
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
              this._lorebook.deleteLorebook({ id: lorebookId });
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
        abilityScoresInferred: !this._cards.hasDeclaredAbilityScores({ character }),
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
      return await this._cards.importFromPng({ file });
    }

    if (file.type === 'application/json' || file.name.endsWith('.json')) {
      return await this._cards.importFromJson({ file });
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
    const uid = this._auth.uid;

    if (!uid) {
      throw toAppError({
        errorType: 'unauthorized',
        errorMessage: 'Cannot upload avatar: User is not logged in.',
      });
    }

    try {
      return await this._storage.uploadAvatar({
        file,
        uid: `${uid}/personas/${personaId}`,
      });
    } catch (error) {
      this.warn('_uploadAvatar:failed', error);
      return undefined;
    }
  }

  private async _loadFromLocalTable(): Promise<void> {
    try {
      const localPersonas = await this._personas.getPersonas('local');

      // Preserve the previously displayed savedAt for rows we already had so
      // the newest-first ordering stays stable across refreshes. New rows fall
      // back to now (getPersonas already returns updated_at DESC).
      const existingById = new Map(this.personas.map((sp) => [sp.persona.id, sp]));

      this.personas = localPersonas
        .filter((persona) => Boolean(persona.id))
        .map((persona) => {
          const existing = existingById.get(persona.id);
          return {
            persona,
            avatarUrl: persona.avatarUrl || existing?.avatarUrl || '',
            savedAt: existing?.savedAt ?? new Date().toISOString(),
          };
        })
        .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
    } catch (error) {
      this.warn('_loadFromLocalTable:failed', error);
    }
  }
}

export const createPersonaListViewModel = (
  options: PersonaListViewModelOptions,
): PersonaListViewModelInterface => PersonaListViewModel.create(options);
