/** biome-ignore-all lint/style/useNamingConvention: Character card format uses snake_case fields */
// apps/frontend/client/src/lib/services/character/character-importer.ts

import { AIKAMI_PNG_CHUNK_KEYWORD } from '@aikami/constants';
import type {
  AikamiCharacterCard,
  Character,
  CharacterBook,
  CharacterBookEntry,
  CharacterCardV3,
  CharacterCardV3Asset,
} from '@aikami/types';
import { toAppError } from '@aikami/utils';
import { logger } from '$logger';
import { type NormalizedBook, normalizeCharacterBook } from './character_book_mapper.ts';
import { isV1Card, isV2Card, isV3Card } from './character_validator.ts';
import { extractTextChunks, isPng } from './png_utils.ts';

export type CharacterImportResult = {
  character: Character;
  avatarFile?: File;
  /** Normalized lorebook data from the card's character_book, if present. */
  lorebook?: NormalizedBook;
};

/**
 * Extracts the character_book from card data, if present.
 * Both V2 and V3 store the book at `data.character_book`.
 */
const _extractBook = (options: {
  data: Record<string, unknown>;
  characterName: string;
}): NormalizedBook | undefined => {
  const { data, characterName } = options;
  const rawBook = data.character_book;
  if (!rawBook || typeof rawBook !== 'object') {
    return undefined;
  }

  // Validate that rawBook has the expected structure
  const book = rawBook as Record<string, unknown>;

  // Validate entries is an array
  if (!Array.isArray(book.entries)) {
    logger.warn('character-importer', {
      message: 'character_book.entries is not an array',
      characterName,
    });
    return undefined;
  }

  // Validate each entry has required fields and skip invalid ones
  const validEntries = book.entries.filter((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      logger.warn('character-importer', {
        message: `Entry at index ${index} is not an object`,
        characterName,
      });
      return false;
    }
    const entryObj = entry as Record<string, unknown>;

    // keys must be an array
    if (!Array.isArray(entryObj.keys)) {
      logger.warn('character-importer', {
        message: `Entry at index ${index} has non-array keys`,
        characterName,
      });
      return false;
    }

    // content must be a string
    if (typeof entryObj.content !== 'string') {
      logger.warn('character-importer', {
        message: `Entry at index ${index} has non-string content`,
        characterName,
      });
      return false;
    }

    return true;
  });

  // Create a validated book object with cleaned entries
  const validatedBook: CharacterBook = {
    name: typeof book.name === 'string' ? book.name : undefined,
    description: typeof book.description === 'string' ? book.description : undefined,
    scan_depth: typeof book.scan_depth === 'number' ? book.scan_depth : undefined,
    token_budget: typeof book.token_budget === 'number' ? book.token_budget : undefined,
    recursive_scanning:
      typeof book.recursive_scanning === 'boolean' ? book.recursive_scanning : undefined,
    extensions:
      book.extensions && typeof book.extensions === 'object' && !Array.isArray(book.extensions)
        ? (book.extensions as Record<string, unknown>)
        : {},
    entries: validEntries as CharacterBookEntry[],
  };

  try {
    return normalizeCharacterBook({ book: validatedBook, characterName });
  } catch {
    logger.warn('character-importer', {
      message: 'Failed to normalize character_book',
      characterName,
    });
    return undefined;
  }
};

/**
 * Normalizes a V3 card's `data.assets` array into `extensions.assets`.
 *
 * SillyTavern V3 keeps its extra fields in `data.assets` (an array of
 * {@link CharacterCardV3Asset} descriptors), but the established output
 * contract for imported characters stores card extras in
 * `character.extensions` — the same bag that carries `abilityScores`.
 * Both the PNG (`ccv3`) and JSON import paths route through this so
 * consumers see one shape: `extensions.assets`.
 */
const normalizeV3Data = (options: {
  data: Character & { assets?: CharacterCardV3Asset[] };
}): Character => {
  const { data } = options;
  const { assets, ...rest } = data;
  return {
    ...rest,
    extensions: assets ? { ...rest.extensions, assets } : rest.extensions,
  };
};

