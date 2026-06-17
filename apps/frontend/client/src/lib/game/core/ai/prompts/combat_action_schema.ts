// apps/frontend/client/src/lib/game/core/ai/prompts/combat_action_schema.ts
//
// TypeBox schema for freeform AI combat actions. Enforces the LLM's combat
// output format so the response can be mechanically mapped to ECS bridge
// commands (COMBAT_ACTION with advantage, bonusDamage, and narrative).
//
// Contract: C-146 Freeform AI Combat Actions

import Type from 'typebox';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Strict schema for translating a player's freeform combat narration
 * into mechanical modifiers and DM-style narrative.
 *
 * The LLM receives this schema via OpenRouter's `response_format: json_schema`
 * and MUST return a JSON object matching this shape.
 */
export const CombatActionSchema = Type.Object(
  {
    /** The mechanical combat action type derived from the player's narration. */
    actionType: Type.Union([Type.Literal('ATTACK'), Type.Literal('DEFEND'), Type.Literal('FLEE')]),

    /** DM-style description of the attempt — appended to the combat log. */
    narrative: Type.String({ minLength: 1 }),

    /**
     * Extra damage awarded for clever, highly contextual attacks (0–5).
     * Added on top of the standard d6 + attack calculation.
     */
    bonusDamage: Type.Number({ minimum: 0, maximum: 5 }),

    /**
     * Whether the description is so creative or well-positioned that the
     * attack deserves advantage on the d20 hit roll.
     */
    advantage: Type.Boolean(),

    /**
     * Whether the action is highly cinematic and drastically changes the
     * scene — triggers background/scene image generation.
     */
    generateImage: Type.Boolean(),
  },
  { additionalProperties: false },
);

/** Inferred TypeScript type from the combat action schema. */
export type CombatActionIntent = Type.Static<typeof CombatActionSchema>;

// ---------------------------------------------------------------------------
// Extraction system prompt
// ---------------------------------------------------------------------------

/**
 * System prompt sent alongside the CombatActionSchema when calling
 * TextGenerationService.extractStructure().
 *
 * Instructs the LLM to act as a Dungeon Master interpreting creative
 * player combat actions and translating them into mechanical modifiers.
 */
export const COMBAT_ACTION_SYSTEM_PROMPT =
  `You are a Dungeon Master adjudicating combat actions in a fantasy RPG.

The player has described a combat action in freeform text. Your job is to:

1. Classify the action as ATTACK, DEFEND, or FLEE.
2. Write a short, vivid narrative describing how the action plays out (DM-style, 1-2 sentences).
3. Award **bonusDamage** (0–5) if the action is clever, exploits the environment, or uses the enemy's weakness creatively.
4. Set **advantage** to true if the action is so well-described or tactically brilliant that it deserves advantage on the d20 roll.
5. Set **generateImage** to true if the action is highly cinematic — something that drastically changes the scene visually (explosions, transformations, environmental destruction, etc.).

## Guidelines

- **ATTACK** — any offensive action (weapon swing, spell, kick, environmental attack, tackle, etc.).
- **DEFEND** — any purely defensive action (raise shield, dodge, take cover, brace for impact).
- **FLEE** — any attempt to escape combat (run, teleport away, climb out of reach, surrender).
- Be generous with **bonusDamage** (1–3) for creative, contextual actions. Reserve 4–5 for exceptionally clever multi-step combos.
- Be sparing with **advantage** — reserve for truly brilliant tactical thinking.
- Be generous with **generateImage** — any flashy spell, dramatic environmental effect, or major scene change should trigger it.

## Examples

Player: "I swing my sword at the goblin."
→ ATTACK, narrative: "You bring your blade down in a clean arc.", bonusDamage: 0, advantage: false, generateImage: false

Player: "I do a backflip off the wall and kick the slime into the campfire!"
→ ATTACK, narrative: "You spring off the tavern wall in a graceful flip, driving your boot into the slime and sending it hurtling into the roaring campfire! The flames hiss and crackle as the creature thrashes.", bonusDamage: 3, advantage: true, generateImage: true

Player: "I dive behind the overturned table for cover."
→ DEFEND, narrative: "You throw yourself behind the heavy oak table, splinters flying as arrows thud into the wood.", bonusDamage: 0, advantage: false, generateImage: false

Respond ONLY with the JSON object defined by the schema. No markdown fences, no explanations.` as const;
