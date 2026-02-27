import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { Character } from '$types/index.ts';
import { CharacterImporter } from './character-importer.ts';

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
   * Adds a character to the characters list.
   * @param char - The character to add
   */
  addCharacter(char: Character): void;

  /**
   * Sets the selected character.
   * @param char - The character to select
   */
  selectCharacter(char: Character): void;
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
    } else if (file.type === 'application/json') {
      char = await CharacterImporter.importFromJson(file);
    }

    if (char) {
      this.addCharacter(char);
    }
    return char;
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
