---
id: C-487
title: "Free-text skill checks honour the real character sheet"
source: direct
contract_type: full
status: approved
github: { issue_number: null, issue_url: null, project_item_id: null, pr_url: null }
created_at: "2026-09-07T00:00:00Z"
---

# Contract C-487: Free-text skill checks honour the real character sheet

## Metadata

| Field | Value |
|---|---|
| **Source** | [`BACKLOG_C485_PLUS.md`](BACKLOG_C485_PLUS.md) § C-487, seeded from the 2026-09-06 external review (`docs/research/astra-game-review.md`); verified findings V-1 and V-2 |
| **Target** | `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts` (free-text roll path `:1306-1326`, `playerContext` `:1208-1212`), `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts` (`analyzeIntent` `playerContext` default `:736-740`), `apps/frontend/client/src/lib/services/game/player_state_service.svelte.ts`, the dialogue overlay component that renders `DECLARED_DC`, `apps/e2e/src/pom/game_page.ts` + a `/game` dialogue E2E spec |
| **Type** | full |
| **Priority** | P0 — this teaches players their character sheet is decorative |
| **Dependencies** | None. C-489 depends on this contract and owns what happens to the roll's result. |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | user-facing — the roll breakdown the player sees before committing |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` — free-text dialogue with an Emberwatch NPC that triggers a skill check |

## Problem & Baseline Evidence

- **Current behavior — hardcoded zero modifier (V-1)**: `dialogue_overlay_view_model.svelte.ts:1309` reads `const modValue = 0; // TODO: read from character sheet when available`. The free-text skill-check path rolls `d20 + 0` regardless of the player's ability scores or proficiencies. `tryNonCombatResolution` (`:882-886`) has the same disease in miniature — it uses `SKILL_STAT_MAP.persuasion.defaultModifier`, a hardcoded demo value.
- **Current behavior — hardcoded player persona (V-2)**: the same free-text path builds `playerContext: { characterSheetSummary: 'Level 1 Fighter', level: 1, classId: 'fighter' }` at `:1208-1212`. The service repeats the same default when `playerContext` is omitted (`npc_dialogue_service.svelte.ts:736-740`).
- **Why "read the real sheet" is non-trivial today**: the real ability scores, skill proficiency flags and saving throws live in `CharacterSheetViewModel` (`_abilities`, `_skills`, `_savingThrows` at `character_sheet_view_model.svelte.ts:246-248`), persisted via JSON edit/export. `playerStateService.characterSheetSummary` (`player_state_service.svelte.ts:105-120`) does **not** read them — it builds from `createDefaultSheet()`, i.e. every ability score 10 / modifier 0. There is no single service-level source of truth the dialogue path can consume.
- **The model-authored modifier is decorative**: `NpcIntentAnalysisOutputSchema.modifierSource` (`packages/shared/schemas/src/lib/game/npc_dialogue_command.ts:313`) is a string the model proposes ("which stat applies"). The roll never uses it. A model that claims a `+5` bonus or advantage cannot currently make one — but equally, a model that guesses the right stat is not trusted either, because the value is hardcoded to 0. Both are wrong in the same way: the sheet is the only authority and it is not consulted.
- **Reproduction**: create a character with a non-zero Charisma modifier, enter `/game`, talk to an Emberwatch NPC, and force a `requiresRoll` free-text action (e.g. a persuasion attempt). The declared roll shows a `0` modifier and the player is told nothing about what failure costs.
- **Existing implementation to reuse**: `packages/shared/utils/src/lib/rules/character_sheet.ts` already exports `computeModifier(score)` (`:29`), `computeProficiencyBonus(level)` (`:38`) and `computeSkillModifier(abilityMod, isProficient, proficiencyBonus, isExpertise)` (`:47`); `packages/shared/constants/src/lib/game/npc_interaction.ts:27` exports `SKILL_STAT_MAP` mapping a skill name to its governing stat. `diceService.rollD20(modifier)` already takes a modifier.
- **Known gaps**: no runtime character-sheet accessor that the dialogue ViewModel can call; the skill's proficiency flag is never read; the roll breakdown shown to the player does not separate ability modifier from proficiency; the player is never shown stakes (what failure costs) before committing to the roll.
- **Baseline tests**: `dialogue_overlay_view_model.test.ts` (existing VM unit tests around `_sendWithIntentAnalysis` and `skillCheckState`), `npc_dialogue_service.test.ts`, and `apps/e2e/tests/client/dialogue_*.spec.ts` (currently dev-sandbox-only). Record their state before changing anything.

