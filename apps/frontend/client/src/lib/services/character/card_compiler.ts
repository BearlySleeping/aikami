// apps/frontend/client/src/lib/services/character/card_compiler.ts
//
// Compiles a parsed SillyTavern character card into Aikami's persona/NPC
// sheet schemas (C-419). A card is a persona or an NPC — never a campaign.
//
// The compiler maps the card-format `Character` record into
// `PersonaSheetSchema` / `NpcSheetSchema` fields, always attaching the six
// ability scores via {@link inferAbilityScores}. The result is schema-valid
// without a parallel type: imported cards land in the existing
// personas/npcs tables.
//
// Field mapping follows the established `convertAikamiCardToCharacter`
// precedent (character_importer.ts) applied in reverse:
//
// | Card field       | PersonaSheetSchema  | NpcSheetSchema     |
// |------------------|---------------------|--------------------|
// | name             | name                | name               |
// | description      | background          | notes              |
// | personality      | personalityTraits   | personality        |
// | scenario         | notes               | scenario           |
// | first_mes        | —                   | firstMessage       |
// | system_prompt    | —                   | systemPrompt       |
// | tags             | tags (extensions)   | tags (extensions)  |

import type { NpcSheet, PersonaSheet } from '@aikami/schemas';
import type { Character } from '@aikami/types';
import { inferAbilityScores } from './ability_score_inference.ts';

/** Result of compiling a parsed card into an Aikami sheet shape. */
export type CardCompilationResult = {
  /** The compiled sheet (PersonaSheetSchema or NpcSheetSchema shape). */
  readonly sheet: PersonaSheet | NpcSheet;
  /** True when the card declared no scores and the default array was used. */
  readonly abilityScoresInferred: boolean;
};

/** Compiles a card into a persona sheet (AC-1 field mapping). */
export const compileCardToPersona = (options: { character: Character }): PersonaSheet => {
  const { character } = options;
  const abilityScores = inferAbilityScores({ character });
  return {
    name: character.name || 'Unnamed Character',
    // PersonaSheetSchema has no description/personality/scenario keys —
    // description → background, personality → personalityTraits,
    // scenario → notes (contract AC-1).
    background: character.description || undefined,
    personalityTraits: character.personality || undefined,
    notes: character.scenario || character.creator_notes || undefined,
    abilityScores,
  };
};

/** Compiles a card into an NPC sheet (NPC import mapping). */
export const compileCardToNpc = (options: { character: Character }): NpcSheet => {
  const { character } = options;
  const abilityScores = inferAbilityScores({ character });
  return {
    name: character.name || 'Unnamed Character',
    // NPC sheets keep the card's narrative fields on their own keys.
    notes: character.description || undefined,
    personality: character.personality || undefined,
    scenario: character.scenario || undefined,
    firstMessage: character.first_mes || undefined,
    systemPrompt: character.system_prompt || undefined,
    abilityScores,
  };
};

/** Whether the card declared explicit ability scores (AC-2 inference flag). */
export const hasDeclaredAbilityScores = (options: { character: Character }): boolean => {
  const { character } = options;
  const raw = character.extensions.abilityScores;
  return (
    typeof raw === 'object' &&
    raw !== null &&
    !Array.isArray(raw) &&
    Object.values(raw as Record<string, unknown>).some(
      (value) => typeof value === 'number' && Number.isFinite(value),
    )
  );
};
