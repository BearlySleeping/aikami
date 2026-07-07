# Architecture Plan: C-232 Character Sheet & Traits System

## Status: 90% Complete — Two remaining issues

### Files to Modify (2 files, small changes)

1. **`apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts`**
   - **What**: Line 215: `new CharacterSheetViewModel({...})` → `getCharacterSheetViewModel({...})`
   - **Why**: Convention violation — factory function `getCharacterSheetViewModel()` exists in `character_sheet_view_model.svelte.ts` but the game UI uses raw `new` (bypasses proxy auto-logging)
   - **Change**: Replace `new CharacterSheetViewModel({...})` with `getCharacterSheetViewModel({...})`, add import for `getCharacterSheetViewModel`

2. **`apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts`**
   - **What**: Append character sheet summary to `_buildSystemPrompt()` return value
   - **Why**: `gameStateService.characterSheetSummary` exists but is never injected into AI dialogue prompts. Contract AC-5 requires AI context injection.
   - **Change**: Add `import { gameStateService } from '$services'` (already imported), append `gameStateService.characterSheetSummary` before the closing `lines.join('\n')` — wrapped with `[CHARACTER SHEET]` markers

### Data Model Changes: **None**
All types (`AbilityScores`, `Skill`, `SavingThrow`, `CharacterTraits`, `NarrativeTraits`, `CharacterSheet`) already exist in `character_sheet_types.ts`. Shared schemas in `packages/shared/schemas/src/lib/database/character.ts` already cover the schema layer. Backend persona schema already includes sheet fields via `BaseCharacterSheetSchema`.

### Existing State (already complete — no changes needed)
- **Data layer**: `character_sheet_types.ts`, `character_sheet_helpers.ts`, `game_state_service.svelte.ts` (`characterSheetSummary` getter)
- **ViewModel**: `character_sheet_view_model.svelte.ts` — tabs (abilities/skills/traits), ability editing, skill proficiency/expertise toggles, save toggles, narrative trait chips, Pro Mode with JSON editor, AI context preview modal
- **View**: `character_sheet_view.svelte` — tabbed DaisyUI layout, game stats summary, equipment slots, modifier color-coding
- **Dev sandbox**: `character_sheet_sandbox_view_model.svelte.ts` + `(dev)/dev/character-sheet/+page.svelte` with mock Fighter data
- **Game UI wiring**: `game_ui_view_model.svelte.ts` routes C-key → `CharacterSheetViewModel` (overlay swap from old dashboard)
- **Unit tests**: `character_sheet_helpers.test.ts` — 11 describe blocks, 28 test cases covering modifier computation, PB, skill/save modifiers, serialization, JSON validation
- **POM**: `character_sheet_page.ts` — locators for tabs, ability inputs, skill rows, narrative chips, Pro Mode, AI preview modal
- **E2E tests**: `character_sheet.spec.ts` — 10 test cases: visibility, ability scores, edit+recompute, 18 skills, proficiency toggle, traits tab, narrative chip add/remove, Pro Mode, invalid JSON, AI preview modal
- **Visual tests**: `character_sheet.visual.ts` — 5 cases: Abilities tab, Skills tab, Traits tab, Pro Mode, Full Page sandbox

### AI Context Injection Strategy
The dialogue overlay's `_buildSystemPrompt()` returns a string assembled from persona archetype prompt + NPC name + greeting + behavioral rules. Append `gameStateService.characterSheetSummary` as a trailing section wrapped in `[CHARACTER SHEET]` markers. The getter already produces the compact format from AC-5. This makes every NPC/player dialogue aware of the character's abilities, proficiencies, traits, and narrative hooks.

### Test Strategy
- **Unit**: `moon run client:test` — existing 28 tests pass
- **Typecheck**: `moon run client:typecheck`
- **E2E**: `cd apps/e2e && bun run test` (Playwright functional tests)
- **Visual**: `cd apps/e2e && bun run test:visual` (AI visual regression)
- **No new tests needed** for the two fixes — they're wiring changes covered by existing assertions

### Verification Commands
```
moon run client:fix
moon run client:typecheck
moon run client:test
cd apps/e2e && bun run test -- --grep "Character Sheet"
```

### Risk Assessment
- Minimal: 2 file edits, 1 import swap + 1 line append
- No schema migrations, no new files, no data model changes
- AI prompt injection is additive — strips empty sections via `serializeForAi()`, won't break existing prompts
