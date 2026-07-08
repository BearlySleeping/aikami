## Metadata

| Field | Value |
|---|---|
| **Source** | Marinara-Engine `docs/GAME_MODE.md` (dice rolling, combat encounters, address modes), `docs/ROLEPLAY.md` (combat encounters, encounter store); TODO.md C-ME-005 |
| **Target** | `apps/frontend/client/src/lib/views/combat/` — Combat UX Enhancement: multi-dice UI, initiative tracker, turn tracking, enriched combat log |
| **Priority** | P1 — Combat is the core D&D mechanic; dice are the most visceral feedback loop in the game |
| **Dependencies** | C-145 (Turn-Based Combat Loop — COMPLETED), C-148 (Combat Immersion — COMPLETED), C-162 (BG3 Action Menu & Dice — COMPLETED), C-164 (Combat Split-Screen — COMPLETED), `CombatViewModel` (1182 lines — EXISTS), `GameDice` component (C-148/C-162 — EXISTS), `diceService` (EXISTS), `combat_dice_ui.svelte` (31 lines — EXISTS), C-232 (Character Sheet — COMPLETED for skill/save modifiers) |
| **Status** | done |
| **Contract version** | 1.0.0 |

## Overview

Aikami's combat engine is already robust: the `CombatViewModel` (C-145, 1182 lines) handles ECS bridge events, LLM action interpretation, HP tracking, dice roll animation triggers, and portrait stage rendering. The `GameDice` component (C-148, C-162) provides a polished d20 overlay with interactive/rolling/revealed phases. However, the combat UX is missing the full D&D dice table experience that Marinara-Engine provides: a multi-dice quick menu (d4–d100), an initiative tracker showing turn order with current-turn highlight, a turn tracking header with action economy, and an enriched combat log that surfaces dice results, advantage/disadvantage, and damage types inline. This contract enhances the existing combat surface with these game-feel layers — the mechanical engine stays unchanged.

## Design Reference

**Existing code to extend (DO NOT rewrite):**
- `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts` (1182 lines) — full combat state machine: ECS bridge, `CombatLogEntry[]`, `DiceState` for d20, `_triggerDiceAnimation()` parsing "Player rolls 17" from COMBAT_LOG messages, combat actions with LLM interpretation via `CombatActionSchema`, HP/status tracking. **This contract adds to, does not replace.**
- `apps/frontend/client/src/lib/views/combat/combat_view.svelte` (282 lines) — main combat view rendering split-screen layout (35/65 from C-164), combat sidebar with log + action bar, `GameDice` overlay
- `apps/frontend/client/src/lib/views/combat/components/combat_dice_ui.svelte` (31 lines) — minimal dice display; will be expanded
- `apps/frontend/client/src/lib/components/game/game_dice.svelte` — shared `DiceState` type + d20 overlay component (interactive/rolling/revealed phases, success/failure coloring, checkInfo for DC display)
- `apps/frontend/client/src/lib/views/combat/components/combat_portrait_stage.svelte` (212 lines) — JRPG party vs enemy portrait stage
- `apps/frontend/client/src/lib/views/combat/components/combat_sidebar.svelte` — combat sidebar with log
- `apps/frontend/client/src/lib/services/game/dice_service.svelte.ts` (if exists) or the `diceService` import used elsewhere

**Marinara-Engine inspiration:**
- Dice roller: `examples/Marinara-Engine/docs/GAME_MODE.md` (8 preset notations + custom, queued then sent, resolved server-side)
- Combat encounters: `examples/Marinara-Engine/docs/GAME_MODE.md` (turn-based, initiative, HP, encounter store)
- Combat UI: `examples/Marinara-Engine/packages/client/src/stores/encounter.store.ts` (`active`, `party`, `enemies`, `environment`, `playerActions`, `encounterLog`)

**Testing conventions:** See `.pi/skills/testing/SKILL.md`. Playwright tests in `apps/e2e/tests/client/`, visual tests in `apps/e2e/src/visual/suites/`, POMs in `apps/e2e/src/pom/`, dev sandbox at `routes/(dev)/dev/`.

## Architecture Directives

