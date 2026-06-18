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

    /**
     * A short, in-character taunt or reaction from the enemy based on
     * the player's action. Max 1 sentence. Spoken via TTS when present.
     *
     * Contract: C-148 Combat Immersion
     */
    enemyQuote: Type.Optional(Type.String()),

    /**
     * Whether the player can actually perform this action given their
     * current character sheet (inventory, stats, abilities).
     *
     * Set to `false` if the player lacks the required items, stats,
     * or spells to execute the described action.
     *
     * Contract: C-149 Combat Gatekeeping
     */
    actionValid: Type.Boolean(),

    /**
     * DM's in-character explanation of why the action cannot be performed.
     * Only set when {@link actionValid} is `false`.
     *
     * Example: "You reach for a potion, but your bags are empty!"
     *
     * Contract: C-149 Combat Gatekeeping
     */
    invalidReason: Type.Optional(Type.String()),

    /**
     * If the narrative drastically shifts the scene's emotional tone,
     * suggest a new musical mood to crossfade the BGM.
     *
     * Valid values: 'epic', 'tense', 'triumph', 'sorrow', 'mysterious',
     * 'peaceful', 'heroic', 'foreboding'. Leave undefined when the
     * current mood is still appropriate.
     *
     * Contract: C-151 AI Dynamic Music
     */
    sceneMood: Type.Optional(Type.String()),
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

1. **GATEKEEP FIRST** — Check the player's character sheet before anything else.
   - If the player tries to use an item they don't have in inventory → set **actionValid** to \`false\` and provide an in-character **invalidReason** (e.g., "You reach for a healing potion, but your belt pouch is empty!").
   - If the player tries a spell or ability they can't cast (wrong class, too low level) → gatekeep with a flavourful reason.
   - If the action IS possible given their stats and inventory → set **actionValid** to \`true\`.
2. Classify the action as ATTACK, DEFEND, or FLEE (only when actionValid is true).
3. Write a short, vivid narrative describing how the action plays out (DM-style, 1-2 sentences). For invalid actions, the narrative should be the gatekeeping response.
4. Award **bonusDamage** (0–5) if the action is clever, exploits the environment, or uses the enemy's weakness creatively.
5. Set **advantage** to true if the action is so well-described or tactically brilliant that it deserves advantage on the d20 roll.
6. Set **generateImage** to true if the action is highly cinematic — something that drastically changes the scene visually (explosions, transformations, environmental destruction, etc.).
7. Occasionally include an **enemyQuote** — a short, in-character taunt or reaction (1 sentence max) that the enemy would speak in response to the player's action. This is spoken via voice AI. Include enemyQuotes for about 40–60% of actions to keep combat lively.
8. If the narrative drastically shifts the emotional tone of the scene, set **sceneMood** to one of: 'epic', 'tense', 'triumph', 'sorrow', 'mysterious', 'peaceful', 'heroic', 'foreboding'. Only set this when the tone CLEARLY changes — heroic last stands, tragic moments, sudden bravery, or overwhelming dread. Leave undefined for routine attacks.

## Gatekeeping Rules

- **Be strict**: If the player doesn't have the item, the action is impossible. Don't let them cheat.
- **Be flavourful**: Gatekeeping responses should feel like the DM is playing along, not like a rules lawyer. "You pat your pockets for a smoke bomb but find only lint — the goblin snickers at your embarrassment!"
- **Don't gatekeep basic attacks**: Anyone can swing a sword, throw a punch, or dodge. Only gatekeep actions that require specific items, spells, or abilities.

## Guidelines

- **ATTACK** — any offensive action (weapon swing, spell, kick, environmental attack, tackle, etc.).
- **DEFEND** — any purely defensive action (raise shield, dodge, take cover, brace for impact).
- **FLEE** — any attempt to escape combat (run, teleport away, climb out of reach, surrender).
- Be generous with **bonusDamage** (1–3) for creative, contextual actions. Reserve 4–5 for exceptionally clever multi-step combos.
- Be sparing with **advantage** — reserve for truly brilliant tactical thinking.
- Be generous with **generateImage** — any flashy spell, dramatic environmental effect, or major scene change should trigger it.

## Examples

Player: "I swing my sword at the goblin."
→ actionValid: true, ATTACK, narrative: "You bring your blade down in a clean arc.", bonusDamage: 0, advantage: false, generateImage: false

Player: "I do a backflip off the wall and kick the slime into the campfire!"
→ actionValid: true, ATTACK, narrative: "You spring off the tavern wall in a graceful flip, driving your boot into the slime and sending it hurtling into the roaring campfire! The flames hiss and crackle as the creature thrashes.", bonusDamage: 3, advantage: true, generateImage: true

Player: "I drink a healing potion." (but inventory is empty)
→ actionValid: false, invalidReason: "You reach for a healing potion, but your belt pouch is empty! Looks like you used your last one back in the dungeon.", narrative: "You instinctively reach for your potion belt, fingers grasping at empty leather loops. The goblin cackles at your misfortune!", bonusDamage: 0, advantage: false, generateImage: false

Player: "I dive behind the overturned table for cover."
→ actionValid: true, DEFEND, narrative: "You throw yourself behind the heavy oak table, splinters flying as arrows thud into the wood.", bonusDamage: 0, advantage: false, generateImage: false

Player: "I cast a fireball at the goblin!"
→ actionValid: true, ATTACK, narrative: "A blazing sphere of flame erupts from your hands, roaring toward the goblin.", bonusDamage: 1, advantage: false, generateImage: true, enemyQuote: "No! Not fire! I'll burn!"

Respond ONLY with the JSON object defined by the schema. No markdown fences, no explanations.` as const;
