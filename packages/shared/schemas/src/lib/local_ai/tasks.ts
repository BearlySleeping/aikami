// packages/shared/schemas/src/lib/local_ai/tasks.ts
//
// Local micro-task declarations (C-427). Each task defines its input schema,
// output schema, system prompt, and repair policy. Used by LocalTaskPool
// to validate, repair, and dispatch tasks to the local text engine.
//
// Expression and battle-trigger tasks target ≥80% exact match accuracy;
// relationship targets ≥70%. Tasks below their bar ship disabled.

import Type from 'typebox';

// ---------------------------------------------------------------------------
// Expression task
// ---------------------------------------------------------------------------

/** Input: a prose snippet describing a character's action or reaction. */
export const ExpressionInputSchema = Type.Object({
  prose: Type.String({ description: 'Narrative prose describing a character action or reaction' }),
  characters: Type.Array(Type.String(), { description: 'Character names present in the scene' }),
});

/** Output: character name → emotion label. */
export const ExpressionOutputSchema = Type.Object({
  name: Type.String({ description: 'Character name' }),
  expression: Type.String({
    description:
      'Detected emotion: happy, sad, angry, surprised, fearful, thoughtful, neutral, disgusted',
  }),
});

// ---------------------------------------------------------------------------
// Battle trigger task
// ---------------------------------------------------------------------------

/** Input: narrative prose that may describe combat. */
export const BattleTriggerInputSchema = Type.Object({
  prose: Type.String({ description: 'Narrative prose that may describe combat' }),
});

/** Output: whether a battle is triggered and who the enemy is. */
export const BattleTriggerOutputSchema = Type.Object({
  battle: Type.Boolean({ description: 'Whether a battle is triggered' }),
  enemy: Type.String({ description: 'Enemy name or empty string if no battle' }),
});

// ---------------------------------------------------------------------------
// Relationship task
// ---------------------------------------------------------------------------

/** Input: a dialogue or interaction snippet. */
export const RelationshipInputSchema = Type.Object({
  speaker: Type.String({ description: 'Name of the speaking character' }),
  target: Type.String({ description: 'Name of the character being addressed' }),
  dialogue: Type.String({ description: 'What was said or described' }),
});

/** Output: relationship change direction and magnitude. */
export const RelationshipOutputSchema = Type.Object({
  change: Type.Union([Type.Literal('improve'), Type.Literal('worsen'), Type.Literal('neutral')]),
  magnitude: Type.Number({
    minimum: 0,
    maximum: 10,
    description: 'How strong the change is (0-10)',
  }),
  reason: Type.String({ description: 'Brief explanation for the change' }),
});

// ---------------------------------------------------------------------------
// Image prompt task
// ---------------------------------------------------------------------------

/** Input: scene description for image generation. */
export const ImagePromptInputSchema = Type.Object({
  scene: Type.String({ description: 'Current scene description' }),
  mood: Type.String({ description: 'Scene mood or atmosphere' }),
  characters: Type.Array(Type.String(), { description: 'Characters present' }),
});

/** Output: an enriched image generation prompt. */
export const ImagePromptOutputSchema = Type.Object({
  prompt: Type.String({ description: 'Enriched image generation prompt' }),
  negativePrompt: Type.Optional(
    Type.String({ description: 'Negative prompt for image generation' }),
  ),
  style: Type.Optional(Type.String({ description: 'Suggested art style' })),
});
