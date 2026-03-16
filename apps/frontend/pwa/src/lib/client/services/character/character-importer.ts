// apps/frontend/pwa/src/lib/client/services/character/character-importer.ts

import { toAppError } from '@aikami/utils';
import { logger } from '$logger';
import type { Character } from '$types';
import { isV1Card, isV2Card } from './character-validator.ts';
import { extractTextChunks, isPng } from './png-utils.ts';

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

    if (isV2Card(json)) return json.data;
    if (json.data) return json.data;
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
 * Imports a character from a PNG file and optionally extracts its avatar.
 * @param options - Options containing the PNG file
 * @returns The parsed character and avatar file
 */
export const importFromPng = async (options: { file: File }): Promise<CharacterImportResult> => {
  const { file } = options;
  const arrayBuffer = await file.arrayBuffer();

  if (!isPng({ buffer: arrayBuffer })) {
    throw toAppError('invalid-argument', 'File is not a valid PNG.');
  }

  const uint8Array = new Uint8Array(arrayBuffer);
  const textChunks = extractTextChunks({ data: uint8Array });

  let character: Character | undefined;

  if (textChunks.ccv3) {
    logger.debug('character-importer', { message: 'CCV3 chunk found, attempting parse' });
  }

  if (!character && textChunks.chara) {
    character = parseBase64Json({ base64: textChunks.chara });
  }

  if (!character && textChunks.cbar) {
    const risuData = parseBase64Json({ base64: textChunks.cbar });
    if (risuData) character = convertRisuAiToCharacter({ data: risuData });
  }

  if (!character) {
    throw toAppError('invalid-argument', 'No valid character data found in PNG.');
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
    throw toAppError('invalid-argument', 'Invalid JSON format.');
  }

  let character: Character | undefined;

  if (isV2Card(json)) {
    character = json.data as Character;
  } else if (isV1Card(json)) {
    character = convertV1ToV2({ data: json });
  } else if ((json as Record<string, unknown>).data) {
    character = (json as Record<string, unknown>).data as Character;
  }

  if (!character) {
    throw toAppError('invalid-argument', 'JSON does not match known character specifications.');
  }

  let avatarFile: File | undefined;
  const avatarDataUri = (json as Record<string, unknown>).avatar as string | undefined;

  if (avatarDataUri?.startsWith('data:image')) {
    avatarFile = await dataUriToFile({ dataUri: avatarDataUri, fileName: 'avatar.png' });
  }

  return { character, avatarFile };
};
