# Contract C-335: Enforce the Playable Demo Release Gate

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/TODO.md` § C-335 — Phase 1 — Playable, Polished, Offline-Capable Vertical Slice |
| **Target** | `apps/e2e/src/pom/game_page.ts` (new POM), `apps/e2e/tests/client/release_gate.spec.ts` (new spec), `apps/e2e/src/visual/suites/release_gate.visual.ts` (new visual suite), `apps/e2e/src/visual/suites/` (extend existing suites for production route), `apps/e2e/playwright.config.ts` (offline + keyboard project profiles), `apps/frontend/client/src/lib/services/campaign/` (QA bypass flag exposure) |
| **Priority** | P0 — Phase 1 is not complete until the real game flow proves it with one command |
| **Dependencies** | All Phase 1 items; C-011 (blackbox testing — completed), C-159 (demo happy-path E2E — completed), C-181–C-183 (visual testing framework — completed), C-217 (E2E stabilisation — not_started per PROGRESS.md), C-218 (E2E logic/UI resolution — not_started per PROGRESS.md), C-313 (campaign aggregate — implemented), C-314 (composition root — implemented), C-316 (Emberwatch pack — verified), C-320 (AI gateway — implemented), C-322 (capability detection — implemented), C-323 (text AI gate — implemented), C-325 (LPC preview — implemented), C-326 (game boot — implemented), C-327 (onboarding — implemented), C-328 (NPC dialogue — implemented), C-329 (demo quest — approved), C-330 (demo combat — approved), C-331 (inventory/equipment — approved), C-332 (game HUD — approved), C-334 (save/autosave — approved) |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal → none (release gate is CI infrastructure; no user-facing docs) |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: There is no single command that proves the production game flow works end-to-end. Tests exist piecemeal — boot (`game_boot.spec.ts`), canvas rendering (`game_page.spec.ts`), dialogue sandbox (`dialogue_fallback.spec.ts` skipped), combat sandbox (`combat_sandbox.spec.ts`), inventory (`inventory_pickup.spec.ts`) — but they test dev sandboxes or individual subsystems in isolation. No test validates the full cold-launch → setup → quest → check → combat/reward → save → reload production journey. The `C-159` "demo happy-path E2E" is marked completed but references pre-C-313 architecture. Visual suites (`game_boot.visual.ts`, `game_hud.visual.ts`, `combat.visual.ts`, `inventory.visual.ts`, `dialogue_fallback.visual.ts`) use dev sandbox routes (`/dev/combat`, `/dev/inventory`) rather than the production `/game` route. No test asserts that the AI capability gate blocks gameplay without a resolved text provider, or that a QA/CI bypass flag exists for deterministic testing. No test gates `WebGPU` vs `WebGL` coverage, no keyboard-only flow test, and no offline-with-local-model run.
- **Reproduction**:
  1. Run `bun moon run e2e:test-client` — see tests pass individually.
  2. Search for a single Playwright spec that navigates `/game`, interacts with an NPC, enters combat, receives a quest reward, opens inventory, and saves — none exists.
  3. Run `bun run src/visual/runner.ts` — visual suites all target dev sandboxes, not production `/game`.
  4. Try `grep -r "release.?gate\|phase.?1.?gate" apps/e2e/` — no results. There is no gate.
- **Existing implementation to reuse**:
  - `apps/e2e/src/pom/combat_page.ts` — Combat POM with `gotoDev()`, `gotoGame()`; extend for production combat flow.
  - `apps/e2e/src/pom/inventory_page.ts` — Inventory POM with `gotoGame()`, keyboard toggle, close-by-Escape.
  - `apps/e2e/src/pom/client_navigation.ts` — Navigation POM for drawer/app-bar interactions.
  - `apps/e2e/tests/client/game_boot.spec.ts` — Boot pipeline tests (`progress.progress-primary`, `#game-canvas-container canvas`, AC-4 re-entry).
  - `apps/e2e/tests/client/game_page.spec.ts` — Production `/game` page tests (canvas, UI layer, escape key, HP bar ARIA, focus trap).
  - `apps/e2e/tests/client/onboarding/appearance_persistence.spec.ts` — Onboarding flow navigation pattern (`navigateToAppearanceStep`).
  - `apps/e2e/src/visual/suites/` — 29 existing visual suites, all targeting dev sandboxes.
  - `apps/e2e/src/visual/runner.ts` — Bun-based CLI with `--capture-only`, `--suite=`, `--eval-only` flags.
  - `apps/e2e/playwright.config.ts` — Client + game + setup projects with WebGL flags, per-worker isolation, global setup/teardown.
  - `apps/e2e/.visual-cache.json` — SHA-256 cache for deterministic visual evaluation.
  - `apps/frontend/client/src/routes/game/+page.svelte` — Production route shell (`GameView` + `getGameViewModel`).
  - `apps/frontend/client/src/lib/views/game/game_view_model.svelte.ts` — GameViewModel owns composition root lifecycle.
  - C-323 contract `start_view_model._hasTextProvider()` hardening — existing gate enforcement that this contract must assert is functional.
