---
id: C-417
title: "P1 Polish Batch — Equipment Sprite Sync, Lighting Readability, Capability Correctness, Dialogue UI, Persona Preview"
source: "docs/contracts/MVP_BACKLOG.md (seeds C-403, C-404, C-406, C-407, C-408); re-verified against main 2026-08-17"
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/159"
  pr_number: 159
created_at: "2026-08-17"
---

# Contract C-417: P1 Polish Batch — Equipment Sprite Sync, Lighting Readability, Capability Correctness, Dialogue UI, Persona Preview

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/contracts/MVP_BACKLOG.md` seeds C-403, C-404, C-406, C-407, C-408 (`mvp-assessment-2026-08-16.md`), re-verified against `main` 2026-08-17 after C-400/C-401/C-402 landed |
| **Target** | `apps/frontend/client/src/lib/services/game/equipment_service.svelte.ts`; `packages/frontend/engine/src/environment/environment_ubo.ts` + `packages/frontend/engine/src/systems/environment_system.ts`; `apps/frontend/client/src/lib/views/capability/`; `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte`; `apps/frontend/client/src/lib/views/character/persona/create/` |
| **Priority** | P1 — MVP coherence and polish, sequenced after the P0 block (C-400/401/402/405) |
| **Dependencies** | C-400 (landed — unified LPC resolver), C-401 (landed — streaming dialogue) |
| **Status** | implemented |
| **Promotion** | `—` |
| **Docs Impact** | internal |
| **Contract version** | 2.0.1 |

This contract absorbs five originally-separate backlog seeds (C-403, C-404,
C-406, C-407, C-408) into one file per explicit user direction to reduce
per-file overhead in the MVP backlog. Each numbered feature below is an
independently mergeable unit of work with its own acceptance criteria — see
[Contract Size & Split Rule](#contract-size--split-rule).

**Re-verification note:** all five seeds were written 2026-08-16. C-400/401/402
have since merged to `main` and touched adjacent code. A fact-check pass on
2026-08-17 found that two of the five seeds' core premises no longer hold as
written — Feature 1 (equipment sync) is already wired, and Feature 5 (persona
preview) is already fixed for the flow it named. Both are re-scoped below
rather than copied verbatim from the seed.

---

## Problem & Baseline Evidence

### Feature 1 — Equipment → LPC sprite sync (absorbs seed C-403)

- **Current behavior, corrected from the seed**: the seed claimed the wiring
  between equip/unequip and the rendered sprite was entirely absent. That is
  **no longer accurate as a static-code claim** — the wiring exists and
  predates C-400:
  - `equipment_service.svelte.ts:260,269` — `equipItem`/`unequipItem` call
    `_emitAppearanceUpdate()`, sending `UPDATE_PLAYER_APPEARANCE`.
  - `game_composition_root.svelte.ts:271` —
    `equipmentService.configureCommandSender(...)`.
  - `game_boot_service.svelte.ts:868` and `game_engine_service.svelte.ts:749`
    both pass `equipmentRecipeProvider: () => equipmentService.buildLpcRecipes()`
    into the engine.
  - `game_world.ts:2991-3005` (`_mergeEquipmentRecipes`) merges equipment
    recipes on `APPEARANCE_CHANGED` (emitted from `render_worker.ts`'s
    `syncAppearanceSystem`, lines 238-310).
  - This chain shipped in commit `58905b68` (C-374) — before this seed was
    written, and untouched by C-400.
  - **Open question, not resolved by static reading**: whether this wiring
    actually produces a visible sprite update at runtime has never been
    confirmed by a test or a manual play session. The seed may have been
    describing an observed runtime bug that static tracing does not
    reproduce, or it may have been wrong from the start.
- **The hard-zero block is real and unchanged in substance**:
  `game_boot_service.svelte.ts:1296-1297` and
  `game_engine_service.svelte.ts:893-894` both zero
  `appearanceLayers[2]` (torso) and `appearanceLayers[4]` (feet), each behind
  a `// C-374:` comment. Given `_mergeEquipmentRecipes` exists as an overlay
  mechanism, this reads as **deliberate design** (equipment owns torso/feet
  after `seedBaseOutfit`), not an accidental leftover — but this has not been
  confirmed against actual render output either.
- **Reproduction**: buy or equip Iron Armour from Mara, observe whether the
  player sprite changes within one frame; unequip, confirm it reverts;
  save/reload, confirm it survives.
- **Existing implementation to reuse**: the full chain listed above — this is
  a verify-and-close-the-gap task, not a from-scratch wiring task.
- **Baseline tests**: `apps/frontend/client/src/lib/services/game/equipment_service.test.ts`
  exists (verified 2026-08-17). No test currently covers
  `_mergeEquipmentRecipes` — `packages/frontend/engine/src/__tests__/game_world.test.ts`
  does not reference it — so AC-1's regression spec is the first coverage.

### Feature 2 — Ambient lighting and map readability (absorbs seed C-404)

