# Architect Plan: C-233 World Generation Wizard

**Task:** Implement Session Zero / World Generation Wizard — multi-step setup replacing bare `/setup` with Genre/Tone → Setting/Difficulty → Goals → LLM World Gen → Preview → Character Creation flow.

## Current State

Most files exist with a working first-pass implementation. Key discrepancies vs contract spec need resolution:

| Contract Spec | Current Impl | Action |
|---|---|---|
| `genres: string[]`, `tone: string[]` (multi) | `genre: string`, `tone: string` (single) | **ACCEPT** — single-select keeps UI simple; matches existing pattern |
| `difficulty: casual/normal/hard/brutal` | `difficulty: Easy/Medium/Hard` | **UPDATE** — align to contract enum values |
| `playerGoals`, `additionalPreferences`, `language` fields in WorldGenInput | `goals` only | **ADD** missing fields; `additionalPreferences` optional |
| `worldOverview`, `storyArc` (GM-secret), `plotTwists`, `startingLocation: {name,description,atmosphere}`, `artStylePrompt` in WorldGenOutput | `worldName`, `worldDescription`, `locations: string[]` | **UPDATE** — restructure output to match contract shape |
| `npcs: name/role/location/reputation/traits` | `npcs: name/race/class/role/description/personality` | **UPDATE** — align fields to contract |
| `partyArcs: characterName/hook/reward/antagonistNpc?` | `partyArcs: chapter/description/objectives/questGivers` | **UPDATE** — align to contract |
| `hudWidgets: id/label/type/initialValue/maxValue?/theme` | `hudWidgets: slot/label/icon/defaultVisibility` | **UPDATE** — align to contract |
| Zod schema with `additionalProperties: false` | TypeBox schema (same semantics) | **ACCEPT** — TypeBox is the project standard |
| GM prompt assembly: separate `assembleGmPrompt()` visibility-aware | Embedded in seeding service | **REFACTOR** — extract as standalone function in data layer |
| `WizardStep` = `genre/setting/goals/generating/character` | `genre_tone/setting_difficulty/goals/generating/preview/character_creation` | **ACCEPT** — merged steps + extra preview step is better UX |

## Files to Create/Modify

### 1. Data Layer
| File | Action |
|---|---|
| `packages/shared/types/src/lib/world_gen.ts` | **MODIFY** — align `WorldGenInput`, `WorldGenOutput`, `WorldGenNpc`, `PartyArc`, `HudWidgetBlueprint`, `SurpriseMePreset` to contract spec |
| `apps/frontend/client/src/lib/data/ai_prompts/world_gen_schema.ts` | **MODIFY** — update TypeBox schemas to match new types |
| `apps/frontend/client/src/lib/data/ai_prompts/world_gen_system_prompt.ts` | **MODIFY** — update LLM prompt to request the new output shape |
| `apps/frontend/client/src/lib/data/ai_prompts/gm_prompt_assembly.ts` | **CREATE** — standalone `assembleGmPrompt(output, gameState): string` with visibility-aware sectioning (player-visible vs GM-secret) |

### 2. ViewModel
| File | Action |
|---|---|
| `apps/frontend/client/src/lib/views/worldgen/world_gen_wizard_view_model.svelte.ts` | **MODIFY** — update `_performGeneration` to handle new output shape; add `additionalPreferences`/`language` state fields; add token budget warning before generation; update `SURPRISE_ME_PRESETS` to match new type shape; update difficulty enum to contract values |
| `apps/frontend/client/src/lib/views/worldgen/world_gen_seeding_service.svelte.ts` | **MODIFY** — update `seedNpcs`, `seedLocations`, `seedPartyArcs`, `seedHudWidgets`, `assembleGmPrompt` for new output shape; add `storyArc`/`plotTwists` → GM-only save path |
| `apps/frontend/client/src/lib/views/dev/world_gen_sandbox_view_model.svelte.ts` | **MODIFY** — update `MOCK_WORLD_GEN_RESPONSE` to match new `WorldGenOutput` shape |