- **Known gaps**:
  - No `GamePage` POM exists — the production game flow has no reusable page object model.
  - No production-route Playwright spec validates the full cold-launch-to-reload journey.
  - Visual suites all use dev sandboxes; none capture the production `/game` route with real content pack data.
  - No offline profile in Playwright config (network-offline-with-local-model run).
  - No keyboard-only test that verifies the entire flow without mouse/touch.
  - No WebGPU/WebGL coverage gating — `pixi_app.ts` renderer preference is not asserted in CI.
  - No console-error or network-error assertions in existing tests.
  - No deterministic engine replay test (snapshot + command log → same mechanical outcome).
  - The QA/CI bypass flag from C-323 (allowing testing without a live text AI model) is not documented in a shared constants file; its existence must be verified and exposed to the E2E harness via environment variable.
- **Baseline tests**:
  - `apps/e2e/tests/client/game_boot.spec.ts` — 3 tests (loading stage, re-entry, HUD visible) — all pass.
  - `apps/e2e/tests/client/game_page.spec.ts` — 7 tests (canvas, UI layer, loading overlay, escape key, HP bar ARIA, focus trap, focus restore) — all pass.
  - `apps/e2e/tests/client/combat_sandbox.spec.ts` — 7 tests (dev sandbox) — all pass.
  - `apps/e2e/tests/client/inventory_pickup.spec.ts` — 7 tests (production `/game` route) — all pass.
  - `apps/e2e/tests/client/onboarding/appearance_persistence.spec.ts` — 4 tests (production `/setup` route) — all pass.
  - `apps/e2e/tests/client/dialogue_fallback.spec.ts` — 3 tests, all `test.skip` — dialogue not tested on production route.
  - `apps/e2e/tests/client/onboarding_hints.spec.ts` — 5 tests (`/game/dev` sandbox) — all pass.
  - Visual runner: `bun moon run e2e:run-visual-tests` — 29 suites, dev sandbox routes only.

## User Outcome

After this contract, a developer can run one command (`bun moon run e2e:release-gate` or `bun run tests/client/release_gate.spec.ts`) that proves cold launch → setup → quest → check → combat or alternate resolution → reward → save → reload works on production routes. The gate runs in CI and blocks merges if any critical test fails. The gate asserts: no skipped critical tests, no missing artifacts, no uncaught console errors, no state divergence after reload, and no code path reaches gameplay without a resolved `AiProviderGateway` connection outside the documented QA/CI bypass flag.

## Success Measures

