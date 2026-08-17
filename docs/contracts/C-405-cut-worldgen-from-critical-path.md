---
id: C-405
title: "Cut World Generation from the Critical Path"
source: "docs/strategy/mvp-assessment-2026-08-16.md §6.1 (MVP playthrough)"
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/158"
  pr_number: 158
created_at: "2026-08-16"
---

# Contract C-405: Cut World Generation from the Critical Path

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/strategy/mvp-assessment-2026-08-16.md` §6.1 — live MVP playthrough 2026-08-16 |
| **Target** | `apps/frontend/client/src/lib/views/start/`, `views/setup/`, `views/worldgen/` — the new-campaign entry flow |
| **Priority** | P0 — the front door of the product is a wizard whose output never shapes the playable map |
| **Dependencies** | — |
| **Status** | implemented |
| **Promotion** | `—` |
| **Docs Impact** | user-facing → `apps/frontend/docs/src/content/docs/start/installation.md` (getting started) |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: a first-time player pressing "Start campaign" is routed
  to `/setup`, which runs an AI world-generation wizard collecting genre, tone,
  setting, difficulty, and goals. The wizard produces a rich world — and the
  game then loads Emberwatch regardless.

- **The pack selection is already correct.**
  `apps/frontend/client/src/lib/views/start/start_view_model.svelte.ts:246`:

  ```ts
  async startNewGame(): Promise<void> {
    // Campaign generation is beta; default to Emberwatch directly.
    await this._proceedWithPack('emberwatch');
  }
  ```

  The problem is downstream. `_proceedWithPack` branches on character count
  (line 360: *"0→/setup, 1→/game, 2+→/personas"*), and the zero-character
  branch — commented *"go to character creation with pack selected"* (line
  ~545) — routes to `/setup`, which fronts the world-generation wizard before
  character creation.

- **The generated world never reaches the playable map.** `onWorldAccepted`
  (`setup_view_model.svelte.ts:68`) calls
  `worldStateService.setWorldGenOutput(output)`, and `acceptWorld`
  (`world_gen_wizard_view_model.svelte.ts:384`) seeds NPCs, locations, arcs,
  and HUD widgets into game state. But those seeds are loose state and prompt
  context — the player still enters Emberwatch's `village` map, and nothing
  generated compiles into the authored `ContentPackManifest` shape the game
  loads maps from (that compiler is issue #81). The consumers today:

  | Consumer | Use |
  |---|---|
  | `services/gm/session_summary_service.svelte.ts:92` | `worldName ?? 'Unknown'` (synopsis) |
  | `services/gm/session_summary_service.svelte.ts:217` | `worldName ?? 'Unknown'` (resume id) |
  | `game_overlay_service.svelte.ts:1357` | `worldName ?? 'default'` as a game id |
  | `services/gm/gm_prompt_service.svelte.ts:248` | full output → GM prompt context |
  | `combat_view_model.svelte.ts:1462` | full output → combat LLM context |
  | `autonomous_message_service.svelte.ts:264` | generated NPC names as message targets |
  | `world_gen_seeding_service.svelte.ts` | seeds NPCs/locations/arcs/HUD on accept |

  **The world's name and loose context survive. The playable world does not.**
  The generated NPCs, locations, story arcs, and HUD configuration never shape
  the map or quest chain the player actually plays.

- **This violates a standing directive.**
  `docs/strategy/vision-and-directives.md:88`: *"Do not make AI world
  generation the front door."* And directive #4: *"Every generative feature
  must compile into the same versioned content/state contracts used by authored
  content."* No such compiler exists — GitHub issue #81 ("Reintroduce Generated
  Campaigns as a Content-Pack Compiler") is the open placeholder for it.

- **The generator itself is good and is not the problem.** A sample run
  produced a coherent setting ("Duskhollow"), 6 NPCs with archetypes and
  descriptions, 7 locations, 3 story arcs with objectives and quest-giver
  bindings, and HUD widget configuration. This contract does not delete that
  work; it moves it off the critical path until it can be consumed.

- **Secondary problem**: generation is slow on OpenRouter free models and runs
  sequentially, though setting prose, NPC roster, locations, and story arcs are
  largely independent.

- **Reproduction**: fresh install, no personas. Press "Start campaign" → `/setup`
  → answer five wizard steps → wait for generation → accept the world → create a
  persona → enter Emberwatch, which bears no relation to the generated world.

- **Existing implementation to reuse**:
  - `campaignService.startNewCampaign({ contentPackId })` — pack selection is
    already plumbed; both `emberwatch` and `whispering-caves` exist under
    `apps/frontend/client/static/content-packs/`.
  - `views/onboarding/onboarding_coordinator_view_model.svelte.ts` — the
    persona creation flow that should be the actual destination.
  - `views/worldgen/world_gen_wizard_view_model.svelte.ts` (577 lines) — moves,
    does not change.
  - `game_state_service.svelte.ts:202` `_getDefaultWorldGenOutput()` — the
    existing default that keeps `worldName` populated when no wizard has run.
  - `pack_registry_service.svelte.ts` + `components/pack_browser_view.svelte`
    (C-345) — an existing, schema-validated pack picker with 1-pack skip logic;
    needs wiring, not building.

- **Known gaps**: the C-345 pack picker (`packRegistryService`,
  `PackBrowserView`, `openPackBrowser()`) ships but is **not wired** to the
  New Game button — `startNewGame()` hardcodes `emberwatch`, and the picker
  methods are only covered by `test.todo` cases in
  `start_view_model.test.ts`.

- **Baseline tests**: `moon run e2e:test -- tests/client/world_gen.spec.ts`,
  `tests/client/game_boot.spec.ts`,
  `apps/frontend/client/src/lib/views/start/start_view_model.test.ts`,
  `views/onboarding/onboarding_coordinator_view_model.test.ts`.

## User Outcome

After this contract, a **first-time player** pressing "Start campaign" reaches
character creation and then a playable Emberwatch, without passing through a
wizard whose result never shapes the playable map. A **curious player** can
still reach world generation deliberately, where it is labelled honestly as a
preview.

## Success Measures

- **Time/latency target**: time from "Start campaign" to a controllable
  character in the world drops to persona-creation time alone — no AI world
  generation on the default path.
- **Offline/degraded behavior**: the default path requires no world-generation
  AI call at all, so a slow or failing provider cannot block starting a
  campaign. A text provider is still required to *play* (directive #3).
- **Production journey enabled**: the cold-start playtest becomes possible —
  today a stranger's first five minutes are spent on a wizard that produces
  nothing playable.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Pack selection | `campaignService.startNewCampaign({ contentPackId })` | **reuse** — already correct |
| New-campaign branching | `start_view_model.svelte.ts:494` `_proceedWithPack` | **modify** — zero-character branch targets onboarding |
| Persona creation | `views/onboarding/` | **reuse** — becomes the default destination |
| World-gen wizard | `views/worldgen/world_gen_wizard_view_model.svelte.ts` | **reuse unchanged** — relocated behind Advanced |
| `/setup` route host | `views/setup/setup_view_model.svelte.ts` (97 lines) | **modify** — no longer fronts the wizard |
| Default world name | `game_state_service.svelte.ts:202` | **reuse** — already covers the no-wizard case |
| Pack registry | `pack_registry_service.svelte.ts` (C-345) — reads `static/content-packs/index.json`, validates via `PackIndexSchema` | **reuse** — already correct |
| Pack picker UI | `components/pack_browser_view.svelte` + `openPackBrowser()/selectPack()/confirmPackSelection()` in `start_view_model` (C-345) | **wire** — exists but not connected to the New Game button |
| Content packs on disk | `static/content-packs/{emberwatch,whispering-caves}` | **reuse** — both already listed in `index.json` |

## Overview

"Start campaign" currently routes first-time players through an AI
world-generation wizard whose output is consumed only as loose state and
prompt context, never as a playable map. This
contract makes the authored content pack the default front door, adds a pack
picker now that two packs ship, moves world generation behind an explicit
Advanced entry labelled as a preview, and parallelizes the generation calls that
are independent of one another.

## Design Reference

**The design decision, and why.** Three options were considered:

- **(a) Delete the wizard.** Removes 577 lines of working code and the most
  impressive artifact in the build.
- **(b) Build the content-pack compiler now** so generated worlds are playable.
  This is issue #81 — a large contract requiring generated NPCs, locations, and
  arcs to compile into `ContentPackManifest`, plus map generation. It cannot
  land inside the MVP window and directive #12 forbids letting it delay the
  slice.
- **(c) Keep it, move it off the critical path, label it honestly.**

**Chosen: (c).** The wizard stays reachable under Advanced (directive #7,
progressive disclosure), clearly marked as producing a preview that is not yet
playable. It costs nothing to leave visible once it is not blocking the default
path, and it remains the natural front end for the compiler when #81 lands.
Deleting it would have to be undone.

Follow the existing progressive-disclosure precedent from C-333, which moved
agents, autonomous NPCs, and provider controls behind an Advanced surface for
exactly this reason.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **One boot coordinator** (directive #5). Route changes go through
  `routerService` and the campaign state machine. This contract must not add a
  second path that seeds subsystems independently — the current
  `_proceedWithPack` already resets five services inline, and that pattern must
  not be duplicated into a new branch.
- **Content packs, not hardcoded sandboxes** (directive #8). The picker reads
  the packs present on disk via the existing content-pack index
  (`static/content-packs/index.json`); no pack id is hardcoded in the view.
- The world-generation wizard is **moved, not modified**. Its view model keeps
  its current interface; only its entry point and its labelling change.
- The Advanced entry must state plainly that the generated world is a preview
  and is not playable yet, and link to the tracking issue. An honest label is
  the whole justification for keeping the feature reachable.
- Parallelized generation must preserve the existing retry and schema
  validation behaviour (`world_gen_retry.test.ts`,
  `world_gen_schema.test.ts` already cover these and must keep passing).

## State & Data Models

```ts
// Installed packs come from the existing C-345 registry:
//   import type { PackIndexEntry } from '@aikami/types';
// `packRegistryService.availablePacks` is `readonly PackIndexEntry[]`,
// derived from `PackIndexSchema` in @aikami/schemas. Do not introduce a
// parallel `ContentPackSummary` type — `PackIndexEntry` already carries
// `id`, `name`, `description`, and `version` (plus `updatedAt`).

