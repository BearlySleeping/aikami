// apps/frontend/client/src/lib/services/character/character-validator.ts
import type { Character, CharacterCardV2 } from '@aikami/types';

/**
 * Validates if the given parsed JSON is a valid V2 Character Card.
 * @param data - The parsed JSON data to validate
 * @returns True if valid V2 card, false otherwise
 */
export const isV2Card = (data: unknown): data is CharacterCardV2 => {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const card = data as Record<string, unknown>;
  if (card.spec !== 'chara_card_v2' || card.spec_version !== '2.0') {
    return false;
  }

  const cardData = card.data;
  if (typeof cardData !== 'object' || cardData === null) {
    return false;
  }

  const requiredFields = [
    'name',
    'description',
    'personality',
    'scenario',
    'first_mes',
    'mes_example',
    'creator_notes',
    'system_prompt',
    'post_history_instructions',
    'alternate_greetings',
    'tags',
    'creator',
    'character_version',
    'extensions',
  ];

  const hasAllFields = requiredFields.every((field) => Object.hasOwn(cardData, field));
  if (!hasAllFields) {
    return false;
  }

  return (
    Array.isArray((cardData as Record<string, unknown>).alternate_greetings) &&
    Array.isArray((cardData as Record<string, unknown>).tags) &&
    typeof (cardData as Record<string, unknown>).extensions === 'object'
  );
};

/**
 * Validates if the given parsed JSON matches the fallback V1 specification.
 * @param data - The parsed JSON data to validate
 * @returns True if valid V1 character, false otherwise
 */
export const isV1Card = (data: unknown): data is Character => {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const requiredFields = [
    'name',
    'description',
    'personality',
    'scenario',
    'first_mes',
    'mes_example',
  ];

  return requiredFields.every((field) => Object.hasOwn(data as Record<string, unknown>, field));
};
