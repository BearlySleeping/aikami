# Contract C-323: Enforce the Mandatory Text AI Capability Gate

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/TODO.md` § C-323 — Phase 1 — Playable, Polished, Offline-Capable Vertical Slice |
| **Target** | `apps/frontend/client/src/lib/views/start/start_view_model.svelte.ts`, `apps/frontend/client/src/lib/views/capability/capability_view_model.svelte.ts`, `apps/frontend/client/src/lib/views/capability/capability_view.svelte`, `apps/frontend/client/src/lib/services/campaign/campaign_service.svelte.ts`, `apps/frontend/client/src/lib/services/capability/capability_service.svelte.ts`, `packages/shared/types/src/lib/game/campaign.ts` |
| **Priority** | P0 — codifies the vision change: a campaign without a resolved text AI engine is not a supported product state. This contract is the product-policy counterpart to the C-320 technical gateway. |
| **Dependencies** | C-320 (`implemented` — `AiProviderGateway` + `packages/frontend/ai-gateway` exist), C-322 (`implemented` — capability detection rewired through gateway), C-318 (`implemented` — capability screen + offline demo path exist; this contract removes the offline demo as a player-facing option), C-313 (`implemented` — Campaign aggregate + boot state machine) |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal → none (gate enforcement is invisible to documentation pages; player-facing text changes are UI labels) |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: The capability screen (`capability_view_model.svelte.ts` + `capability_view.svelte`) exposes three player-facing paths: Play Offline Demo, Use Detected Local AI, and Connect Cloud AI. "Play Offline Demo" is always available — it calls `_startCampaign({ textProvider: false, imageProvider: false, voiceProvider: false })`, creating a campaign with zero AI. This violates the product's Non-Negotiable Directive #3: "a campaign with zero text AI capability … is removed as a supported state." The start menu (`start_view_model.svelte.ts`) has a `_hasTextProvider()` gate that shows a "Missing Providers" dialog when no text provider is configured, but the dialog navigates to settings rather than blocking progression — it is an advisory nudge, not a hard enforcement. The `campaign_service.startNewCampaign()` accepts any `CapabilityProfile` (including `textProvider: false`) with zero validation.
- **Reproduction**:
  1. Cold launch Aikami with no AI configuration.
  2. Observe the capability screen: "Play Offline Demo" button is rendered as `btn-primary` (visually dominant).
  3. Click "Play Offline Demo" — a campaign is created with `capabilityProfile.textProvider: false` and the player proceeds to character onboarding (`/setup`).
  4. From the start menu: click "New Game" with no text provider configured — a "Missing Providers" dialog appears but only navigates to settings; nothing prevents returning to the start menu and retrying.
- **Existing implementation to reuse**:
  - `apps/frontend/client/src/lib/services/campaign/campaign_service.svelte.ts` — `startNewCampaign()` + `buildCapabilityProfile()` — the gate must be enforced here as the single creation bottleneck.
  - `apps/frontend/client/src/lib/views/start/start_view_model.svelte.ts` — `_hasTextProvider()` check (lines 180-194) — to be hardened into a blocking gate, not an advisory dialog.
  - `apps/frontend/client/src/lib/views/capability/capability_view_model.svelte.ts` — `selectOfflineDemo()` method (line 190) + `_startCampaign()` (line 253) — offline path to remove, local/cloud paths to keep.
  - `apps/frontend/client/src/lib/views/capability/capability_view.svelte` — Offline Demo button (line 56-65) — to remove.
  - `apps/frontend/client/src/lib/services/capability/capability_service.svelte.ts` — summary strings referencing "offline demo" (lines 143, 152, 177) — to rephrase.
  - `packages/shared/types/src/lib/game/campaign.ts` — `CapabilityProfile` type — shape is unchanged; the constraint is enforced at creation, not in the type.
- **Known gaps**:
  - No code currently enforces `textProvider === true` at campaign creation time.
  - The "Play Offline Demo" path is a first-class player option, not a hidden debug flag.
  - `_startCampaign()` in `capability_view_model` mutates `capabilityProfile` after creation (post-hoc assignment to `campaignService.activeCampaign.capabilityProfile`) — the profile should be set during creation, not patched afterward.
  - No QA/CI bypass mechanism exists for deterministic testing without a live model.
- **Baseline tests**:
  - `apps/frontend/client/src/lib/views/capability/capability_view_model.test.ts` — AC-2 tests `selectOfflineDemo()`; must be updated/removed.
  - `apps/frontend/client/src/lib/services/capability/capability_service.test.ts` — assertions on "offline demo" summary text; must be updated.
  - `apps/frontend/client/src/lib/services/campaign/campaign_service.test.ts` — covers `startNewCampaign()`; must add gate-rejection test.

## User Outcome

After this contract, a player cannot create or enter a campaign without a resolved text AI engine. The product no longer offers "Play Offline Demo" as a menu option. If no text AI is detected or configured, the player is guided to resolution (connect local AI or configure a cloud provider) before character onboarding is reachable. QA/CI pipelines retain deterministic access to authored-fallback dialogue via a documented bypass flag that never ships in production builds.

## Success Measures

- **Time/latency target**: Gate check is a synchronous boolean read (`capabilityProfile.textProvider === true`) or a pre-resolved gateway call — added latency is <1ms.
- **Offline/degraded behavior**: Without a resolved text engine, the player is blocked at the capability screen (or routed to it from the start menu) with a clear message and actionable steps. Image and voice remain optional and un-gated. Mid-session AI failures use authored fallback text (C-318's per-feature degradation policy), not a "disable AI" toggle, and are out of scope for this contract.
- **Production journey enabled**: Every path from cold launch to gameplay passes through exactly one text-AI-resolution checkpoint. The authored "Emberwatch" demo adventure (C-316) cannot be played without text AI — by design.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Campaign creation gate | `campaign_service.startNewCampaign()` | Modify — add `textProvider === true` precondition |
| Start menu provider check | `start_view_model._hasTextProvider()` | Modify — harden to blocking, reroute to capability screen |
| Offline demo path (to remove) | `capability_view_model.selectOfflineDemo()` | Replace — remove method, remove view button |
| Offline demo button (to remove) | `capability_view.svelte` lines 56-65 | Replace — remove button block |
| Capability profile type | `packages/shared/types/src/lib/game/campaign.ts` | Reuse — no schema change |
| Gateway detection | `aiGatewayService.detect()` via C-320/C-322 | Reuse — gate queries gateway for text resolution status |
| QA/CI bypass flag | New — no existing pattern | New — env-var-based flag pattern |
| Connection editor panel | `connection_editor_panel.svelte` via `cloudConnectionVm` | Reuse — stays as the guided cloud setup path |

## Overview

Enforce the mandatory text AI capability gate across every campaign-creation and campaign-resume code path. Remove the "Play Offline Demo" player-facing option. Replace advisory "Missing Providers" dialogs with hard routing to the capability screen (which now lacks an offline escape hatch). Add a narrow, clearly-labeled QA/CI bypass so deterministic tests can exercise authored fallback dialogue without a live model.

## Design Reference

- **Gate pattern**: Single precondition check at `startNewCampaign()` — throws a typed `AiTextProviderRequiredError` if `capabilityProfile.textProvider` is `false` or if no text provider is resolved via the gateway.
- **Start menu routing**: `startNewGame()` and `continueGame()` call `_resolveTextProvider()` which queries `aiGatewayService.resolveMode('text')` (C-320). On failure, the player is routed to the capability screen (not a dismissible dialog) with a reason parameter.
- **Capability screen**: Remove `selectOfflineDemo()`, "Play Offline Demo" button, and offline-demo summary text. The only paths are Local AI and Cloud AI. If neither is available, the player sees actionable guidance (install Ollama, add a cloud key) but no "skip" button.
- **QA/CI bypass**: Check `PUBLIC_AI_GATE_BYPASS` env var (Vite `import.meta.env.PUBLIC_AI_GATE_BYPASS`) or `window.__AIKAMI_AI_GATE_BYPASS__`. When set and truthy, the gate is skipped and campaigns can be created with `textProvider: false`. The env var must not exist in any `.env.production` or `.env.staging` file — it is set only in `.env.emulator` for CI/E2E. The bypass flag is documented in the implementation notes of this contract and in C-318's execution notes.
- See `.pi/skills/svelte-conventions/SKILL.md` for ViewModel/View patterns; `.pi/skills/aikami-conventions/SKILL.md` for TypeScript rules.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Capability ViewModel** (`apps/frontend/client/src/lib/views/capability/`): Remove `selectOfflineDemo()` method and `CapabilityViewModelInterface.selectOfflineDemo`. Keep `selectLocalAi()` and `selectCloudConnection()`. Remove the `Offline Demo` path's `_startCampaign` call that passes `textProvider: false`.
- **Capability View** (`apps/frontend/client/src/lib/views/capability/capability_view.svelte`): Remove the "Play Offline Demo" button block (lines 56-65). The view must show a clear message when no AI path is available, with instructions to install Ollama or configure a cloud connection. No "skip" or "demo" button.
- **Start ViewModel** (`apps/frontend/client/src/lib/views/start/start_view_model.svelte.ts`): Replace the dismissible `MissingProvidersDialog` with hard routing to the capability screen when no text provider is resolved. Remove `showMissingProvidersDialog` state field and associated methods. Add `_resolveTextProvider()` that calls `aiGatewayService.resolveMode('text')` (imported via `$services`) and returns `true` only when a text engine is confirmed available.
- **Campaign Service** (`apps/frontend/client/src/lib/services/campaign/campaign_service.svelte.ts`): In `startNewCampaign()`, before creating the campaign, call `buildCapabilityProfile()` and throw `AiTextProviderRequiredError` (a new error class in `packages/shared/utils`) if `textProvider` is `false` AND the QA/CI bypass is not active. Accept an optional `capabilityProfile` override in `startNewCampaign()` options so the capability screen can pass the resolved profile.
- **Capability Service** (`apps/frontend/client/src/lib/services/capability/capability_service.svelte.ts`): Replace "offline demo available" in summary strings (lines 143, 152, 177) with guidance text: "No text AI detected — install Ollama or add a cloud provider."
- **Shared types** (`packages/shared/types/`): No schema change to `CapabilityProfile` — the enforcement is at the service layer, not in the schema. Add `AiTextProviderRequiredError` type export.
- **Shared utils** (`packages/shared/utils/`): Add `AiTextProviderRequiredError` class extending `AppError` with code `'text-provider-required'`.

## State & Data Models

Existing schema (unchanged — enforcement is at the service layer, not in data shape):

```typescript
// packages/shared/schemas/src/lib/game/campaign.ts (existing, unchanged)
export const CapabilityProfileSchema = Type.Object({
  textProvider: Type.Boolean({ description: 'Whether a text AI provider is available' }),
  imageProvider: Type.Boolean({ description: 'Whether an image AI provider is available' }),
  voiceProvider: Type.Boolean({ description: 'Whether a voice AI provider is available' }),
});