## User Outcome

After this contract, a player who built a persuasive bard or a strong fighter sees their character's real numbers in a dialogue skill check: the ability modifier, the proficiency bonus where it applies, the DC, and what failure will cost — all shown before they commit the roll. A player who just says hello to a shopkeeper never sees a die.

## Success Measures

- **Time/latency target**: modifier computation is local and deterministic — under 1ms. No new network calls.
- **Offline/degraded behavior**: modifier and stakes computation are pure local functions of the character sheet; they work identically offline.
- **Production journey enabled**: `/game` → walk to an Emberwatch NPC → free-text action that triggers a check → see which ability applies, the total modifier, the DC and the failure cost → roll with the real numbers.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Ability modifier, proficiency bonus, skill-total math | `packages/shared/utils/src/lib/rules/character_sheet.ts` (`computeModifier`, `computeProficiencyBonus`, `computeSkillModifier`) | reuse |
| Skill name → governing stat | `packages/shared/constants/src/lib/game/npc_interaction.ts` `SKILL_STAT_MAP` | reuse the `stat` field; discard `defaultModifier` for the production path |
| d20 roll with a modifier | `apps/frontend/client/src/lib/services/dice/dice_service.svelte.ts` `rollD20(modifier)` | reuse |
| The free-text intent path | `dialogue_overlay_view_model.svelte.ts` `_sendWithIntentAnalysis` | modify — source the modifier and stakes from the real sheet |
| Character-sheet state | `player_state_service.svelte.ts` / `character_sheet_view_model.svelte.ts` | modify — expose the real abilities + skill proficiencies through a service accessor |
| The declared-DC roll UI | the dialogue overlay component rendering `skillCheckState` | modify — add stakes and the two-component breakdown |

## Overview

The free-text dialogue roll currently rolls `d20 + 0` against a model-declared DC while telling the player nothing about the stakes. This contract makes the character sheet the sole source of the roll's inputs: the governing ability's modifier plus proficiency where the character is proficient, computed with the existing pure rules helpers, shown to the player as a named breakdown alongside the DC and the cost of failure, and only then committed. It deliberately stops at the roll's *inputs* — what happens to a pass or fail result is C-489's job.

## Design Reference

- `packages/shared/utils/src/lib/rules/character_sheet.ts` — the canonical, already-tested modifier math. The dialogue path must call these, never re-implement `floor((score - 10) / 2)` locally.
- `packages/shared/constants/src/lib/game/npc_interaction.ts` `SKILL_STAT_MAP` — maps `checkType` (e.g. `"Deception"`) to `stat` (`"CHA"`). The `defaultModifier` field exists only for the demo and must not be read by the production free-text path.
- `character_sheet_view_model.svelte.ts` `getAiContext()` / `_refreshJsonText()` — the established shape of a full `GameCharacterSheet`. A service accessor must return the same shape, not a parallel ad-hoc structure.
- C-371's two-call pipeline (`_sendWithIntentAnalysis` → `analyzeIntent` → `DECLARED_DC`) — the seams this contract changes are the `playerContext` passed into call 1 and the `skillCheckState` assembled after the envelope returns.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

Establish **one** service-level source of truth for the character sheet that the dialogue ViewModel reads. The natural home is `playerStateService` (or a thin character-sheet service it delegates to); a ViewModel (`CharacterSheetViewModel`) must not be imported into the dialogue overlay. The accessor returns the real abilities and skill proficiency flags, falling back to `createDefaultSheet()` only when no character has been authored yet — and that fallback is a neutral sheet, never the string `"Level 1 Fighter"`.

