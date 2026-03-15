// apps/frontend/pwa/src/lib/views/characters/list/character-list-view-model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { characterService } from '$services';
import type { Character } from '$types'; // Updated to use the correct alias per skill.md

export type CharacterLibraryViewModelOptions = BaseViewModelOptions;

/**
 * View model interface for the Character Library view.
 * Handles the logic for displaying and importing characters.
 */
export type CharacterLibraryViewModelInterface = BaseViewModelInterface & {
  /**
   * The list of all imported characters.
   */
  readonly characters: Character[];

  /**
   * Handles the file input change event to upload characters.
   * @param options The options object containing the HTML event.
   */
  handleFileUpload(options: { event: Event }): Promise<void>;

  /**
   * Selects a character from the library.
   * @param options The options object containing the character to select.
   */
  selectCharacter(options: { character: Character }): void;
};

class CharacterLibraryViewModel
  extends BaseViewModel<CharacterLibraryViewModelOptions>
  implements CharacterLibraryViewModelInterface
{
  get characters(): Character[] {
    return characterService.characters;
  }

  async handleFileUpload(options: { event: Event }): Promise<void> {
    const { event } = options;
    const target = event.target as HTMLInputElement;

    // Escape early if no files were selected
    if (!target.files) {
      return;
    }

    try {
      for (const file of target.files) {
        await characterService.importFile(file);
      }
    } catch (error) {
      this.error('Failed to upload character file', error);
    } finally {
      // Clear the input value so the same file can be uploaded again if needed
      target.value = '';
    }
  }

  selectCharacter(options: { character: Character }): void {
    const { character } = options;
    characterService.selectCharacter(character);
  }
}

export const getCharacterListViewModel = (
  options: CharacterLibraryViewModelOptions,
): CharacterLibraryViewModelInterface => new CharacterLibraryViewModel(options);