export type CapabilityProfile = Static<typeof CapabilityProfileSchema>;
```

New error type:

```typescript
// packages/shared/utils/src/lib/errors.ts (new file — add barrel export to packages/shared/utils/src/index.ts)
export type AiTextProviderRequiredError = AppError & {
  readonly code: 'text-provider-required';
};
```

QA/CI bypass mechanism (no persistent state — runtime-only env check):

```typescript
// apps/frontend/client/src/lib/services/campaign/campaign_service.svelte.ts (new private helper)
const isAiGateBypassed = (): boolean => {
  // Vite strips COMPILED_OUT code in production builds via define/string replacement
  if (typeof window !== 'undefined' && (window as Record<string, unknown>).__AIKAMI_AI_GATE_BYPASS__) {
    return true;
  }
  // import.meta.env is compiled away by Vite; PUBLIC_AI_GATE_BYPASS only exists in .env.emulator
  try {
    return import.meta.env.PUBLIC_AI_GATE_BYPASS === 'true';
  } catch {
    return false;
  }
};
```

## Quality Requirements

- **Offline/degraded mode**: Without a text engine, the player is blocked at the capability screen with actionable guidance. Authored fallback text (C-318) handles mid-session AI failures — this contract only gates creation, not runtime degradation. N/A for the gate itself.
- **Accessibility/input**: Capability screen buttons must be keyboard-navigable (they already are — no regression). Error messages must be announced to screen readers via `aria-live`. N/A — no new input surfaces.
- **Performance budget**: Gate check is synchronous or a single cached gateway call. Must not add >1ms to campaign creation. N/A — negligible.
- **Security/privacy**: The QA/CI bypass flag must be absent from production builds. Verified by: `grep -r "PUBLIC_AI_GATE_BYPASS" apps/frontend/client/.env.production apps/frontend/client/.env.staging` returns no results. N/A for the gate itself.
- **Persistence/migration**: Existing campaigns with `capabilityProfile.textProvider: false` (created by the old "Play Offline Demo" path) will fail the gate on load/continue, which is intentional — they were created in an unsupported mode. The migration is: delete them (they are demo throwaways). No schema migration needed.
- **Cancellation/retry/idempotency**: `startNewCampaign()` with `textProvider: false` must throw consistently (idempotent rejection). Gateway resolution calls may be retried by the player (clicking "Retry Detection" on the capability screen). N/A — no new cancellation surface.
- **Observability**: Gate rejection must emit a log: `this.debug('startNewCampaign:gate-blocked', { reason: 'textProvider false' })`. QA/CI bypass activation must emit: `this.debug('startNewCampaign:gate-bypassed', { mode: 'QA/CI' })`.

## Migration & Rollback

- **Old data compatibility**: Campaigns with `capabilityProfile.textProvider: false` created before this contract will be rejected on load/continue. No migration — these are demo throwaways that predate the vision change.
- **Migration**: N/A — no persistent state changes.
- **Rollback**: Revert the contract implementation commit. The old "Play Offline Demo" button and `selectOfflineDemo()` method return. No data loss.
- **Feature flag or kill switch**: The QA/CI bypass env var (`PUBLIC_AI_GATE_BYPASS`) serves as a kill switch during testing. For production rollback, revert the commit.
- **Failure recovery**: If `aiGatewayService.resolveMode('text')` throws (gateway misconfigured), the gate blocks with a clear error — no broken-through-to-gameplay path. The player sees the capability screen with a retry button.

## Scope Boundaries

- **In Scope:**
  - Remove `selectOfflineDemo()` method from `CapabilityViewModel`
  - Remove "Play Offline Demo" button from `capability_view.svelte`
  - Harden `_hasTextProvider()` in `start_view_model` to route to capability screen instead of showing dismissible dialog
  - Add `textProvider === true` enforcement in `campaign_service.startNewCampaign()`
  - Add `AiTextProviderRequiredError` error class
  - Add QA/CI bypass flag (`PUBLIC_AI_GATE_BYPASS`) for deterministic testing
  - Update capability summary strings to remove "offline demo" language
  - Update tests: remove offline-demo test case, add gate-rejection test, add bypass test
  - Update C-318 execution notes to reflect removed path
- **Out of Scope:**
  - Mid-session AI failure fallback policy (C-318 owns per-feature degradation)
  - Image/voice capability enforcement (these remain optional)
  - Changes to `ai_gateway_service.svelte.ts` or `packages/frontend/ai-gateway` (C-320/C-322 own the gateway)
  - Changes to the connection editor panel or settings UI (C-318/C-322 own provider configuration UI)
  - Character onboarding (`/setup`) changes (C-319 owns character creation flow)
  - Removal of "No AI" code paths in `packages/backend/ai` or degradation policy constants (C-324 owns legacy cleanup)
  - The `start_view.svelte` "Missing Providers" dialog component — keep it temporarily as a visual artifact but replace its trigger (routing to capability screen instead of dialog)

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** 4 ACs, 2 affected projects (client + shared/utils). No split needed — all work is tightly coupled around one gate enforcement policy. The deferred QA/CI bypass refinement (making the flag environment-proof) is included here because it is small and required for the AC.

## Acceptance Criteria

### AC-1: Campaign Creation Blocked Without Text AI
**Given** no text AI provider is detected or configured (gateway `resolveMode('text')` returns no resolution or `aiGatewayService.detect('text')` returns `available: false`)
**When** any code path calls `campaignService.startNewCampaign()`
**Then** an `AiTextProviderRequiredError` is thrown with code `'text-provider-required'`, and no campaign is persisted to IndexedDB.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `apps/frontend/client/src/lib/services/campaign/campaign_service.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Unit test mocks `aiGatewayService.resolveMode()` to throw/return undefined; asserts `AiTextProviderRequiredError` is thrown.
- E2E / Visual:
    - **Functional**: N/A — unit-testable synchronous gate
    - **Visual**: N/A