The roll's total modifier is **computed**, not received. The model's `modifierSource` is treated as a *label hint* (which stat the model thinks applies); the actual number is `computeSkillModifier(abilityModifier, skill.isProficient, proficiencyBonus, skill.isExpertise)`, where `abilityModifier` comes from `computeModifier(sheet.abilities[stat].value)` and `SKILL_STAT_MAP[checkType]` resolves the stat. This preserves the shared rules implementation's expertise behavior: a proficient skill with expertise adds twice the proficiency bonus, while expertise never adds proficiency to a non-proficient skill. If `checkType` does not map to a known skill/stat, do not invent a bonus — fall back to the governing ability's raw modifier and log it. The model can influence *which check happens*; it cannot manufacture a modifier, an advantage, or a bonus (AC-5).

Stakes are part of the declared state. Before `phase` leaves `'declared'`, the player must see: the ability being tested, the ability modifier, the proficiency bonus (or `—` when not proficient), the total modifier, the DC, the target number, and what failure costs. "What failure costs" comes from the check type and world state (e.g. "the guard's suspicion rises" for a failed persuasion), not from unbounded model prose.

## State & Data Models

`skillCheckState` (the runtime shape rendered by the overlay) gains named breakdown and stakes fields, keeping its existing phase machine:

```ts
type SkillCheckBreakdown = {
  ability: AbilityKey;            // e.g. "CHA"
  abilityModifier: number;        // computeModifier(score)
  isProficient: boolean;
  isExpertise: boolean;
  proficiencyBonus: number;       // 0 when not proficient
  totalModifier: number;          // computeSkillModifier(..., isExpertise)
};

type SkillCheckStakes = {
  success: string;                // short, bounded outcome description
  failure: string;                // what failing costs, shown before the roll
};

type SkillCheckState = {
  checkType: string;              // e.g. "Deception"
  difficultyClass: number;
  breakdown: SkillCheckBreakdown;
  stakes: SkillCheckStakes;
  targetNumber: number;           // max(1, DC - totalModifier)
  rollValue: number | null;
  phase: 'declared' | 'awaiting_click' | 'rolling' | 'revealed';
  isSuccess: boolean | null;
};
```

The old `statModifier` / `statModifierValue` string/number pair is replaced by `breakdown`. This is a UI-state type in the ViewModel, not a persisted domain type — do not add it to `@aikami/types`.

## Quality Requirements

- **Offline/degraded mode**: modifier and stakes are local; when the AI provider is unavailable the declared-DC preview must still render if the envelope was already recovered, and must never render a fabricated modifier.
- **Accessibility/input**: the breakdown and stakes must be readable text, not only iconography; screen readers must reach the DC and the failure cost before the roll button.
- **Performance budget**: no new async work in the roll path; modifier computation is O(1).
- **Security/privacy**: N/A — no new data leaves the device.
- **Persistence/migration**: no save-format change. The real sheet already persists; this contract only reads it.
- **Cancellation/retry/idempotency**: aborts during `DECLARED_DC` continue to behave as C-401 specifies — an abort removes the placeholder and must not leave a half-built `skillCheckState`.
- **Observability**: log when a `checkType` fails to map to a known skill (fallback path), and when the neutral-sheet fallback is used in production.

## Migration & Rollback

N/A — no persistent state changes. The character sheet is already persisted; this contract changes only which runtime path reads it and what the roll UI shows. Rollback is reverting the ViewModel/service/component edits.

## Scope Boundaries

