// apps/frontend/client/src/lib/views/characters/characters_view_model.svelte.ts
//
// ViewModel for the Characters selection screen. Loads characters from
// localStorage, supports selection (→ /game), deletion, and navigation
// to character creation (/setup).
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { PersonaData } from '@aikami/types';
import { gameStateService, routerService } from '$services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A saved character entry from localStorage. */
export type SavedCharacter = {
  persona: PersonaData;
  avatarUrl: string;
  savedAt: string;
};

export type CharactersViewModelOptions = BaseViewModelOptions;

export type CharactersViewModelInterface = BaseViewModelInterface & {
  /** All saved characters from localStorage (sorted newest first). */
  readonly characters: readonly SavedCharacter[];

  /** Whether the list of characters is empty. */
  readonly isEmpty: boolean;

  /** Selects a character and navigates to /game to start playing. */
  selectCharacter(options: { id: string }): Promise<void>;

  /** Deletes a character from localStorage. */
  deleteCharacter(options: { id: string }): void;

  /** Navigates to /setup to create a new character. */
  createCharacter(): Promise<void>;

  /** Navigates back to the start menu. */
  goBack(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class CharactersViewModel
  extends BaseViewModel<CharactersViewModelOptions>
  implements CharactersViewModelInterface
{
  characters: SavedCharacter[] = $state([]);

  get isEmpty(): boolean {
    return this.characters.length === 0;
  }

  override async initialize(): Promise<void> {
    this.debug('initialize');
    this._loadFromStorage();
    await super.initialize();
  }

  /** @inheritdoc */
  async selectCharacter(options: { id: string }): Promise<void> {
    const { id } = options;
    const character = this.characters.find((c) => c.persona.id === id);
    if (!character) {
      this.warn('selectCharacter:not-found', { id });
      return;
    }

    this.debug('selectCharacter', { id, name: character.persona.name });

    // Set as active persona if logged in, so Firestore-aware game init can find it
    try {
      const { personaService } = await import('$lib/services/persona/persona_repository.svelte');
      await personaService.setActivePersona(id);
    } catch (error) {
      // Non-critical — localStorage fallback in GameViewModel handles this
      this.debug('selectCharacter:setActivePersona-failed', error);
    }

    // Clear any stale state from a previous play session
    gameStateService.reset();

    await routerService.goToRoute('game', {
      queryParameters: undefined,
      pathParameters: undefined,
    });
  }

  /** @inheritdoc */
  deleteCharacter(options: { id: string }): void {
    const { id } = options;
    const updated = this.characters.filter((c) => c.persona.id !== id);
    this.characters = updated;
    this._saveToStorage(updated);
    this.debug('deleteCharacter', { id, remaining: updated.length });
  }

  /** @inheritdoc */
  async createCharacter(): Promise<void> {
    await routerService.goToRoute('setup', {
      queryParameters: undefined,
      pathParameters: undefined,
    });
  }

  /** @inheritdoc */
  async goBack(): Promise<void> {
    await routerService.navigateToApp();
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private _loadFromStorage(): void {
    try {
      const stored = localStorage.getItem('aikami-characters');
      if (stored) {
        const parsed = JSON.parse(stored) as SavedCharacter[];
        // Sort newest first
        this.characters = parsed.sort(
          (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
        );
      }
    } catch (error) {
      this.warn('_loadFromStorage:failed', error);
    }
  }

  private _saveToStorage(characters: SavedCharacter[]): void {
    try {
      localStorage.setItem('aikami-characters', JSON.stringify(characters));
    } catch (error) {
      this.error('_saveToStorage:failed', error);
    }
  }
}

export const getCharactersViewModel = (
  options: CharactersViewModelOptions,
): CharactersViewModelInterface => CharactersViewModel.create(options);