**Watch Points**:
- Ensure `buildCapabilityProfile()` is called before campaign creation, not after. The existing code calls `buildCapabilityProfile()` synchronously at the top of `startNewCampaign()` — the gate must be evaluated against that result.
- The bypass flag must take precedence: if `PUBLIC_AI_GATE_BYPASS` is set, the gate must not throw even with `textProvider: false`.

### AC-2: Offline Demo Path Removed From Capability Screen
**Given** the capability screen is rendered (any detection result)
**When** the view is inspected
**Then** the "Play Offline Demo" button is absent, `CapabilityViewModelInterface` no longer exposes `selectOfflineDemo()`, and the capability screen offers only Local AI and Cloud AI paths. When no AI is available, the screen shows actionable guidance (no dismissible "skip" button).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + Visual | `apps/frontend/client/src/lib/views/capability/capability_view_model.test.ts`, `suites/capability.visual.ts` | `/capability` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Manual check — cold launch, observe capability screen, verify no "Play Offline Demo" button exists.
- E2E / Visual:
    - **Functional**: N/A
    - **Visual**: Visual suite at `suites/capability.visual.ts` — assert no "Play Offline Demo" text, assert actionable guidance text visible when no AI detected.

**Watch Points**:
- The old "Play Offline Demo" button was styled as `btn-primary` when no AI was available. The new screen must not leave a visual void — guidance text must be prominent.

