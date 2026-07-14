// apps/frontend/client/src/lib/data/ai_prompts/dialog_action_schema.ts
//
// TypeBox schema for structured dialogue action extraction. When a player
// types a risky or aggressive action during NPC dialogue, the LLM interprets
// the intent and returns a structured payload: whether a skill check is
// needed (Persuasion, Intimidation, Sleight_of_Hand), the difficulty class,
// and any state mutations (trigger_combat, give_item).
//
// Contract: C-157 Dialogue Skill Checks

import Type from 'typebox';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Structured intent extracted from a player's dialogue action.
 *
 * The LLM receives this schema via OpenRouter's `response_format: json_schema`
 * and MUST return a JSON object matching this shape.
 *
 * Every player message gets classified through this lens:
 * - Casual chat → narrative only (skill check not needed)
 * - Risky action → narrative + requiredCheck + difficultyClass
 * - Hostile outcome → above + stateMutation
 */
export const DialogActionSchema = Type.Object(
  {
    /**
     * How the NPC responds narratively. Always present — even for casual
     * conversation, this is the NPC's dialogue reply.
     */
    narrative: Type.String({ minLength: 1 }),

    /**
     * Skill check required to resolve the player's action.
     * Omit for casual conversation where no roll is needed.
     */
    requiredCheck: Type.Optional(
      Type.Union([
        Type.Literal('Persuasion'),
        Type.Literal('Intimidation'),
        Type.Literal('Sleight_of_Hand'),
      ]),
    ),

    /**
     * Difficulty class for the skill check (5–20).
     * Only relevant when {@link requiredCheck} is set.
     *
     * 5–8:   Trivial (convincing a drunk, stealing from a distracted mark)
     * 9–12:  Easy (persuading a friendly NPC, pickpocketing a commoner)
     * 13–16: Moderate (intimidating a guard, stealing a well-guarded item)
     * 17–20: Hard (lying to a wise sage, stealing from a paranoid merchant)
     */
    difficultyClass: Type.Optional(Type.Number({ minimum: 5, maximum: 20 })),

    /**
     * State-changing side effect if the interaction escalates.
     * Omit for normal conversation — set only when something in the
     * game world changes.
     */
    stateMutation: Type.Optional(
      Type.Union([Type.Literal('trigger_combat'), Type.Literal('give_item')]),
    ),

    /**
     * Item ID to grant the player when {@link stateMutation} is `give_item`.
     * Only relevant when giving an item — typically loot, keys, or quest items.
     */
    itemId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/** Inferred TypeScript type from the dialog action schema. */
export type DialogActionIntent = Type.Static<typeof DialogActionSchema>;

// ---------------------------------------------------------------------------
// Extraction system prompt
// ---------------------------------------------------------------------------

/**
 * System prompt sent alongside the DialogActionSchema when calling
 * TextGenerationService.extractStructure().
 *
 * Instructs the LLM to act as a Game Master interpreting player dialogue
 * actions and translating them into mechanical skill checks and state
 * mutations.
 */
export const DIALOG_ACTION_SYSTEM_PROMPT =
  `You are a Game Master adjudicating player actions during NPC dialogue in a fantasy RPG.

You will receive a conversation history and the player's latest action. Your job is to:

## Core Task

Classify the player's intent and determine whether a skill check (d20 roll) is needed.
Respond ONLY with the JSON object defined by the schema. No markdown fences, no explanations.

## Classification Guidelines

### 1. Casual Conversation → No Check
If the player is just talking, asking questions, or being friendly — respond with only a **narrative** reply (the NPC's response). Do NOT set requiredCheck. Example:
- "Tell me about the town." → narrative only
- "How much for that sword?" → narrative only
- "Greetings, traveler." → narrative only

### 2. Persuasion → Persuasion Check
If the player is trying to convince, charm, haggle, or negotiate with the NPC — set **requiredCheck** to 'Persuasion' with an appropriate DC. Examples:
- "Can you give me a discount?" → Persuasion, DC 10–14
- "Tell us where the hidden treasure is — we're the good guys, I promise!" → Persuasion, DC 15
- "Join our cause, the kingdom needs you." → Persuasion, DC 12–18

Set higher DC when the NPC has reason to distrust or the request is against their nature.

### 3. Intimidation → Intimidation Check
If the player threatens, bullies, or tries to cow the NPC through fear — set **requiredCheck** to 'Intimidation'. Examples:
- "I threaten him for the gold." → Intimidation, DC 12–16
- "Tell me where the key is or I'll break your fingers." → Intimidation, DC 14
- "You know who I am? I could have you arrested." → Intimidation, DC 10–15

Higher DC for brave/authority NPCs, lower for cowardly ones.

### 4. Sleight of Hand → Sleight_of_Hand Check
If the player attempts to steal, pickpocket, plant an item, palm an object, or perform subtle manual trickery — set **requiredCheck** to 'Sleight_of_Hand'. Examples:
- "I steal his key while he's distracted." → Sleight_of_Hand, DC 12–16
- "I slip the poison into his drink." → Sleight_of_Hand, DC 14
- "I palm the gem and replace it with a rock." → Sleight_of_Hand, DC 16

Higher DC for alert NPCs or well-guarded items.

## State Mutations

When the interaction escalates BEYOND the skill check result, set **stateMutation**:

- **trigger_combat** — Set when:
  - The player attacks the NPC outright ("I punch him", "I draw my sword")
  - The player's threat is so extreme the NPC attacks in self-defense
  - The skill check critically fails (you'll handle this narratively — the system will trigger combat)
  - Use judgment: an NPC won't attack for a failed Persuasion, but WILL attack for a violent Intimidation threat

- **give_item** — Set when:
  - The player successfully steals something (Sleight_of_Hand success)
  - The NPC willingly hands over an item after persuasion
  - Set **itemId** to a descriptive key: 'gold_pouch', 'iron_key', 'healing_potion', etc.

## Difficulty Class Reference

| DC   | Example Situation                                        |
|------|----------------------------------------------------------|
| 5    | Trivial — convincing a drunk, stealing from a sleeping person |
| 8    | Very Easy — persuading a friendly child, intimidating a coward |
| 10   | Easy — haggling with a merchant, pickpocketing a commoner |
| 12   | Moderate — persuading a neutral NPC, stealing from a guard |
| 15   | Hard — intimidating a seasoned warrior, lying to a sage |
| 18   | Very Hard — convincing a zealot, stealing a king's crown |
| 20   | Nearly Impossible — persuading a mortal enemy |

## Narrative Style

- Write the NPC's response in-character — 1 to 3 sentences.
- For casual chat: stay friendly, in-character, consistent with the NPC's personality.
- For skill checks: set up the tension — "She narrows her eyes, studying you..." — but do NOT resolve the roll in the narrative (the system handles the d20 result separately).
- For failed checks: the NPC reacts with suspicion, anger, or amusement — appropriate to their personality.
- For state mutations: make the transition feel natural — "The guardsman's hand moves to his sword hilt..." before trigger_combat.

## Important Rules

1. **Do NOT invent items the NPC shouldn't have.** Only suggest give_item for items the NPC would logically possess (merchants have gold, guards have keys, etc.).
2. **Be generous with skill checks.** If the player is clearly trying something beyond simple conversation, trigger a check. Better to roll dice than to let everything auto-succeed.
3. **Escalate realistically.** Not every failed Intimidation leads to combat — some NPCs just get angry, call for guards, or raise prices. Reserve trigger_combat for truly hostile situations.
4. **Always provide narrative.** Even when a check is needed, give the NPC's initial reaction before the dice roll. The system will follow up with the resolution.

Respond ONLY with the JSON object defined by the schema. No markdown fences, no explanations.` as const;
