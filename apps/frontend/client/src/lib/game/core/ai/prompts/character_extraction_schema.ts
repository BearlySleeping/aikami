// apps/frontend/client/src/lib/game/core/ai/prompts/character_extraction_schema.ts
//
// Character extraction configuration. Uses a STRICT subset of PersonaSchema
// that requires essential fields — name, race, class, background, appearance,
// and abilityScores. The LLM MUST populate these from the conversation.
// After extraction, the result is merged with PersonaSchema defaults.
//
// Contract: C-081

import {
  AbilityScoresSchema,
  AlignmentSchema,
  BackgroundSchema,
  ClassSchema,
  RaceSchema,
} from '@aikami/schemas';
import Type from 'typebox';
import { getLpcCatalogPrompt } from '$lib/data/lpc_asset_catalog_generated';

// ---------------------------------------------------------------------------
// Strict extraction schema — requires essential fields
// ---------------------------------------------------------------------------

/**
 * Schema sent to the LLM. Only REQUIRED fields are included here.
 * The LLM MUST return these. Optional persona fields are handled by
 * the merge step in the view model.
 */
export const CharacterExtractionSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, description: 'Character name' }),
    race: RaceSchema,
    class: ClassSchema,
    background: Type.String({ minLength: 1, description: 'Character background story' }),
    alignment: AlignmentSchema,
    abilityScores: AbilityScoresSchema,
    appearance: Type.Object(
      {
        physicalDescription: Type.String({
          minLength: 1,
          description: 'Vivid physical description for image generation',
        }),
        age: Type.Optional(Type.String({ description: 'Age' })),
        height: Type.Optional(Type.String({ description: 'Height' })),
        weight: Type.Optional(Type.String({ description: 'Weight' })),
        eyeColor: Type.Optional(Type.String({ description: 'Eye color' })),
        hairColor: Type.Optional(Type.String({ description: 'Hair color' })),
        skinColor: Type.Optional(Type.String({ description: 'Skin color' })),
        distinguishingMarks: Type.Optional(
          Type.String({ description: 'Scars, tattoos, or other distinguishing marks' }),
        ),
      },
      { additionalProperties: false },
    ),
    personalityTraits: Type.Optional(Type.String({ description: 'Personality traits' })),
    ideals: Type.Optional(Type.String({ description: 'Ideals' })),
    bonds: Type.Optional(Type.String({ description: 'Bonds' })),
    flaws: Type.Optional(Type.String({ description: 'Flaws' })),
    subclass: Type.Optional(Type.String({ description: 'Subclass' })),
    level: Type.Optional(
      Type.Integer({ description: 'Level', minimum: 1, maximum: 20, default: 1 }),
    ),
    proficiencies: Type.Optional(
      Type.Array(Type.String(), { description: 'Proficiencies to assign' }),
    ),
    languages: Type.Optional(
      Type.Array(Type.String(), { description: 'Additional languages beyond Common' }),
    ),
    equipment: Type.Optional(Type.Array(Type.String(), { description: 'Starting equipment' })),
    lpcRecipe: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description:
          'LPC sprite component mapping. Each key is a slot name (e.g. "head", "body", "hair") and the value is the asset ID from the catalog below. Choose assets that best match the character\'s appearance.',
      }),
    ),
  },
  { additionalProperties: false },
);

/** Inferred TypeScript type from the extraction schema. */
export type ExtractedCharacter = Type.Static<typeof CharacterExtractionSchema>;

// ---------------------------------------------------------------------------
// Extraction system prompt
// ---------------------------------------------------------------------------

/**
 * System prompt for the extraction phase. Emphasises that core fields
 * are REQUIRED and must be derived from the conversation.
 */
export const CHARACTER_EXTRACTION_SYSTEM_PROMPT =
  `You are a Dungeon Master finalizing a character creation session.

Review the conversation history and extract the final character persona as a strictly-typed JSON object.

## LPC Sprite Generation
Below is a catalog of available LPC (Liberated Pixel Cup) sprite components. After extracting the character data, also populate the optional **lpcRecipe** field with a mapping from slot name → asset ID for the slots that best match the character's appearance.

${getLpcCatalogPrompt()}

## CRITICAL — Required Fields
These fields MUST be populated with content from the conversation. If a field's value was NOT explicitly discussed, creatively infer a reasonable value based on the character's concept, species, and class. NEVER leave these empty:

1. **name** — The character's name. If not given, create an appropriate fantasy name matching their species and class.
2. **race** — The character's species (e.g., Elf, Human, Tiefling, Dragonborn).
3. **class** — The character's class (e.g., Wizard, Rogue, Paladin).
4. **background** — A 2-4 sentence story describing the character's origin and how they became their class.
5. **alignment** — One of: Lawful Good, Neutral Good, Chaotic Good, Lawful Neutral, True Neutral, Chaotic Neutral, Lawful Evil, Neutral Evil, Chaotic Evil.
6. **abilityScores** — All six scores (strength, dexterity, constitution, intelligence, wisdom, charisma) as integers. Use the 2024 standard array (15, 14, 13, 12, 10, 8) optimised for the class.
7. **appearance.physicalDescription** — A vivid, detailed description for portrait generation including hair, eyes, build, skin tone, species-specific traits, clothing style.

## Optional Fields
Populate these from the conversation if available, otherwise omit:
- age, height, weight, eyeColor, hairColor, skinColor, distinguishingMarks
- personalityTraits, ideals, bonds, flaws
- subclass, level
- proficiencies, languages, equipment

Respond ONLY with the JSON object defined by the schema. No markdown fences, no explanations.` as const;