- **In Scope:** sourcing the free-text skill-check modifier from the real character sheet (ability modifier + applicable proficiency); passing the real character in `playerContext` so the service default is never reached in production; showing stakes and the named breakdown before the roll commits; ensuring ordinary conversation does not roll; ensuring model-authored bonuses/advantages cannot override computed mechanics; a production `/game` dialogue test.
- **Out of Scope:** routing the *result* of the roll through `resolveCommand` or applying any consequence — that is C-489 (state what happens after the roll, not what feeds it); new skills, spells, or class features; combat-path modifiers (already sourced from the sheet); rewriting the `tryNonCombatResolution` combat-negotiation path beyond replacing its hardcoded `defaultModifier` with the same computed modifier; the authored NPC identity (C-488).

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** the modifier source, the stakes preview, and the real `playerContext` are one outcome — a roll the player can trust — and each AC fails independently if the others ship without it. The result-application half is already split out into C-489 by the backlog. A production `/game` test is folded in as AC-6 because C-485's rule makes it the only evidence that counts for a player-facing capability.

## Acceptance Criteria

### AC-1: The modifier equals the character sheet's value
**Given** a character with a non-zero relevant ability modifier and, where applicable, proficiency or expertise in the checked skill
**When** a free-text action triggers a skill check
**Then** the applied modifier equals `computeSkillModifier(abilityModifier, isProficient, proficiencyBonus, isExpertise)`, and the breakdown shown to the player exposes the ability modifier, proficiency, expertise, and proficiency bonus as separate components. A proficient expertise character receives exactly the shared helper's doubled-proficiency modifier.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + E2E | `dialogue_overlay_view_model.test.ts`; `apps/e2e/tests/client/dialogue_skill_check.spec.ts` | `/game` — free-text dialogue with an Emberwatch NPC triggering a check | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test task and the client E2E task
- Integration: seed a level-1 character (therefore an explicit `+2` proficiency bonus) with CHA 16 (`+3`), proficiency in Persuasion, and no expertise; assert the declared total modifier is deterministically `+5`, not `0`. Add the expertise variant with the same seed and assert `+7`, matching `computeSkillModifier`.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/dialogue_skill_check.spec.ts`, `/game` journey, using `game_page.ts` `approachAndTalkToNpc()` / `sendFreeText()`.
    - **Visual**: N/A.

**Watch Points**:
- Do not read `SKILL_STAT_MAP[...].defaultModifier` for the production path — that is the demo value and is exactly the bug being removed.
- The modifier is computed with `computeModifier` / `computeSkillModifier`; a locally re-derived formula will drift when the rules helpers change.
- Do not treat `isExpertise` as presentation-only: pass it to `computeSkillModifier` and expose it in `SkillCheckBreakdown`.
- 🔴 **Case mismatch**: the model and the dev sandbox emit `checkType` in Title Case (e.g. `"Persuasion"`, `"Deception"`, `"Sleight Of Hand"`) but `SKILL_STAT_MAP` keys are camelCase (`persuasion`, `deception`, `sleightOfHand`). A direct `SKILL_STAT_MAP[checkType]` lookup misses and silently falls back to the raw ability modifier, breaking the AC-1 `+5`/`+7` assertions. Normalise `checkType` to the map key (lowercase first letter, strip spaces) before lookup, and cover the normalisation in the AC-1 unit test.

### AC-2: Stakes and breakdown are shown before the roll commits
**Given** a free-text action that triggers a skill check
**When** the check is proposed
**Then** the player sees, before any roll is committed: the ability being tested, the ability modifier, whether proficiency and expertise apply, the proficiency bonus, the total modifier, the DC, and what failure costs. No roll is committed without that preview.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + E2E | `dialogue_overlay_view_model.test.ts`; `apps/e2e/tests/client/dialogue_skill_check.spec.ts` | `/game` — the declared-DC overlay shown before the d20 is clicked | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test task and the client E2E task
- Integration: assert the overlay in `'declared'` phase renders the breakdown and the failure cost, and that the roll button is not yet actionable in that phase.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/dialogue_skill_check.spec.ts` — assert the stakes text and breakdown are visible before `d20RollButton` is clicked.
    - **Visual**: N/A.

