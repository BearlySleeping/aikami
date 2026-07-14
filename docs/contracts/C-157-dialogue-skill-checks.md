<!-- completed: 2026-06-29 -->
<!-- audit: legacy — no execution report -->
## Metadata

| Field | Value |
|---|---|
| **Source** | Architect MVP Polish |
| **Target** | `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/` — Out-of-combat skill checks |
| **Priority** | P0 — Critical for RPG reactivity in the demo |
| **Dependencies** | C-129, C-145 |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Overview

We need to bring the "anything is possible" mechanics from combat into standard dialogue. When a player says "I steal his key", the LLM should recognize the intent, trigger a Sleight of Hand roll, and execute state changes (adding the item, altering NPC disposition, or dropping the player into combat). 

## Design Reference

Follow the structured extraction pattern used in `combat_view_model.svelte.ts` (executeCustomAction) and `combat_action_schema.ts`.

## Architecture Directives

- Introduce `DialogActionSchema` using TypeBox. It should extract: `narrative` (string), `requiredCheck` (optional enum: Persuasion, Intimidation, Sleight of Hand, etc.), `difficultyClass` (optional number 5-20), `stateMutation` (optional: trigger_combat, give_item, take_gold).
- Update `DialogueOverlayViewModel` to support structured intents. If the LLM demands a roll, pause the dialogue, invoke the dice roller UI (reused from combat), and feed the result back to the LLM for the final narrative resolution.
- Ensure state mutations (like `trigger_combat`) dispatch the appropriate bridge commands (e.g., setting the Engine Mode to COMBAT and emitting COMBAT_STARTED).

## State & Data Models

    import { Type } from '@sinclair/typebox';
    
    export const DialogActionSchema = Type.Object({
        narrative: Type.String(),
        requiredCheck: Type.Optional(Type.Union([
            Type.Literal('Persuasion'),
            Type.Literal('Intimidation'),
            Type.Literal('Sleight_of_Hand')
        ])),
        difficultyClass: Type.Optional(Type.Number()),
        stateMutation: Type.Optional(Type.Union([
            Type.Literal('trigger_combat'),
            Type.Literal('give_item')
        ])),
        itemId: Type.Optional(Type.String())
    });

## Acceptance Criteria

### AC-1: Skill Check Prompting
**Given** the player is in dialogue with an NPC
**When** the player types an aggressive or risky action ("I threaten him for the gold")
**Then** the UI displays a required Intimidation check, rolls the d20, and resolves the dialogue based on the success/failure against the DC.

### AC-2: State Mutation (Combat)
**Given** a failed skill check or extreme hostility
**When** the LLM returns `stateMutation: 'trigger_combat'`
**Then** the dialogue overlay closes and the game seamlessly transitions into the COMBAT overlay against that NPC.

**Test Hooks**:
- Unit: Mock `extractStructure` to return `stateMutation: 'trigger_combat'` and assert the ViewModel calls the appropriate bridge/state events to start combat.
- Integration: Validate the d20 UI component mounts correctly in the dialogue layer.

## Implementation Notes

1. **Files to create**: `apps/frontend/client/src/lib/game/core/ai/prompts/dialog_action_schema.ts`
2. **Files to modify**: `dialogue_overlay_view_model.svelte.ts`, `dialogue_overlay.svelte`
3. **Order of operations**: 
   - Define the schema and system prompt.
   - Refactor the dialogue submit flow to use structured extraction when player intent is complex.
   - Wire the d20 component to dialogue.
   - Handle the `stateMutation` side-effects.

## Edge Cases & Gotchas

- **LLM Hallucinations**: Ensure the system prompt strictly forbids handing out items the NPC shouldn't have.
- **Async Rolling**: The dialogue must remain in a loading/locked state while waiting for the dice animation to finish before generating the resolution narrative.
