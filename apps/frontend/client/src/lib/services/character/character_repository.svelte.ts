// apps/frontend/client/src/lib/services/character/character_repository.svelte.ts
//
// CharacterRepository — abstracted localStorage persistence for locally-saved
// personas/characters. Replaces direct `localStorage.getItem('aikami-characters')`
// scattered across StartViewModel, PersonaCreateViewModel, and GameEngineService.
//
// C-313: A character is not a game. Characters are saved independently from
// campaigns and save slots. This repository provides a single access point
// for local character CRUD operations.

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { PersonaData } from '@aikami/types';

// ---------------------------------------------------------------------------
// Persisted character shape (what lives in localStorage)
// ---------------------------------------------------------------------------

export type LocalCharacterEntry = {
  persona: PersonaData;
  avatarUrl?: string;
  savedAt: string;
};

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type CharacterRepositoryInterface = BaseFrontendClassInterface & {
  /** Returns all locally-saved character entries (sorted newest first). */
  getAll(): LocalCharacterEntry[];

  /** Returns the number of locally-saved characters. */
  count(): number;

  /** Saves or updates a character entry. Replaces existing by persona.id. */
  save(entry: LocalCharacterEntry): void;

  /** Removes a character by persona ID. */
  remove(personaId: string): void;

  /** Returns the most recently saved character, or undefined. */
  getMostRecent(): LocalCharacterEntry | undefined;

  /** Returns true if any character is saved locally. */
  hasAny(): boolean;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'aikami-characters';

class CharacterRepository
  extends BaseFrontendClass<BaseFrontendClassOptions>
  implements CharacterRepositoryInterface
{
  /** @inheritdoc */
  getAll(): LocalCharacterEntry[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        return [];
      }
      const parsed = JSON.parse(stored) as unknown[];
      if (!Array.isArray(parsed)) {
        return [];
      }
      // Sort newest first
      return (parsed as LocalCharacterEntry[]).sort(
        (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
      );
    } catch {
      return [];
    }
  }

  /** @inheritdoc */
  count(): number {
    return this.getAll().length;
  }

  /** @inheritdoc */
  save(entry: LocalCharacterEntry): void {
    try {
      const characters = this._getRawArray();
      const idx = characters.findIndex(
        (c: LocalCharacterEntry) => c.persona?.id === entry.persona.id,
      );
      if (idx >= 0) {
        characters[idx] = entry;
      } else {
        characters.push(entry);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(characters));
    } catch (error) {
      this.warn('save:failed', error);
    }
  }

  /** @inheritdoc */
  remove(personaId: string): void {
    try {
      const characters = this._getRawArray().filter(
        (c: LocalCharacterEntry) => c.persona?.id !== personaId,
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(characters));
    } catch (error) {
      this.warn('remove:failed', error);
    }
  }

  /** @inheritdoc */
  getMostRecent(): LocalCharacterEntry | undefined {
    return this.getAll()[0];
  }

  /** @inheritdoc */
  hasAny(): boolean {
    return this.count() > 0;
  }

  // ── Private ──

  private _getRawArray(): LocalCharacterEntry[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        return [];
      }
      const parsed = JSON.parse(stored) as unknown[];
      return Array.isArray(parsed) ? (parsed as LocalCharacterEntry[]) : [];
    } catch {
      return [];
    }
  }
}

/** Singleton instance. */
export const characterRepository: CharacterRepositoryInterface = CharacterRepository.create({
  className: 'CharacterRepository',
});