- **Multi-dice quick menu**: A compact button toolbar rendered inside the existing combat sidebar (or as a collapsible panel) showing 8 preset dice notations: d20, d12, d10, d8, d6, d4, d100, 2d6. Clicking a die queues the roll. A custom input field allows free-form notation like `3d8+2`. Queued rolls are displayed as badges; clicking "Roll All" resolves them all via `diceService` and appends results to the combat log.
- **Initiative tracker**: A vertical list in the combat sidebar showing all combatants sorted by initiative value (highest first). Each row shows: combatant name, initiative value, HP bar (mini), and a "current turn" highlight. The tracker updates when the ECS emits `COMBAT_STATE_UPDATE`. Clicking a combatant name scrolls the log to their last action.
- **Turn tracking header**: A prominent banner at the top of the combat area showing "Your Turn" (green) or "Enemy Turn" (red) with the combatant name. Below it: action economy indicators — 3 dots/circles for Action, Bonus Action, Reaction. Used dots are dimmed. An "End Turn" button is visible during player turns.
- **Combat log enrichment**: Existing `CombatLogEntry` type is extended with optional `diceResult`, `advantage`, `damageType`, and `targetName` fields. The log renderer highlights dice rolls in bold, shows advantage/disadvantage with ⟐/⬡ icons, and colors damage by type (fire=red, cold=blue, etc.).
- **Quick-dice in chat input**: The dialogue overlay and chat input gain a small dice icon button that opens the same dice quick menu. This enables non-combat skill checks without entering full combat mode.
- **No ECS changes**: The initiative/turn data already exists in the ECS combat system (C-145). This contract only surfaces it visually.

## State & Data Models

    // ── Dice Notation ─────────────────═════════════════════

    interface DiceNotation {
        id: string;            // "d20", "d6", "custom-123"
        label: string;         // "d20", "2d6", "3d8+2"
        notation: string;      // "1d20", "2d6", "3d8+2" — standard dice notation
        isPreset: boolean;     // Built-in preset or user custom
    }

    // 8 built-in presets:
    const DICE_PRESETS: DiceNotation[] = [
        { id: 'd20',    label: 'd20',    notation: '1d20',    isPreset: true },
        { id: 'd12',    label: 'd12',    notation: '1d12',    isPreset: true },
        { id: 'd10',    label: 'd10',    notation: '1d10',    isPreset: true },
        { id: 'd8',     label: 'd8',     notation: '1d8',     isPreset: true },
        { id: 'd6',     label: 'd6',     notation: '1d6',     isPreset: true },
        { id: 'd4',     label: 'd4',     notation: '1d4',     isPreset: true },
        { id: 'd100',   label: 'd100',   notation: '1d100',   isPreset: true },
        { id: '2d6',    label: '2d6',    notation: '2d6',     isPreset: true },
    ];

    // ── Queued Roll ─────────────────════════════════════════

    interface QueuedRoll {
        id: string;
        notation: DiceNotation;
        result?: { total: number; rolls: number[]; modifier: number };
        // e.g., 2d6+3 → { total: 11, rolls: [4, 4], modifier: 3 }
    }

    // ── Initiative Entry ─────────────────═══════════════════

    interface InitiativeEntry {
        combatantId: string;
        name: string;              // "Goblin Scout", "Aldric (You)"
        initiative: number;        // Raw roll + DEX modifier
        hp: number;
        maxHp: number;
        isPlayer: boolean;
        isCurrentTurn: boolean;    // Highlighted row
        isDefeated: boolean;       // 0 HP — grayed out, moved to bottom
    }

    // ── Turn Tracking ─────────────────══════════════════════

    interface TurnState {
        phase: 'player' | 'enemy' | 'waiting';
        activeCombatantName: string;
        actionUsed: boolean;       // Main action consumed this turn
        bonusActionUsed: boolean;
        reactionAvailable: boolean; // Reaction resets at start of player's turn
    }

    // ── Enriched Combat Log Entry ─────────────────══════════

    // Extends existing CombatLogEntry (from combat_view_model.svelte.ts):
    interface EnrichedCombatLogEntry {
        // ...existing fields (id, text, timestamp, sender, type)...
        diceResult?: {
            notation: string;      // "1d20+4" or "2d6+3"
            total: number;
            rolls: number[];
            modifier: number;
        };
        advantage?: 'advantage' | 'disadvantage' | null;
        damageType?: 'slashing' | 'piercing' | 'bludgeoning'
                   | 'fire' | 'cold' | 'lightning' | 'acid'
                   | 'poison' | 'necrotic' | 'radiant' | 'force'
                   | 'psychic' | 'thunder';
        targetName?: string;       // Who was hit/healed
    }

    // ── Damage Type Colors ─═════════════════════════════════

    const DAMAGE_TYPE_COLORS: Record<string, string> = {
        slashing:    'text-base-content',   // neutral
        piercing:    'text-base-content',
        bludgeoning: 'text-base-content',
        fire:        'text-error',           // red
        cold:        'text-info',            // blue
        lightning:   'text-warning',         // yellow
        acid:        'text-success',         // green
        poison:      'text-accent',          // purple
        necrotic:    'text-neutral',         // dark gray
        radiant:     'text-warning',         // gold
        force:       'text-primary',         // blue-primary
        psychic:     'text-secondary',       // pink
        thunder:     'text-info',            // cyan
    };