- **Time/latency target**: Full release gate suite completes in under 90s on CI hardware (emulator mode, WebGL software rasterization). Individual AC test cases complete in under 30s each.
- **Offline/degraded behavior**: An offline profile (`--project=client-offline`) runs the full production journey with network throttled to offline using a pre-cached local AI model (mock or real Ollama). The offline run fails if any test times out waiting for network. Authored dialogue fallbacks (C-328) must render when AI is unavailable — no error text, no blank state.
- **Production journey enabled**: The release gate is the ultimate Phase 1 acceptance test. When it passes, Phase 1 is proven complete. When it fails, the failure pinpoints the broken contract (via evidence links in the spec).

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Combat POM (dev sandbox) | `apps/e2e/src/pom/combat_page.ts` | Reuse — `gotoGame()`, `waitReady()`, action locators |
| Inventory POM (production) | `apps/e2e/src/pom/inventory_page.ts` | Reuse — `gotoGame()`, `toggle()`, `expectOpen()`, keyboard shortcuts |
| Navigation POM | `apps/e2e/src/pom/client_navigation.ts` | Reuse — drawer open/close, nav item click |
| Boot test patterns | `apps/e2e/tests/client/game_boot.spec.ts` | Reuse — progress bar assertion, canvas readiness pattern |
| Game page test patterns | `apps/e2e/tests/client/game_page.spec.ts` | Reuse — escape key, HP bar ARIA, focus trap assertions |
| Onboarding navigation | `apps/e2e/tests/client/onboarding/appearance_persistence.spec.ts` | Reuse — `navigateToAppearanceStep` pattern |
| Visual suite config | `apps/e2e/src/visual/suites/*.visual.ts` (29 suites) | Modify — add production-route cases to existing suites, create new release_gate.visual.ts |
| Visual runner CLI | `apps/e2e/src/visual/runner.ts` | Reuse — `--capture-only`, `--suite=` flags |
| Playwright config | `apps/e2e/playwright.config.ts` | Modify — add `client-offline` and `client-keyboard` projects |
| Visual cache | `apps/e2e/.visual-cache.json` | Reuse — SHA-256 hash cache for deterministic eval |
| Production game route | `apps/frontend/client/src/routes/game/+page.svelte` | Reuse — target for all production-route tests |
| GameViewModel | `apps/frontend/client/src/lib/views/game/game_view_model.svelte.ts` | Reuse — composition root lifecycle |
| AI capability gate | `apps/frontend/client/src/lib/services/campaign/campaign_service.svelte.ts` (C-323) | Reuse — assert gate blocks gameplay without text provider |
| QA bypass flag | `packages/shared/constants/src/` (to verify/create) | Modify — expose documented `PUBLIC_QA_BYPASS_TEXT_AI` flag |

## Overview

This contract builds the single Phase 1 release gate: a comprehensive E2E spec, dedicated POM, production-route visual suites, and CI enforcement that together prove cold launch → setup → quest → combat → reward → save → reload works on production routes. It adds offline and keyboard-only Playwright profiles, console/network error assertions, an engine replay fixture, and an explicit assertion that the AI capability gate blocks gameplay without a resolved text provider. When the gate passes, Phase 1 is verified. When it fails, the failure pinpoints the broken contract.

## Design Reference

- **POM pattern**: Follow `apps/e2e/src/pom/combat_page.ts` — constructor with `page`, getter-based locators, async action methods with `await import('@playwright/test')` for lazy `expect` imports. Export from `apps/e2e/src/pom/index.ts` barrel.
- **E2E spec pattern**: Follow `apps/e2e/tests/client/game_boot.spec.ts` — `test.describe` per contract, `test('AC-N: description')`, shared `test.beforeEach` with `page.goto('/game')`.
- **Visual suite pattern**: Follow `apps/e2e/src/visual/suites/game_boot.visual.ts` — TypeBox schema, `defineConfig` with `id`, `route`, `waitCondition`, `cases[]` entries with `name`, `prompt`, `schema`.
- **Playwright config**: Extend existing `projects[]` in `playwright.config.ts` — add profiles with specific `use.launchOptions.args` and `contextOptions`.
- **Engine replay**: C-336 will build the deterministic rules kernel; this contract creates the fixture/harness so the replay test exists as infrastructure. The replay fixture records command logs during the gate run and asserts mechanical outcome equality.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **E2E POM**: New `GamePage` POM in `apps/e2e/src/pom/game_page.ts` — encapsulates production `/game` route interactions: NPC interaction, quest acceptance, combat trigger, inventory open/close, save trigger, reload/continue.
- **E2E spec**: New `apps/e2e/tests/client/release_gate.spec.ts` — the single command that validates the full Phase 1 flow. Each AC section corresponds to a production journey segment.
- **Visual suites**: Extend existing suites (`combat.visual.ts`, `inventory.visual.ts`, `game_hud.visual.ts`, `dialogue_fallback.visual.ts`) with production-route cases. Add new `release_gate.visual.ts` for full-journey screenshot checkpoints.
- **Playwright config**: Add `client-offline` project (network throttled, local AI mock), `client-keyboard` project (no mouse/touch, keyboard-only assertions).
- **Engine replay fixture**: New `apps/e2e/src/fixtures/engine_replay.ts` — records command logs during gate run, replays in Bun test runtime with seeded RNG for deterministic mechanical outcome assertion.
- **QA bypass flag**: Verify and document `PUBLIC_QA_BYPASS_TEXT_AI` in `packages/shared/constants/src/lib/feature_flags.ts` (or the existing constants file). Expose to Playwright via `use.contextOptions` or global setup.
- **Console/network assertions**: Add `page.on('console')` and `page.on('pageerror')` listeners to the gate spec that collect errors and assert zero at test teardown. Add `page.route()` network failure injection for offline tests.

