# Contract C-108: Quest System MVVM & Dev Sandbox

## Context
The Quest Log is a highly stateful piece of JRPG UI. It requires tracking multiple quests across different states (Active, Completed, Failed) and granular objectives (e.g., "Defeat 5 slimes"). We are applying the Svelte 5 MVVM Sandbox pattern so we can instantly inject complex quest states via the `DevToolsPanel` and rapidly build the UI without relying on the game engine's ECS or backend.

## Scope
- `apps/frontend/client/src/lib/views/quest/quest_view_model.svelte.ts` (New)
- `apps/frontend/client/src/lib/views/quest/quest_view.svelte` (New)
- `apps/frontend/client/src/routes/(dev)/dev/quest/+page.svelte` (New sandbox route)

## Acceptance Criteria
- [ ] **ViewModel Creation:** Create `quest_view_model.svelte.ts` exporting a `QuestViewModel` class. It should use Svelte 5 `$state` to track arrays of quests (e.g., `activeQuests`, `completedQuests`). Define a lightweight mock `Quest` interface in the file if a shared one doesn't exist yet (e.g., `{ id, title, description, status, objectives: { label, current, max }[] }`).
- [ ] **Dumb View:** Create `quest_view.svelte` that takes `vm: QuestViewModel` as a prop. It should render a basic layout (e.g., a list of active quests and their objective progress).
- [ ] **Dev Override:** Create `quest_dev_view_model.svelte.ts` extending the base class.
- [ ] **Sandbox Route:** Create `(dev)/dev/quest/+page.svelte`. Instantiate `QuestDevViewModel`, pass it to `<QuestView />`, and mount `<DevToolsPanel />`.
- [ ] **Dev Tools Wiring:** Implement at least 3 dev methods in `QuestDevViewModel` and wire them to the DevToolsPanel:
  - Action: `injectMockQuests()` (Populates the view model with a mix of active, completed, and multi-step quests).
  - Action: `progressObjective()` (Finds an active quest and increments an objective's `current` count).
  - Action: `failRandomQuest()` (Moves an active quest to a failed state to test red/error UI styling).
- [ ] **Nav Update:** Add the Quest Sandbox to the dev layout sidebar navigation (`dev_layout_view_model.svelte.ts`).

## Implementation Notes
1. The UI doesn't need to be perfectly styled yet. Focus on structurally wiring the data so it renders on the screen when the dev buttons are clicked.
2. Ensure the dev methods handle edge cases safely (e.g., `progressObjective()` shouldn't crash if there are no active quests).

## Edge Cases
- Ensure the `max` value of objectives is respected when progressing them via the dev tools (cap `current` at `max`).

---

## Execution Log (2026-06-10)

**Agent**: pi (GPT-5.2 via OpenRouter)
**Mode**: emulator

### Files created

1. `apps/frontend/client/src/lib/views/quest/quest_view_model.svelte.ts` — Production QuestViewModel extending BaseViewModel with `$state` activeQuests/completedQuests/failedQuests, `addQuest`, `completeQuest`, `failQuest`, `progressObjective` methods. Exports `Quest`, `QuestObjective`, `QuestStatus` types inline.
2. `apps/frontend/client/src/lib/views/quest/quest_view.svelte` — Dumb view: zero logic, takes `viewModel: QuestViewModelInterface` prop, renders three sections (Active/Completed/Failed) with objective progress bars.
3. `apps/frontend/client/src/lib/views/quest/quest_dev_view_model.svelte.ts` — Dev override extending QuestViewModel. Methods: `injectMockQuests()` (6 quests: 3 active, 2 completed, 1 failed), `progressObjective()` (scans active quests for first incomplete objective), `failRandomQuest()`. All handle empty-state edge cases safely.
4. `apps/frontend/client/src/routes/(dev)/dev/quest/+page.svelte` — Sandbox route instantiating QuestDevViewModel, mounting QuestView + DevToolsPanel with 3 actions: Inject Mock Quests, Progress Objective, Fail Random Quest.

### Files modified

5. `apps/frontend/client/src/lib/views/dev/layout/dev_layout_view_model.svelte.ts` — Added Quest nav item (route `/dev/quest`, clipboard-check icon) to `_NAV_ITEMS` (now 11 items).
6. `apps/frontend/client/src/lib/views/dev/layout/dev_layout_view_model.test.ts` — Updated test: 10→11 items, added `/dev/quest` route assertion.

### Verification

- `client:fix` — passed (3 non-null assertions caught and fixed)
- `client:typecheck` — 0 errors, 0 warnings (svelte-check)
- `client:test` — 258/291 pass; 33 pre-existing failures (AiTextIntelligenceService, ImageGenerationService) unrelated to this contract
- DevViewModel unit tests: 6/6 pass including updated "all 11 dev console links"