**Watch Points**:
- "Failure cost" is a bounded, check-appropriate consequence string — not an unbounded model paragraph, and not omitted. If a check genuinely has no failure cost, that is a product decision to record, not a reason to hide the field.
- Keep the `'declared' → 'awaiting_click' → roll` phase machine intact; stakes are added to the state, not a new phase.

### AC-3: The real character context reaches the dialogue service
**Given** the free-text dialogue path in production
**When** it calls `analyzeIntent`
**Then** `playerContext` carries the real character (level, class, and a sheet summary derived from the real ability scores and proficiencies), and the service's `"Level 1 Fighter"` default is never reached — a test asserts the production caller always passes a real context.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + E2E | `dialogue_overlay_view_model.test.ts`; `npc_dialogue_service.test.ts`; `apps/e2e/tests/client/dialogue_skill_check.spec.ts` | `/game` — the production free-text path (not the dev sandbox) | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test task and the client E2E task
- Integration: a service-level test asserts that omitting `playerContext` in production code is caught — the only remaining default is inside the service, and no production caller may rely on it.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/dialogue_skill_check.spec.ts` — reaches dialogue via `/game` so the production caller is exercised.
    - **Visual**: N/A.

**Watch Points**:
- The neutral-sheet fallback (no authored character yet) is acceptable and distinct from the string default: a fallback sheet with real `AbilityScores` all at 10 is not `"Level 1 Fighter"`.
- Do not satisfy this AC by deleting the service default — keep it as a guard, but prove no production caller reaches it.

### AC-4: Ordinary conversation does not roll
**Given** ordinary conversation with no uncertain outcome (greeting, small talk, asking directions)
**When** the player speaks
**Then** no dice are rolled and no `DECLARED_DC` / dice phase is entered. Rolls resolve uncertainty, not permission to participate.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit + E2E | `dialogue_overlay_view_model.test.ts`; `apps/e2e/tests/client/dialogue_skill_check.spec.ts` | `/game` — send a greeting and assert no dice UI appears | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test task and the client E2E task
- Integration: a VM test with a stubbed `analyzeIntent` returning `requiresRoll: false` asserts `dialoguePhase` stays `FREE_TEXT` and `skillCheckState` stays `null`.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/dialogue_skill_check.spec.ts` — send a neutral greeting via `/game` and assert the d20 button never appears.
    - **Visual**: N/A.

**Watch Points**:
- This AC constrains the model's `requiresRoll` decision at the boundary — the test proves the *consequence* of `requiresRoll: false` (no dice), and the intent prompt must keep instructing the model that rolls are for uncertain outcomes. Do not "fix" a chatty model by rolling anyway.

### AC-5: Model-authored bonuses cannot override mechanical facts
**Given** a model-authored intent envelope that claims a bonus, advantage, or a `modifierSource` different from what the character sheet implies
**When** the check is resolved
**Then** the applied modifier and any advantage are derived from character/world state, not from the model's suggestion. Eloquent prompting cannot manufacture a modifier.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | `dialogue_overlay_view_model.test.ts` (stub `analyzeIntent` returning a bogus `modifierSource` / bonus claim) | `DialogueOverlayViewModel` — the production ViewModel entry point that assembles the roll | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test task
- Integration: a VM test stubs `analyzeIntent` to return `modifierSource: "CHA +5"` and asserts the computed modifier still equals the sheet's `computeSkillModifier(...)` result, including expertise when present and ignoring the model's `+5`.
- E2E / Visual:
    - **Functional**: N/A — this is an input-sanitisation property best proven at the ViewModel boundary.
    - **Visual**: N/A.

