import { CharacterImporter } from './character-importer';
import type { Character } from '$lib/types/character';

export class CharacterService {
    characters = $state<Character[]>([]);
    selectedCharacter = $state<Character | null>(null);

    constructor() {
        // TODO: Load from persisted storage (IndexedDB/Firebase)
    }

    async importFile(file: File) {
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

    addCharacter(char: Character) {
        this.characters.push(char);
        // TODO: Persist
    }

    selectCharacter(char: Character) {
        this.selectedCharacter = char;
    }
}

export const characterService = new CharacterService();
