import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/index.ts';
import { authService, storageService } from '$services/index.ts';
import type { Character } from '$types/index.ts';
import { CharacterImporter, type CharacterImportResult } from './character-importer.ts';

export type CharacterServiceOptions = BaseFrontendClassOptions;

/**
 * Service interface for managing characters in the application.
 * Provides methods for importing, adding, and selecting character data.
 */
export type CharacterServiceInterface = BaseFrontendClassInterface & {
  /**
   * List of all imported characters.
   * @readonly - Use addCharacter() to modify
   */
  readonly characters: Character[];

  /**
   * Currently selected character for chat or editing.
   * @readonly - Use selectCharacter() to modify
   */
  readonly selectedCharacter: Character | null;

  /**
   * Imports a character from a file (PNG or JSON).
   * Automatically detects format and parses character data.
   * @param file - The file to import (PNG image or JSON file)
   * @returns The imported Character or null if import failed
   */
  importFile(file: File): Promise<Character | null>;

  /**
   * Imports a character from a file (PNG or JSON) with avatar upload.
   * Automatically detects format, parses character data, and uploads avatar to Firebase.
   * @param file - The file to import (PNG image or JSON file)
   * @param characterId - The character document ID for storing avatar
   * @returns The imported Character with avatarUrl, or null if import failed
   */
  importFileWithAvatar(file: File, characterId: string): Promise<Character | null>;

  /**
   * Adds a character to the characters list.
   * @param char - The character to add
   */
  addCharacter(char: Character): void;

  /**
   * Sets the selected character.
   * @param char - The character to select
   */
  selectCharacter(char: Character): void;

  /**
   * Uploads an avatar image for a character.
   * @param file - The avatar image file
   * @param characterId - The character document ID
   * @returns The uploaded avatar URL or undefined if failed
   */
  uploadAvatar(file: File, characterId: string): Promise<string | undefined>;
};

class CharacterService
  extends BaseFrontendClass<CharacterServiceOptions>
  implements CharacterServiceInterface
{
  characters: Character[] = $state([]);
  selectedCharacter: Character | null = $state(null);

  async importFile(file: File): Promise<Character | null> {
    let char: Character | null = null;
    if (file.type === 'image/png') {
      char = await CharacterImporter.importFromPng(file);
    } else if (file.type === 'application/json' || file.name.endsWith('.json')) {
      char = await CharacterImporter.importFromJson(file);
    }

    if (char) {
      this.addCharacter(char);
    }
    return char;
  }

  async importFileWithAvatar(file: File, characterId: string): Promise<Character | null> {
    let importResult: CharacterImportResult | null = null;

    if (file.type === 'image/png') {
      importResult = await CharacterImporter.importFromPngWithAvatar(file);
    } else if (file.type === 'application/json' || file.name.endsWith('.json')) {
      importResult = await CharacterImporter.importFromJsonWithAvatar(file);
    }

    if (!importResult) return null;

    const { character } = importResult;

    if (importResult.avatarFile) {
      const avatarUrl = await this.uploadAvatar(importResult.avatarFile, characterId);
      if (avatarUrl) {
        character.avatarUrl = avatarUrl;
      }
    }

    this.addCharacter(character);
    return character;
  }

  async uploadAvatar(file: File, characterId: string): Promise<string | undefined> {
    const uid = this._getCurrentUserId();
    if (!uid) {
      this.log('uploadAvatar', { message: 'No user logged in' });
      return undefined;
    }

    try {
      const result = await storageService.uploadAvatar({
        file,
        uid: `${uid}/characters/${characterId}`,
      });
      return result;
    } catch (error) {
      this.error(error);
      return undefined;
    }
  }

  private _getCurrentUserId(): string | undefined {
    return authService.uid;
  }

  addCharacter(char: Character): void {
    this.characters.push(char);
  }

  selectCharacter(char: Character): void {
    this.selectedCharacter = char;
  }
}

export const characterService: CharacterServiceInterface = new CharacterService({
  className: 'CharacterService',
});