## State & Data Models

No new persistent data shapes. The gate operates on existing state:

```typescript
// apps/e2e/src/pom/game_page.ts — GamePage POM interface

type GamePageOptions = {
  /** Whether to use the QA bypass flag to skip text AI requirement */
  bypassTextAi?: boolean;
};

type GameJourneyCheckpoint = {
  /** Human-readable label for the checkpoint (e.g. 'post-combat-reward') */
  label: string;
  /** Route path at this checkpoint */
  route: string;
  /** Expected game mode at this checkpoint */
  expectedMode: 'explore' | 'combat' | 'dialogue' | 'menu';
};
```

```typescript
// Release gate test results shape (used in visual suite schema)
import { Type, type Static } from '@sinclair/typebox';

export const ReleaseGateResultSchema = Type.Object({
  score: Type.Number({ description: '0-100 overall gate quality score' }),
  bootCompleted: Type.Boolean({ description: 'Game booted to playing state' }),
  npcDialogueRendered: Type.Boolean({ description: 'NPC dialogue overlay visible with authored text' }),
  combatTriggered: Type.Boolean({ description: 'Combat UI visible with HP bars and action buttons' }),
  questRewardReceived: Type.Boolean({ description: 'Quest reward notification or inventory item added' }),
  inventoryAccessible: Type.Boolean({ description: 'Inventory overlay opens with items listed' }),
  saveIndicatorVisible: Type.Boolean({ description: 'Autosave indicator or save confirmation visible' }),
  issues: Type.Array(Type.String(), { description: 'List of visual issues detected' }),
});

export type ReleaseGateResult = Static<typeof ReleaseGateResultSchema>;
```

```typescript
// Engine replay fixture shape
type EngineReplaySnapshot = {
  /** Seed used for the RNG during the recorded run */
  seed: number;
  /** Ordered command log from the production gate run */
  commands: Array<{
    type: string;
    payload: Record<string, unknown>;
    timestamp: number;
  }>;
  /** Final mechanical snapshot (positions, HP, inventory, quest flags) */
  finalSnapshot: Record<string, unknown>;
};
```

## Quality Requirements

- **Offline/degraded mode**: ✅ Gate must run in `client-offline` profile with network throttled to offline, using pre-cached local AI model mock. Authored dialogue fallbacks (C-328) must render without network. The local text model runs in a local Ollama instance managed by the E2E harness.
- **Accessibility/input**: ✅ Gate must run in `client-keyboard` profile — the entire cold-launch-to-reload journey must be navigable with keyboard only (Tab, Enter, Escape, I, arrow keys). Focus trap assertions from `game_page.spec.ts` must be extended to cover all overlay states during the journey.
- **Performance budget**: ✅ Boot to `playing` state under 5s cold, under 3s warm (C-326 budget). Visual runner total capture under 60s. Full gate suite under 90s CI wall-clock. Console must contain zero errors (filtered: ResizeObserver, known benign PixiJS warnings). Memory: no leaks across save/reload cycle (no detached DOM nodes > 50 after reload).
- **Security/privacy**: N/A — the gate is a test harness with no user-facing surface. However, the QA bypass flag (`PUBLIC_QA_BYPASS_TEXT_AI`) must never be true in production builds — assert this in the gate's CI configuration.
- **Persistence/migration**: ✅ Gate must assert state survival across `page.reload()` — campaign state, inventory, quest progress, and player position must be identical before and after reload. Save slot metadata (C-334) must be readable after reload.
- **Cancellation/retry/idempotency**: ✅ Gate must assert game boot idempotency — navigate away mid-boot and re-enter (C-326 AC-4 pattern). Save operations must be idempotent — saving twice with the same state produces identical save data.
- **Observability**: ✅ Gate must collect and assert: zero `console.error` calls (filtered), zero uncaught `pageerror` events, zero failed network requests (beyond intentional offline tests). Gate report must link each failure to the responsible contract.

