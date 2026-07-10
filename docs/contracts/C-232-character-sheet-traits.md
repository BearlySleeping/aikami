## Metadata

| Field | Value |
|---|---|
| **Source** | Marinara-Engine `docs/GAME_MODE.md` (party cards, game-specific character sheets, stats), `docs/ROLEPLAY.md` (HUD widgets, PersonaStatsConfig), `docs/FRONTEND.md` (RPGStatsConfig); TODO.md C-ME-003 |
| **Target** | `apps/frontend/client/src/lib/views/game/dashboard/` + `apps/frontend/client/src/lib/views/character/` — D&D-Style Character Sheet with abilities, skills, traits, and AI context injection |
| **Priority** | P0 — Defines the RPG identity; the character sheet is the player's primary self-reference throughout the game |
| **Dependencies** | C-153 (Character Dashboard & Equipment — COMPLETED), C-158 (LPC Avatar Integration — COMPLETED), `GameStateService`, `PersonaData` schema, `persona_create_view_model.svelte.ts` (ability score extraction — EXISTS), `character_extraction_schema.ts` (AI extraction — EXISTS), C-230 (Connection config — COMPLETED), C-202 (Provider settings — COMPLETED) |
| **Status** | completed |
| **Contract version** | 1.0.0 |

## Overview

Aikami already has a combat-focused Character Dashboard (C-153) showing Level, XP, HP, ATK, DEF, and equipment slots — plus a persona creation flow that extracts ability scores (STR/DEX/CON/INT/WIS/CHA) from AI conversations. What's missing is the full D&D-style character sheet: ability score display with modifiers, a skills proficiency grid, saving throws, personality traits (Ideals/Bonds/Flaws), and narrative traits (Likes/Temptations/Keys) that influence AI behavior. Marinara-Engine's party cards and RPGStatsConfig type provide the inspiration. This contract replaces the minimal combat dashboard with a tabbed, DaisyUI character sheet that serializes into every AI prompt — making the AI truly aware of who the player character is.

## Design Reference

**Existing code to extend:**
- `apps/frontend/client/src/lib/views/game/dashboard/character_dashboard_view_model.svelte.ts` — reads HP, ATK, DEF, Level, XP, equipment from `GameStateService`; opened via C-key overlay
- `apps/frontend/client/src/lib/views/game/dashboard/character_dashboard_view.svelte` — DaisyUI card with stat grid, HP progress bar, XP progress bar, ATK/DEF display, equipment slots
- `apps/frontend/client/src/lib/views/character/persona/create/persona_create_view_model.svelte.ts` — already defines `ScoreLabel` type with `strength|dexterity|constitution|intelligence|wisdom|charisma` keys; AI extracts ability scores from conversation via `CharacterExtractionSchema`
- `apps/frontend/client/src/lib/data/ai_prompts/character_extraction_schema.ts` — TypeBox schema for extracting character data from LLM output
- `apps/frontend/client/src/lib/data/ai_prompts/dnd_creation.ts` — D&D creation system prompt
- `apps/frontend/client/src/lib/services/ai/text_generation_service.svelte.ts` — `streamChat()` and `extractStructure()` for AI calls
- `packages/shared/schemas/` — existing `PersonaData` and `CharacterData` schemas to extend

**Marinara-Engine inspiration:**
- Party cards: `examples/Marinara-Engine/docs/GAME_MODE.md` (party cards with class, abilities, strengths, weaknesses)
- HUD widgets: `examples/Marinara-Engine/docs/ROLEPLAY.md` (Roleplay HUD tracking player stats, inventory, quests)
- Stats config: `examples/Marinara-Engine/packages/shared/src/types/persona.ts` (PersonaStatsConfig)
- Card display: `examples/Marinara-Engine/docs/screenshots/Browser_Game_Party_Card.png`

**Testing conventions:** See `.pi/skills/testing/SKILL.md`. Playwright tests in `apps/e2e/tests/client/`, visual tests in `apps/e2e/src/visual/suites/`, POMs in `apps/e2e/src/pom/`, dev sandbox at `routes/(dev)/dev/`.