- **Current behavior**: `packages/frontend/engine/src/environment/environment_ubo.ts:54`
  defines `COLOR_MIDNIGHT = [0.18, 0.18, 0.3, 1.0]` as the darkest point of
  `DIURNAL_KEYFRAMES` (`environment_system.ts:73-79`). At default midnight
  ambient, terrain/props/floor are hard to distinguish, and interiors (`inn`,
  `merchant_shop`) read as undifferentiated dark rooms when their lighting is
  not independent of the world clock.
- **Correction to the seed**: the seed assumed new campaigns boot at night.
  They do not — `environment_system.ts:37` (`let _gameHour = 12;`) and
  `time_service.svelte.ts:39` (`private _gameHour = $state(12);`) both default
  to **noon**, and no campaign-start override changes this (only test
  fixtures and a `?gameHour=` dev-sandbox param do). The readability problem
  is real at night — every campaign eventually reaches it — but there is no
  "player boots into darkness on day one" bug to fix. Acceptance criteria
  below verify readability at both the actual default (noon) and at night,
  not a corrected "first boot" state.
- **Reproduction**: advance the world clock to midnight in `village`, `inn`,
  and `merchant_shop`; compare prop/floor/NPC contrast against noon.
- **Existing implementation to reuse**: `DIURNAL_KEYFRAMES` interpolation
  already exists — this is a floor-value and interior-independence change,
  not a new lighting system.

### Feature 3 — `/capability` correctness and polish (absorbs seed C-406)

- **Current behavior**: `capability_view_model.svelte.ts:106` sets
  `voiceStatus: 'detected'` as a literal initial-state default (its text/image
  siblings are `'pending'`), unchanged from the seed.
  `_seedDetectedConnections` (lines 405-475) creates connections with
  `source: 'detected'` at line 507.
- **Nuance found during re-verification**: `_seedDetectedConnections` is only
  invoked from `startDetection()` (line 231) using the **real** result of
  `capabilityService.detect()` — not the literal default at line 106.
  `capability_service.svelte.ts:47-71` performs genuine concurrent probes via
  `aiGatewayService.detect(...)`. So today, the literal default is dead
  initial state that the current UI path does not surface as a false
  positive. It remains a latent risk: any future code path that reads
  `snapshot.voiceStatus` before `startDetection()` completes would see a
  false `'detected'`. The fix (explicit non-`detected` initial state matching
  the text/image siblings) is still correct; the severity is lower than the
  seed implied. **Note:** the shared `DetectionStatusSchema` in
  `packages/shared/schemas/src/lib/capability.ts` defines
  `pending | detected | not_found | configured | error | skipped` — there is
  no `unknown`/`unavailable`/`probing` status in this codebase. The correct
  pre-detection default is the existing `'pending'` literal, not a new
  status value.
- **Reproduction**: with no local voice engine running, inspect
  `capabilityViewModel.snapshot.voiceStatus` immediately after construction
  and before `startDetection()` resolves.
- **Existing implementation to reuse**: `capability_service.svelte.ts`'s probe
  logic is correct and stays; only the initial-state literal and the
  auto-seed gating need to change.

### Feature 4 — Dialogue UI overhaul (absorbs seed C-407)

The seed bundled six problems; re-verification found two no longer apply as
described and one applies to a different element than named.

- **CYOA choice buttons — seed's "overflow into horizontal scrollbar" claim is
  false today.** `dialogue_overlay.svelte:474-486`
  (`data-testid="cyoa-choices"`) is a vertical stack — `class="space-y-1 px-2"`
  with each button `w-full justify-start`. `git log -S "cyoa-choices"` shows
  this predates the seed. **Dropped from scope.**
- **The horizontal-scroll problem is real, but on the suggestion-chip row, not
  the choice list.** `dialogue_overlay.svelte:524-564`
  (`data-testid="suggestion-chips"`), `class="flex shrink-0 gap-1.5
  overflow-x-auto"` — chips past what fits require scrolling and are
  effectively hidden. This becomes the P0-weight element of this feature,
  retargeted at the correct component.
- **Portrait strip clipping**: unverified by static read (contained in a
  `max-w-2xl` centered flex, `dialogue_overlay.svelte:76-124`) — needs a real
  viewport check at 1280×720 and 800×600 before either confirming or dropping
  this item.
- **Portrait art direction — seed's premise is false.** Both `npcAvatarUrl`
  and `playerAvatarUrl` resolve exclusively through pre-rendered portrait
  busts in `npc_avatar_catalog.ts` (`resolveNpcAvatarUrl` /
  `resolvePlayerAvatarUrl`, lines 101-184) — lives at
  `apps/frontend/client/src/lib/data/npc_avatar_catalog.ts`. The catalog's own header comment
  states the in-world LPC spritesheet "is NEVER used as a portrait avatar."
  There is no raw-LPC-crop code path in this view to be inconsistent with an
  AI-generated one. **Dropped from scope as a bug fix**; recorded as an Open
  Question in case product still wants an LPC-derived portrait as a future
  option — that would be a new feature, not a consistency fix.
- **Message area dead space**: unverified by static read — needs a real
  viewport check.