## Scope Boundaries

- **In Scope:**
  - Multi-dice quick menu (8 preset buttons + custom notation input) in combat sidebar
  - Dice roll queuing (click dice → badge appears → "Roll All" resolves)
  - Dice roll resolution via existing `diceService` (server-side PRNG)
  - Initiative tracker component reading from ECS `COMBAT_STATE_UPDATE` events
  - Sorted initiative list with current-turn highlight, HP mini-bars, defeated graying
  - Turn tracking header ("Your Turn"/"Enemy Turn") with action economy dots
  - "End Turn" button dispatching `END_TURN` command to ECS bridge
  - Combat log enrichment: dice results bolded, advantage/disadvantage icons, damage type coloring
  - Quick-dice button in dialogue overlay chat input for non-combat skill rolls
  - Dev sandbox route `/dev/combat-enhancements` for isolated testing
  - Unit tests for dice notation parsing, initiative sorting, action economy state machine
  - Playwright E2E tests in `apps/e2e/tests/client/combat_enhancements.spec.ts`
  - Visual tests in `apps/e2e/src/visual/suites/combat_enhancements.visual.ts`
  - POM extension for existing combat page (`apps/e2e/src/pom/combat_page.ts` — extend, don't replace)
- **Out of Scope:**
  - Changes to the ECS combat engine or `turn_manager_system` (already works)
  - Changes to combat LLM action interpretation (already works)
  - New damage types or combat mechanics
  - Multi-target spell targeting UI (separate contract)
  - Combat music/SFX triggers (C-150 Audio System covers this)
  - Portrait stage changes (already rendered by `combat_portrait_stage.svelte`)

## Acceptance Criteria

### AC-1: Multi-Dice Quick Menu
**Given** the combat sidebar is visible
**When** the dice quick menu is expanded
**Then** 8 preset dice buttons (d4, d6, d8, d10, d12, d20, d100, 2d6) are displayed in a compact grid; clicking a die adds a badge to a "queued rolls" area; a custom input field below the buttons accepts free-form notation like `3d8+2`; clicking "Roll All" resolves all queued rolls via `diceService` and appends results to the combat log

**Test Hooks**:
- Moon Task: `moon run client:test`
- Unit Test: `dice_quick_menu.test.ts` — test `queueRoll(d20)` adds to queue; `queueRoll('3d8+2')` parses notation and adds; `resolveAllRolls()` calls `diceService` for each and clears queue; custom notation validator rejects `abc`, accepts `2d6+3`
- Integration: `/dev/combat-enhancements` — click d20 → verify badge appears → click 2d6 → verify second badge → type `1d8+2` → click Roll All → verify 3 results in combat log
- E2E / Visual:
    - **Functional**: `tests/client/combat_enhancements.spec.ts` — test "open dice menu → click d20 → verify badge → click Roll All → verify result in log"
    - **Visual**: `suites/combat_enhancements.visual.ts` — `defineConfig({ id: 'combat-dice-menu', route: '/dev/combat-enhancements', cases: [{ name: 'Dice Quick Menu — All 8 presets + custom input + queued badges', prompt: 'Verify 8 dice preset buttons in a compact grid, custom notation input field, and 2 queued roll badges visible before Roll All. Clean DaisyUI styling with hover states on dice buttons.', schema: DiceMenuSchema }] })`

**Watch Points**:
- Dice buttons should be large enough for touch targets (min 44×44px)
- Queued rolls visible as DaisyUI `badge` components next to the dice menu
- "Roll All" is disabled when queue is empty; shows roll count: "Roll All (3)"
- Custom input validates on blur — invalid notation shows red border + tooltip
- Results appended to log in queue order, not simultaneously

### AC-2: Initiative Tracker
**Given** combat is active with multiple combatants
**When** the initiative tracker is displayed in the combat sidebar
**Then** all combatants are listed in initiative order (highest first); each row shows name, initiative value, mini HP bar, and player/enemy icon; the current-turn combatant row is highlighted with a glowing border; defeated combatants (0 HP) are grayed out and moved to the bottom

**Test Hooks**:
- Moon Task: `moon run client:test`
- Unit Test: `initiative_tracker.test.ts` — test `sortByInitiative(entries)` sorts highest first; test defeated entries moved to bottom regardless of initiative; test `isCurrentTurn` flag updates when active combatant changes; test HP bar percentage calculation
- Integration: `/dev/combat-enhancements` — verify initiative list renders with 3 combatants in correct order; verify current-turn highlight; reduce a combatant HP to 0 → verify grayed out + bottom
- E2E / Visual:
    - **Functional**: `tests/client/combat_enhancements.spec.ts` — test "verify initiative order → verify current turn highlight → defeat enemy → verify grayed out"
    - **Visual**: `suites/combat_enhancements.visual.ts` — case showing initiative list with 5 combatants, current-turn highlight on the 2nd entry, one defeated at bottom

**Watch Points**:
- Initiative values from ECS are signed numbers — could be negative (low DEX + bad roll)
- The player's row should show "(You)" after the name
- Mini HP bar: DaisyUI `progress` with `h-1` (very compact)
- Defeated combatants: `opacity-50` + strikethrough name + moved below a "Defeated" divider
- Sort tiebreaker: DEX modifier (already in ECS data) or alphabetical

### AC-3: Turn Tracking Header with Action Economy
**Given** it is the player's turn in combat
**When** the combat area header is displayed
**Then** a prominent banner shows "Your Turn" in green with the player's name; below it, 3 action economy indicators (Action, Bonus Action, Reaction) are shown as filled/empty circles; used actions are dimmed; clicking "End Turn" dispatches an `END_TURN` ECS command and transitions to "Enemy Turn: Goblin Scout"

**Test Hooks**:
- Moon Task: `moon run client:test`
- Unit Test: `turn_tracker.test.ts` — test `TurnState` transitions: `player` → `enemy` on `endTurn()`; test action/bonus action toggles; test reaction resets on new player turn; test `endTurn()` dispatches `END_TURN` via bridge
- Integration: `/dev/combat-enhancements` — verify "Your Turn" banner → click "Attack" (action) → verify Action dot dims → click "End Turn" → verify banner changes to "Enemy Turn"
- E2E / Visual:
    - **Functional**: `tests/client/combat_enhancements.spec.ts` — test "verify Your Turn banner → perform action → verify action dot dimmed → click End Turn → verify enemy banner"
    - **Visual**: `suites/combat_enhancements.visual.ts` — case showing "Your Turn" banner in green with action economy dots (1 used, 2 available)

**Watch Points**:
- "Your Turn" banner: green background (`bg-success/20`), player name bold
- "Enemy Turn" banner: red background (`bg-error/20`), enemy name + "is thinking..." spinner
- Action economy dots: large circles (24×24px), filled when available, outline when used
- "End Turn" button: prominent, right-aligned, disabled during enemy turns
- The banner should animate in with a slide-down transition on turn change

### AC-4: Enriched Combat Log
**Given** combat actions are logged
**When** a log entry contains a dice roll result (e.g., "Player rolls 17 (+4 = 21) to hit")
**Then** the dice roll values appear in bold with the notation and total highlighted; advantage/disadvantage is indicated with ⟐/⬡ icons; damage type is color-coded (fire=red, cold=blue, etc.); the target name is shown in italics

**Test Hooks**:
- Moon Task: `moon run client:test`
- Unit Test: `combat_log_enrichment.test.ts` — test `parseDiceFromLog("Player rolls 17 (+4 = 21) to hit")` extracts `{ notation: "1d20+4", total: 21, rolls: [17], modifier: 4 }`; test `parseDamageFromLog("deals 8 fire damage to Goblin")` extracts `{ amount: 8, type: 'fire', target: 'Goblin' }`; test advantage detection from "with advantage" or "⟐" in log
- E2E / Visual:
    - **Functional**: `tests/client/combat_enhancements.spec.ts` — test "perform attack → verify log shows bold dice result → verify fire damage in red → verify target name italicized"
    - **Visual**: `suites/combat_enhancements.visual.ts` — case showing enriched combat log with bold dice totals, colored damage types, advantage icon, italicized target name

**Watch Points**:
- Log parsing uses regex — must handle variations from the LLM: "rolls 17", "rolled a 17", "17 (+4)", "1d20 = 17"
- Damage type matching: case-insensitive, handles "fire", "Fire", "FIRE"
- Advantage indicator: "with advantage" or if the engine emits a specific advantage flag
- Log entries without dice/damage (narration, status updates) render as normal plain text
- Must NOT break existing log parsing — enrichment is additive, not destructive

### AC-5: Quick-Dice in Chat Input
**Given** the dialogue overlay is open during non-combat gameplay
**When** the player clicks the dice icon in the chat input area
**Then** the same dice quick menu opens as a popover; selecting dice queues them; clicking "Roll" resolves and appends results to the chat as a system message: "🎲 Aldric rolled 1d20+4 = 21 (17+4)"

**Test Hooks**:
- Moon Task: `moon run client:test`
- Unit Test: `quick_dice_chat.test.ts` — test dice menu opens from chat input; test roll result appended as system message; test menu closes on roll or click-away
- E2E / Visual:
    - **Functional**: `tests/client/combat_enhancements.spec.ts` — test "open dialogue → click dice icon → select d20 → roll → verify 'Aldric rolled 1d20+4 = 21' in chat"
    - **Visual**: N/A (functional suffices)

**Watch Points**:
- The dice icon button is placed next to the send button in the chat input (DaisyUI `btn-ghost btn-circle`)
- Uses the same `DiceNotation` presets and `diceService` as the combat dice menu — DRY
- Rolls outside combat don't trigger ECS combat events — they're purely informational
- The system message format must include character name, notation, total, and breakdown

### AC-6: Dev Sandbox — Isolated Testing
**Given** the developer navigates to `/dev/combat-enhancements`
**When** the page loads
**Then** a DaisyUI panel shows a mock combat encounter with all enhancements: multi-dice menu with queue, initiative tracker with 5 combatants (mixed player/enemy, one defeated), turn tracking header with action economy, enriched combat log with dice results and damage colors, and a dialogue area with quick-dice button

**Test Hooks**:
- Moon Task: `moon run client:dev` (manual verification)
- E2E / Visual:
    - **Functional**: `tests/client/combat_enhancements.spec.ts` — test sandbox loads, all components render, interactions work
    - **Visual**: `suites/combat_enhancements.visual.ts` — `defineConfig({ id: 'combat-enhancements-sandbox', route: '/dev/combat-enhancements', cases: [{ name: 'Combat Sandbox — Full layout', prompt: 'Verify initiative tracker on the left with sorted entries and current-turn highlight, combat log on the right with enriched entries (bold dice, colored damage), dice quick menu at bottom with 8 presets + custom input + queued badges, and turn tracking header showing Your Turn with action economy dots.', schema: SandboxFullSchema }, { name: 'Combat Sandbox — Dice Menu Detail', setupHook: expandDiceMenu, prompt: 'Verify all 8 dice buttons visible in grid, custom notation input, and 3 queued roll badges with Roll All button.', schema: SandboxDiceSchema }] })`

## Implementation Sequence

### Phase 1: Data Layer
1. Define `DiceNotation`, `QueuedRoll`, `InitiativeEntry`, `TurnState`, `EnrichedCombatLogEntry` types — extend existing types where possible
2. Create `DICE_PRESETS` constant (8 preset notations)
3. Create `DAMAGE_TYPE_COLORS` constant
4. Create pure helpers: `parseDiceNotation(input: string): DiceNotation | null`, `sortInitiative(entries: InitiativeEntry[]): InitiativeEntry[]`, `parseDiceFromLog(text: string): DiceResult | null`, `parseDamageFromLog(text: string): DamageInfo | null`
5. Extend `CombatViewModel` minimally:
   - Add `queuedRolls: QueuedRoll[]`, `initiativeEntries: InitiativeEntry[]` (derived from ECS state), `turnState: TurnState`
   - Add `queueRoll(notation)`, `removeQueuedRoll(id)`, `resolveAllRolls()`, `endTurn()`
   - `_triggerDiceAnimation()` already exists — enhance to handle multi-dice results in log enrichment
6. Write unit tests: `dice_quick_menu.test.ts`, `initiative_tracker.test.ts`, `turn_tracker.test.ts`, `combat_log_enrichment.test.ts`, `quick_dice_chat.test.ts`

### Phase 2: View Components
1. Create `dice_quick_menu.svelte` — compact grid of 8 preset buttons + custom input + "Roll All" button + queued badges. Reusable component (used in both combat sidebar and chat input).
2. Create `initiative_tracker.svelte` — vertical list of combatant rows with initiative, mini HP, highlight, and defeated state. Reads from `CombatViewModel.initiativeEntries`.
3. Create `turn_tracker_header.svelte` — "Your Turn"/"Enemy Turn" banner with action economy dots + "End Turn" button.
4. Enhance `combat_sidebar.svelte` — integrate `dice_quick_menu` at the bottom, `initiative_tracker` above it (collapsible), and enriched log entries.
5. Enhance `combat_view.svelte` — add `turn_tracker_header` at the top of the combat area.
6. Add quick-dice button to `dialogue_overlay.svelte` — small dice icon next to the send button, opens `dice_quick_menu` as a popover.
7. Create dev sandbox: `routes/(dev)/dev/combat-enhancements/+page.svelte` + `combat_enhancements_sandbox_view_model.svelte.ts`

### Phase 3: Integration
1. Wire `InitiativeEntry[]` population from existing ECS `COMBAT_STATE_UPDATE` bridge events (data already flowing — just derive the UI-ready list)
2. Wire `TurnState` transitions from ECS turn events (player turn → enemy turn → player turn)
3. Wire `END_TURN` command dispatch through existing `EngineBridge.send()`
4. Ensure existing combat functionality (portrait stage, image generation, dice animation) continues to work alongside new components

### Phase 4: Validation
1. `moon run client:fix && moon run client:typecheck` — ensure zero type errors
2. `moon run client:test` — unit tests for dice parsing, initiative sorting, turn state machine, log enrichment
3. `cd apps/e2e && bun run test` — Playwright functional tests
4. `cd apps/e2e && bun run test:visual` — AI visual tests
5. Manual: `/dev/combat-enhancements` sandbox — all components functional

## Edge Cases & Gotchas

- **Dice notation validation**: Free-form input must parse standard notation: `XdY+Z` or `XdY-Z` where X=1-99, Y=2-100, Z=0-999. Case-insensitive "d". Reject empty, non-numeric.
- **Initiative during turn changes**: The initiative list should animate row reordering smoothly (CSS transition on `transform`). Avoid abrupt jumps.
- **Defeated combatant reordering**: Defeated combatants go to the bottom but should NOT animate if they were already there — only animate when a combatant just dropped to 0 HP.
- **Action economy edge cases**: Multi-class characters may have different action economies. Keep it simple: 1 action, 1 bonus action, 1 reaction per turn. Action Surge (Fighter) adds a 2nd action as a future enhancement.
- **Quick-dice outside combat**: Non-combat dice rolls don't affect ECS state. The result is displayed but not sent to the engine. The player can optionally send it to the chat as a contextual roll.
- **Existing log compatibility**: The `CombatLogEntry` type is already used throughout the codebase. Add `diceResult`/`advantage`/`damageType`/`targetName` as optional fields — existing entries without these fields render identically to before.
- **Dice result display format**: Show both the total and the breakdown. "17+4 = 21" is more useful than just "21". Marinara's format: `[dice: 1d20+4 = 21 (17+4)]` — adopt this.
- **Turn transition animation**: Adding animation on turn change is a small quality win. The "Your Turn" banner should slide in with a brief scale bounce. The enemy turn shows a spinner while the LLM processes.
