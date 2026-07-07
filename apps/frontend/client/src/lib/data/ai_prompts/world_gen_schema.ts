// apps/frontend/client/src/lib/data/ai_prompts/world_gen_schema.ts
//
// TypeBox validation schemas for the LLM world generation response.
// The LLM must return structured JSON matching these schemas.
// All schemas use additionalProperties: false for strict validation.
//
// Contract: C-233

import Type from 'typebox';

// ---------------------------------------------------------------------------
// NPC schema
// ---------------------------------------------------------------------------

/**
 * Schema for a single generated NPC within a world.
 * The LLM must populate all fields from the world concept.
 */
export const WorldGenNpcSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, description: 'NPC display name' }),
    race: Type.String({ minLength: 1, description: 'Species or ancestry' }),
    class: Type.String({ minLength: 1, description: 'Class or profession' }),
    role: Type.String({
      minLength: 1,
      description: 'Narrative role (ally, quest-giver, merchant, antagonist, etc.)',
    }),
    description: Type.String({
      minLength: 10,
      description: 'Vivid 1-2 sentence physical and contextual description',
    }),
    personality: Type.String({
      minLength: 10,
      description: 'Personality traits, mannerisms, and speech patterns',
    }),
  },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// Party arc schema
// ---------------------------------------------------------------------------

/**
 * Schema for a single story chapter / party arc.
 * Each arc defines an adventure chapter with objectives and quest-givers.
 */
export const PartyArcSchema = Type.Object(
  {
    chapter: Type.String({
      minLength: 1,
      description: "Chapter title (e.g. 'Chapter 1: The Awakening')",
    }),
    description: Type.String({
      minLength: 10,
      description: '1-2 sentence overview of what happens in this chapter',
    }),
    objectives: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      description: 'Concrete objectives the party must complete',
    }),
    questGivers: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      description: 'NPC names (must match npcs[].name) who give quests in this chapter',
    }),
  },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// HUD widget blueprint schema
// ---------------------------------------------------------------------------

/**
 * Schema for a HUD widget that should appear in the generated world's UI.
 */
export const HudWidgetBlueprintSchema = Type.Object(
  {
    slot: Type.String({
      minLength: 1,
      description: "HUD slot identifier (e.g. 'top-left', 'top-right', 'bottom-center')",
    }),
    label: Type.String({ minLength: 1, description: 'Display label for the widget' }),
    icon: Type.String({
      minLength: 1,
      description: "Icon identifier (e.g. 'compass', 'star', 'skull')",
    }),
    defaultVisibility: Type.Boolean({
      description: 'Whether this widget is visible by default',
    }),
  },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// Main output schema
// ---------------------------------------------------------------------------

/**
 * Complete world generation output schema.
 * The LLM must return exactly this shape.
 */
export const WorldGenSchema = Type.Object(
  {
    worldName: Type.String({
      minLength: 1,
      maxLength: 100,
      description: 'A compelling name for the generated world',
    }),
    worldDescription: Type.String({
      minLength: 20,
      maxLength: 2000,
      description:
        'A 2-4 paragraph immersive description of the world — its atmosphere, key locations, factions, and overall feel',
    }),
    npcs: Type.Array(WorldGenNpcSchema, {
      minItems: 3,
      maxItems: 12,
      description: 'Key NPCs inhabiting this world (3-12 recommended)',
    }),
    locations: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 3,
      maxItems: 20,
      description: 'Notable location names in this world (3-20)',
    }),
    partyArcs: Type.Array(PartyArcSchema, {
      minItems: 1,
      maxItems: 6,
      description: 'Story arcs / chapters for the adventure (1-6)',
    }),
    hudWidgets: Type.Array(HudWidgetBlueprintSchema, {
      minItems: 1,
      maxItems: 8,
      description: "HUD widget blueprints for this world's UI (1-8)",
    }),
  },
  { additionalProperties: false },
);

/** Inferred TypeScript type from the output schema. */
export type WorldGenOutput = Type.Static<typeof WorldGenSchema>;

/** Schema for validating LLM world generation input (sent to the LLM). */
export const WorldGenInputSchema = Type.Object(
  {
    genre: Type.String({ minLength: 1, description: 'Story genre' }),
    tone: Type.String({ minLength: 1, description: 'Narrative tone' }),
    setting: Type.String({ minLength: 1, description: 'World setting description' }),
    difficulty: Type.String({ minLength: 1, description: 'Difficulty level' }),
    goals: Type.String({ minLength: 1, description: 'Player goals and plot hooks' }),
  },
  { additionalProperties: false },
);