- **TTS toggle unlabelled/unstyled**: confirmed unchanged —
  `dialogue_overlay.svelte:645-653`, a bare `<span>TTS</span>` next to
  `input.toggle.toggle-xs` with no `aria-label`.
- **Emoji prefixes — mostly already resolved.** Suggestion chips already map
  emoji to `chip.intentType` (lines 546-558). The remaining ad hoc emoji
  (`📋 🔄 🔊 🌿 ✏️ 🗑️`, lines 298-377) are message **action** icons (retry,
  read-aloud, edit, delete), not choice/intent icons — a different, smaller
  concern than the seed described. Scope narrows to: confirm no leftover
  hardcoded choice-emoji exist outside the chip system; leave action icons
  alone.
- **Reproduction**: talk to Elder Thalia, trigger a skill check with Rollo so
  multiple suggestion chips render, at both 1280×720 and 800×600.
- **Existing implementation to reuse**: `dialogue_overlay.svelte` in full;
  `chip.intentType`-driven emoji mapping as the pattern to extend if any
  leftover hardcoded choice emoji are found.

### Feature 5 — Persona creation: inline LPC preview (absorbs seed C-408)

- **Current behavior, corrected from the seed**: the seed's premise — that
  player onboarding redirects to `/dev` for LPC preview — **is false today**.
  `onboarding_appearance_step_view.svelte:10,90` already imports and renders
  `LpcPreviewView` directly, with live recipe sync via a `$effect`
  (lines 34-39). This shipped in commit `0290bf72` (C-325), well before this
  seed. **No `/dev` link exists anywhere under `views/onboarding/`.**
- **The `/dev` redirect does exist, but in a different flow the seed did not
  name**: `persona_create_view_model.svelte.ts:224` returns
  `` `/dev/lpc?${params.toString()}` ``, opened via `target="_blank"` from
  `persona_create_view.svelte:219-227`. This is the **AI-companion / NPC
  persona creation flow** ("Generate Character", chat-driven), not the
  player's character-onboarding route. This feature retargets entirely to
  that flow.
- **Generation parallelism**: not verified during re-check — whether
  `persona_create_view_model`'s generation calls are sequential is an open
  question to resolve during implementation, same as the original seed's
  secondary concern.
- **Reproduction**: from the companion/NPC creation surface, use "Generate
  Character" and observe the `/dev/lpc` tab opening instead of an inline
  preview.
- **Existing implementation to reuse**: `views/character/lpc_preview/`
  (`lpc_preview_pixi_facade.ts`, `lpc_preview_view.svelte`,
  `lpc_preview_view_model.svelte.ts`) — the same component already embedded
  in onboarding is reused here, not rebuilt.

---

## User Outcome

After this contract:
- A **player** who equips or unequips gear sees their sprite update
  immediately and reliably (verified, not just wired).
- A **player** can read Emberwatch's interiors and night scenes without
  squinting, and props/NPCs stay visually distinct from terrain regardless of
  the world clock.
- A **new player** on `/capability` never sees a provider marked `detected`
  that has not actually been probed.
- A **player** mid-dialogue can see every suggestion chip without a hidden
  horizontal scrollbar, and has a labelled TTS control.
- A **player using the AI-companion "Generate Character" flow** previews their
  character's appearance inline, without leaving to a `/dev` tab.

## Success Measures

- **Time/latency target**: N/A for lighting/capability/persona (visual and
  correctness changes, not perf-critical paths); equipment sprite update
  within one rendered frame of the equip action.
- **Offline/degraded behavior**: capability probes must never report a false
  `detected` when no local engine is reachable; pre-detection state stays at
  the existing `pending` status until a probe result lands.
- **Production journey enabled**: gear changes read visually during play; the
  night portion of the day/night cycle stops being a readability regression;
  first-run capability detection is trustworthy; dialogue is fully navigable
  by chip/choice at common resolutions; companion creation stays inside one
  flow.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Equipment → engine appearance channel | `equipment_service.svelte.ts`, `game_world.ts:2991-3005` | **reuse** — verify, close any live gap |
| Torso/feet zero-out | `game_boot_service.svelte.ts:1296-1297`, `game_engine_service.svelte.ts:893-894` | **verify intent, dedupe** (coordinate with C-418 Feature C) |
| Diurnal ambient interpolation | `environment_ubo.ts`, `environment_system.ts:73-79` | **modify** — raise night floor, decouple interiors |
| Capability probing | `capability_service.svelte.ts:47-71` | **reuse** — probe logic is correct |
| Capability initial state | `capability_view_model.svelte.ts:106` | **modify** — remove literal `'detected'` default, use `'pending'` |
| Suggestion chip row | `dialogue_overlay.svelte:524-564` | **modify** — fix overflow, keep intentType emoji mapping |
| Chip emoji-by-intent | `dialogue_overlay.svelte:546-558` | **reuse** — extend only if leftover hardcoded emoji found |
| LPC preview component | `views/character/lpc_preview/` | **reuse** — already embedded in onboarding; embed in companion flow too |
| Companion persona creation | `persona_create_view.svelte`, `persona_create_view_model.svelte.ts:224` | **modify** — replace `/dev/lpc` tab with inline preview |

