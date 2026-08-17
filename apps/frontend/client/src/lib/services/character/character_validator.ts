// apps/frontend/client/src/lib/services/character/character-validator.ts
import type { Character, CharacterCardV2, CharacterCardV3 } from '@aikami/types';

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

  const extensions = (cardData as Record<string, unknown>).extensions;

  return (
    Array.isArray((cardData as Record<string, unknown>).alternate_greetings) &&
    Array.isArray((cardData as Record<string, unknown>).tags) &&
    typeof extensions === 'object' &&
    extensions !== null &&
    !Array.isArray(extensions)
  );
};

/**
 * Validates if the given parsed JSON is a valid V3 Character Card.
 * @param data - The parsed JSON data to validate
 * @returns True if valid V3 card, false otherwise
 */
export const isV3Card = (data: unknown): data is CharacterCardV3 => {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const card = data as Record<string, unknown>;
  if (card.spec !== 'chara_card_v3' || card.spec_version !== '3.0') {
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

  // C-419 hardening: extensions must be a non-null, non-array object —
  // malformed cards (null/array) must not be treated as CharacterCardV3
  // before inferAbilityScores dereferences extensions.abilityScores.
  const extensions = (cardData as Record<string, unknown>).extensions;

  return (
    Array.isArray((cardData as Record<string, unknown>).alternate_greetings) &&
    Array.isArray((cardData as Record<string, unknown>).tags) &&
    typeof extensions === 'object' &&
    extensions !== null &&
    !Array.isArray(extensions)
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
