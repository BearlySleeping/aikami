# Architect Plan — C-234 Combat Enhancement: Dice & Initiative

## Status
~80% of the contract code is already implemented (types, utils, components, ViewModel, dialogue integration, all tests). Only gap items remain.

## Files to Create/Modify

### 1. Extend DiceService (`packages/shared-level service`)
- **`apps/frontend/client/src/lib/services/dice/dice_service.svelte.ts`** — ADD `rollNotation(notation: DiceNotation): number`. Rolls `notation.count` dice of `notation.sides` each, pushes to history, returns sum.
- **`apps/frontend/client/src/lib/services/dice/dice_service.test.ts`** — ADD `rollNotation` tests (d20 range, 2d6 range, d100 range, pushes to history).

### 2. Update CombatViewModel to use DiceService
- **`apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts`** — In `resolveAllRolls()`, replace `_simulateDiceRoll()` with `diceService.rollNotation()`. Remove private `_simulateDiceRoll()` method.
- Import `diceService` from `$lib/services/dice/dice_service.svelte.ts`.

### 3. Create Dev Sandbox
- **`apps/frontend/client/src/lib/views/combat/combat_enhancements_sandbox_view_model.svelte.ts`** — NEW. Mock ViewModel providing mock `queuedRolls`, `initiativeEntries` (5 combatants, 1 defeated), `turnState`, and combat log with enriched entries. Self-contained — no bridge dependency.
- **`apps/frontend/client/src/routes/(dev)/dev/combat-enhancements/+page.svelte`** — NEW. DaisyUI-paneled sandbox showing all 5 C-234 features with mock data.

### 4. E2E POM — Add sandbox navigation
- **`apps/e2e/src/pom/combat_page.ts`** — ADD `gotoCombatEnhancementsDev()` method that navigates to `/dev/combat-enhancements`.

## Data Model Changes
- `DiceServiceInterface` gains `rollNotation(notation: DiceNotation): number`
- `CombatViewModel` loses private `_simulateDiceRoll()` in favor of `diceService.rollNotation()`

## Test Strategy
1. **Unit**: `dice_service.test.ts` — new `rollNotation` tests (boundary/correctness)
2. **Unit**: Run existing 4 test files — should pass without change
3. **Typecheck**: `moon run client:typecheck` — warn on import changes
4. **Dev sandbox**: Manual verification at `/dev/combat-enhancements`
5. **E2E**: Existing `combat_enhancements.spec.ts` — update `gotoDev()` for new sandbox URL
6. **Visual**: Existing `combat_enhancements.visual.ts` targets `/dev/combat-enhancements` — will activate when sandbox exists

## Verification Commands
- `moon run shared-schemas:fix && moon run client:fix`
- `moon run client:typecheck`
- `moon run client:test`
- `cd apps/e2e && bun run test tests/client/combat_enhancements.spec.ts`
