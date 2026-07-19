# Contract C-337: Complete Character Progression, Classes, Abilities, Skills, and Spells

## Metadata

| Field | Value |
|---|---|
| **Source** | TODO.md — Phase 2 — Core RPG Depth and Replayability |
| **Target** | `packages/shared/schemas/src/lib/game/class_definition.ts`, `packages/shared/types/src/lib/game/class_definition.ts`, `packages/shared/constants/src/lib/game/classes.ts`, `packages/frontend/engine/src/systems/progression_system.ts`, `apps/frontend/client/src/lib/views/game/dashboard/character_sheet_view_model.svelte.ts` (extend), `apps/frontend/client/src/lib/views/game/hotbar/` (new) |
| **Priority** | P1 — character choices need consequences beyond initial stats. |
| **Dependencies** | C-232 (Character Sheet & Traits — `completed`), C-153 (Character Dashboard & Equipment — `completed`), C-162 (BG3 Action Menu & Dice — `completed`), C-336 (Deterministic Rules Kernel — `approved`, not yet implemented — implementer must stub `grantXp` command type locally if C-336 kernel routines are unavailable; align with C-336's `RulesCommand` discriminated union pattern) |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | None — internal systems only until Phase 3 media/gameplay promotion |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: The character sheet (C-232) displays ability scores, skills, saving throws, and traits but the `class` field is a free-text string with zero mechanical consequences. XP is tracked (`PlayerStateService`, `CombatStats`) and a basic level-up exists in the ECS (`turn_manager_system.ts` lines 915–990) that increments level, bumps HP by 10, heals to full, and scales `xpToNextLevel` by a flat ×1.5 multiplier. There is no class-specific leveling table, no feature unlock at level-up, no ability/spell registry, no hotbar, and no projection of what the next level grants. The `grantXp` rules command exists in C-336's `RulesCommand` union but has no class-aware resolution logic.

- **Reproduction**:
  1. Create a character via fast onboarding (C-319) — class is just a string pick ("Fighter", "Wizard", etc.) with no mechanical effect.
  2. Open the character sheet (`/game` → dashboard overlay) — the "Class" field shows the string but nothing else.
  3. Gain XP in combat (`/dev/sandbox/combat`) — level-up increases HP and attack, but grants no new abilities or class features.
  4. Search for ability definitions: `grep -r "ClassDefinition\|AbilityDefinition\|classFeature" packages/shared/` — zero results. The concept does not exist.
  5. Search for hotbar: `grep -r "hotbar\|ability_bar" apps/frontend/client/src/lib/` — zero results.

- **Existing implementation to reuse**:

  | What | Where |
  |---|---|
  | `BaseCharacterSheetSchema` (class, level, xp, ability scores, skills, HP, AC) | `packages/shared/schemas/src/lib/database/character.ts` |
  | `SkillSchema`, `SavingThrowSchema`, `DEFAULT_SKILLS` | `packages/shared/schemas/src/lib/database/skills.ts` |
  | `CharacterSheet` type, `CharacterSheetViewModel`, character sheet UI | `apps/frontend/client/src/lib/data/character_sheet_types.ts`, `.../character_sheet_view_model.svelte.ts` |
  | `PlayerStateService` (level, XP, HP mirror, `addXp()`) | `apps/frontend/client/src/lib/services/game/player_state_service.svelte.ts` |
  | `GameStateService` (character sheet summary for AI) | `apps/frontend/client/src/lib/services/game/game_state_service.svelte.ts` |
  | `CombatStats` SoA (level, xp, xpToNextLevel) | `packages/frontend/engine/src/components/combat_stats.ts` |
  | Level-up logic (`_grantXp()`, `_triggerLevelUp()`) | `packages/frontend/engine/src/systems/turn_manager_system.ts` (lines 915–990) |
  | `grantXp` rules command type (C-336) | `docs/contracts/C-336...` § State & Data Models |
  | `ContentPackManifestSchema` — registry pattern for items/NPCs/quests | `packages/shared/schemas/src/lib/game/content_pack.ts` |
  | `ContentPackSkillCheckSchema` — skill check structure in content packs | `packages/shared/schemas/src/lib/game/content_pack.ts` (lines 264–294) |
  | `diceService` (d20 rolls, roll history) | `apps/frontend/client/src/lib/services/dice/dice_service.svelte.ts` |
  | Combat action menu (BG3-style) | `apps/frontend/client/src/lib/views/combat/` (C-162 pattern) |
  | ECS `create_player.ts` (initial `CombatStats` seeding) | `packages/frontend/engine/src/entities/create_player.ts` |
  | Equipment slot system (weapon/armor) | `packages/shared/schemas/src/lib/database/item.ts`, `packages/frontend/engine/src/components/equipment.ts` |
  | Sandbox for character sheet | `apps/frontend/client/src/lib/views/dev/character_sheet_sandbox_view_model.svelte.ts` |

- **Known gaps**:
  1. **No class definition schema**: `class` is `Type.Optional(Type.String())` — no data structure for what a class grants at each level.
  2. **No ability/feature registry**: No TypeBox schema for class features (e.g., "Second Wind", "Sneak Attack"), no type for what an ability does mechanically.
  3. **No spell registry**: No data shape for spells, spell levels, spell slots, or casting rules.
  4. **No class-based progression**: Level-up in `turn_manager_system.ts` uses hardcoded HP (+10) and stat (+1 attack) gains regardless of class.
  5. **No feature unlock at level-up**: The `PLAYER_LEVELED_UP` bridge event carries only `newLevel`, `newMaxHp`, `newAttack`, `newDefense`, `xpToNext` — no list of unlocked features.
  6. **No hotbar**: Abilities have no UI surface to trigger them outside the combat action menu.
  7. **No save projection**: The character sheet shows current stats but not what you gain next level.
  8. **AI context missing class/abilities**: The `serializeForAi()` function (C-232) includes level/HP/ATK/DEF/skills/traits but no class features or known abilities.

- **Baseline tests**:
  - `packages/shared/schemas/src/lib/database/character.test.ts` — validates `BaseCharacterSheetSchema`. **All pass.**
  - `packages/frontend/engine/src/__tests__/turn_manager.test.ts` — covers XP grant and level-up logic. **All pass.**
  - `apps/frontend/client/src/lib/data/__tests__/character_sheet_helpers.test.ts` — validates modifier computation, serialization. **All pass.**
  - Run `bun moon run :test` before starting.

## User Outcome

After this contract, a player can: choose a class during character creation that determines their mechanical identity; see their class features on the character sheet; gain XP and level up, unlocking new abilities at specific class levels; slot abilities into a hotbar; and preview what they'll earn at the next level. The AI GM receives the player's class and known abilities in its context, enabling class-aware narration and encounter design.

## Success Measures

- **Time/latency target**: Level-up computation under 1ms (pure data lookup). Hotbar render under 16ms (one frame). AI context serialization under 0.5ms.
- **Offline/degraded behavior**: Class definitions are static content-pack data — fully offline. No AI/network dependency for progression mechanics.
- **Production journey enabled**: A player creates a Fighter, gains XP through the Emberwatch demo quests (C-316/C-329), levels up to 2, unlocks "Action Surge", sees it on their hotbar, uses it in combat (C-338), and the AI GM references "the Fighter's Action Surge" in narration.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Character sheet schema | `packages/shared/schemas/src/lib/database/character.ts` | **Modify** — add `classFeatures`, `knownAbilities` fields |
| Skill/save schemas | `packages/shared/schemas/src/lib/database/skills.ts` | **Reuse** — class definitions reference these for proficiencies |
| Content pack registry pattern | `packages/shared/schemas/src/lib/game/content_pack.ts` | **Reuse pattern** — same `Type.Record(Type.String(), ...)` for class/ability registry |
| Character sheet ViewModel | `apps/frontend/client/src/lib/views/game/dashboard/character_sheet_view_model.svelte.ts` | **Modify** — add class features tab, save projection |
| Player state service | `apps/frontend/client/src/lib/services/game/player_state_service.svelte.ts` | **Modify** — add class-aware level-up, feature tracking |
| Game state service (AI serialization) | `apps/frontend/client/src/lib/services/game/game_state_service.svelte.ts` | **Modify** — include class features in `characterSheetSummary` |
| Combat stats SoA | `packages/frontend/engine/src/components/combat_stats.ts` | **Reuse** — level/XP fields stay; progression system reads them |
| ECS level-up logic | `packages/frontend/engine/src/systems/turn_manager_system.ts` (lines 915–990) | **Replace** — extract to `progression_system.ts`, delegate to shared class tables |
| Combat action menu | `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts` (C-162) | **Reuse pattern** — hotbar action menu follows same interaction model |
| Dice service | `apps/frontend/client/src/lib/services/dice/dice_service.svelte.ts` | **Reuse** — ability activation may trigger d20 rolls |
| Content pack loader | `packages/frontend/engine/src/assets/content_pack_loader.ts` | **Modify** — load class/ability definitions from pack manifest |
| Sandbox for character sheet | `apps/frontend/client/src/lib/views/dev/character_sheet_sandbox_view_model.svelte.ts` | **Modify** — extend for class feature testing |

## Overview

This contract adds the first mechanical layer of character identity: class definitions with level-based feature unlocks, an ability registry, class-aware progression, a hotbar to equip and trigger abilities, and save projection so players can see what they'll earn. It defines 4 curated starter classes (Fighter, Wizard, Rogue, Cleric) with 5 levels each, using a content-pack data model that parallels the existing item/NPC/quest registries. The progression system replaces the hardcoded level-up in `turn_manager_system.ts` with a table-driven resolver that looks up class features and emits them through the bridge. The existing character sheet gains a class features tab and a next-level preview. A new hotbar overlay lets players slot 6 abilities for quick access. Spell slot management is deferred — spells are treated as class features with per-rest usage for now, not a full Vancian casting system.

## Design Reference

- **Content pack registry pattern**: Follow `ContentPackItemEntrySchema` / `ContentPackNpcEntrySchema` from `content_pack.ts`. Classes and abilities are defined in the manifest with TypeBox-validated schemas, keyed by string ID, consumed by the engine at boot.
- **Character sheet tab pattern**: Follow existing `CharacterSheetTab` (`'abilities' | 'skills' | 'traits'`) from `character_sheet_view_model.svelte.ts`. Add `'features'` tab following the same pattern.
- **Overlay navigation**: Follow `game_ui_view_model.svelte.ts` overlay stack pattern (C-332). Hotbar is a persistent HUD element, not a toggleable overlay.
- **ECS bridge event pattern**: Follow `PLAYER_LEVELED_UP` bridge event from `packages/frontend/engine/src/types.ts` (line 434+). Extend with `featuresUnlocked: string[]`.
- **Rules command protocol**: Follow C-336's discriminated union pattern. Existing `grantXp` command gets a `classId` field. New `unlockFeature` event type.
- **AI serialization**: Follow `serializeForAi()` pattern from `character_sheet_helpers.ts` — compact text block, omit defaults, under 2KB target.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Shared schemas** (`packages/shared/schemas/src/lib/game/class_definition.ts`): TypeBox schemas for `ClassDefinition`, `ClassFeature`, `AbilityDefinition`, `AbilityActivation`. Follow `content_pack.ts` discriminated union patterns.
- **Shared types** (`packages/shared/types/src/lib/game/class_definition.ts`): `Static<>` types derived from schemas.
- **Shared constants** (`packages/shared/constants/src/lib/game/classes.ts`): Starter class data (Fighter, Wizard, Rogue, Cleric — levels 1–5). Re-export from `@aikami/constants`.
- **Engine** (`packages/frontend/engine/src/systems/progression_system.ts`): New system that handles `grantXp` → level-up check → feature unlock → bridge emit. Import class tables from `@aikami/constants`.
- **Engine** (`packages/frontend/engine/src/systems/turn_manager_system.ts`): Remove inline `_grantXp()` / `_triggerLevelUp()`. Delegate to `progression_system.ts`.
- **Content pack** (`packages/shared/schemas/src/lib/game/content_pack.ts`): Add optional `classes` and `abilities` registry fields to manifest schema.
- **Client ViewModels** (`apps/frontend/client/src/lib/views/game/dashboard/`): Extend `character_sheet_view_model.svelte.ts` with features tab, save projection, class summary. Add `hotbar_view_model.svelte.ts`.
- **Client Views** (`apps/frontend/client/src/lib/views/game/hotbar/`): New hotbar component and View.
- **Client services** (`apps/frontend/client/src/lib/services/game/`): Extend `player_state_service.svelte.ts` with known abilities array, class data. Extend `game_state_service.svelte.ts` AI serialization.
- **Dev sandbox** (`apps/frontend/client/src/routes/(dev)/sandbox/`): Extend `character_sheet` sandbox. Add `hotbar` sandbox.

## State & Data Models

### Class Definition (shared schema)

```typescript
// packages/shared/schemas/src/lib/game/class_definition.ts

// A single feature granted at a specific class level
type ClassFeature = {
  /** Unique feature ID — "fighter_second_wind", "rogue_sneak_attack" */
  id: string;
  /** Display name */
  name: string;
  /** Player-facing description of what this does */
  description: string;
  /** The class level at which this feature is granted */
  level: number;
  /** Whether this feature is an active ability (goes on hotbar) vs passive */
  kind: 'active' | 'passive';
  /** For active abilities: how to activate it */
  activation?: AbilityActivation;
};

// How an active ability is triggered
type AbilityActivation = {
  /** What the activation costs */
  cost: 'action' | 'bonus_action' | 'reaction' | 'free';
  /** Usage limit — e.g. "per_rest", "per_encounter", "unlimited" */
  usageLimit: 'per_rest' | 'per_encounter' | 'per_day' | 'unlimited';
  /** How many uses per the usageLimit period */
  maxUses: number;
  /** Optional: target required (self, single enemy, ally, area) */
  target?: 'self' | 'single_enemy' | 'single_ally' | 'all_enemies' | 'area';
  /** Optional: dice expression for the effect (e.g. "1d8+2" for healing) */
  effectDice?: string;
  /** Optional: what stat this scales off */
  scalingStat?: 'strength' | 'dexterity' | 'intelligence' | 'wisdom' | 'charisma';
};
```

### Class Definition (data shape)

```typescript
type ClassDefinition = {
  /** Unique class ID — "fighter", "wizard", "rogue", "cleric" */
  id: string;
  /** Display name */
  name: string;
  /** Flavor description */
  description: string;
  /** Hit die for HP rolls on level-up (e.g. "d10") */
  hitDie: string;
  /** Average HP per level after first (rounded up) */
  hpPerLevel: number;
  /** Abilities the class uses for features */
  primaryAbility: AbilityKey; // from character.ts
  /** Saving throw proficiencies granted at level 1 */
  savingThrowProficiencies: AbilityKey[];
  /** Skill proficiencies to choose from at level 1 */
  skillProficiencyChoices: string[];
  /** Number of skills to pick from the choices */
  skillProficiencyCount: number;
  /** Weapon proficiencies */
  weaponProficiencies: string[];
  /** Armor proficiencies */
  armorProficiencies: string[];
  /** Features granted at each level, keyed by level number */
  features: Record<number, ClassFeature[]>;
  /** Subclass choice level (0 = no subclass) */
  subclassChoiceLevel: number;
  /** Available subclasses */
  subclasses: SubclassDefinition[];
};

type SubclassDefinition = {
  id: string;
  name: string;
  description: string;
  features: Record<number, ClassFeature[]>;
};
```

### Character Sheet Extensions

```typescript
// Additions to BaseCharacterSheet (character.ts)
type CharacterSheetClassExtension = {
  /** The class definition ID — "fighter", "wizard", etc. */
  classId: string;
  /** Features the character has unlocked */
  classFeatures: Array<{
    featureId: string;
    source: { classId: string; level: number };
  }>;
  /** Active abilities currently slotted on the hotbar (feature IDs, max 6) */
  hotbarSlots: string[];
  /** Usage tracking for limited-use abilities */
  abilityUses: Record<string, number>; // featureId → uses remaining
};
```

### Progression Table (constants)

```typescript
// XP thresholds per level (curated subset, not full 5e)
type XpThresholds = {
  [level: number]: number;
  // 1: 0, 2: 300, 3: 900, 4: 2700, 5: 6500
};
```

### AI Context Extension

The existing `serializeForAi()` output gains a "Class Features" section:

```
[CHARACTER SHEET]
Level 3 Fighter | HP 28/28 | ATK +5 | DEF 16
STR 16(+3) DEX 12(+1) CON 14(+2) INT 10(+0) WIS 12(+1) CHA 10(+0)
Proficiency: Athletics, Intimidation, Perception
Saves: STR +5, CON +4
Features: Second Wind (1/rest, heal 1d10+3), Action Surge (1/rest, extra action), Fighting Style: Great Weapon Fighting (passive)
```

## Quality Requirements

- **Offline/degraded mode**: Class definitions are static content-pack JSON — full offline support. Progression math is pure TypeScript — no network. Hotbar is local UI state persisted in save data.
- **Accessibility/input**: Hotbar uses keyboard shortcuts (1–8) in addition to click. Class features tab follows existing tab pattern (keyboard navigable). No screen-reader changes needed beyond what daisyUI provides.
- **Performance budget**: Level-up computation under 1ms (pure lookup). Hotbar render under 16ms (one frame). AI context serialization under 0.5ms. Class definition data under 10KB total for all 4 classes.
- **Security/privacy**: N/A — all data is local. No auth changes.
- **Persistence/migration**: Character sheet gains new optional fields (`classId`, `classFeatures`, `hotbarSlots`, `abilityUses`). Old saves with `class` string but no `classId` must migrate: if `class` matches a known class name case-insensitively, set `classId` and grant level-appropriate features retroactively. If no match, default to "fighter" level 1 retroactively.
- **Cancellation/retry/idempotency**: Level-up is idempotent — checking current level against XP threshold always produces the same feature list. Feature unlock is additive (never removes features). Hotbar slot assignment is pure local state — no retry needed.
- **Observability**: `this.debug()` on level-up, feature unlock, hotbar slot change. Bridge events logged via engine `log()` pattern.

## Migration & Rollback

- **Old data compatibility**: Saves without `classId`/`classFeatures`/`hotbarSlots`/`abilityUses` must be loadable. Migration runs on load: maps legacy `class: string` to known class definitions, grants features for levels 1–N retroactively. Characters whose `class` string doesn't match a known class default to "fighter".
- **Migration**: Add `classId`, `classFeatures`, `hotbarSlots`, `abilityUses` fields to character sheet schema with defaults (`""`, `[]`, `[]`, `{}`). On save load, check if `classId` is empty and `class` string has a value — run retroactive feature grant.
- **Rollback**: Old client versions ignore unknown fields (TypeBox `additionalProperties: false` permits this). A player downgrading from a version with class features to one without would lose feature access — acceptable for pre-release. No breaking schema change.
- **Feature flag or kill switch**: Class progression can be gated behind a content pack manifest field. If the manifest lacks `classes`, the system falls back to legacy flat level-up. No runtime flag needed.
- **Failure recovery**: If migration fails (corrupted class ID), reset to "fighter" level 1 with base features. Log the error and player can re-level naturally.

## Scope Boundaries

- **In Scope:**
  - TypeBox schemas for `ClassDefinition`, `ClassFeature`, `AbilityActivation`, `SubclassDefinition`
  - Starter class data for Fighter, Wizard, Rogue, Cleric (levels 1–5) in `@aikami/constants`
  - Content pack manifest extension: optional `classes` and `abilities` registry fields
  - Class-aware progression resolver (`progression_system.ts`) replacing hardcoded level-up
  - Extended `PLAYER_LEVELED_UP` bridge event with `featuresUnlocked`
  - Character sheet extension: `classId`, `classFeatures`, `hotbarSlots`, `abilityUses` fields
  - Character sheet UI: new "Features" tab showing known class features with descriptions
  - Save projection: "Next Level" preview showing features gained at N+1
  - Hotbar overlay: 6-slot ability bar (keyboard 1–6), drag/drop from features list, click to activate
  - AI context: class name, level, and known features included in `serializeForAi()`
  - Migration: legacy `class: string` → `classId` mapping on save load
  - Dev sandboxes: extended character sheet sandbox, new hotbar sandbox
  - Tests: schema validation, progression math, feature unlock, AI serialization, migration

- **Out of Scope:**
  - Spell slot management (Vancian casting, prepared spells, spellbooks) — deferred to C-343 or future contract
  - Multi-classing — deferred to future contract
  - Full 5e SRD class tables (20 levels, all subclasses) — this contract delivers levels 1–5 for 4 classes only
  - Combat integration of abilities (damage calculation, targeting in encounters) — C-338 owns this
  - Visual effects for ability activation (particles, animations, SFX) — C-163 owns juice/feedback
  - Ability tooltips with detailed rules text — deferred to C-343 (rich chat UX promotion)
  - Class-specific equipment restrictions (e.g., Wizard can't wear plate) — deferred to C-338/C-342
  - Content pack authoring UI for class/ability data — manual JSON editing only; C-358 owns authoring
  - Relationship between class choice and faction/reputation — C-341 owns relationships
  - Gamepad/touch hotbar access — C-346 owns platform input

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** 5 ACs (at the limit). Touched projects: shared schemas, shared types, shared constants, engine, client — technically > 2, but the schemas/constants/types are small additive enablers of the single releasable system (character progression + hotbar). Splitting by layer would create contracts that fail independently — you can't ship the hotbar without class definitions, and you can't ship class definitions without progression rules. The 5 ACs form a tight vertical slice that ships a working feature. Size is acceptable for a single contract.

## Acceptance Criteria

### AC-1: Class and ability definitions are validated content-pack data
**Given** the Emberwatch campaign is active and the content pack manifest includes `classes` and `abilities` registries
**When** the content pack loader parses the manifest
**Then** class definitions are validated against the TypeBox schema (`ClassDefinition`, `ClassFeature`, `AbilityActivation`), each class has features at appropriate levels (dead levels allowed), and ability activations have valid cost/usage/target fields — `Value.Check()` rejects unknown `kind` values, invalid usage limits, and out-of-range numeric fields

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `packages/shared/schemas/src/lib/game/class_definition.test.ts` | N/A — schema validation | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run schemas:test`
- Integration: Parse Emberwatch manifest with `classes` field — confirm all 4 classes validate with correct feature counts per level
- E2E / Visual:
    - **Functional**: N/A — schema validation is a unit test concern
    - **Visual**: N/A

**Watch Points**:
- Feature IDs must be unique across all classes (e.g., `"fighter_second_wind"`, not just `"second_wind"`) to avoid collisions if features are shared across classes
- Schema must allow classes with no features at specific levels (dead levels are valid in D&D)
- `AbilityActivation` schema must handle all usage limit types — missing `'per_day'` would block cleric channel divinity

### AC-2: XP progression unlocks class features at correct levels
**Given** a level 1 Fighter with 0 XP and the Fighter class definition loaded in the progression system
**When** the player gains 300 XP (reaching level 2 threshold)
**Then** the `PLAYER_LEVELED_UP` bridge event fires with `newLevel: 2`, `featuresUnlocked` containing `"fighter_action_surge"`, and the existing stat fields (`maxHp`, `attack`, `defense`, `xpToNextLevel`); the level 1 feature `"fighter_fighting_style"` is NOT duplicated in the unlock list; XP carries over correctly (`newXp = currentXp + gained - threshold`); if the XP gain is enough for multiple levels (e.g., 1000 XP at once), each intermediate level unlocks its own features sequentially and the final bridge event reflects the final level

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + Integration | `packages/frontend/engine/src/__tests__/progression_system.test.ts`, `packages/frontend/engine/src/__tests__/turn_manager.test.ts` (modified) | `/game` — combat XP → level-up | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`
- Integration: Start combat in dev sandbox, defeat enemy worth 300 XP → verify level-up notification appears → check character sheet shows new feature
- E2E / Visual:
    - **Functional**: Playwright spec `tests/client/progression.spec.ts` — start game, `gameStateService.addXp({ amount: 300 })`, verify level-up overlay, check features tab
    - **Visual**: N/A — level-up overlay is a text notification; visual assessment not needed

**Watch Points**:
- If XP gained is enough for multiple level-ups (e.g., 1000 XP at once), all intermediate levels must be processed sequentially with features from each level
- Retroactive feature grant on migration (see Migration & Rollback section) follows the same code path as natural level-up — test both
- Bridge event must carry `featuresUnlocked` as `string[]` (feature IDs), not the full feature objects

### AC-3: Character sheet displays class features and next-level projection
**Given** a level 2 Rogue with "Sneak Attack" and "Cunning Action" features
**When** the player opens the character sheet and navigates to the "Features" tab
**Then** both features are listed with their descriptions and activation details; a "Next Level" section shows that level 3 unlocks "Roguish Archetype" and "Steady Aim"; features already earned show a checkmark; upcoming features show a lock icon

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration + Visual | `apps/frontend/client/src/lib/views/game/dashboard/character_sheet_view.svelte` (modified), `suites/character_sheet.visual.ts` | `/game` → character dashboard → Features tab | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Open character sheet sandbox, switch to Features tab, verify feature cards render with correct names/descriptions
- E2E / Visual:
    - **Functional**: Playwright spec `tests/client/character_sheet.spec.ts` — navigate to features tab, count feature cards, check next-level projection
    - **Visual**: Suite `suites/character_sheet.visual.ts` — test case `features_tab` at route `/dev/sandbox/character_sheet`, TypeBox schema validates feature card count and lock/check icons, AI prompt: "Score 90+: Features tab shows earned abilities with checkmarks and locked abilities with lock icons. No rendering artifacts."

**Watch Points**:
- Features with `kind: 'passive'` must still be shown but marked differently from active abilities
- Subclass features at higher levels must appear in projection (e.g., level 3 subclass choice for Rogue)
- The "Next Level" section must handle the case where the player is at max level (5) — show "Maximum level reached"

### AC-4: Hotbar displays slotted abilities and supports keyboard activation
**Given** a level 3 Cleric with "Turn Undead", "Channel Divinity", and "Healing Word" features in `hotbarSlots`
**When** the player is in exploration mode and presses keyboard 1–3
**Then** the corresponding ability activation callback fires (shows a brief pulse animation on the hotbar slot, logs via `this.debug()`); abilities with usage limits decrement their remaining uses; abilities that require a target (per `AbilityActivation.target`) show an "invalid target" hint in exploration mode (no game-world effect); the hotbar renders as a horizontal bar at the bottom of the game HUD with 6 visually distinct slots (filled = ability icon + keybinding label, empty = dimmed "+" indicator)

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Integration + Visual | `apps/frontend/client/src/lib/views/game/hotbar/hotbar_view.svelte` (new), `suites/hotbar.visual.ts` | `/game` — HUD hotbar | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Load hotbar sandbox with pre-slotted abilities, press 1–3, verify activation callbacks fire
- E2E / Visual:
    - **Functional**: Playwright spec `tests/client/hotbar.spec.ts` — slot ability, press key, verify state
    - **Visual**: Suite `suites/hotbar.visual.ts` — test case `hotbar_with_abilities` at route `/dev/sandbox/hotbar`, TypeBox schema validates slot count and ability icons, AI prompt: "Score 90+: 6 hotbar slots visible at screen bottom, first 3 filled with ability icons and keybinding labels (1, 2, 3). Empty slots show empty state. No overlapping with HUD elements."

**Watch Points**:
- Hotbar must not overlap with the combat action menu (C-162) — they share screen bottom real estate
- During combat (C-338), hotbar abilities that cost an action/bonus action must integrate with the action economy — this AC only tests exploration mode activation
- Empty slots must be distinguishable from filled slots (dimmed background, "+" or empty indicator)
- Drag-and-drop from features tab to hotbar is a nice-to-have; click-to-slot (select ability, click slot) is the MVP
- Hotbar needs a `showHotbar` HUD visibility boolean in `game_ui_view_model.svelte.ts` (paralleling `showHpBar`/`showQuestTracker`) — hidden during `PAUSE_MENU`, `DIALOGUE`, `COMBAT`, `GAME_OVER`, `END_SESSION`; visible during `NONE` (exploration)
- Keyboard bindings 1–6 must not conflict with dialogue overlay number keys — dialogue takes priority when active

### AC-5: AI context includes class and ability information
**Given** a level 4 Wizard with features "Arcane Recovery", "Sculpt Spells", and "Ability Score Improvement" in the character sheet
**When** the game state service builds the AI system prompt via `serializeForAi()`
**Then** the output contains a "Features" line listing the three features by name; the class name "Wizard" appears next to the level; the total output stays under 2KB; no feature descriptions are included (names only to save tokens)

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | `apps/frontend/client/src/lib/data/__tests__/character_sheet_helpers.test.ts` (modified) | `/game` — AI dialogue context | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Call `serializeForAi()` with a sheet that has features → verify output contains feature names, fits under 2KB
- E2E / Visual:
    - **Functional**: N/A — unit test covers serialization
    - **Visual**: N/A

**Watch Points**:
- Characters with no class (legacy data) must not crash `serializeForAi()` — omit the Features line entirely
- Feature names must be comma-separated, no markdown, no bullets — keep it compact
- The Features line must appear after Skills/Saves and before Traits to maintain a consistent prompt structure

## Implementation Sequence

1. **Phase 1 (Data/Logic)**:
   - Add `ClassDefinition`, `ClassFeature`, `AbilityActivation`, `SubclassDefinition` TypeBox schemas to `packages/shared/schemas/src/lib/game/class_definition.ts`
   - Add derived types to `packages/shared/types/src/lib/game/class_definition.ts`
   - Add starter class data (Fighter, Wizard, Rogue, Cleric, levels 1–5) to `packages/shared/constants/src/lib/game/classes.ts`
   - Extend `ContentPackManifestSchema` with optional `classes` and `abilities` fields
   - Extend `BaseCharacterSheetSchema` with `classId`, `classFeatures`, `hotbarSlots`, `abilityUses`
   - Add XP threshold table to `@aikami/constants`
   - Extend `PLAYER_LEVELED_UP` bridge event type with `featuresUnlocked: string[]`
   - Write schema/type unit tests, run `bun moon run schemas:test` and `bun moon run types:typecheck`

2. **Phase 2 (Integration)**:
   - Build `progression_system.ts` in engine — table-driven `resolveLevelUp()`, `checkLevelUp()`
   - Remove inline level-up logic from `turn_manager_system.ts`, delegate to progression system
   - Wire content pack loader to parse `classes`/`abilities` manifest fields
   - Extend `character_sheet_view_model.svelte.ts` with features tab, class summary, save projection
   - Extend `character_sheet_helpers.ts` `serializeForAi()` with class/features section
   - Build `hotbar_view_model.svelte.ts` and `hotbar_view.svelte`
   - Wire hotbar into `game_ui_view_model.svelte.ts` / `game_ui_view.svelte`
   - Extend `player_state_service.svelte.ts` with `classId`, `knownFeatures`, `hotbarSlots`
   - Add migration logic: legacy `class: string` → `classId` mapping on save load
   - Update dev sandboxes: character sheet sandbox, new hotbar sandbox
   - Run `bun moon run client:test` and `bun moon run frontend-engine:test`

3. **Phase 3 (Validation)**:
   - Unit tests: schema validation, progression math, feature unlock, AI serialization, migration
   - Integration: content pack loading with class data, level-up bridge event, hotbar activation
   - E2E: Playwright spec for level-up flow, hotbar keyboard activation
   - Visual: character sheet features tab, hotbar with abilities
   - Run `validate()` — fix, typecheck, all tests, build pass

## Edge Cases & Gotchas

- **Multi-level jump**: XP gain of 1000 at level 1 (thresholds: 0→300→900) requires two sequential level-ups — each unlocks its own features. Test that `_triggerLevelUp()` loops correctly.
- **Legacy class migration**: A save with `class: "Barbarian"` (not in our 4 starter classes) must default to "fighter" and grant fighter features retroactively. Log a warning.
- **Feature ID collisions**: Features shared across classes need globally unique IDs (`"fighter_second_wind"`, not `"second_wind"`). Enforce in schema via pattern or uniqueness test.
- **Hotbar during combat**: In exploration mode, hotbar is at screen bottom. During combat (C-338), the combat action menu also occupies bottom space. The hotbar should collapse or reposition during combat. This contract handles exploration mode only — combat integration is C-338.
- **Usage reset**: Abilities with `usageLimit: 'per_rest'` must reset on short/long rest. Rest mechanics are in C-338/C-344 — for now, add a `resetAbilityUses()` method and call it on combat end (existing combat flow) and on scene load. Document the TODO for proper rest integration.
- **Save file size**: Adding 4 classes × ~15 features each could add ~20KB of feature descriptions to the save if duplicated per character. Instead, save only `featureId` references and resolve descriptions from the content pack at display time.
- **Hotbar keyboard binding conflicts**: Hotbar uses keys 1–6 by default. These must not conflict with dialogue choice selection (also uses numbers). Dialogue choices take priority when dialogue overlay is open.

## Open Questions

Must be resolved before status becomes `approved`:

- Should the 4 starter classes track full 5 levels or just 3? Level 1-3 supports the Emberwatch demo (which is ~30-60 min). Level 1-5 supports longer campaigns. **Recommendation**: Implement 1–5 (the data is trivial to author; the validation and UI work is the same regardless).
- Should subclass choice at level 3 be a real choice with UI or auto-assigned? **Recommendation**: Auto-assign the first subclass for each class (Champion for Fighter, Evoker for Wizard, Thief for Rogue, Life for Cleric) — subclass choice UI adds UI complexity with no immediate gameplay value. Defer to a future contract.
- Should the hotbar support drag-and-drop reordering or just click-to-slot? **Recommendation**: Click-to-slot MVP (click feature, then click hotbar slot to assign). Drag-and-drop is a nice-to-have for C-346 (gamepad/touch).
- Should class data live in the content pack manifest or in `@aikami/constants`? **Recommendation**: Both — class DEFINITIONS (structure, feature tables) live in `@aikami/constants` as the source of truth. The content pack manifest gains an optional `classes` field that can override/augment the base set for adventure-specific variants (e.g., "Emberwatch Fighter" with fire-themed features). This mirrors how items work (base definitions in code, manifest can extend).
- Spell slot casting: Even though this contract defers full Vancian spellcasting, should Wizard/Cleric "spell" features mention spell slots in their descriptions? **Recommendation**: Yes — describe them as "You can cast X once per rest" without implementing a slot system. This sets expectations without building the system.

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
