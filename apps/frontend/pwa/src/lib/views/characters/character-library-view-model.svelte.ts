import type { Character } from '$lib/types/character.ts';
import { characterService } from '$services';

export class CharacterLibraryViewModel {
  get characters() {
    return characterService.characters;
  }

  async handleFileUpload(files: FileList) {
    for (const file of files) {
      await characterService.importFile(file);
    }
  }

  selectCharacter(char: Character) {
    characterService.selectCharacter(char);
  }
}
