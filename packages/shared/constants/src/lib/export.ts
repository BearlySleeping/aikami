// packages/shared/constants/src/lib/export.ts
//
// Constants for the export/import system (C-246).

/** Current export format version across all formats. */
export const EXPORT_FORMAT_VERSION = '1.0.0' as const;

/** tEXt chunk keyword for Aikami character data embedded in PNG cards. */
export const AIKAMI_PNG_CHUNK_KEYWORD = 'aikami_character' as const;

/** Character card type discriminators for {@link AikamiCharacterCard.type}. */
export const CHARACTER_CARD_TYPES = ['character', 'npc', 'persona'] as const;

/** Maximum number of messages per EPUB chapter before splitting. */
export const EPUB_MESSAGES_PER_CHAPTER = 40;

/** Maximum file name length for sanitized export file names. */
export const MAX_EXPORT_FILENAME_LENGTH = 100;
