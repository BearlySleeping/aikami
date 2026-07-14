/** biome-ignore-all lint/style/useNamingConvention: Character card format uses snake_case fields */
// apps/frontend/client/src/lib/services/character/character-importer.ts

import { AIKAMI_PNG_CHUNK_KEYWORD } from '@aikami/constants';
import type { AikamiCharacterCard, Character } from '@aikami/types';
import { toAppError } from '@aikami/utils';
import { logger } from '$logger';
import { isV1Card, isV2Card } from './character_validator.ts';
import { extractTextChunks, isPng } from './png_utils.ts';

export type CharacterImportResult = {
  character: Character;
  avatarFile?: File;
};

const parseBase64Json = (options: { base64: string }) => {
  try {
    const binaryString = atob(options.base64);
    const bytes = new Uint8Array([...binaryString].map((char) => char.charCodeAt(0)));
    const decoded = new TextDecoder().decode(bytes);
    const json = JSON.parse(decoded);

    if (isV2Card(json)) {
      return json.data;
    }
    if (json.data) {
      return json.data;
    }
    return json;
  } catch {
    return undefined;
  }
};

const dataUriToFile = async (options: { dataUri: string; fileName: string }): Promise<File> => {
  const response = await fetch(options.dataUri);
  const blob = await response.blob();
  return new File([blob], options.fileName, { type: blob.type });
};

// biome-ignore lint/suspicious/noExplicitAny: external data format conversion
const convertV1ToV2 = (options: { data: any }): Character => {
  const { data } = options;
  return {
    name: data.name || '',
    description: data.description || '',
    personality: data.personality || '',
    scenario: data.scenario || '',
    first_mes: data.first_mes || '',
    mes_example: data.mes_example || '',
    creator_notes: '',
    system_prompt: '',
    post_history_instructions: '',
    alternate_greetings: [],
    tags: [],
    creator: '',
    character_version: '',
    extensions: {},
  };
};

// biome-ignore lint/suspicious/noExplicitAny: external data format conversion
const convertRisuAiToCharacter = (options: { data: any }): Character => {
  const { data } = options;
  return {
    name: data.name || '',
    description: data.description || '',
    personality: data.personality || '',
    scenario: data.scenario || data.world_scenario || '',
    first_mes: data.first_mes || data.first_message || '',
    mes_example: data.mes_example || '',
    creator_notes: data.creator_notes || '',
    system_prompt: data.system_prompt || '',
    post_history_instructions: data.post_history_instructions || '',
    alternate_greetings: data.alternate_greetings || [],
    tags: data.tags || [],
    creator: data.creator || '',
    character_version: data.character_version || '',
    extensions: data.extensions || {},
  };
};

/**
 * Converts an AikamiCharacterCard (full D&D sheet) to the simpler Character
 * card format used by the character import flow.
 */
const convertAikamiCardToCharacter = (options: { card: AikamiCharacterCard }): Character => {
  const { card } = options;
  const sheet = card.character;
  return {
    name: sheet.name || '',
    description: sheet.background || '',
    personality: sheet.personalityTraits || '',
    scenario: '',
    first_mes: '',
    mes_example: '',
    creator_notes: sheet.notes || '',
    system_prompt: '',
    post_history_instructions: '',
    alternate_greetings: [],
    tags: [],
    creator: '',
    character_version: '',
    extensions: {},
    avatarUrl: card.avatarUrl,
  };
};

/**
 * Imports a character from a PNG file and optionally extracts its avatar.
 * @param options - Options containing the PNG file
 * @returns The parsed character and avatar file
 */