## Architecture Directives

- **Sheet data model**: Extend `PersonaData` schema with `AbilityScores`, `Skills`, `SavingThrows`, `Traits`, and `NarrativeTraits`. These fields are optional (backward-compatible with existing personas).
- **Sheet ViewModel**: Create `character_sheet_view_model.svelte.ts` extending `BaseViewModel`. Reads from `GameStateService` + persona data. Computes modifiers, proficiency bonuses, and total skill/save values.
- **Sheet View**: Create `character_sheet_view.svelte` — tabbed DaisyUI layout (Abilities, Skills, Traits) replacing the current minimal dashboard. Retain the C-key overlay trigger. Keep equipment slots accessible.
- **AI Context Serialization**: `serializeForAi()` method on the ViewModel produces a compact text summary of abilities, skills, traits, and narrative traits. This is injected into the system prompt on every AI interaction.
- **Narrative trait resolution**: The GM/system prompt uses Likes/Temptations/Keys to adjust DCs, NPC reactions, and plot hooks. Example: `Likes: Gold → Persuasion DC -2 when bribing`.
- **Pro Mode toggle**: "Advanced Mode" switch in the sheet header toggles between the visual DaisyUI sheet and a raw JSON editor (`<textarea>` with syntax highlighting hints). Changes saved to the same data model.
- **No backend changes**: Character sheet data is stored in existing `PersonaData` / Firestore schema. AI context injection is prompt-side only.

## State & Data Models

    // ── Ability Scores ──────────────────────────────────────

    type AbilityKey = 'strength' | 'dexterity' | 'constitution'
                    | 'intelligence' | 'wisdom' | 'charisma';

    interface AbilityScore {
        value: number;        // 3–20 (standard D&D range)
        modifier: number;     // Computed: floor((value - 10) / 2)
    }

    type AbilityScores = Record<AbilityKey, AbilityScore>;

    // ── Skills ──────────────────────────────────────────────

    interface Skill {
        name: string;                // "Athletics", "Stealth", etc.
        ability: AbilityKey;         // Associated ability for modifier
        proficient: boolean;         // Proficiency checkbox
        expertise: boolean;          // Double proficiency bonus (rogue/bard feature)
        modifier: number;            // Computed: abilityMod + (proficient ? pb : 0) * (expertise ? 2 : 1)
    }

    // Standard D&D 5e SRD skill list — 18 skills, each mapped to an ability:
    const STANDARD_SKILLS: Omit<Skill, 'modifier'>[] = [
        { name: 'Acrobatics',      ability: 'dexterity'     },
        { name: 'Animal Handling',  ability: 'wisdom'       },
        { name: 'Arcana',           ability: 'intelligence'  },
        { name: 'Athletics',        ability: 'strength'      },
        { name: 'Deception',        ability: 'charisma'      },
        { name: 'History',          ability: 'intelligence'  },
        { name: 'Insight',          ability: 'wisdom'        },
        { name: 'Intimidation',     ability: 'charisma'      },
        { name: 'Investigation',    ability: 'intelligence'  },
        { name: 'Medicine',         ability: 'wisdom'        },
        { name: 'Nature',           ability: 'intelligence'  },
        { name: 'Perception',       ability: 'wisdom'        },
        { name: 'Performance',      ability: 'charisma'      },
        { name: 'Persuasion',       ability: 'charisma'      },
        { name: 'Religion',         ability: 'intelligence'  },
        { name: 'Sleight of Hand',  ability: 'dexterity'     },
        { name: 'Stealth',          ability: 'dexterity'     },
        { name: 'Survival',         ability: 'wisdom'        },
    ];

    // ── Saving Throws ─────────────────══════════════════════

    interface SavingThrow {
        ability: AbilityKey;
        proficient: boolean;
        modifier: number; // Computed: abilityMod + (proficient ? pb : 0)
    }

    // ── Traits ──────────────────────────────────────────────

    interface CharacterTraits {
        personalityTraits: string;   // Free-text, comma-separated or prose
        ideals: string;
        bonds: string;
        flaws: string;
    }

    // ── Narrative Traits (Marinara-inspired) ─═══════════════

    interface NarrativeTraits {
        likes: string[];         // ["Gold", "Ancient Lore", "Flattery"]
        temptations: string[];   // ["Power", "Revenge", "Forbidden Knowledge"]
        keys: string[];          // ["Lost Sister", "The Crown of Aldren"]
                                 // Keys seed plot hooks — GM prioritizes these
    }

    // ── Proficiency Bonus ─────────────────══════════════════

    // Computed from level: floor((level - 1) / 4) + 2
    // Level 1-4: +2, 5-8: +3, 9-12: +4, 13-16: +5, 17-20: +6

    // ── Full Character Sheet ─────────────────═══════════════

    interface CharacterSheet {
        abilities: AbilityScores;
        skills: Skill[];
        savingThrows: SavingThrow[];
        traits: CharacterTraits;
        narrativeTraits: NarrativeTraits;
        proficiencyBonus: number;  // Computed from level

        // Inherited from existing PersonaData:
        level: number;
        xp: number;
        hp: number;
        maxHp: number;
        attack: number;
        defense: number;
    }

    // ── AI Serialization Format ─────────────────────────────

    // serializeForAi() produces compact text for system prompt injection:
    //
    // [CHARACTER SHEET]
    // Level 5 Fighter | HP 42/42 | AC 16 | ATK +7 | DMG 1d8+3
    // STR 16(+3) DEX 14(+2) CON 14(+2) INT 10(+0) WIS 12(+1) CHA 8(-1)
    // Proficiency: Athletics, Intimidation, Perception, Survival
    // Saves: STR +6, CON +5
    // Traits: "I always keep my word." "Might makes right." "I will find my sister."
    // Likes: Gold, Strong Drink, A Good Fight
    // Temptations: Power, Revenge
    // Keys: Lost Sister — the GM should seed related plot hooks.

