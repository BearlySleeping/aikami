// apps/frontend/pwa/src/lib/client/services/character/character.svelte.ts
import { BaseFrontendClass, type BaseFrontendClassOptions } from '@aikami/frontend/services';
import { toAppError } from '@aikami/utils';
import { authService, storageService } from '$services';
import type { Character } from '$types';
import { downloadFromUrl } from './character_downloader.ts';
import { importFromJson, importFromPng } from './character_importer.ts';

export type CharacterServiceOptions = BaseFrontendClassOptions;

/**
 * Service interface for managing characters in the application.
 */
export type CharacterServiceInterface = {
  /**
   * List of all imported characters currently in state.
   * @readonly Modify this list using the `addCharacter` method.
   */
  readonly characters: Character[];

  /**
   * The currently selected character for chat or editing.
   * @readonly Modify this state using the `selectCharacter` method.
   */
  readonly selectedCharacter: Character | undefined;

  /**
   * Parses a character from a local file (PNG or JSON) without uploading assets.
   * * @param options - Configuration object.
   * @param options.file - The local file to parse.
   * @returns A promise that resolves to the parsed Character object.
   */
  importFile(options: { file: File }): Promise<Character>;

  /**
   * Parses a character from a local file and simultaneously uploads its avatar to storage.
   * * @param options - Configuration object.
   * @param options.file - The local file to parse and extract the avatar from.
   * @param options.characterId - The database ID to associate with the uploaded avatar.
   * @returns A promise that resolves to the parsed Character object, updated with the remote avatar URL.
   */
  importFileWithAvatar(options: { file: File; characterId: string }): Promise<Character>;

  /**
   * Downloads a character card from a remote URL, parses it, and uploads the avatar to storage.
   * * @param options - Configuration object.
   * @param options.url - The external URL to download the character from (e.g., Chub, Risu).
   * @param options.characterId - The database ID to associate with the uploaded avatar.
   * @returns A promise that resolves to the parsed Character object, updated with the remote avatar URL.
   */
  importFromUrl(options: { url: string; characterId: string }): Promise<Character>;

  /**
   * Appends a newly parsed or fetched character to the active state list.
   * * @param options - Configuration object.
   * @param options.character - The character object to add.
   */
  addCharacter(options: { character: Character }): void;

  /**
   * Sets the active character in the application state.
   * * @param options - Configuration object.
   * @param options.character - The character object to set as active.
   */
  selectCharacter(options: { character: Character }): void;

  /**
   * Uploads an avatar image file to Firebase storage.
   * * @param options - Configuration object.
   * @param options.file - The image file to upload.
   * @param options.characterId - The character document ID used to build the storage path.
   * @returns A promise that resolves to the uploaded avatar's download URL, or undefined if it fails.
   */
  uploadAvatar(options: { file: File; characterId: string }): Promise<string | undefined>;
};

class CharacterService
  extends BaseFrontendClass<CharacterServiceOptions>
  implements CharacterServiceInterface
{
  characters: Character[] = $state([]);
  selectedCharacter: Character | undefined = $state(undefined);

  async importFile(options: { file: File }): Promise<Character> {
    this.debug('handleFileUpload', options);

    const { file } = options;
    const { character } = await this._extractCharacter({ file });
    this.addCharacter({ character });
    return character;
  }

  async importFileWithAvatar(options: { file: File; characterId: string }): Promise<Character> {
    this.debug('importFileWithAvatar', options);
    const { file, characterId } = options;
    const { character, avatarFile } = await this._extractCharacter({ file });

    if (avatarFile) {
      const avatarUrl = await this.uploadAvatar({ file: avatarFile, characterId });
      if (avatarUrl) {
        character.avatarUrl = avatarUrl;
      }
    }

    this.addCharacter({ character });
    return character;
  }

  async importFromUrl(options: { url: string; characterId: string }): Promise<Character> {
    this.debug('importFromUrl', options);
    const { url, characterId } = options;

    const file = await downloadFromUrl({ url });
    return this.importFileWithAvatar({ file, characterId });
  }
  async _extractCharacter(options: { file: File }) {
    this.debug('_extractCharacter', options);
    const { file } = options;

    if (file.type === 'image/png') {
      return await importFromPng({ file });
    }

    if (file.type === 'application/json' || file.name.endsWith('.json')) {
      return await importFromJson({ file });
    }

    throw toAppError({
      errorType: 'invalid-argument',
      errorMessage: 'Unsupported file type. Please upload a PNG or JSON file.',
    });
  }

  async uploadAvatar(options: { file: File; characterId: string }): Promise<string | undefined> {
    this.debug('uploadAvatar', options);
    const { file, characterId } = options;
    const uid = authService.uid;

    if (!uid) {
      throw toAppError({
        errorType: 'unauthorized',
        errorMessage: 'Cannot upload avatar: User is not logged in.',
      });
    }

    try {
      return await storageService.uploadAvatar({
        file,
        uid: `${uid}/characters/${characterId}`,
      });
    } catch (error) {
      this.error('uploadAvatar failed', error);
      return undefined;
    }
  }

  addCharacter(options: { character: Character }): void {
    this.debug('addCharacter', options);
    this.characters.push(options.character);
  }

  selectCharacter(options: { character: Character }): void {
    this.debug('selectCharacter', options);
    this.selectedCharacter = options.character;
  }
}

export const characterService: CharacterServiceInterface = new CharacterService({
  className: 'CharacterService',
});