export const importFromPng = async (options: { file: File }): Promise<CharacterImportResult> => {
  const { file } = options;
  const arrayBuffer = await file.arrayBuffer();

  if (!isPng({ buffer: arrayBuffer })) {
    throw toAppError({
      errorType: 'invalid-argument',
      errorMessage: 'File is not a valid PNG.',
    });
  }

  const uint8Array = new Uint8Array(arrayBuffer);
  const textChunks = extractTextChunks({ data: uint8Array });

  let character: Character | undefined;

  // C-246: Detect Aikami character card (tEXt chunk with aikami_character keyword)
  if (!character && textChunks[AIKAMI_PNG_CHUNK_KEYWORD]) {
    try {
      const card: AikamiCharacterCard = JSON.parse(textChunks[AIKAMI_PNG_CHUNK_KEYWORD]);
      if (card.formatVersion && card.type && card.character?.name) {
        character = convertAikamiCardToCharacter({ card });
        logger.debug('character-importer', { message: 'aikami_character chunk parsed' });
      }
    } catch {
      logger.debug('character-importer', { message: 'aikami_character chunk JSON parse failed' });
      throw toAppError({
        errorType: 'invalid-argument',
        errorMessage: 'This card appears to be damaged. The character data could not be read.',
      });
    }
  }

  if (textChunks.ccv3) {
    logger.debug('character-importer', { message: 'CCV3 chunk found, attempting parse' });
  }

  if (!character && textChunks.chara) {
    character = parseBase64Json({ base64: textChunks.chara });
  }

  if (!character && textChunks.cbar) {
    const risuData = parseBase64Json({ base64: textChunks.cbar });
    if (risuData) {
      character = convertRisuAiToCharacter({ data: risuData });
    }
  }

  if (!character) {
    throw toAppError({
      errorType: 'invalid-argument',
      errorMessage: 'No valid character data found in PNG.',
    });
  }

  const avatarFile = new File([file], `${file.name.replace('.png', '')}_avatar.png`, {
    type: 'image/png',
  });

  return { character, avatarFile };
};

/**
 * Imports a character from a JSON file.
 * @param options - Options containing the JSON file
 * @returns The parsed character and optional base64 avatar converted to File
 */
export const importFromJson = async (options: { file: File }): Promise<CharacterImportResult> => {
  const { file } = options;
  const text = await file.text();
  let json: unknown;

  try {
    json = JSON.parse(text);
  } catch {
    throw toAppError({
      errorType: 'invalid-argument',
      errorMessage: 'Invalid JSON format.',
    });
  }

  let character: Character | undefined;

  // C-246: Detect Aikami character card JSON format
  const maybeCard = json as Partial<AikamiCharacterCard>;
  if (maybeCard.formatVersion && maybeCard.type && maybeCard.character?.name) {
    try {
      character = convertAikamiCardToCharacter({ card: json as AikamiCharacterCard });
      logger.debug('character-importer', { message: 'aikami.json card parsed' });
    } catch {
      throw toAppError({
        errorType: 'invalid-argument',
        errorMessage: 'This card appears to be damaged. The character data could not be read.',
      });
    }
  }

  if (!character && isV2Card(json)) {
    character = json.data as Character;
  } else if (isV1Card(json)) {
    character = convertV1ToV2({ data: json });
  } else if ((json as Record<string, unknown>).data) {
    character = (json as Record<string, unknown>).data as Character;
  }

  if (!character) {
    throw toAppError({
      errorType: 'invalid-argument',
      errorMessage: 'JSON does not match known character specifications.',
    });
  }

  let avatarFile: File | undefined;

  // C-246: Extract avatar from Aikami card if available
  if (maybeCard.avatarBase64?.startsWith('data:image')) {
    avatarFile = await dataUriToFile({ dataUri: maybeCard.avatarBase64, fileName: 'avatar.png' });
  }

  const avatarDataUri = (json as Record<string, unknown>).avatar as string | undefined;

  if (!avatarFile && avatarDataUri?.startsWith('data:image')) {
    avatarFile = await dataUriToFile({ dataUri: avatarDataUri, fileName: 'avatar.png' });
  }

  return { character, avatarFile };
};