## Scope Boundaries

- **In Scope:**
  - `CharacterSheet` data model extending existing `PersonaData`
  - Ability score display (STR/DEX/CON/INT/WIS/CHA) with computed modifiers
  - Skills grid — 18 standard D&D 5e SRD skills with proficiency + expertise toggles
  - Saving throws — 6 abilities with proficiency toggles and computed modifiers
  - Proficiency bonus computation from character level
  - Personality traits, ideals, bonds, flaws (CharacterTraits)
  - Narrative traits (Likes, Temptations, Keys) — editable string arrays
  - `serializeForAi()` method producing compact character sheet text
  - AI context injection — system prompt includes serialized sheet
  - Tabbed DaisyUI character sheet view (Abilities, Skills, Traits tabs)
  - Pro Mode toggle — raw JSON editor for manual stat allocation
  - Replace existing minimal `character_dashboard_view` (keep C-key trigger)
  - Dev sandbox route `/dev/character-sheet` for isolated testing
  - Unit tests for modifier computation, proficiency bonus, AI serialization
  - Playwright E2E tests in `apps/e2e/tests/client/character_sheet.spec.ts`
  - Visual tests in `apps/e2e/src/visual/suites/character_sheet.visual.ts`
  - POM for the character sheet (`apps/e2e/src/pom/character_sheet_page.ts`)