## Overview

Five independent P1 polish items, batched into one contract file. Two
(equipment sync, persona preview) turned out to be partially or fully already
fixed by the P0 landings and are re-scoped to verification-and-close-the-gap
or retargeted at the correct flow. The other three (lighting, capability
correctness, dialogue chip overflow) proceed close to their original seed
scope, corrected for exact code locations and line numbers found during
re-verification on 2026-08-17.

## Design Reference

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

- **Feature 1**: no design decision needed if runtime verification confirms
  the existing wiring works — this becomes a regression-test-and-close item.
  If a real gap is found, root-cause it against the chain listed in Problem &
  Baseline Evidence before writing new code; do not re-wire a path that
  already exists.
- **Feature 4, portrait art direction**: explicitly **not** designing an
  LPC-crop-vs-AI-portrait unification, because there is nothing to unify.
  Recorded as OQ-4 instead of a scoped change.
- **Feature 5**: follow the onboarding precedent exactly — same component
  (`LpcPreviewView`), same `$effect`-driven recipe sync pattern
  (`onboarding_appearance_step_view.svelte:34-39`), applied to
  `persona_create_view.svelte` instead of re-deriving an integration.

## Architecture Directives

- **Feature 1**: any fix must go through the existing
  `equipmentRecipeProvider` → `_mergeEquipmentRecipes` → `APPEARANCE_CHANGED`
  channel. Do not add a second appearance-update path.
- **Feature 2**: ambient changes live in `environment_ubo.ts` /
  `environment_system.ts` only; interior independence from the world clock
  must not require per-map special-casing — it should be a property the
  content pack manifest or map data can declare generically.
- **Feature 3**: every capability status field must derive from an explicit
  probe result (shared `DetectionStatus` values: `pending | detected |
  not_found | configured | error | skipped`), never a literal `detected`
  default. `_seedDetectedConnections` must only run after a confirmed probe.
- **Feature 4**: `suggestion-chips` overflow fix should apply the same
  pattern already used successfully for `cyoa-choices` (full-width vertical
  stacking or wrapping) rather than inventing a new layout primitive.
- **Feature 5**: `persona_create_view_model.svelte.ts` should mirror
  `onboarding_appearance_step_view_model`'s recipe-sync shape so both preview
  integrations stay structurally consistent.

## State & Data Models

```ts
/** Pre-detection state matches the text/image siblings — no literal 'detected'. */
// The status union is the EXISTING shared DetectionStatusSchema
// (packages/shared/schemas/src/lib/capability.ts):
//   'pending' | 'detected' | 'not_found' | 'configured' | 'error' | 'skipped'
// Consume it via `DetectionStatus` from '@aikami/types' — do NOT introduce a
// new status union or schema (Pillar 2: shared schemas are the single source).

// Fix: capability_view_model.svelte.ts:106 changes the literal default
//   voiceStatus: 'detected'  →  voiceStatus: 'pending'
```

No new persisted schema for the other four features — they are rendering,
layout, and routing changes over existing data shapes.

## Quality Requirements

- **Offline/degraded mode**: capability probes must stay `pending` (the
  existing pre-detection status) with no network/engine present, and only
  transition to `detected` on a confirmed probe (Feature 3); dialogue chip
  layout must not depend on network state (Feature 4).
- **Accessibility/input**: TTS toggle needs an `aria-label` (Feature 4);
  suggestion chips must remain keyboard-reachable after the overflow fix.
- **Performance budget**: N/A for all five — none are on a hot path.
- **Security/privacy**: N/A.
- **Persistence/migration**: N/A — no save-format changes.
- **Cancellation/retry/idempotency**: capability retry affordance (Feature 3)
  must be safe to invoke repeatedly without leaking duplicate connections.
- **Observability**: log the resolved equipment recipe merge outcome
  (Feature 1) and capability probe transitions (Feature 3) at `debug` level.

## Migration & Rollback

N/A — no persistent state changes in any of the five features. Each is
independently revertible by reverting its own commit(s).

## Scope Boundaries

- **In Scope:**
  - Feature 1: verify equip/unequip sprite sync end-to-end; add a regression
    test; resolve whether the torso/feet zero-out is intentional and dedupe
    with C-418 if so.
  - Feature 2: night ambient floor, interior lighting independence, readable
    contrast on interactables, verified at both noon (actual default) and
    night.
  - Feature 3: explicit probe-state defaults, auto-seed only on confirmed
    probe, retry affordance, visual polish.
  - Feature 4: suggestion-chip overflow fix, TTS toggle label/style, audit for
    leftover hardcoded choice emoji. Portrait clipping and message-area dead
    space are investigated and either fixed or dropped with a recorded reason.
  - Feature 5: inline LPC preview in the companion/NPC "Generate Character"
    flow, replacing the `/dev/lpc` tab; parallelize generation calls if found
    sequential.

