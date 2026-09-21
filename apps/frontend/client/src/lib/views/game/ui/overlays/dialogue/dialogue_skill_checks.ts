// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_skill_checks.ts
//
// Check-type normalisation and bounded stakes for dialogue skill checks
// (C-487). Extracted from the ViewModel so the rules are unit-testable and the
// ViewModel stays within its grandfathered size budget.

import {
  DEFAULT_SKILL_CHECK_STAKES,
  SKILL_CHECK_STAKES,
  type SkillCheckStakes,
} from '@aikami/constants';

/**
 * Normalises a model-authored `checkType` (Title Case, spaces) to the
 * camelCase `SKILL_STAT_MAP` key: "Sleight Of Hand" → "sleightOfHand",
 * "Persuasion" → "persuasion". A direct lookup misses otherwise (C-487 AC-1).
 */
export const normalizeCheckType = (checkType: string): string => {
  const words = checkType.trim().split(/\s+/);
  if (words.length === 1) {
    const word = words[0] ?? '';
    return word.charAt(0).toLowerCase() + word.slice(1);
  }
  return words
    .map((word, index) => {
      const lowercaseWord = word.toLowerCase();
      if (index === 0) {
        return lowercaseWord;
      }
      return lowercaseWord.charAt(0).toUpperCase() + lowercaseWord.slice(1);
    })
    .join('');
};

/** Resolves bounded success/failure stakes for a check type (C-487). */
export const resolveStakes = (checkType: string): SkillCheckStakes =>
  SKILL_CHECK_STAKES[normalizeCheckType(checkType)] ?? DEFAULT_SKILL_CHECK_STAKES;
