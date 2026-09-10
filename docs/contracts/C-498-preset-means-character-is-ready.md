---
id: C-498
title: "A preset means the character is ready"
source: direct
contract_type: thin
status: approved
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
| **Status** | approved |
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
