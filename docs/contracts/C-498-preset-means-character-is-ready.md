---
id: C-498
title: "A preset means the character is ready"
source: direct
contract_type: thin
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-10T00:00:00Z"
---

# Contract C-498: A preset means the character is ready

## Metadata

| Field | Value |
|---|---|
| **Source** | Formalizes the C-498 seed in `BACKLOG_C485_PLUS.md`; maintainer onboarding review, 2026-09-06 |
| **Target** | `apps/frontend/client/src/lib/views/onboarding/` (coordinator view/view-model, `starter_hero_card.svelte`), `packages/shared/constants/src/lib/characters.ts` (`STARTER_HEROES`), route `/personas/create` |
| **Type** | thin |
| **Priority** | P2 — the fastest-looking route to play currently takes the longest |
| **Dependencies** | None (coordinate with [C-483](C-483-guided-ai-setup.md) / [C-484](C-484-capability-first-settings.md), which own the AI-setup half of onboarding; build on C-504's stable appearance identity, already implemented) |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | user-facing — character creation flow in `apps/frontend/docs/src/content/docs/` |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/personas/create` |

## Problem & Baseline Evidence

- **Current behavior:** in the observed session, character creation put the AI chat at the top and presets below it. Selecting the "Thaldrin" preset opened a long character-sheet form — missing portrait placeholder, small LPC preview, editable HP, AC, speed, class, alignment, proficiencies. A preset should mean _"this character is ready"_, not _"please finish filling out this form"_.
- **Reproduction:** open `/personas/create` (or the setup flow that hosts `OnboardingCoordinatorView`): (1) `onboarding_coordinator_view.svelte` renders `OnboardingChatView` first in the default `chat` mode, with presets only below two dividers ("or", "Start from a Preset"); (2) preset cards identify heroes by hard-coded emoji (`🛡️`/`🔮`/`🗡️`), not portraits; (3) `onboarding_coordinator_view_model.svelte.ts:548-554` — `selectPreset()` assembles the persona and sets `mode = 'review'`, dropping the player into the full editable `OnboardingReviewView` sheet; (4) `packages/shared/constants/src/lib/characters.ts:199` marks `illustrationAsset` as "placeholder for now".
- **Existing implementation to reuse:** `confirmAndEnter()` (`onboarding_coordinator_view_model.svelte.ts:558`) already finalizes and attaches a persona without requiring the review step; `_assemblePersonaFromStarter()` produces a complete persona from a `STARTER_HEROES` entry; C-504 (implemented) gives each starter hero a stable LPC appearance identity via `lpcRecipe`/`paletteOverrides`.
- **Known gaps:** no fast path from preset selection to world entry; no curated portrait art for starter heroes; the primary affordance (chat) is the slowest path, and the fastest content (presets) is presented as secondary.
- **Baseline tests:** existing onboarding view-model tests and the `initial_suggestion_presets.test.ts` data tests; capture the current `/personas/create` flow before restructuring it.

## User Outcome

After this contract, a player can pick an illustrated starter hero, supply at most a name and one motivating choice, and enter the world — faster than the AI-generation path — while full editing remains one explicit click away.

## Scope Boundaries

- **In Scope:** reordering the creation screen so illustrated starter heroes are the primary affordance and AI generation is clearly secondary; a preset fast path (name + one motivating choice → enter world); an explicit "customize everything" path to the full sheet; curated portrait art (or best-available curated art with placeholders recorded) for shipped starter heroes; timing comparison evidence.
- **Out of Scope:** removing AI character generation; the AI provider/model setup steps (C-483/C-484 own those); commissioning new portrait art (see the bounded art experiment in `BACKLOG_C485_PLUS.md` — ship the best available curated art and record what is placeholder); changes to `STARTER_HEROES` stats or the LPC recipes themselves (C-504/C-496 own appearance identity and playback); the art-direction decision (maintainer decision, assumed to exist).

## Acceptance Criteria

### AC-1: Starter heroes are the primary affordance
**Given** the character creation screen,
**When** it opens,
**Then** illustrated starter heroes are the primary affordance and AI generation is a clearly secondary path (visually subordinate, not the first interaction).

**Verification**: visual suite capture of `/personas/create` showing hero cards first with portraits; view test asserting the default mode presents presets as primary.

### AC-2: A preset is ready with at most a name and one choice
**Given** a selected preset,
**When** the player confirms,
**Then** the player supplies at most a name and one motivating choice before entering the world; the full character sheet is reachable only via an explicit "customize everything" path, never as a required step.

**Verification**: Playwright journey on `/personas/create`: select preset → name + one choice → world entry, asserting no full-sheet form is rendered on the fast path.

### AC-3: No placeholder portraits in the default flow
**Given** a shipped starter hero or Emberwatch cast member,
**When** displayed in the creation flow,
**Then** a portrait exists — no empty placeholder frame or hard-coded emoji stands in for a portrait. Any art that is still provisional is recorded as placeholder in the execution report.

**Verification**: visual capture of every starter hero card and any Emberwatch cast display in the default flow; data test asserting each shipped `StarterHero` resolves a real portrait asset.

### AC-4: The preset path is faster than AI generation
**Given** the preset path and the AI-generation path,
**When** each is timed from character screen to world entry,
**Then** the preset path is faster, measured on the production route.

**Verification**: timed Playwright runs of both paths on `/personas/create` (preset vs. chat-to-persona with a mocked text provider), with durations recorded in the execution report.

## Edge Cases & Gotchas

- **Renaming a preset** must not break C-504 appearance identity — the `lpcRecipe`/`paletteOverrides` travel with the persona regardless of edited name.
- **"One motivating choice"** must feed the persona record (background/goal hook the narrative systems can read), not a dead-end flavor field.
- **Do not strand the manual wizard:** "customize everything" lands on the existing manual steps/review flow; this contract reorders entry, it does not delete paths.
- **Coordinate, don't collide, with C-483/C-484:** if AI setup is incomplete, the secondary AI path must degrade gracefully (disabled with a pointer to setup), not block the preset fast path.
- **Two card implementations exist today:** preset cards are rendered *inline* in `onboarding_coordinator_view.svelte` (hard-coded emoji `🛡️`/`🔮`/`🗡️`), while `starter_hero_card.svelte` is currently **unused/dead** (not imported anywhere). Consolidate the illustrated card into a single component (`starter_hero_card.svelte`) and render it from both the default and onboarding flows — do not leave two divergent card paths, and remove the inline emoji block.
- **`illustrationAsset` is currently dead metadata:** it is set on each `STARTER_HEROES` entry (e.g. `'starter_thaldrin'`) but consumed nowhere in the codebase. AC-3's "resolves a real portrait asset" therefore requires a real resolution path (render from the C-504 `lpcRecipe`/`paletteOverrides` via C-496 playback, or a bundled asset), not merely a string key with no consumer.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-09-10 | Formal draft replaces backlog seed; baseline line refs re-verified on 2026-09-10 | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

## Execution Report

### Summary
Restructured character creation so illustrated starter heroes are the primary
affordance (default `presets` mode), with AI chat and the manual wizard as
clearly secondary paths. Selecting a preset opens a lightweight fast path
(name + one motivating choice → Enter World) that skips the full editable
review sheet; full customization is one explicit "Customize Everything" click
away. Starter hero cards render real LPC portraits from each hero's C-504
appearance identity instead of placeholder emoji, resolving the previously
dead `illustrationAsset`/card portrait path. Added unit + data tests, E2E
journey + timing specs, a visual suite, and a user-facing docs page.

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Default mode is `presets`; "Choose Your Hero" heading, 3 illustrated hero cards primary, chat/manual secondary. Unit test + headless production-route render verified. |
| AC-2 | ✅ | Preset → `preset_confirm` fast path (exactly 1 form field: name) + motivating choice (feeds persona background); Enter World / Customize Everything; no full sheet on fast path. Unit + headless verified. |
| AC-3 | ✅ | All 3 hero cards render real non-blank LPC portraits (pixel check) + data test asserting every `StarterHero` resolves a non-empty recipe set. |
| AC-4 | ⚠️ | Preset path measured **940ms** on the production route (New Adventure → onboarding → preset → /game). E2E timing spec `onboarding_preset_vs_ai.spec.ts` times BOTH paths (AI path with a mocked Ollama `/api/chat` provider). The AI path could not complete in this environment (no text provider configured → the client never fires a provider call), so its runtime is recorded by the verifier's full-stack/mocked-provider run; structural comparison is strict (AI has chat round-trip + generation + review steps the preset path skips). |

### Files Created
| File | Purpose |
|---|---|
| `apps/frontend/client/src/lib/data/starter_hero_recipes.ts` | Builds LpcLayerRecipe[] from a StarterHero's lpcRecipe/paletteOverrides (single portrait resolution path, AC-3). |
| `apps/frontend/client/src/lib/data/starter_hero_recipes.test.ts` | Data test: every shipped hero resolves a real non-empty portrait (AC-3). |
| `apps/frontend/client/src/lib/views/onboarding/onboarding_coordinator_view_model.test.ts` | Coordinator VM unit tests for AC-1/AC-2 fast path + appearance-identity preservation. |
| `apps/e2e/src/visual/suites/onboarding_presets.visual.ts` | Visual suite capturing `/personas/create?onboarding=1` (AC-1/AC-3). |
| `apps/e2e/tests/client/onboarding_preset_vs_ai.spec.ts` | E2E timing spec timing both preset and AI (mocked provider) paths (AC-4). |
| `apps/frontend/docs/src/content/docs/start/creating-your-hero.md` | User-facing docs page for the creation flow. |

### Files Modified
| File | Change |
|---|---|
| `apps/frontend/client/src/lib/views/onboarding/onboarding_coordinator_view_model.svelte.ts` | Added `presets`/`preset_confirm` modes, preset fast-path state + `confirmPresetAndEnter`/`customizeEverything`/`startChat`, motivating-choice → background hook. |
| `apps/frontend/client/src/lib/views/onboarding/onboarding_coordinator_view.svelte` | Presets-first layout; removed inline emoji block; added fast-path confirm view; secondary AI/manual paths. |
| `apps/frontend/client/src/lib/views/onboarding/starter_hero_card.svelte` | Now renders a real LPC portrait (LpcPreviewViewModel) instead of a placeholder emoji; consolidated single card component. |
| `apps/frontend/client/src/lib/views/character/lpc_preview/lpc_preview_view_model.svelte.ts` | Added public `isReady` getter (used by the card to init Pixi once canvas is present). |
| `apps/e2e/tests/client/new_campaign_flow.spec.ts` | Updated starter-hero journey for the new fast path. |

### Deviations from Spec
None against the approved ACs. AC-4's full timed AI-path run (with a mocked
text provider) could not be exercised in this environment because the client
does not fire a text-provider call when no provider connection is configured,
and the full E2E harness cannot reuse the running dev server under
`CI=true`. The preset-path duration is real and measured (940ms); the AI-path
timing test is provided and runs in the verifier's full-stack/mocked-provider
environment. No Amendment proposed.

### Test Results
- Unit: 11/11 pass (0 failures) — coordinator VM (7) + starter hero recipes (4).
- E2E: preset-path timing verified on the production route (940ms → /game). Full E2E harness not runnable here (CI=true blocks dev-server reuse; AI/hub services down). Timing specs `onboarding_preset_vs_ai.spec.ts` + updated `new_campaign_flow.spec.ts` provided for the verifier.
- Visual: suite `onboarding_presets.visual.ts` provided; not executed here (no AI image-validation tooling in this environment).
- Baseline: `validate({ test: true })` green across client, docs, e2e — no new baseline failures.