const parseBase64Json = (options: { base64: string }) => {
  try {
    const binaryString = atob(options.base64);
    const bytes = new Uint8Array([...binaryString].map((char) => char.charCodeAt(0)));
    const decoded = new TextDecoder().decode(bytes);
    const json = JSON.parse(decoded);

    // C-419: V3 cards arrive in the `ccv3` chunk; their data shape is the
    // same `Character` record as V2 (V3-only fields ride in `data.assets`).
    // Normalize the assets array into extensions.assets like the JSON path.
    if (isV3Card(json)) {
      return normalizeV3Data({ data: (json as CharacterCardV3).data });
    }
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

  // C-419: Parse V3 character cards (tEXt chunk with ccv3 keyword).
  // Previously only detected with a debug log — now parsed like V2 `chara`.
  if (!character && textChunks.ccv3) {
    character = parseBase64Json({ base64: textChunks.ccv3 });
    if (character) {
      logger.debug('character-importer', { message: 'ccv3 chunk parsed' });
    }
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

  // C-439: Extract the embedded lorebook (character_book) from the raw card JSON.
  // Extract from the same chunk that successfully produced the character, so a
  // malformed ccv3 falls back to valid chara containing a book.
  let lorebook: NormalizedBook | undefined;
  let successfulChunkKeyword: string | undefined;

  if (character) {
    // Determine which chunk produced the character
    if (textChunks[AIKAMI_PNG_CHUNK_KEYWORD]) {
      successfulChunkKeyword = AIKAMI_PNG_CHUNK_KEYWORD;
    } else if (textChunks.ccv3) {
      const parsedCcv3 = parseBase64Json({ base64: textChunks.ccv3 });
      if (parsedCcv3) {
        successfulChunkKeyword = 'ccv3';
      }
    }
    if (!successfulChunkKeyword && textChunks.chara) {
      const parsedChara = parseBase64Json({ base64: textChunks.chara });
      if (parsedChara) {
        successfulChunkKeyword = 'chara';
      }
    }
    if (!successfulChunkKeyword && textChunks.cbar) {
      successfulChunkKeyword = 'cbar';
    }

    // Parse the raw chunk JSON to extract the book before normalization.
    // The book lives in `data.character_book` in both V2 and V3 cards.
    const rawChunkText = successfulChunkKeyword ? textChunks[successfulChunkKeyword] : '';
    if (rawChunkText && (successfulChunkKeyword === 'ccv3' || successfulChunkKeyword === 'chara')) {
      try {
        const binaryString = atob(rawChunkText);
        const bytes = new Uint8Array([...binaryString].map((char) => char.charCodeAt(0)));
        const decoded = new TextDecoder().decode(bytes);
        const rawJson = JSON.parse(decoded);
        const rawData = (rawJson as Record<string, unknown>).data as
          | Record<string, unknown>
          | undefined;
        if (rawData?.character_book) {
          lorebook = _extractBook({
            data: rawData,
            characterName: character.name,
          });
        }
      } catch {
        logger.warn('character-importer', {
          message: 'Failed to extract character_book from PNG chunk',
        });
      }
    }
  }

  const avatarFile = new File([file], `${file.name.replace('.png', '')}_avatar.png`, {
    type: 'image/png',
  });

  return { character, avatarFile, lorebook };
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
  } else if (!character && isV3Card(json)) {
    // C-419: V3 JSON cards parse identically to V2; `data.assets` (an array
    // of asset descriptors) is normalized into extensions.assets for
    // downstream compilation.
    character = normalizeV3Data({ data: (json as CharacterCardV3).data });
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

  // C-439: Extract the embedded lorebook (character_book) from the raw card JSON
  let lorebook: NormalizedBook | undefined;
  if (character) {
    const rawData = (json as Record<string, unknown>).data as Record<string, unknown> | undefined;
    if (rawData?.character_book) {
      lorebook = _extractBook({
        data: rawData,
        characterName: character.name,
      });
    }
  }

  return { character, avatarFile, lorebook };
};
