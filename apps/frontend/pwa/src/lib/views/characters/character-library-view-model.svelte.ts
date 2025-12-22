import { characterService } from '$lib/client/services/character-service.svelte';

export class CharacterLibraryViewModel {
    get characters() {
        return characterService.characters;
    }

    async handleFileUpload(files: FileList) {
        for (const file of files) {
            await characterService.importFile(file);
        }
    }

    selectCharacter(char: any) {
        characterService.selectCharacter(char);
    }
}