**Watch Points**:
- `modifierSource` remains a schema field (the model's *label*). Do not remove it — stop trusting it for the number. If a future advantage/bonus is legitimate, it must come from state (e.g. a class feature), which is out of scope here.
- This AC overlaps C-489's territory. The line: **C-487 owns what goes into the roll; C-489 owns what happens to the result.** Keep both contracts' Watch Points cross-referencing each other.

### AC-6: The production /game dialogue journey proves it end to end
**Given** the production `/game` route
**When** the player walks to an Emberwatch NPC, opens dialogue, and a free-text action triggers a skill check
**Then** the E2E run observes the real sheet's modifier in the declared breakdown and the stakes before the roll — not merely a ViewModel unit test or the dev sandbox.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | E2E | `apps/e2e/tests/client/dialogue_skill_check.spec.ts` (new or extended), via `game_page.ts` | `/game` — production dialogue, NPC interaction, declared-DC overlay | Filled only by a green `/game` run |

**Test Hooks**:
- Moon Task: the client E2E task
- Integration: run against `main`; a failure here is a real product bug, not a reason to downgrade the AC to the dev sandbox.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/dialogue_skill_check.spec.ts`, `/game` journey.
    - **Visual**: N/A.

**Watch Points**:
- **This is the AC that will hurt.** The existing dialogue POM targets the dev sandbox (`/dev/sandbox/dialogue`); do not reuse it to fake a production path. Extend `game_page.ts` (which already has `approachAndTalkToNpc()` / `expectDialogueVisible()` / `sendFreeText()`) and drive `/game`.
- Triggering a `requiresRoll` check through a live model is non-deterministic. If the check cannot be triggered deterministically through a real model, the spec may seed a deterministic intent (a stubbed provider in the E2E harness) — but the route, the overlay and the ViewModel must be the production ones. State in the spec which mechanism is used.
- Offline AI may require a `test.skip` with a stated reason (the sanctioned form); it must not become an `if (present)`.

## Implementation Sequence

1. **Phase 1 (Sheet accessor)**: expose the real abilities, skill proficiency flags and proficiency bonus through `playerStateService` (or a delegated character-sheet service), reusing `@aikami/utils` rules helpers. Add unit tests (AC-1, AC-3).
2. **Phase 2 (Roll inputs)**: in `_sendWithIntentAnalysis`, replace `modValue = 0` with the computed modifier; pass the real `playerContext`; assemble the `breakdown` and `stakes` into `skillCheckState` (AC-1, AC-2, AC-3, AC-5).
3. **Phase 3 (UI)**: render the breakdown and stakes in the declared-DC overlay before the roll commits (AC-2).
4. **Phase 4 (No-roll path)**: assert ordinary conversation stays in `FREE_TEXT` with no dice (AC-4).
5. **Phase 5 (Production journey)**: extend `game_page.ts` and add the `/game` E2E spec; run `validate()` and the client E2E task (AC-6).

## Edge Cases & Gotchas

- **No authored character yet**: fall back to a neutral sheet (all 10s → `+0`), never to `"Level 1 Fighter"` and never to a `SKILL_STAT_MAP.defaultModifier`.
- **`checkType` not in `SKILL_STAT_MAP`**: normalise `checkType` to a map key first (Title Case → camelCase, strip spaces — `"Sleight Of Hand"` → `sleightOfHand`). Only if it still does not resolve to a known skill/stat use the governing ability's raw modifier; otherwise log and do not invent a bonus. Do not crash the dialogue.
- **Non-combat resolution path** (`tryNonCombatResolution`) also reads `defaultModifier` at `:885`; route it through the same computed modifier so two paths don't drift.
- **The dev sandbox dialogue route** is not a production path. Tests for this contract must not use `/dev/sandbox/dialogue` as their production evidence.
- **Result application**: nothing in this contract may mutate inventory, quest flags, relationships, or trust as part of "applying" the roll — that is C-489. A tempting implementation will add a consequence in the same PR; refuse it.

## Open Questions

- Resolved: the production test may seed a deterministic intent when a live model cannot deterministically produce `requiresRoll: true`, provided the route/overlay/ViewModel are production. A `test.skip` for offline AI is acceptable with a stated reason.
- Resolved: the character-sheet source of truth lives in a service (`playerStateService` or a thin delegate), not in `CharacterSheetViewModel`, which the dialogue overlay must not import.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