## Migration & Rollback

N/A — no persistent state changes. The gate is entirely additive test infrastructure. It does not modify any production code, save schemas, or routing. If the gate is removed, all existing tests continue to function independently.

## Scope Boundaries

- **In Scope:**
  - New `GamePage` POM (`apps/e2e/src/pom/game_page.ts`) with production-route locomotion, NPC interaction, quest acceptance, combat trigger, inventory, save, and reload primitives.
  - New `release_gate.spec.ts` — the single Playwright spec that proves cold launch → setup → quest → check → combat/reward → save → reload on production routes.
  - Extend existing visual suites (`combat.visual.ts`, `inventory.visual.ts`, `game_hud.visual.ts`, `dialogue_fallback.visual.ts`) with production-route cases.
  - New `release_gate.visual.ts` — full-journey screenshot checkpoints captured on the production `/game` route.
  - Add `client-offline` Playwright project with network throttling and local AI mock.
  - Add `client-keyboard` Playwright project with keyboard-only navigation assertions.
  - Engine replay fixture (`apps/e2e/src/fixtures/engine_replay.ts`) — record/replay command logs for deterministic mechanical outcome.
  - Console/network error collection and zero-error assertion in every gate test.
  - AI capability gate assertion: verify that `campaign_service.startNewCampaign()` rejects when `textProvider === false` (C-323 enforcement).
  - QA bypass flag documentation and exposure: verify `PUBLIC_QA_BYPASS_TEXT_AI` exists in constants, pipe to Playwright via env.
  - CI integration: `bun moon run e2e:release-gate` moon task in `apps/e2e/moon.yml`.
  - Evidence matrix linking each gate failure to the responsible contract.
- **Out of Scope:**
  - Implementing any Phase 1 feature — the gate only tests what already exists.
  - Fixing bugs found by the gate — file separate bug-fix contracts.
  - Building the deterministic rules kernel (C-336) — only create the replay fixture infrastructure.
  - Creating new visual test framework features — use existing `defineConfig` + TypeBox pattern.
  - Modifying production game code beyond exposing the QA bypass flag (if missing).
  - Modifying the visual runner CLI — reuse existing `--suite=` and `--capture-only` flags.
  - Adding new dependencies to any package — gate is pure E2E infrastructure.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:**
- AC count: 8 (under 10 limit) — acceptable.
- Projects affected: 2 (`apps/e2e`, `packages/shared/constants`) — acceptable.
- Single releasable system (the release gate itself) — no split needed.

This contract is a monolithic gate by design — splitting would defeat the purpose of "one command proves Phase 1."

## Acceptance Criteria