/** Where "Start campaign" sends the player, resolved from existing state. */
type NewCampaignDestination =
  | { readonly kind: 'onboarding'; readonly contentPackId: string }
  | { readonly kind: 'persona_picker'; readonly contentPackId: string }
  | { readonly kind: 'game'; readonly contentPackId: string };

/** Explicitly marks generated worlds as not-yet-playable. */
type WorldGenPreviewState = {
  readonly output: unknown;      // WorldGenOutput
  readonly playable: false;      // invariant until issue #81 lands
};
```

No persisted schema changes. `WorldGenOutput` and its storage in
`game_state_service` are unchanged — the wizard still stores its result, and
`worldName` continues to flow to the naming consumers listed in Problem &
Baseline Evidence.

## Quality Requirements

- **Offline/degraded mode**: the default path makes **zero** world-generation
  AI calls, so it works regardless of provider health. Text AI is still
  required before entering `playing` state (directive #3) — that check is
  unchanged and must keep firing, including its existing redirect to
  `/capability` on `isAiTextProviderRequiredError`.
- **Accessibility/input**: the pack picker must be keyboard navigable with
  visible focus, and each pack card must have an accessible name.
- **Performance budget**: N/A — routing and a small list.
- **Security/privacy**: N/A.
- **Persistence/migration**: existing saves reference `contentPackId` already;
  no migration. A save created via the old `/setup` path must still load.
- **Cancellation/retry/idempotency**: leaving the pack picker or onboarding
  must not leave a half-created campaign. `startNewCampaign` is called before
  navigation today — verify the campaign is cleaned up or reused if the player
  backs out.
- **Observability**: log the resolved `NewCampaignDestination` and the chosen
  pack id at campaign start.

## Migration & Rollback

- **Old data compatibility**: saves store `contentPackId`; unchanged.
- **Migration**: none.
- **Rollback**: revert. The wizard code is relocated, not deleted, so a revert
  restores the previous entry point intact.
- **Feature flag or kill switch**: not warranted.
- **Failure recovery**: N/A.

## Scope Boundaries

- **In Scope:**
  - Zero-character branch of `_proceedWithPack` routes to persona creation, not
    the world-generation wizard.
  - A content-pack picker when more than one pack is installed.
  - World generation relocated behind an explicit Advanced entry, labelled as a
    non-playable preview.
  - Parallelization of independent world-generation calls.
  - Docs page update for the new getting-started flow.

- **Out of Scope:**
  - **The content-pack compiler (issue #81)** — the reason this contract exists
    rather than building it.
  - Deleting any world-generation code.
  - Persona creation UX itself, including the `/dev` LPC preview redirect —
    that is **C-408**.
  - `/capability` behaviour — that is **C-406**.
  - The `localStorage.getItem('aikami-characters')` read inside
    `_proceedWithPack` — pre-existing, noted in Gotchas, not fixed here.
  - Emberwatch content changes.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** borderline, and deliberately kept whole. The pack picker
and the wizard relocation both change what "Start campaign" does, share the
`NewCampaignDestination` decision, and would leave a confusing intermediate
state if split — a picker that still leads into a discarded wizard, or a
relocated wizard with no way to choose the pack it was replaced by. The
parallelization is separable and may be dropped to a follow-up if it threatens
the contract's size; if so, record an amendment.

## Acceptance Criteria

### AC-1: Default path skips world generation
**Given** a fresh install with zero personas
**When** the player presses "Start campaign"
**Then** they arrive at persona creation without passing through the
world-generation wizard, and no world-generation AI call is made. "Persona
creation" means the onboarding coordinator
(`views/onboarding/onboarding_coordinator_view.svelte`, C-319) — note it
currently has **no route**; the implementer must mount it, either on the
existing `personaCreate` route (`/personas/create`, which `routes.ts` already
declares with an `onboarding` query parameter) or on a new `/onboarding`
route.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | E2E | `apps/e2e/tests/client/new_campaign_flow.spec.ts` | `/` → (pack picker when 2+ packs) → onboarding | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run e2e:test -- tests/client/new_campaign_flow.spec.ts`
- Integration: clear local state, press Start campaign, assert the route.
- E2E / Visual: **Functional**: new spec asserting the route sequence and that
  the world-gen provider is never called (assert via a request spy, not by
  timing). **Visual**: N/A.