### AC-3: Start Menu Routes to Capability Screen Instead of Dismissible Dialog
**Given** no text AI provider is resolved (gateway `resolveMode('text')` returns no resolution)
**When** the player clicks "New Game" or "Continue" on the start menu
**Then** the player is routed to the capability screen (`/capability`) instead of seeing a dismissible "Missing Providers" dialog. The capability screen provides actionable paths (install Ollama, configure cloud) and no "skip" to gameplay. The `showMissingProvidersDialog`-based flow is removed.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `apps/frontend/client/src/lib/views/start/start_view_model.test.ts` | `/` → `/capability` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Manual check — cold launch, click "New Game", verify routing to `/capability` with no dismissible dialog.
- E2E / Visual:
    - **Functional**: N/A — unit-testable routing assertion
    - **Visual**: N/A

**Watch Points**:
- The existing `_hasTextProvider()` check (lines 180-194 in `start_view_model.svelte.ts`) duplicates provider-detection logic that should come from the gateway. Replace with a call to `aiGatewayService.resolveMode('text')`.
- `continueGame()` must also gate on text AI resolution — loading an existing campaign without text AI must fail early.

### AC-4: QA/CI Bypass Enables Deterministic Testing Without Live Model
**Given** the `PUBLIC_AI_GATE_BYPASS` env var is set to `'true'` (or `window.__AIKAMI_AI_GATE_BYPASS__` is truthy)
**When** a campaign is created with `textProvider: false` via `campaignService.startNewCampaign()`
**Then** the gate is bypassed, the campaign is created successfully, and the bypass is logged (`this.debug('startNewCampaign:gate-bypassed', { mode: 'QA/CI' })`). Given a production or staging build, the bypass flag is not present in any `.env` file and `grep` returns no results.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `apps/frontend/client/src/lib/services/campaign/campaign_service.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Unit test sets `window.__AIKAMI_AI_GATE_BYPASS__` before calling `startNewCampaign()` with `textProvider: false`; asserts campaign is created.
- E2E / Visual:
    - **Functional**: E2E spec `tests/client/gate_bypass.spec.ts` — sets bypass flag, creates campaign, asserts entry to gameplay with authored fallback text.
    - **Visual**: N/A

**Watch Points**:
- The bypass flag must not survive bundling in production. Verify with: `grep -r "PUBLIC_AI_GATE_BYPASS\|__AIKAMI_AI_GATE_BYPASS__" apps/frontend/client/build/` returns no results.
- Add the bypass flag to `.env.emulator` (not `.env.production` or `.env.staging`).

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Add `AiTextProviderRequiredError` to `packages/shared/utils/`. Add bypass helper to `campaign_service.svelte.ts`. Add gate enforcement in `startNewCampaign()`. Fix post-hoc `capabilityProfile` mutation in `capability_view_model._startCampaign()` (pass profile as option to `startNewCampaign()` instead of mutating after creation).
2. **Phase 2 (Integration)**: Remove `selectOfflineDemo()` from `CapabilityViewModel`. Remove "Play Offline Demo" button from `capability_view.svelte`. Replace `_hasTextProvider()` in `start_view_model` with gateway-based check and routing to capability screen. Update capability service summary strings.
3. **Phase 3 (Validation)**: Run `validate()`. Update tests. Add bypass flag to `.env.emulator`. Verify production build strips bypass.

## Edge Cases & Gotchas

- **Existing campaign with `textProvider: false`**: Loading such a campaign via `loadCampaign()` currently does not check `capabilityProfile`. This contract does NOT add a load-time gate for `textProvider` (the gate is at creation), but `continueGame()` in the start menu now gates on gateway resolution before calling `loadCampaign()`. The net effect is: old offline-demo campaigns are unreachable from the start menu but not corrupted in IndexedDB.
- **Gateway resolution failure vs. no-provider**: `aiGatewayService.resolveMode('text')` may throw (unconfigured gateway) or return a resolution with no model. Both cases must trigger the gate. The distinction between "no provider configured" and "gateway error" matters for the error message shown to the player.
- **Capability screen rendering without any available path**: If both local and cloud AI are unavailable, the capability screen must show guidance text and a "Retry Detection" button but no "Play Offline Demo" escape. This is a deliberate UX constraint — no skip to gameplay.
- **Race condition in `_startCampaign()`**: The current code calls `startNewCampaign()`, then mutates `activeCampaign.capabilityProfile` post-hoc (line 256-257 in `capability_view_model`). This must be changed so `startNewCampaign()` accepts the profile as an option and the gate runs on the passed profile, not the default `buildCapabilityProfile()`.

## Open Questions

None — all design decisions are resolved by this contract and its dependencies (C-320, C-322, C-318, C-313).

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