### AC-1: Full Cold-Launch Production Journey (Happy Path)
**Given** a clean emulator profile with no prior campaign state and the QA bypass flag enabled (`PUBLIC_QA_BYPASS_TEXT_AI=true`),
**When** the release gate spec navigates from cold launch through `/` → start menu → `/setup` (character onboarding) → `/game` (boot to playing) → NPC dialogue interaction → quest acceptance → combat trigger → combat resolution → quest reward → inventory check → manual save → page reload → continue campaign,
**Then** the game canvas renders, the HUD is visible at every stage, the player position is preserved across reload, inventory contains the quest reward item, and the quest journal reflects completion.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | E2E | `apps/e2e/tests/client/release_gate.spec.ts` — `test('AC-1: full cold-launch to reload journey')` | `/` → `/setup` → `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run e2e:release-gate -- --grep "AC-1"`
- Integration: Run against emulator with clean Firestore — all worker projects purged via `global_setup.ts`.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/release_gate.spec.ts` — one test case covering the full flow. Uses `GamePage` POM for `/game` interactions, `ClientNavigation` POM for start-menu navigation, the onboarding flow pattern from `appearance_persistence.spec.ts` for `/setup`.
    - **Visual**: `suites/release_gate.visual.ts` — declarative cases at key checkpoints: `after-boot` (HUD visible, map rendered), `during-dialogue` (dialogue overlay, NPC name, 2-4 choices), `during-combat` (HP bars, action buttons, combat log), `post-reward` (inventory with new item, quest journal updated). Score 85+: all required elements visible at each checkpoint.

**Watch Points**:
- The full-flow test is fragile by nature — if any intermediate contract is broken, the gate fails. Pinpoint the broken contract via the evidence link.
- Onboarding step navigation (`/setup` → starter_select → identity → play_style → appearance) must be deterministic — use `page.locator` with text-based selectors, not index-based.
- Combat trigger timing is non-deterministic (PixiJS render loop). Use `waitForSelector` with generous timeouts (15s).

### AC-2: Offline Production Journey with Local AI
**Given** a clean emulator profile with the QA bypass flag disabled and a pre-configured local Ollama instance serving the text AI model,
**When** the `client-offline` Playwright profile runs the full production journey with network throttled to offline,
**Then** the game boots without network access, NPC dialogue renders authored fallback text (no raw error strings, no blank state), combat resolves with deterministic mechanics, and the save/reload cycle completes without network-dependent operations.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | E2E | `apps/e2e/tests/client/release_gate.spec.ts` — `test('AC-2: offline journey with local AI')` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run e2e:release-gate -- --grep "AC-2" --project=client-offline`
- Integration: Requires local Ollama instance running. The E2E harness starts/stops Ollama via `global_setup.ts` hooks. If Ollama is unavailable, the test is skipped with a clear message (not a failure).
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/release_gate.spec.ts` — offline profile with `page.route('**/*', route => route.abort())` for all external domains, except localhost AI microservice ports. Asserts dialogue fallback renders (C-328 AC-1), combat resolves, and save completes.
    - **Visual**: `suites/dialogue_fallback.visual.ts` — extend existing suite with a production-route case (`route: '/game'`, `waitCondition: 'game_ready'`). Score 85+: dialogue visible, 2-4 choices, no error text.

**Watch Points**:
- Ollama availability in CI is a known limitation. The offline test may be `test.skip` with a `TEST_REQUIRES_OLLAMA` guard in CI until CI hardware supports local models.
- Network throttling must allow `localhost:*` connections (for the client dev server itself and the local AI services).

### AC-3: Keyboard-Only Production Journey
**Given** a clean emulator profile with QA bypass enabled,
**When** the `client-keyboard` Playwright profile runs the full production journey using only keyboard inputs (Tab, Enter, Escape, I, arrow keys, Space),
**Then** every interactive element is reachable via Tab, focus is never lost to the document body, overlays trap focus correctly, and the full flow completes without any `page.mouse` or `page.touch` calls.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | E2E | `apps/e2e/tests/client/release_gate.spec.ts` — `test('AC-3: keyboard-only journey')` | `/` → `/setup` → `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run e2e:release-gate -- --grep "AC-3" --project=client-keyboard`
- Integration: Run in `client-keyboard` project — no mouse, no touch. Assert focus trap in every overlay (pause menu, dialogue, combat, inventory, quest journal).
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/release_gate.spec.ts` — keyboard-only flow using `page.keyboard.press('Tab')`, `page.keyboard.press('Enter')`, `page.keyboard.press('Escape')`, `page.keyboard.press('KeyI')`, `page.keyboard.press('ArrowLeft')` etc. Asserts `document.activeElement` is never `document.body` during interactive sequences.
    - **Visual**: N/A — keyboard-only is functional, not visual.

**Watch Points**:
- Focus management after combat resolution — verify focus returns to the game canvas, not a random overlay element.
- Inventory toggle via `I` must not conflict with any text input fields during onboarding.

### AC-4: AI Capability Gate Enforcement
**Given** a clean emulator profile with no AI provider configured and the QA bypass flag set to `false`,
**When** the gate spec attempts to navigate from the start menu to a new campaign,
**Then** `campaign_service.startNewCampaign()` rejects or the capability screen blocks progression with a visible message, and no production route reaches the `playing` game state.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | E2E | `apps/e2e/tests/client/release_gate.spec.ts` — `test('AC-4: AI capability gate blocks AI-less play')` | `/` → capability screen | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run e2e:release-gate -- --grep "AC-4"`
- Integration: Clear all AI configuration (no API keys, no local model detected). Assert the capability screen shows a clear message about missing text AI. Assert that clicking "New Game" from the start menu does not reach `/setup`.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/release_gate.spec.ts` — test that navigates to `/`, clears AI config, and asserts the capability screen renders without an "Offline Demo" button (C-323). Asserts the start menu redirects to capability resolution.
    - **Visual**: N/A — gate enforcement is behavioral, not visual.