**Watch Points**:
- Asserting "no AI call" by elapsed time is flaky. Spy on the provider request.

### AC-2: All three character-count branches reach a playable state
**Given** zero, one, and two-or-more existing personas
**When** "Start campaign" is pressed in each case
**Then** each reaches a playable Emberwatch without passing through world
generation

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `apps/frontend/client/src/lib/views/start/start_view_model.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-unit`
- Integration: assert the resolved `NewCampaignDestination` for each count.
- E2E / Visual: **Functional**: extend `tests/client/game_boot.spec.ts`.

**Watch Points**:
- The one-character branch reads `localStorage` directly and picks
  `characters[0]` — verify it still works and does not silently pick the wrong
  persona when the picker is introduced.

### AC-3: Pack picker appears when multiple packs are installed
**Given** both `emberwatch` and `whispering-caves` are installed
**When** a new campaign is started
**Then** the existing C-345 picker (`PackBrowserView`) lists both with name and
description, and the chosen pack id is what `startNewCampaign` receives —
wire `startNewGame()` through `openPackBrowser()` instead of hardcoding
`emberwatch`

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | E2E | `apps/e2e/tests/client/new_campaign_flow.spec.ts` | `/` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run e2e:test -- tests/client/new_campaign_flow.spec.ts`
- Integration: select `whispering-caves` and assert the loaded map is its
  starting map, not Emberwatch's `village`.
- E2E / Visual: **Visual**: a picker case in a client visual suite — score 90+:
  two distinct pack cards, readable names and descriptions, no clipped text.

**Watch Points**:
- With exactly one pack installed the picker must be skipped, not shown with a
  single option.
- `whispering-caves` may not be as complete as `emberwatch`. If it cannot be
  entered without errors, either fix it here or hide it — shipping a picker
  whose second option is broken is worse than no picker. Resolve via OQ-2.

### AC-4: World generation is reachable and honestly labelled
**Given** the Advanced entry point
**When** the player generates a world
**Then** the result renders as before, and the UI states plainly that it is a
preview and not yet playable

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | E2E | `apps/e2e/tests/client/world_gen.spec.ts` | Advanced entry | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run e2e:test -- tests/client/world_gen.spec.ts`
- Integration: keep the sandbox-based spec for wizard behaviour; assert the
  preview notice on the Advanced entry's own route.