- **Out of Scope:**
  - AI-driven auto-generation of traits (Session Zero contract C-ME-004 covers this)
  - Equipment/inventory detail (already in C-153 dashboard — retain but don't redesign)
  - Spell slots / class features (separate contract)
  - Feats / racial traits (separate contract)
  - Backend persistence changes (extends existing PersonaData schema, no new collections)
  - Multi-character party management (separate contract)
  - Character sheet sharing / export (C-ME-017)

## Acceptance Criteria

### AC-1: Ability Scores with Modifiers
**Given** the player opens the character sheet (C-key)
**When** the Abilities tab is displayed
**Then** all 6 ability scores (STR/DEX/CON/INT/WIS/CHA) are shown with their current values, computed modifiers (e.g. "16 (+3)"), and the modifier is color-coded (positive=green, negative=red, zero=neutral)

**Test Hooks**:
- Moon Task: `moon run client:test`
- Unit Test: `ability_scores.test.ts` — test `computeModifier(16) → 3`, `computeModifier(9) → -1`, `computeModifier(10) → 0`; test ability values default to 10; test clamping (min 3, max 20)
- Integration: Dev sandbox at `/dev/character-sheet` — verify all 6 abilities render with correct modifiers; edit a score and verify modifier recomputes
- E2E / Visual:
    - **Functional**: `tests/client/character_sheet.spec.ts` — test "open sheet → verify STR shows '16 (+3)' → edit DEX to 10 → verify shows '10 (+0)'"
    - **Visual**: `suites/character_sheet.visual.ts` — `defineConfig({ id: 'ability-scores', route: '/dev/character-sheet', cases: [{ name: 'Ability Scores Tab — All 6 scores with modifiers', prompt: 'Verify 6 ability score rows with labels (STR, DEX, CON, INT, WIS, CHA), numeric values (3-20), modifier in parentheses with green/red color, and DaisyUI stat card layout.', schema: AbilityScoresSchema }] })`

**Watch Points**:
- Modifier formula: `Math.floor((score - 10) / 2)` — classic D&D 5e
- Ability scores range from 3 to 20 (standard point-buy/rolled range)
- Negative modifiers must be red, positive green, zero gray — use DaisyUI `text-success` / `text-error` / `text-base-content`
- Ability scores must persist in `PersonaData` — survivable across page reloads
- Tauri/mobile: touch-friendly number inputs with +/- stepper buttons

### AC-2: Skills Grid with Proficiency
**Given** the character sheet is open on the Skills tab
**When** the player views the skills list
**Then** all 18 standard D&D skills are displayed grouped by ability, each showing the computed total modifier (ability mod + proficiency bonus if proficient), with proficiency and expertise toggle checkboxes that update the modifier live

**Test Hooks**:
- Moon Task: `moon run client:test`
- Unit Test: `skills.test.ts` — test `computeSkillModifier({ abilityMod: 3, proficient: true, pb: 2, expertise: false }) → 5`; test `computeSkillModifier({ abilityMod: 3, proficient: true, pb: 2, expertise: true }) → 7`; test non-proficient skill uses raw ability modifier
- Integration: `/dev/character-sheet` — check proficiency checkbox on Athletics → verify modifier updates; uncheck → verify reverts
- E2E / Visual:
    - **Functional**: `tests/client/character_sheet.spec.ts` — test "navigate to Skills tab → verify 18 skills listed → toggle Athletics proficiency → verify modifier changed"
    - **Visual**: `suites/character_sheet.visual.ts` — case with mixed proficiency toggles, expertise on one skill, correct totals

**Watch Points**:
- Skills grouped by ability with section headers (STR skills, DEX skills, etc.)
- Proficient skills have a checkmark; expertise shows a star or double-check
- Total modifier display: `${name} +${total}` or `${name} ${total}` (show sign)
- 18 skills is a lot — use compact DaisyUI card or table layout; scrollable if needed
- Proficiency bonus is computed from level — `Math.floor((level - 1) / 4) + 2`

### AC-3: Saving Throws
**Given** the character sheet displays saving throws (visible on Abilities tab or a sub-section)
**When** the player toggles proficiency on a saving throw
**Then** the save modifier updates to include the proficiency bonus; the save display shows the total modifier with a proficiency indicator

**Test Hooks**:
- Moon Task: `moon run client:test`
- Unit Test: `saving_throws.test.ts` — test `computeSaveModifier({ abilityMod: 2, proficient: true, pb: 3 }) → 5`; test non-proficient save uses ability mod only
- E2E / Visual:
    - **Functional**: `tests/client/character_sheet.spec.ts` — test "toggle STR save proficiency → verify modifier updates"
    - **Visual**: N/A (covered by AC-1 abilities tab visual test)

**Watch Points**:
- Each class has default save proficiencies (Fighter: STR+CON, Wizard: INT+WIS, etc.) — auto-set during character creation but editable here
- Save display format: "STR Save: +5" (with proficiency dot/indicator)
- Six saves — consider a compact 3×2 or 2×3 grid layout

### AC-4: Traits & Narrative Traits
**Given** the player opens the Traits tab of the character sheet
**When** they view their character's personality traits, ideals, bonds, flaws
**Then** each is displayed as editable text with a descriptive label; below them, Likes, Temptations, and Keys are shown as chip/tag arrays with add/remove buttons

**Test Hooks**:
- Moon Task: `moon run client:test`
- Unit Test: `traits.test.ts` — test `addNarrativeTrait('likes', 'Gold')` → likes array includes 'Gold'; `removeNarrativeTrait('likes', 'Gold')` → removed; immutable update pattern (new array, not splice)
- E2E / Visual:
    - **Functional**: `tests/client/character_sheet.spec.ts` — test "navigate to Traits tab → verify personality/ideals/bonds/flaws textareas → add 'Gold' to Likes → verify chip appears → remove chip → verify removed"
    - **Visual**: `suites/character_sheet.visual.ts` — case showing Traits tab with filled-in personality traits, multiple Likes/Temptations/Keys chips

**Watch Points**:
- Personality traits, ideals, bonds, flaws are free-text (textarea). Max 500 chars each.
- Likes/Temptations/Keys are string arrays — use DaisyUI `badge` components with ✕ remove button
- Add new item via text input + Enter key or "Add" button
- Deduplicate — no duplicate entries in any array
- Narrative traits must appear in `serializeForAi()` output

### AC-5: AI Context Injection
**Given** the player has a character sheet with abilities, skills, traits, and narrative traits
**When** they interact with any NPC or the GM
**Then** the system prompt includes a serialized character sheet summary containing abilities with modifiers, proficient skills, saving throws, traits, and narrative traits (Likes/Temptations/Keys)

**Test Hooks**:
- Moon Task: `moon run client:test`
- Unit Test: `ai_serialization.test.ts` — test `serializeForAi(sheet)` produces output with all sections; test output length under 2KB (don't bloat prompts); test null-safe (missing fields produce graceful fallback); test narrative traits formatted correctly
- Integration: `/dev/character-sheet` — click "Preview AI Context" button → verify serialized text appears and matches expected format
- E2E / Visual:
    - **Functional**: `tests/client/character_sheet.spec.ts` — test "fill character sheet → click Preview AI Context → verify text contains 'STR 16(+3)', 'Proficiency: Athletics', 'Likes: Gold'"
    - **Visual**: N/A (text output — functional test suffices)

**Watch Points**:
- Serialized output must be compact — target < 2KB for the character sheet section
- Null-safe: if traits are empty, don't inject empty sections (avoid confusing the AI)
- Keys section: append hint text "the GM should seed related plot hooks" only when keys are present
- The serialized text is injected into the `system` prompt message — never into `user` messages
- Existing prompts must not break — append to end of system prompt, don't replace

### AC-6: Pro Mode — Raw JSON Editor
**Given** the player is on any tab of the character sheet
**When** they toggle the "Pro Mode" switch
**Then** the DaisyUI card view is replaced by a read-only JSON display of the full `CharacterSheet` object; a sub-toggle "Enable Editing" reveals an editable `<textarea>` with the JSON; saving validates the JSON against the schema and updates the sheet; invalid JSON shows inline error

**Test Hooks**:
- Moon Task: `moon run client:test`
- Unit Test: `pro_mode.test.ts` — test `validateSheetJson(validJson)` → returns parsed object; `validateSheetJson(invalidJson)` → returns error with line number; edit JSON → re-validate → update state
- E2E / Visual:
    - **Functional**: `tests/client/character_sheet.spec.ts` — test "toggle Pro Mode → verify JSON displayed → enable editing → modify STR value → save → verify sheet updated → type invalid JSON → verify error shown"
    - **Visual**: `suites/character_sheet.visual.ts` — case showing Pro Mode with formatted JSON and the "Enable Editing" toggle

**Watch Points**:
- Pro Mode toggle persists in `localStorage` (not per-character — global preference)
- JSON formatting: `JSON.stringify(data, null, 2)` for readability
- Validation: use the existing Zod/TypeBox schema — reuse `CharacterExtractionSchema` or create a lightweight `CharacterSheetSchema`
- Invalid JSON: highlight the error, show the validation message, do NOT clear the textarea
- Pro Mode is a power-user feature — default OFF

### AC-7: Dev Sandbox — Isolated Testing
**Given** the developer navigates to `/dev/character-sheet`
**When** the page loads
**Then** a DaisyUI-panel displays a fully interactive character sheet with mock data: all 6 ability scores editable, skills grid with proficiency toggles, traits with editable text, narrative trait chips, Pro Mode toggle, AI context preview button

**Test Hooks**:
- Moon Task: `moon run client:dev` (manual verification)
- E2E / Visual:
    - **Functional**: `tests/client/character_sheet.spec.ts` — test sandbox loads, all tabs render, interactions work
    - **Visual**: `suites/character_sheet.visual.ts` — `defineConfig({ id: 'character-sheet-sandbox', route: '/dev/character-sheet', cases: [{ name: 'Character Sheet Sandbox — Abilities tab', prompt: 'Verify all 6 ability scores, modifier colors, Pro Mode toggle, and tab navigation visible with clean DaisyUI styling.', schema: SandboxSchema }, { name: 'Character Sheet Sandbox — Skills tab', setupHook: switchToSkillsTab, prompt: 'Verify 18 skills grouped by ability, proficiency checkboxes, computed modifiers.', schema: SkillsSchema }, { name: 'Character Sheet Sandbox — Traits tab', setupHook: switchToTraitsTab, prompt: 'Verify personality traits textareas, Likes/Temptations/Keys chips with add/remove buttons.', schema: TraitsSchema }] })`

## Implementation Sequence

### Phase 1: Data Layer
1. Define `AbilityKey`, `AbilityScore`, `AbilityScores` types in `packages/shared/types/`
2. Define `Skill`, `SavingThrow`, `CharacterTraits`, `NarrativeTraits` types
3. Create `CharacterSheet` aggregate type
4. Create `STANDARD_SKILLS` constant (18 D&D SRD skills with ability mappings)
5. Create pure computation helpers: `computeModifier(score: number): number`, `computeProficiencyBonus(level: number): number`, `computeSkillModifier(skill, abilityMod, pb): number`, `computeSaveModifier(save, abilityMod, pb): number`
6. Create `serializeForAi(sheet: CharacterSheet): string` — produces compact text summary
7. Create `validateSheetJson(json: string): { data?: CharacterSheet; error?: string }` — JSON parse + Zod/TypeBox validation
8. Extend `PersonaData` schema to include optional `CharacterSheet` fields
9. Write unit tests: `ability_scores.test.ts`, `skills.test.ts`, `saving_throws.test.ts`, `traits.test.ts`, `ai_serialization.test.ts`, `pro_mode.test.ts`

### Phase 2: ViewModel
1. Create `character_sheet_view_model.svelte.ts` extending `BaseViewModel`
2. Read character data from `GameStateService` (level, xp, hp, maxHp, attack, defense) + existing persona data
3. Expose computed state: `abilities`, `skills` (with computed modifiers), `savingThrows`, `traits`, `narrativeTraits`, `proficiencyBonus`, `activeTab`
4. Methods: `setActiveTab(tab)`, `setAbilityScore(key, value)`, `toggleSkillProficiency(name)`, `toggleSkillExpertise(name)`, `toggleSaveProficiency(ability)`, `setTrait(field, text)`, `addNarrativeTrait(category, value)`, `removeNarrativeTrait(category, value)`, `toggleProMode()`, `enableJsonEditing()`, `saveJsonEdit(json)`, `getAiContext()`
5. `save()` method persists back to `GameStateService` / persona data store
6. Write unit test: `character_sheet_view_model.test.ts`

### Phase 3: Views
1. Create `character_sheet_view.svelte` — full DaisyUI card with:
   - Header: character name, level badge, Pro Mode toggle
   - Tab bar: Abilities | Skills | Traits (DaisyUI `tabs` component)
   - Abilities tab: 6 ability cards in a 3×2 or 2×3 grid with value inputs, modifier display, save proficiency toggle
   - Skills tab: skills grouped by ability with proficiency + expertise checkboxes, computed modifier
   - Traits tab: personality/ideals/bonds/flaws textareas + Likes/Temptations/Keys chip inputs
   - Pro Mode overlay: JSON display + editable textarea + validate button
   - "Preview AI Context" button (footer) — opens modal showing serialized text
2. Update `character_dashboard_view.svelte` to render the new `character_sheet_view` (or replace it entirely — keep the C-key overlay trigger and equipment slot section)
3. Create dev sandbox: `routes/(dev)/dev/character-sheet/+page.svelte` + `character_sheet_sandbox_view_model.svelte.ts`

### Phase 4: AI Integration
1. Wire `serializeForAi()` into the dialogue AI prompt assembly — append character sheet to system prompt in both `chat_view_model` and `dialogue_overlay_view_model`
2. Update `dnd_creation.ts` system prompt to reference character sheet traits
3. Add narrative trait hints to GM prompt: "The player Likes: Gold → persuasion DCs involving bribes are 2 lower. The player's Key: Lost Sister → seed related plot hooks."

### Phase 5: Validation
1. `moon run client:fix && moon run client:typecheck` — ensure zero type errors
2. `moon run client:test` — unit tests for all computation helpers, ViewModel, serialization
3. `cd apps/e2e && bun run test` — Playwright functional tests
4. `cd apps/e2e && bun run test:visual` — AI visual tests
5. Manual: `/dev/character-sheet` sandbox — all tabs, Pro Mode, AI preview work in isolation

## Edge Cases & Gotchas

- **Backward compatibility**: Existing personas don't have `CharacterSheet` fields. On first load, default all ability scores to 10, skills to empty proficiencies, traits to empty strings. Migration must be non-destructive — don't overwrite existing persona data.
- **Ability score bounds**: Scores must be clamped to 3–20. Pro Mode JSON editing must enforce this range on save.
- **Modifier caching**: Modifiers are computed values — recompute on ability change or level change. Use Svelte 5 `$derived` for reactive recomputation.
- **Proficiency bonus from level**: Must stay in sync with `GameStateService.level`. If level changes (level up), all skill and save modifiers recompute automatically.
- **Textarea vs input for scores**: On desktop, number inputs work. On mobile/Tauri, consider +/- stepper buttons alongside the input for easier tapping.
- **Skills display density**: 18 skills is a lot. Use compact table layout with ability group headers. Scrollable if viewport is small. Consider collapsible ability sections.
- **AI serialization length**: Keep serialized output under 2KB. Omit skills/traits that are at default values (not proficient, no text). Don't waste tokens on empty data.
- **Pro Mode safety**: When the user toggles Pro Mode OFF, discard any unsaved JSON edits (or prompt to save). The visual sheet always reflects the last validated state.
- **Narrative trait indexing**: Likes/Temptations/Keys are stored as string arrays. The GM prompt uses substring matching to detect relevant traits — no NLP needed. "Likes: Gold" matches when the player attempts to bribe an NPC.
- **Equipment section preservation**: The existing C-153 equipment slots (weapon, armor) must remain accessible. Either keep them in a sub-section of the new sheet or retain the old dashboard as a separate overlay.