### 3. Views
| File | Action |
|---|---|
| `apps/frontend/client/src/lib/views/worldgen/world_gen_wizard_view.svelte` | **MODIFY** — update preview cards for new output fields (startingLocation, storyArc toggle, GM-only section hidden behind badge); add `additionalPreferences` textarea on goals step; add language selector on genre step |
| `apps/frontend/client/src/routes/setup/+page.svelte` | **VERIFY** — already correct, no changes expected |
| `apps/frontend/client/src/routes/(dev)/dev/world-gen/+page.svelte` | **VERIFY** — add "View GM Prompt" debug button |

### 4. Tests
| File | Action |
|---|---|
| `apps/frontend/client/src/lib/views/worldgen/world_gen_schema.test.ts` | **MODIFY** — update test data to match new schema shape |
| `apps/frontend/client/src/lib/views/worldgen/world_gen_wizard_view_model.test.ts` | **MODIFY** — update default inputs to new type shape; add tests for `additionalPreferences`, `language`, difficulty enum change |
| `apps/frontend/client/src/lib/views/worldgen/gm_prompt_assembly.test.ts` | **MODIFY** — update to test new standalone `assembleGmPrompt()`; add GM-secret visibility tests |
| `apps/frontend/client/src/lib/views/worldgen/map_seeding.test.ts` | **MODIFY** — update mock output shape for seeding tests |
| `apps/frontend/client/src/lib/views/worldgen/surprise_me.test.ts` | **MODIFY** — update for new `SurpriseMePreset` shape |
| `apps/frontend/client/src/lib/views/worldgen/world_gen_retry.test.ts` | **MODIFY** — update mock data for new output shape |
| `apps/e2e/tests/client/world_gen.spec.ts` | **MODIFY** — update test interactions for new UI layout |
| `apps/e2e/src/pom/world_gen_wizard_page.ts` | **MODIFY** — update locators for new preview elements |
| `apps/e2e/src/visual/suites/world_gen.visual.ts` | **MODIFY** — update prompt text and schemas for new output fields |

## Data Model Changes

- `WorldGenInput.genres`: `string[]` (was `genre: string`)
- `WorldGenInput.playerGoals`: `string` (was `goals`)
- `WorldGenInput.additionalPreferences`: `string` (new, optional)
- `WorldGenInput.language`: `string` (new, default `"en"`)
- `WorldGenInput.difficulty`: `'casual' | 'normal' | 'hard' | 'brutal'` (was `string`)
- `WorldGenOutput.worldOverview`: `string` (was `worldDescription`)
- `WorldGenOutput.storyArc`: `string` (new, GM-secret)
- `WorldGenOutput.plotTwists`: `string[]` (new, GM-secret)
- `WorldGenOutput.startingLocation: {name, description, atmosphere}` (new, replaced `locations: string[]`)
- `WorldGenNpc.role`: `string` (keep)
- `WorldGenNpc.location`: `string` (new — where they're found)
- `WorldGenNpc.reputation`: `number` (-10 to +10, new)
- `WorldGenNpc.traits`: `string[]` (new — replaces personality)
- `WorldGenNpc.description`: `string` (keep, condensed)
- `PartyArc.characterName`: `string` (was `chapter`)
- `PartyArc.hook`: `string` (was `description`)
- `PartyArc.reward`: `string` (was `objectives`)
- `PartyArc.antagonistNpc?`: `string` (was `questGivers`)
- `HudWidgetBlueprint.id`: `string` (was `slot`)
- `HudWidgetBlueprint.type`: `'gauge' | 'counter' | 'timer' | 'stat-block'` (was `slot`)
- `HudWidgetBlueprint.initialValue`: `number` (was `icon`)
- `HudWidgetBlueprint.maxValue?`: `number` (new)
- `HudWidgetBlueprint.theme`: `string` (was `defaultVisibility`)

## Test Strategy

1. **Unit tests** — 6 existing files updated. Run: `moon run client:test`
2. **Type/validation** — `moon run client:typecheck` catches all type mismatches
3. **E2E** — Playwright: `cd apps/e2e && bun run test` (functional)
4. **Visual** — `cd apps/e2e && bun run test:visual` (AI visual assertions)
5. **Manual** — Load `/dev/world-gen` sandbox, run through all flows including Surprise Me and retry simulation

## Verification Commands

```bash
moon run client:fix
moon run client:typecheck
moon run client:test
cd apps/e2e && bun run test --grep "World Generation Wizard"
cd apps/e2e && bun run test:visual --grep "world-gen"
```
