// apps/frontend/client/src/lib/views/character/persona/list/persona_list_view_model.svelte.ts
//
// ViewModel for the Persona List screen. Loads personas from localStorage
// and Firestore (when authenticated), supports selection (→ /game),
// deletion, active persona management, and navigation to persona creation.
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { PersonaData } from '@aikami/types';
import {
  authService,
  campaignService,
  equipmentService,
  gameModeService,
  inventoryService,
  personaService,
  playerStateService,
  routerService,
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

  get isEmpty(): boolean {
    return this.personas.length === 0;
  }

  override async initialize(): Promise<void> {
    this.debug('initialize');
    this.isLoading = true;

    try {
      // Load from localStorage (always available)
      this._loadFromStorage();

      // Load from Firestore if authenticated
      const uid = (authService as { uid?: string }).uid;
      if (uid) {
        await this._loadFromFirestore(uid);
      }
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

      // Refresh from Firestore to get updated active states
      const uid = (authService as { uid?: string }).uid;
      if (uid) {
        await this._loadFromFirestore(uid);
      }
    } catch (error) {
      this.error('setActivePersona', error);
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────

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

  private async _loadFromFirestore(uid: string): Promise<void> {
    try {
      const firestorePersonas = await personaService.getPersonas(uid);

      if (firestorePersonas.length > 0) {
        // Merge Firestore personas into the local list
        // Firestore personas take precedence for matching IDs
        const mergedMap = new Map<string, SavedPersona>();

        // Start with localStorage personas
        for (const sp of this.personas) {
          mergedMap.set(sp.persona.id, sp);
        }

        // Overlay Firestore personas (more authoritative)
        for (const fp of firestorePersonas) {
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
      this.warn('_loadFromFirestore:failed', error);
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