**Watch Points**:
- The QA bypass flag (`PUBLIC_QA_BYPASS_TEXT_AI`) must be verified as `false` for this test. The gate spec must set it explicitly per-test.
- If the bypass flag does not yet exist in `packages/shared/constants/`, this AC includes adding it as a documented escape hatch.

### AC-5: Console and Network Error Assertions
**Given** the full production journey test (AC-1) is running,
**When** the gate spec collects all `console.error`, `pageerror`, and failed network requests during the run,
**Then** at test teardown, the collected error lists are empty (filtered: known benign PixiJS warnings, ResizeObserver loop errors, fetch aborts from navigation).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | E2E | `apps/e2e/tests/client/release_gate.spec.ts` — error collection in `test.beforeEach` / `test.afterEach` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run e2e:release-gate -- --grep "AC-1"` (error assertions are embedded in every AC-1 run)
- Integration: Error collection is automatic — every gate test registers `page.on('console')` and `page.on('pageerror')` in `test.beforeEach` and asserts zero errors in `test.afterEach`.
- E2E / Visual: N/A — error assertions are functional, not visual.

**Watch Points**:
- The error filter list must be maintained as new benign errors are discovered. Document the filter in the POM or a shared `error_allowlist.ts`.
- `fetch` aborts during navigation (page.goto mid-flight) must be filtered — they are intentional, not failures.

### AC-6: State Survival Across Reload
**Given** the production journey has reached post-reward state (quest completed, inventory has reward item, player at known position),
**When** the gate spec triggers `page.reload()` and verifies state after re-boot,
**Then** the player position is within 1 tile of the pre-reload position, the inventory contains exactly the same items (same count, same ids), the quest journal shows the completed quest, and the HUD shows consistent HP/status values.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | E2E | `apps/e2e/tests/client/release_gate.spec.ts` — `test('AC-6: state survival across reload')` | `/game` → reload → `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run e2e:release-gate -- --grep "AC-6"`
- Integration: Part of the AC-1 flow — the reload step in AC-1 validates this. Separate test for focused debugging.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/release_gate.spec.ts` — snapshot state before reload (`page.evaluate` to read game state), reload, snapshot after, deep-equal comparison.
    - **Visual**: N/A — state consistency is data-driven, not visual.

**Watch Points**:
- Auto-save timing: the test must explicitly trigger a manual save before reload to ensure the save slot exists. Auto-save may not have fired yet.
- Position comparison tolerance: 1 tile (~16px at default zoom) to account for floating-point drift across reload.

### AC-7: Visual Checkpoint Snapshots on Production Routes
**Given** the `release_gate.visual.ts` suite targeting the production `/game` route,
**When** the visual runner captures screenshots at each journey checkpoint (boot complete, dialogue, combat, post-reward HUD, inventory open),
**Then** AI evaluation scores each checkpoint ≥ 85/100 with no missing critical elements (no missing HP bar, no overflowing inventory cards, no un-styled text).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-7 | Visual | `apps/e2e/src/visual/suites/release_gate.visual.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run e2e:run-visual-tests -- --suite=release-gate`
- Integration: Requires client dev server running. `--capture-only` for local capture; full run requires `OPENROUTER_API_KEY`.
- E2E / Visual:
    - **Functional**: N/A — visual-only.
    - **Visual**: `suites/release_gate.visual.ts` — uses `defineConfig` with `route: '/game'`, `waitCondition: 'game_ready'`. Cases: `boot-complete`, `hud-visible`, `dialogue-active`, `combat-active`, `inventory-open`. TypeBox schema: `ReleaseGateResultSchema` (defined above). AI prompt: "Score 85+: All gameplay HUD zones visible, no element overlap, dialogue overlay shows NPC name and 2-4 choices, combat shows HP bars and action buttons, inventory shows item cards without overflow."

**Watch Points**:
- Production-route visual tests require the game to be in a specific state (NPC nearby, combat triggerable). Use `setupHook` to interact with the game before capture, or use query params to skip to known game states.
- The visual runner captures sequentially to protect the WebGL context — long setup hooks increase total suite time.