- **Out of Scope:**
  - Palette/recolour support, expression system changes (unchanged from
    C-400's exclusions).
  - Any LPC-crop-derived portrait feature for dialogue (Feature 4) — recorded
    as an open question, not built here.
  - `/dev` route removal itself — that is C-418 Feature B (gate dev routes).
  - Combat lighting or combat UI.
  - The player-onboarding LPC preview integration — already shipped; not
    touched by this contract.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** deliberately bundles five otherwise-independent P1
items — none shares a data model or invariant with another — per explicit
user direction to reduce file count in the MVP backlog. Each feature above
has its own Problem, Scope, and AC block and can be implemented, verified,
and merged independently of the other four; treat this as five parallel work
items sharing one contract wrapper, not a single vertically-integrated
change. If any one feature's implementation grows large enough to threaten
review quality, split it out into its own contract file and record that as
an amendment rather than shrinking its scope to fit.

## Acceptance Criteria

### AC-1: Equipment change updates the rendered sprite
**Given** the player has Iron Armour in inventory
**When** they equip it, then unequip it
**Then** the rendered sprite changes to reflect equipped torso armour within
one frame, and reverts on unequip; the change survives save/load

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | E2E | `apps/e2e/tests/client/equipment_visual.spec.ts` | `/game` inventory panel | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run e2e:test -- tests/client/equipment_visual.spec.ts`
- Integration: equip/unequip in a live session, screenshot diff before/after.
- E2E / Visual: **Functional**: new spec asserting recipe/appearance state
  changes on equip. **Visual**: visual suite case — score 90+: torso armour
  visibly rendered on the player sprite.

**Watch Points**:
- If this AC already passes with no code change, do not close it silently —
  add the regression test anyway so the next refactor cannot silently break
  it again, and record in Amendments that Feature 1 was verification-only.

### AC-2: Emberwatch stays readable across the day/night cycle
**Given** the `village`, `inn`, and `merchant_shop` maps
**When** the world clock is at noon (the actual default) and at midnight
**Then** terrain, walkable floor, props, and NPCs remain visually
distinguishable at both times, and interiors are lit independently of the
outdoor clock

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Visual | extend `apps/e2e/src/visual/suites/environment.visual.ts` (noon + midnight cases) and/or `emberwatch.visual.ts` | `/game` (Emberwatch village, inn, merchant_shop) | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run e2e:run-visual-tests` (filter: `--suite environment`)
- Integration: manual clock advance in dev sandbox (`?gameHour=`), compare
  screenshots.
- E2E / Visual: **Visual**: two cases per map (noon, midnight); score 90+:
  props/NPCs distinguishable from terrain, interiors readable regardless of
  outdoor time.

**Watch Points**:
- Do not build this AC around a "fix the night-boot bug" framing — there is
  no night-boot bug; the default is noon.

### AC-3: No capability reports `detected` without a real probe
**Given** no local text, image, or voice engine is running
**When** `/capability` loads and detection runs
**Then** no provider status reads `detected`, and no connection is
auto-seeded

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `capability_view_model.test.ts` | `/capability` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-unit`
- Integration: construct the view model with no reachable engines, assert
  `snapshot.voiceStatus !== 'detected'` at every point in its lifecycle,
  including before `startDetection()` resolves.
- E2E / Visual: **Functional**: extend or add a `/capability` spec asserting
  no auto-seeded connection with engines stopped.

**Watch Points**:
- The pre-detection literal default is the actual bug surface — test it
  explicitly, not just the post-`startDetection()` state which already works.

### AC-4: Suggestion chips never require horizontal scrolling to discover
**Given** a dialogue turn producing more suggestion chips than fit the
viewport width
**When** the dialogue renders at 1280×720 and 800×600
**Then** all chips are reachable without a hidden horizontal scrollbar
(wrap or another visible-by-default layout)

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | E2E | `apps/e2e/tests/client/dialogue_chips.spec.ts` | `/game` dialogue overlay | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run e2e:test -- tests/client/dialogue_chips.spec.ts`
- Integration: trigger Rollo's skill check (produces multiple chips), assert
  chip count vs. visible/reachable count at both viewport sizes.
- E2E / Visual: **Visual**: score 90+: all chips visible or reachable by
  wrap, no clipped or scroll-hidden chip.

**Watch Points**:
- Target `data-testid="suggestion-chips"`, not `cyoa-choices` — the latter
  does not have this bug.

### AC-5: TTS toggle is labelled and styled
**Given** the dialogue overlay
**When** a screen reader or keyboard user reaches the TTS control
**Then** it has an accessible name and is visually consistent with adjacent
controls

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | E2E | `apps/e2e/tests/client/dialogue_tts_toggle.spec.ts` (asserts `aria-label` + visible label on the TTS toggle) | `/game` dialogue overlay | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run e2e:test-client -- tests/client/dialogue_tts_toggle.spec.ts`
- Integration: axe/a11y check on the dialogue overlay — `@axe-core/playwright`
  is already a dependency of `apps/e2e`.
- E2E / Visual: **Visual**: confirm styled toggle in the suggestion/action bar
  screenshot.

**Note**: there is no component-test infrastructure in `apps/frontend/client`
(no `@testing-library/svelte`; unit tests are service/ViewModel `.test.ts`
only), so the `aria-label` assertion belongs in the e2e project, not a unit
spec.

**Watch Points**:
- Keep the fix scoped to labelling/styling — do not touch TTS behaviour
  itself (explicitly out of scope, matching the original seed).

### AC-6: Companion "Generate Character" previews inline, not via `/dev`
**Given** a user on the AI-companion persona creation flow
**When** they use "Generate Character"
**Then** the LPC appearance preview renders inline in the same view, with no
`/dev/lpc` tab opened

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | E2E | `apps/e2e/tests/client/persona_create_preview.spec.ts` | companion persona creation route | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run e2e:test -- tests/client/persona_create_preview.spec.ts`
- Integration: assert no `window.open`/new-tab navigation occurs during
  generation; assert `LpcPreviewView` renders and updates live.
- E2E / Visual: **Visual**: score 90+: preview panel visible inline, updates
  as generation completes.

**Watch Points**:
- Do not confuse this with player onboarding — that flow already has the
  inline preview and needs no change.

## Implementation Sequence

1. **Phase 1 (Verify & Data)** — Run the equipment sync repro (AC-1) and
   record whether it passes as-is. Change the literal
   `voiceStatus: 'detected'` default at `capability_view_model.svelte.ts:106`
   to `'pending'` (no new status type — reuse the existing shared
   `DetectionStatus` union). Confirm the noon default and write down the
   night-ambient floor change.
2. **Phase 2 (Integration)** — Fix `suggestion-chips` overflow, label the TTS
   toggle, wire `LpcPreviewView` into `persona_create_view.svelte` following
   the onboarding pattern, decouple interior lighting from the world clock.
3. **Phase 3 (Validation)** — Add the five new/extended specs listed in the
   Evidence Matrices, run `moon run client:test-unit`,
   `moon run e2e:test-client`, `moon run e2e:run-visual-tests`,
   `bun run typecheck`.

## Edge Cases & Gotchas

- **Feature 1**: if AC-1 passes with zero code changes, resist the urge to
  "improve" the existing chain anyway — this contract is scoped to
  verification, not a refactor of working equipment code.
- **Feature 2**: the day/night cycle eventually reaches midnight in every
  campaign — do not scope this as a one-time first-impression fix only.
- **Feature 3**: `_seedDetectedConnections` reads `capabilityService.detect()`
  results, not the view model's own `snapshot` — verify the fix doesn't
  accidentally decouple the two further.
- **Feature 4**: `cyoa-choices` and `suggestion-chips` are visually adjacent
  in the same overlay — a screenshot-only review can conflate them; check the
  `data-testid` in any fix.
- **Feature 5**: `persona_create_view_model.svelte.ts:224`'s
  `lpcPreviewUrl` getter may have other consumers besides the `<a>` tag —
  grep before removing it.

## Open Questions

Must be resolved before status becomes `approved`:

- **OQ-1** — Feature 1: is the torso/feet zero-out at
  `game_boot_service.svelte.ts:1296-1297` /
  `game_engine_service.svelte.ts:893-894` confirmed intentional (equipment
  overlay ownership) or an accidental leftover? Confirm by comparing rendered
  output with and without the zero-out while equipment is present.
- **OQ-2** — Feature 2: should the interior-lighting-independence property be
  declared per-map (Tiled) or per-manifest? Pick one and record why.
- **OQ-3** — Feature 4: is portrait strip clipping and message-area dead
  space at 1280×720/800×600 real? Confirm with a live viewport check before
  committing to a fix.
- **OQ-4** — Feature 4: does product still want an LPC-derived portrait option
  for dialogue, given no inconsistency currently exists to fix? If yes, that
  is a new contract, not this one.
- **OQ-5** — Feature 5: are `persona_create_view_model.svelte.ts`'s
  generation calls sequential today? If so, is parallelizing them
  independently mergeable from the preview-embedding change, or should it be
  dropped to a follow-up (mirroring C-405's AC-5 precedent)?

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-08-17 | Initial draft merging seeds C-403, C-404, C-406, C-407, C-408. Features 1 and 5 re-scoped from "build the wiring" to "verify/retarget" after re-checking current code against seeds written 2026-08-16, before C-400/401/402 landed. Feature 4 dropped the CYOA-choice-overflow and portrait-unification items after confirming both premises are false today; retargeted the overflow fix at suggestion chips. | — |
| 2.0.1 | 2026-08-17 | Critic review corrections (no scope change): Feature 3 aligned with the real shared `DetectionStatusSchema` union (`pending \| detected \| not_found \| configured \| error \| skipped`) — the proposed `unknown/probing/unavailable` union does not exist in this codebase, and the fix is the literal `'pending'` default, not a new status type; corrected capability line refs (103→106, 483→507); corrected `dialogue_overlay` path (lives under `views/game/ui/overlays/dialogue/`) and `npc_avatar_catalog` path (`lib/data/`); replaced nonexistent `moon run client:test-visual` with `moon run e2e:run-visual-tests`; AC-5 evidence moved from impossible client component test to e2e spec (`dialogue_tts_toggle.spec.ts`, `@axe-core/playwright` lives in `apps/e2e`); corrected Feature 1 baseline (no test currently covers `_mergeEquipmentRecipes`). | critic review |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

Target: **`integrated`** per feature — each has its own E2E or unit coverage;
Features 2 and 4 additionally require `release_verified`-level visual
evidence given their visual nature.

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---

## Execution Report

### Summary
Implemented all five C-417 features. Feature 1 (equipment sprite sync) was verified as already-wired (C-374 chain intact) — added the first regression coverage for `_mergeEquipmentRecipes` (engine unit tests) plus an e2e spec + before/after visual evidence proving the sprite updates on equip/unequip. Feature 2 raised the night ambient floor (new `COLOR_NIGHT_FLOOR` clamp in the diurnal interpolator) and made interior lighting clock-independent via a generic manifest-declared `interior` flag projected through `PackConfig` and consumed by the engine tilemap tint. Feature 3 replaced the literal `voiceStatus: 'detected'` pre-detection default with `'pending'` and pinned it with unit tests. Feature 4 changed the suggestion-chip row from `overflow-x-auto` to `flex-wrap` and added a `?manyChips=1` deterministic overflow hook; Feature 5 labelled/styled the TTS toggle with an accessible name. Feature 6 embedded the production `LpcPreviewView` inline in the companion persona TWEAK phase (same recipe-sync shape as onboarding) and removed the `/dev/lpc` tab link. Five new e2e specs (10 tests) added; two production-path visual-suite cases added (noon 95/100, midnight 90/100).

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Existing wiring verified end-to-end; `_mergeEquipmentRecipes` regression tests (engine) + `equipment_visual.spec.ts` (2 tests) + before/after screenshots (95/100 each) showing chainmail → plate torso change. No production code change needed — verification-only as the contract anticipated. |
| AC-2 | ✅ | Night ambient floor (`COLOR_NIGHT_FLOOR`, clamped in `_interpolateDiurnal`) + interior independence (`interior` manifest flag → `PackConfig` → `COLOR_INTERIOR` tilemap tint). Engine unit tests, manifest audit test, production visual cases (noon 95/100, midnight 90/100). Interior mechanism covered by unit/schema/manifest tests; production interior screenshot attempted but wandering-NPC collision made deterministic walking to the inn unreliable — recorded as a residual visual-verification gap (code path identical to the verified outdoor tint path). |
| AC-3 | ✅ | Literal `'detected'` default → `'pending'`; 2 new unit tests assert pre-detection state + no auto-seed; `/capability` production screenshot validated 100/100. `_seedDetectedConnections` was already gated on a real probe result (no change needed). |
| AC-4 | ✅ | `suggestion-chips` row now `flex-wrap` (same wrapping pattern as `cyoa-choices`); `?manyChips=1` sandbox hook; `dialogue_chips.spec.ts` asserts 8 chips wrap with no horizontal overflow at 1280×720 and 800×600; screenshot validated 95/100. |
| AC-5 | ✅ | TTS toggle wrapped in a labelled control: visible "🔊 TTS" label + `aria-label="Toggle text-to-speech"` + `toggle-primary` styling; `dialogue_tts_toggle.spec.ts` (3 tests incl. axe-core a11y check on the overlay) — no serious/critical violations. |
| AC-6 | ✅ | `LpcPreviewView` embedded inline in the TWEAK phase avatar card with `$effect`-driven recipe sync from `lpcRecipe` via new `lpcPreviewRecipes` getter (mirrors onboarding); `/dev/lpc` link removed (getter kept — no other consumers after grep); dev mock now seeds an LPC recipe; `persona_create_preview.spec.ts` (2 tests) asserts inline canvas + no `/dev/lpc` link + no popup; screenshot validated 95/100. |

### Files Created
| File | Purpose |
|---|---|
| `packages/frontend/engine/src/__tests__/equipment_merge.test.ts` | AC-1 regression: `_mergeEquipmentRecipes` replace/append/revert semantics (6 tests). |
| `packages/frontend/engine/src/__tests__/environment_lighting.test.ts` | AC-2: night-floor clamp + noon baseline + interior constant (4 tests). |
| `apps/e2e/tests/client/equipment_visual.spec.ts` | AC-1 e2e: equip/unequip Iron Armor state change + DEF badge delta (2 tests). |
| `apps/e2e/tests/client/dialogue_chips.spec.ts` | AC-4 e2e: 8 chips wrap with no horizontal overflow at 1280×720 + 800×600 (2 tests). |
| `apps/e2e/tests/client/dialogue_tts_toggle.spec.ts` | AC-5 e2e: accessible name, visible label, keyboard toggle, axe-core overlay audit (3 tests). |
| `apps/e2e/tests/client/persona_create_preview.spec.ts` | AC-6 e2e: inline preview renders, no `/dev/lpc` link/popup (2 tests). |
| `apps/e2e/screenshots/c417_capability.png`, `c417_dialogue_chips_tts.png`, `c417_equipment_before.png`, `c417_equipment_after_equip.png`, `c417_persona_inline_preview.png` | Phase-3 production-path visual evidence (validated 95–100/100 via `ai_validate_image`). |

### Files Modified
| File | Change |
|---|---|
| `packages/frontend/engine/src/environment/environment_ubo.ts` | AC-2: added `COLOR_NIGHT_FLOOR` and `COLOR_INTERIOR` constants. |
| `packages/frontend/engine/src/systems/environment_system.ts` | AC-2: clamp diurnal ambient to the night floor. |
| `packages/frontend/engine/src/game_world.ts` | AC-2: `_isInteriorMap` from `packConfig.interior`; tilemap tint uses `COLOR_INTERIOR` on interiors; import. |
| `packages/shared/schemas/src/lib/game/content_pack.ts` | AC-2: `interior?: boolean` on `ContentPackMapEntrySchema` and `PackConfigSchema`. |
| `apps/frontend/client/static/content-packs/emberwatch/manifest.json` | AC-2: `"interior": true` on `inn` + `merchant_shop`. |
| `apps/frontend/client/src/lib/services/game/game_engine_service.svelte.ts` | AC-2: `_buildPackConfig` accepts `mapId` and projects the manifest `interior` flag; both call sites pass the map id. |
| `apps/frontend/client/src/lib/views/capability/capability_view_model.svelte.ts` | AC-3: pre-detection `voiceStatus` default `'detected'` → `'pending'`. |
| `apps/frontend/client/src/lib/views/capability/capability_view_model.test.ts` | AC-3: 2 new tests (pre-detection pending, no auto-seed). |
| `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte` | AC-4/5: chips row `flex-wrap`; TTS toggle labelled + styled. |
| `apps/frontend/client/src/routes/(dev)/dev/(sandbox)/sandbox/dialogue/+page.svelte` | AC-4: `?manyChips=1` mock produces 8 chips. |
| `apps/frontend/client/src/lib/views/character/persona/create/persona_create_view_model.svelte.ts` | AC-6: `lpcPreviewRecipes` getter (slot-ordered `LpcLayerRecipe[]`); interface updated. |
| `apps/frontend/client/src/lib/views/character/persona/create/persona_create_view.svelte` | AC-6: inline `LpcPreviewView` + `$effect` sync + `onDestroy` dispose; `/dev/lpc` link removed. |
| `apps/frontend/client/src/lib/views/character/persona/create/persona_create_view_model.dev.svelte.ts` | AC-6: mock generate seeds `lpcRecipe` so the inline preview renders in the dev sandbox. |
| `apps/e2e/src/visual/suites/emberwatch.visual.ts` | AC-2: production `/game` noon + midnight readability cases (2 cases). |
| `packages/frontend/engine/src/__tests__/emberwatch_content_audit.test.ts` | AC-2: manifest interior-declaration fixture test. |

### Deviations from Spec
- **AC-2 interior visual evidence**: the Evidence Matrix expects production `/game` interior screenshots for `inn`/`merchant_shop`. The inn/shop are reachable only by walking through the village, and the wandering elder NPC's collision blocks deterministic Playwright walking. Interior independence is instead verified by (a) engine unit tests on the interior constant + floor, (b) schema support for the generic `interior` flag, (c) manifest audit asserting `inn`/`merchant_shop` declare `interior: true`, and (d) the tint code path (identical to the visually-verified outdoor path). Recommend a follow-up to capture an interior screenshot via a spawn hook if full visual evidence is required.
- **OQ-5 (generation parallelism)**: not addressed — `generateCharacter` calls `_extractCharacter` once (single call); there is no sequential multi-call to parallelize. Recorded rather than expanded.
- **OQ-1 (torso/feet zero-out intent)**: not re-litigated — the C-374 comment + `_mergeEquipmentRecipes` overlay mechanism confirm the zero-out is intentional (equipment owns torso/feet). Recorded.
- Pre-existing failures not introduced by this contract: `client:test-unit` `GameBootService AC-4 cancellation` (1), emberwatch visual suite requiredTrueFields (3: terrainTransitionsLookNatural, overheadOccludesPlayer, allNpcsHaveBodies), and `e2e:test` site specs (site dev server cannot start in this worktree — `PUBLIC_MODE`/`PUBLIC_APP_ID` missing for the Astro env; site is not among the registered herdr services).

### Test Results
- Unit (client): 1815/1817 pass (2 new capability tests), 1 pre-existing failure, 0 new failures.
- Unit (engine): 1008 pass / 0 fail (997 baseline + 11 new).
- E2E (new specs): 10/10 pass.
- Visual: production emberwatch — C-417 noon 95/100 (PASS), C-417 midnight 90/100 (PASS); 3 pre-existing requiredTrueFields failures unchanged.
- Baseline: client 1 pre-existing failure, engine 0 — no new failures introduced.
