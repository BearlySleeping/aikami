import type { Character, CharacterCardV2 } from '$lib/types/character.ts';

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export type CharacterImportResult = {
  character: Character;
  avatarFile?: File;
};

export class CharacterImporter {
  static async importFromPng(file: File): Promise<Character | null> {
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const textChunks = CharacterImporter.extractTextChunks(uint8Array);

    if (textChunks.ccv3) {
    }

    if (textChunks.chara) {
      const decoded = new TextDecoder().decode(base64ToUint8Array(textChunks.chara));
      try {
        const json = JSON.parse(decoded);
        if (json.spec === 'chara_card_v2') {
          return (json as CharacterCardV2).data;
        }
        if (json.data) {
          return json.data as Character;
        }
      } catch (e) {
        console.error('Failed to parse V2 character card', e);
      }
    }

    if (textChunks.cbar) {
      const decoded = new TextDecoder().decode(base64ToUint8Array(textChunks.cbar));
      try {
        const json = JSON.parse(decoded);
        if (json.name && json.description) {
          return CharacterImporter.convertRisuAiToCharacter(json);
        }
      } catch (e) {
        console.error('Failed to parse cbar (RisuAI) character card', e);
      }
    }

    return null;
  }

  static async importFromPngWithAvatar(file: File): Promise<CharacterImportResult | null> {
    const character = await CharacterImporter.importFromPng(file);
    if (!character) return null;

    const avatarFile = await CharacterImporter.extractAvatarFromPng(file);

    return {
      character,
      avatarFile,
    };
  }

  static async extractAvatarFromPng(file: File): Promise<File | undefined> {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      const isPng = pngSignature.every((byte, i) => uint8Array[i] === byte);
      if (!isPng) return undefined;

      const avatarBlob = new Blob([arrayBuffer], { type: 'image/png' });
      const avatarFile = new File([avatarBlob], `${file.name.replace('.png', '')}_avatar.png`, {
        type: 'image/png',
      });

      return avatarFile;
    } catch (e) {
      console.error('Failed to extract avatar from PNG', e);
      return undefined;
    }
  }

  static async importFromJson(file: File): Promise<Character | null> {
    const text = await file.text();
    try {
      const json = JSON.parse(text);
      if (CharacterImporter.isCharacter(json)) {
        return json;
      }
      if (json.spec === 'chara_card_v2') {
        return (json as CharacterCardV2).data;
      }
      if (json.data) {
        return json.data as Character;
      }
      if (json.name && json.description) {
        return CharacterImporter.convertV1ToV2(json);
      }
    } catch (e) {
      console.error('Failed to parse JSON character', e);
    }
    return null;
  }

  static async importFromJsonWithAvatar(file: File): Promise<CharacterImportResult | null> {
    const character = await CharacterImporter.importFromJson(file);
    if (!character) return null;

    let avatarFile: File | undefined;

    const text = await file.text();
    try {
      const json = JSON.parse(text);
      if (json.avatar?.startsWith('data:image')) {
        avatarFile = await CharacterImporter.dataUriToFile(json.avatar, 'avatar.png');
      }
    } catch {
      // Ignore - avatar is optional
    }

    return {
      character,
      avatarFile,
    };
  }

  private static async dataUriToFile(dataUri: string, fileName: string): Promise<File> {
    const response = await fetch(dataUri);
    const blob = await response.blob();
    return new File([blob], fileName, { type: blob.type });
  }

  private static isCharacter(obj: unknown): obj is Character {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      typeof (obj as Record<string, unknown>).name === 'string' &&
      typeof (obj as Record<string, unknown>).first_mes === 'string'
    );
  }

  // biome-ignore lint/suspicious/noExplicitAny: External data from character files has unknown structure
  private static convertRisuAiToCharacter(risuData: any): Character {
    return {
      name: risuData.name || '',
      description: risuData.description || '',
      personality: risuData.personality || '',
      scenario: risuData.scenario || risuData.world_scenario || '',
      first_mes: risuData.first_mes || risuData.first_message || '',
      mes_example: risuData.mes_example || '',
      creator_notes: risuData.creator_notes || '',
      system_prompt: risuData.system_prompt || '',
      post_history_instructions: risuData.post_history_instructions || '',
      alternate_greetings: risuData.alternate_greetings || [],
      tags: risuData.tags || [],
      creator: risuData.creator || '',
      character_version: risuData.character_version || '',
      extensions: risuData.extensions || {},
    };
  }

  // biome-ignore lint/suspicious/noExplicitAny: External data from character files has unknown structure
  private static convertV1ToV2(v1: any): Character {
    return {
      name: v1.name || '',
      description: v1.description || '',
      personality: v1.personality || '',
      scenario: v1.scenario || '',
      first_mes: v1.first_mes || '',
      mes_example: v1.mes_example || '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: [],
      creator: '',
      character_version: '',
      extensions: {},
    };
  }

  private static extractTextChunks(data: Uint8Array): Record<string, string> {
    const chunks: Record<string, string> = {};
    let pos = 8;

    while (pos < data.length) {
      if (pos + 8 > data.length) break;

      const length = new DataView(data.buffer).getUint32(pos);
      const type = new TextDecoder().decode(data.slice(pos + 4, pos + 8));

      if (type === 'tEXt') {
        const chunkData = data.slice(pos + 8, pos + 8 + length);
        let separatorIndex = -1;
        for (let i = 0; i < chunkData.length; i++) {
          if (chunkData[i] === 0) {
            separatorIndex = i;
            break;
          }
        }

        if (separatorIndex !== -1) {
          const key = new TextDecoder().decode(chunkData.slice(0, separatorIndex));
          const value = new TextDecoder().decode(chunkData.slice(separatorIndex + 1));
          chunks[key] = value;
        }
      }

      pos += 12 + length;
    }

    return chunks;
  }
}