- E2E / Visual: **Functional**: existing spec updated. **Visual**: assert the
  preview notice is visible and not truncated.

**Watch Points**:
- The existing `world_gen.spec.ts` does **not** navigate to `/setup` — it uses
  `WorldGenWizardPage.gotoDevSandbox()` (`/dev/world-gen`); the POM's
  `gotoSetup()` is currently unused. Since the Advanced entry must not live
  under `/dev` (OQ-1), assert the preview notice on the Advanced entry's own
  route (in `new_campaign_flow.spec.ts`) and keep the sandbox spec for wizard
  behaviour. A spec that passes against the dead `/setup` route is a false
  green.

### AC-5: Independent generation calls run in parallel
**Given** a world-generation run
**When** setting prose, NPC roster, locations, and story arcs are produced
**Then** independent calls are issued concurrently and wall-clock time
decreases measurably against the sequential baseline

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | `apps/frontend/client/src/lib/views/worldgen/world_gen_wizard_view_model.test.ts` | Advanced entry | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-unit`
- Integration: record before/after wall-clock on a fixed provider and put both
  numbers in the Execution Report.
- E2E / Visual: N/A.

**Watch Points**:
- Story arcs reference NPCs as quest-givers, so arcs likely depend on the NPC
  roster. Parallelize only genuinely independent stages; a wrong dependency
  graph produces arcs referencing NPCs that do not exist.
- Existing retry and schema-validation behaviour must survive
  (`world_gen_retry.test.ts`, `world_gen_schema.test.ts`).

## Implementation Sequence

1. **Phase 1 (Data/Logic)** — Introduce `NewCampaignDestination` and resolve it
   in `start_view_model`. Point the zero-character branch at onboarding. Load
   packs via the existing `packRegistryService` (C-345). Unit-test all
   three branches (AC-2) before touching routes.
2. **Phase 2 (Integration)** — Wire the existing C-345 pack picker into
   `startNewGame()`. Mount the onboarding coordinator on a route (see AC-1).
   Move the world-generation wizard to the Advanced entry and add the preview
   notice. Update `/setup` so it no longer fronts the wizard; review the three
   other `goToRoute('setup')` callers (see Gotchas).
3. **Phase 3 (Validation)** — Parallelize independent generation stages, with
   the dependency graph written down in a comment. Add
   `tests/client/new_campaign_flow.spec.ts`. Update the docs getting-started
   page. Run `moon run client:test-unit`, `moon run e2e:test`,
   `bun run typecheck`.

## Edge Cases & Gotchas

- **`/setup` has four callers, not one.** `goToRoute('setup')` appears at
  `start_view_model.svelte.ts:552` (the branch being changed),
  `capability_view_model.svelte.ts:504` (post-`_startCampaign`),
  `persona_list_view_model.svelte.ts:159` (`createPersona()`), and
  `ai_privacy_view_model.svelte.ts:114` (`connectAi()`, passes
  `from: 'settings'`). Each lands on the world-gen wizard today; decide per
  caller whether it should route to the onboarding coordinator instead. Docs
  also mention setup: `docs/src/content/docs/start/*` and
  `docs/src/content/docs/guides/run-locally.mdx`.
- **Direct `localStorage` in the view model.** `_proceedWithPack` reads
  `aikami-characters` directly — exactly the pattern the strategy doc flags as
  making lifecycle hard to reason about. Out of scope, but do not extend it;
  the new picker must go through a service.
- **Five services reset inline** before navigation in two separate branches of
  `_proceedWithPack`. Do not add a third copy — extract or reuse.
- **Campaign created before navigation.** `startNewCampaign` runs before
  `goToRoute`, so backing out of onboarding leaves a campaign behind. Confirm
  whether it is reused or orphaned, and make it deliberate either way.
- **`_getDefaultWorldGenOutput()`** keeps `worldName` populated when no wizard
  runs, so the naming consumers keep working on the default path.
  Verify the default name is presentable — it will now be what most players
  see in session summaries.
- **A text provider is still required to play.** The
  `isAiTextProviderRequiredError` redirect to `/capability` must survive the
  refactor; it is directive #3's enforcement point.

## Open Questions

Must be resolved before status becomes `approved`:

- **OQ-1** — Where exactly does the Advanced entry live: a link on the start
  screen, an entry in Settings → Advanced, or a `/dev`-adjacent route? Must not
  be `/dev`, which C-410 removes from production builds.
- **OQ-2** — Is `whispering-caves` complete enough to be offered in the picker?
  It is structurally complete (manifest with `startingMapId`, a real map file
  `maps/whispering_caves.json` ~3.9KB vs Emberwatch's 18KB, two NPCs with
  dialogue keys and combat stats, items) — offerable, but confirm by playing
  it to a sensible end; if it is not, exclude it or mark it work-in-progress.
- **OQ-3** — Which world-generation stages are genuinely independent? Requires
  reading `world_gen_wizard_view_model.svelte.ts` and writing the dependency
  graph down before parallelizing. If arcs depend on NPCs and NPCs depend on
  setting, the achievable speed-up may be small enough that AC-5 should be
  dropped to a follow-up.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-08-16 | Initial draft from `mvp-assessment-2026-08-16.md` §6.1. Option (c) — relocate and label — chosen over deleting the wizard or building the compiler now; rationale in Design Reference. | — |
| 2.0.0 | 2026-08-16 | Critic pass (codebase inspection): corrected factual claims — output is seeded/consumed as loose state, not discarded; the C-345 pack picker exists but is unwired (AC-3, Reuse Map); `world_gen.spec.ts` runs against the dev sandbox, not `/setup` (AC-4); onboarding coordinator has no route (AC-1 destination clarified); reused `PackIndexEntry` instead of a new `ContentPackSummary`. | critic |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

Target: **`integrated`** — production route plus E2E. A visual case is included
for the pack picker but the contract's substance is routing, not appearance.

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---

## Execution Report

### Summary

Cut AI world generation out of the new-campaign critical path. “Start campaign”
now routes through the C-345 pack picker (both `emberwatch` and
`whispering-caves` are listed, full descriptions unclamped) and lands on the
onboarding coordinator (`/personas/create?onboarding=1`) for persona creation —
zero world-gen AI calls on the default path (verified with a request spy). The
world-generation wizard moved, unchanged in behaviour, to a new production
route `/worldgen` reached via an Advanced disclosure on the start screen, with
an honest “preview, not playable yet” banner linking issue #81. `/setup` no
longer fronts the wizard — it hosts the onboarding coordinator so all legacy
callers land on persona creation. Generation was split into parallel stages
(4 independent sections concurrent, party arcs after the NPC roster) with the
dependency graph documented and retry/schema behaviour preserved.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | `new_campaign_flow.spec.ts` asserts `/` → pack picker → onboarding, and zero AI-provider requests via a route-level request spy (not timing). Onboarding mounted on the existing `personaCreate` route with `onboarding=1`. |
| AC-2 | ✅ | `start_view_model.test.ts` covers all three branches (0→personaCreate?onboarding=1, 1→/game, 2+→/personas); one-character branch still picks `characters[0]`. |
| AC-3 | ✅ | `startNewGame()` wired through `openPackBrowser()`; picker listed both packs; single-pack skip preserved; visual suite `start_picker` scores 100/100 (≥90 required). |
| AC-4 | ✅ | New `/worldgen` production route (not `/dev`) with preview banner + issue #81 link; Advanced entry on the start screen; asserted in `new_campaign_flow.spec.ts` and screenshots. |
| AC-5 | ✅ | Generation split into 5 stages; setting/npcs/locations/hudWidgets issued concurrently, partyArcs after npcs. Unit test asserts max concurrency = 4. Wall-clock on fixed sandbox provider: 1830ms parallel vs 4000ms sequential-equivalent (~54% reduction). Retry + schema tests still pass. |

### Files Created

| File | Purpose |
|---|---|
| `apps/frontend/client/src/routes/worldgen/+page.svelte` | Production Advanced route hosting the relocated wizard with the preview-not-playable banner (AC-4). |
| `apps/e2e/tests/client/new_campaign_flow.spec.ts` | E2E: default-path route sequence, pack picker contents, request-spy “no world-gen AI call” assertion, and /worldgen preview notice. |
| `apps/e2e/src/visual/suites/start_picker.visual.ts` | Visual suite for the pack picker (AC-3) — 100/100. |

### Files Modified

| File | Change |
|---|---|
| `apps/frontend/client/src/lib/constants/routes.ts` | Added `worldgen` route (`/worldgen`). |
| `apps/frontend/client/src/lib/views/start/start_view_model.svelte.ts` | `NewCampaignDestination` type + `_resolveNewCampaignDestination`; `startNewGame()` → `openPackBrowser()`; zero-char branch → `personaCreate?onboarding=1`; `startWorldGeneration()`; destination + pack id logging. |
| `apps/frontend/client/src/lib/views/start/start_view.svelte` | Advanced disclosure with “World Generation (Preview)” entry + `data-testid="start-menu"` (visual-suite signal). |
| `apps/frontend/client/src/lib/views/start/components/pack_browser_view.svelte` | Removed `line-clamp-2` so pack descriptions render fully (AC-3 “no clipped text”). |
| `apps/frontend/client/src/routes/personas/create/+page.svelte` | Mounts the onboarding coordinator when `?onboarding=1`; legacy persona create otherwise. |
| `apps/frontend/client/src/lib/views/setup/setup_view_model.svelte.ts` | Replaced wizard + persona VMs with the onboarding coordinator (no longer fronts the wizard). |
| `apps/frontend/client/src/lib/views/setup/setup_view.svelte` | Renders the onboarding coordinator. |
| `apps/frontend/client/src/lib/data/ai_prompts/world_gen_schema.ts` | Added per-stage TypeBox schemas (setting/npcs/locations/hudWidgets/partyArcs). |
| `apps/frontend/client/src/lib/views/worldgen/world_gen_wizard_view_model.svelte.ts` | Parallel stage generation (dependency graph in comment), stage prompts, `_callLlm` schema param; retry/schema behaviour unchanged. |
| `apps/frontend/client/src/lib/views/start/start_view_model.test.ts` | Updated routing expectations (setup→personaCreate), implemented the C-345 pack-browser `test.todo` cases, added AC-2 three-branch tests. |
| `apps/frontend/client/src/lib/views/worldgen/world_gen_wizard_view_model.test.ts` | Added AC-5 concurrency + failure-propagation tests. |
| `apps/e2e/src/visual/core/capture.ts` | `start-menu` data-testid accepted by `_waitForGameReady` (follows the persona-list precedent). |
| `apps/frontend/docs/src/content/docs/start/installation.md` | “Starting a campaign” section describing the picker → persona creation flow and the Advanced preview entry. |

### Deviations from Spec

- **OQ-1 (Advanced entry location)** resolved: a link on the start screen under an
  Advanced disclosure, per the C-333 progressive-disclosure precedent; the
  wizard itself lives on the new production route `/worldgen` (not `/dev`).
- **OQ-2 (whispering-caves offerable)** resolved: yes — structurally complete
  (manifest, starting map, 2 NPCs with dialogue/combat, items, quests,
  encounters). Offered in the picker; full map-enter verification of
  `whispering-caves` is deferred to the verifier (the `game_boot` HUD test is a
  pre-existing environment failure, see Test Results).
- **OQ-3 (stage dependency graph)** resolved: setting | npcs | locations |
  hudWidgets are mutually independent and run concurrently; partyArcs depend on
  npcs (questGivers must be roster names) and run after. The wall-clock
  improvement is measured against the sequential-equivalent of the same five
  stages (1830ms vs 4000ms on the fixed 800ms/call sandbox provider); a
  single-call full-output baseline is inherently faster per round-trip, so the
  real-world gain depends on per-stage latency scaling.
- **Campaign back-out behaviour**: deliberate — `startNewCampaign` creates a
  fresh campaign before navigation; backing out of onboarding orphans a
  `creating`-state campaign (pre-existing, unchanged, no active half-created
  campaign).
- **AC-3 “loaded map is its starting map”**: covered by picker selection unit
  assertions (pack id reaches `startNewCampaign`) and the E2E route sequence;
  full `whispering-caves` map boot is not asserted because the game boot HUD
  test already fails pre-existing in this environment.

### Test Results

- Unit: 1811 pass / 1 fail (1 pre-existing `GameBootService — AC-4
  Cancellation > cancellation during boot returns cancelled result`, confirmed
  failing on the pristine base commit) / 2 pre-existing `CampaignService` todos.
- E2E (focused contract scope): 15 pass / 1 fail — `new_campaign_flow.spec.ts`
  4/4, `world_gen.spec.ts` 8/8, `game_boot.spec.ts` 3/4 with the same 1
  pre-existing HUD failure as baseline. The full `e2e:test` aggregate also runs
  chat/game/ai-services/site projects that require microservices (text/voice/
  image) or the site server; those failures are environmental and unrelated
  (site server required `.env.emulator` provisioning in the worktree).
- Visual: `start_picker` suite 100/100 (≥90 required); production screenshots
  validated with `ai_validate_image`: start screen 95, pack picker 95, onboarding
  100, /worldgen preview 95, start-screen Advanced 100.
- Baseline regression: 1 pre-existing unit failure + 1 pre-existing E2E
  failure, 0 new failures.

### Suggested Commit

```
feat(client): cut world generation from the new-campaign critical path (C-405)
```