### AC-8: Engine Replay Determinism
**Given** a recorded command log from the AC-1 production journey run,
**When** the engine replay fixture replays those commands with the same RNG seed in a Bun test runtime,
**Then** the final mechanical snapshot (player position, HP, inventory items, quest flags, NPC positions) matches the original run's final snapshot exactly.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-8 | Integration | `apps/e2e/src/fixtures/engine_replay.ts` + Bun test in `apps/e2e/tests/` | N/A (Bun runtime) | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run e2e:test -- --grep "engine-replay"` (Bun test, not Playwright)
- Integration: The replay fixture is a Bun test (`apps/e2e/tests/engine_replay.test.ts`) that imports the recorded command log from a test artifact, seeds the RNG, and runs the commands through the game engine in headless mode.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/engine_replay.test.ts` — Bun test using the game engine's deterministic rules. The command log is generated by instrumenting the AC-1 Playwright test to emit typed commands to a JSON file.
    - **Visual**: N/A — replay is data-driven.

**Watch Points**:
- The engine replay fixture depends on C-336 (deterministic rules kernel) — until C-336 is implemented, this fixture records commands but cannot assert mechanical equality. The fixture is infrastructure; the assertion is marked `test.skip` with a reference to C-336 until that contract is implemented.
- RNG seeding: the replay fixture must use the same seed as the recorded run. Extract the seed from the campaign's boot state.

## Implementation Sequence

1. **Phase 1 (POM + Gate Scaffold)**: Build `GamePage` POM with production-route primitives. Build `release_gate.spec.ts` skeleton with all AC test stubs. Add `client-offline` and `client-keyboard` Playwright projects. Expose/document QA bypass flag in constants. Wire console/network error collection.
2. **Phase 2 (Visual + Replay)**: Extend existing visual suites with production-route cases. Build `release_gate.visual.ts` with journey checkpoints. Build engine replay fixture (`engine_replay.ts`) with command recording and Bun test harness.
3. **Phase 3 (CI + Enforcement)**: Add `release-gate` moon task. Integrate into CI pipeline. Run full gate against emulator. File bug-fix contracts for any failures. Mark gate as blocking for Phase 2 entry.

## Edge Cases & Gotchas

- **Missing dependencies (C-329–C-334 approved, not implemented)**: The gate will fail for ACs that depend on unimplemented contracts. Each failure links to the responsible contract. The gate is useful even before all deps are implemented — it becomes a live dashboard of Phase 1 completion.
- **Ollama availability in CI**: AC-2 (offline with local AI) requires a running Ollama instance. Mark as `test.skip` in CI with `TEST_REQUIRES_OLLAMA` guard. The gate must still pass without AC-2 in CI; AC-2 is verified in a separate manual run.
- **WebGPU vs WebGL**: The gate runs in CI with WebGL software rasterization (`--use-gl=angle`, `--use-angle=gl`). WebGPU coverage is a manual test on hardware with `--use-angle=swiftshader` or a real GPU. Add a `client-webgpu` project for manual opt-in.
- **Visual test flakiness**: Production-route visual tests require the game to reach a specific state deterministically. Use `setupHook` interactions (keyboard inputs via Playwright) to reach the desired state before capture. If the game state is non-deterministic (NPC movement), add a "freeze" query param for visual testing (extending C-217's test mode pattern).
- **QA bypass flag in production**: The gate must assert that `PUBLIC_QA_BYPASS_TEXT_AI` is `false` (or absent) in production builds. This is a build-time assertion, not a runtime one — check `.env.production` or the resolved config.
- **Save format changes**: If the save format changes (C-334), the reload test (AC-6) must be updated to match the new shape. The gate is coupled to the save format by design.

## Open Questions

Must be resolved before status becomes `approved`:

- **Q1**: Does `PUBLIC_QA_BYPASS_TEXT_AI` already exist in `packages/shared/constants/`? If not, what is the exact key name and where should it live? (Verification needed during Phase 1.)
- **Q2**: Is the local Ollama model deterministic enough for AC-2? Different Ollama versions may produce different text for the same prompt. Should the offline test assert specific text, or only that text is present (non-empty, no error markers)?
- **Q3**: Should the engine replay fixture (AC-8) be in `apps/e2e/tests/` (run with Bun test) or `apps/frontend/client/src/lib/` (run with client unit tests)? The fixture needs access to the engine package but not the browser.
- **Q4**: Should the release gate run on every CI push, or only on PRs targeting `main`? Full gate takes ~90s — may be too slow for every push.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
