---
id: C-465
title: "AI settings section — provider tree, status board, and role assignment"
source: "Settings teardown review, 2026-09-03 (§6-7). Follows C-463 (PRs #236/#237) and C-464 (PRs #240/#241), which built the Provider/Connection/Role model and the settings-group shell this replaces the AI content of. C-464 is the highest claimed ID; C-465 is the next free one."
contract_type: full
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-04"
---

# Contract C-465: AI settings section — provider tree, status board, and role assignment

## Metadata

| Field | Value |
|---|---|
| **Source** | Settings teardown review, 2026-09-03; §6 "The new shape of the page", §7 "Voice and image, done properly" |
| **Target** | `apps/frontend/client/src/lib/views/settings/ai/` (new) — replaces the `connections` section content in the `ai` settings group |
| **Type** | full |
| **Priority** | P1 — the model, the runtime wiring, and the settings shell it slots into are all already merged; this is the piece that makes them visible and operable |
| **Dependencies** | C-463 (Provider/Connection/Role model, PRs #236/#237), PR #238 (settings groups + registry), PR #239 (generation/voice/image params reach the runtime), C-464 (Account section pattern to follow, PRs #240/#241) |
| **Status** | draft |
| **Promotion** | `integrated` |
| **Docs Impact** | user-facing → a short "Connecting an AI provider" page in `apps/frontend/docs/src/content/docs/` |
| **Contract version** | 1.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: `Settings → AI` shows `AI & Privacy` (status badge, offline mode, telemetry — the last two already slated to move to Data by C-464's own scope, confirm they did) and `Connections`, a flat list of individually-created connections. Creating a second connection on an account already in use re-asks for the API key from scratch: `connection_manager_view_model.svelte.ts`'s `setProvider()` swaps a transient `_providerCache: Record<string, {apiKey, model}>` populated only from whatever the editor has touched in the current session — it is wiped by `openCreate()`/`cancelEdit()`/`saveDraft()` and never reads the real account list.

- **Reproduction**: Settings → AI → Connections → Add Connection → OpenRouter → paste a key → save → Add Connection again → OpenRouter. The key field is empty. This is the exact repro from C-463's own Problem statement — C-463 fixed the *data model* (one `AiProvider` now really is shared across connections) but the *editor* was never rewired onto it, per that contract's explicit Out of Scope: "Any settings UI redesign... `connection_manager_view_model` changes only as much as compiling requires."

- **Existing implementation to reuse**:
  - `configService.getProviders()` / `getAiConnections()` / `getRoleAssignments()` / `resolveRole()` / `addProvider()` / `addAiConnection()` / `setRoleAssignment()` — the full C-463 CRUD surface, already correct and tested.
  - `TEXT_PROVIDERS` / `VOICE_PROVIDERS` / `IMAGE_PROVIDERS` (`@aikami/constants`) — provider registries, `needsKey` / `needsUrl` / `isLocal` per entry.
  - `fetchModelsFromProvider`, `PROVIDER_MODEL_FETCH`, `buildVerifyUrl` / `buildVerifyHeaders` — the model-list and key-verify machinery `connection_manager_view_model` already calls; keep calling it, just from the new shape.
  - `VoiceModelDownload` (used in `capability_view.svelte`) — the local Kokoro download component with progress/cancel. Reuse verbatim for the voice section's local-install panel.
  - `styleProfileService` — already has `activeProfileId` / `activeProfile`; the image section surfaces it, doesn't rebuild it.
  - `ai_privacy_view_model`'s `aiConnectionStatus` derivation pattern — same "loading / connected / not_configured" shape, now per-capability instead of one AI-wide status.
  - The `settings_view_model` registry pattern from #238 (`group`, `contexts`) — the new section(s) register the same way `account` did in C-464.

- **Known gaps**:
  - `state.voice.voiceArchetypes` (the named-role → provider-voice-id mapping) still lives on the legacy `VoiceConfig`, not on an `AiConnection`'s `VoiceParams`. It has a UI in the old provider tabs (deleted in PR-1) and no UI today at all.
  - `ImageParams` has no `sampler`, `comfyWorkflow`, or `styleProfileId` field — those still live on legacy `ImageConfig`. The teardown's own §7 recommendation was fewer image knobs, not more, so this contract must decide what (if anything) of that legacy surface is worth carrying forward rather than silently dropping user configuration.
  - No settings UI exists for `RoleAssignments` at all. A user with two text connections has no way to say which one narration uses vs. summarization — `resolveRole()` works, but only the migration ever calls `setRoleAssignment()`.
  - `TEXT_PROVIDERS` still lists providers with no image/voice equivalents in the corresponding registries (unrelated — out of scope here, tracked separately).

- **Baseline tests** (must stay green): `config_service.test.ts` (94 tests as of PR #241), `capability_view_model.test.ts`, `connection_manager_view_model.test.ts` if present, `settings_view_model.test.ts`. Client unit baseline is **1818 pass / 34 fail**, the 34 being the pre-existing set named in Baseline Evidence of C-464 (InventoryService, GmPromptService, ImageViewModel, GameCanvasViewModel, EndSessionViewModel) — unrelated to this work, do not fix them here.

## User Outcome

After this contract, a player pastes one API key once, picks a model, and the connection works; adding a second model on the same account reuses the key automatically. They can see at a glance whether text, voice, and image are each connected, and — without ever needing to know the word "provider" — assign a cheaper model to background tasks and a better one to narration.

## Success Measures

- **Time/latency target**: the section renders from cached config state with no network call on mount. Verify/fetch-models stay explicit, user-triggered actions, exactly as today.
- **Offline/degraded behavior**: unchanged — the section must render and be fully editable offline; only Test/Verify/Fetch-models require a network round trip, and each fails visibly rather than hanging.
- **Production journey enabled**: creating a second connection on an existing provider account with zero re-entry of the credential — the concrete case C-463 was built to fix and that has had no UI since.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Provider/Connection/Role CRUD | `config_service.svelte.ts` (C-463) | reuse unchanged |
| Provider registries + descriptors | `@aikami/constants` | reuse unchanged |
| Key verify / model fetch | `provider_endpoints.ts`, `fetchModelsFromProvider` | reuse unchanged |
| Connection editor UI | `connection_editor_panel.svelte`, `connection_manager_view_model.svelte.ts` | replace — provider-aware, not cache-based |
| Connections list UI | `connections_list_view.svelte` | replace — grouped by provider |
| AI status badge | `ai_privacy_view_model.aiConnectionStatus` | modify — per-capability, not AI-wide |
| Local voice install | `VoiceModelDownload` (capability screen) | reuse verbatim |
| Image style profile | `style_profile_service.svelte.ts` | reuse, surfaced in the image section |
| Settings registry (`group`/`contexts`) | `settings_sections.ts` (#238) | modify — add/replace sections in the `ai` group |

## Overview

Replace the `Connections` section with an `AI` section built on three pieces: a **status board** (one row per capability: connected/offline/not-configured, default model, a Test action), a **provider tree** (providers as parent rows, their connections nested under them, one "+ Add provider" entry point whose form is a single dropdown-driven flow that resolves-or-creates the provider automatically), and a collapsed **Roles** drawer for assigning connections to jobs. Voice and image get their own capability-specific controls — archetypes with a preview button, and size/quality controls with a live preview — wired to the params PR #239 already made functional.

## Design Reference

Follow the mockup already agreed in the original teardown review:

```
STATUS
● Text     Claude Sonnet via OpenRouter        148 ms · Test
● Voice    Kokoro (on this computer)           ready · Preview
○ Image    Not set up                          Set up image →

PROVIDERS                                        + Add provider
☁ OpenRouter personal                    sk-or-…9f2c  Edit
   ├ Sonnet — narration      text        narration · dialogue
   ├ Haiku — background      text               summarization
   └ + Add model
▣ This computer  local stack · docker          running  Manage
   ├ Kokoro                  voice     narrator · npc voice
   └ ComfyUI                 image           not installed

▸ Roles & advanced                                    collapsed
```

The add/edit connection form is the one from the teardown's §5 "The dropdown does not change" — provider dropdown, then a masked API-key field prefilled from the matching `AiProvider` if one already exists for that registry id, then model, then an optional "Use for" role checklist that only appears once at least one connection of that capability already exists.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- No new persisted state shape. Everything here reads and writes through the existing `configService` provider/connection/role API — this contract is UI and wiring, not another data-model contract.
- The resolve-or-create logic (match an existing `AiProvider` by `(registryId, baseUrl)`, prefill its credential masked, ask before silently re-keying it if the user changes the value) lives once, in the new editor's ViewModel — not duplicated per capability tab.
- Voice/image capability-specific controls (archetypes, size presets) write through `updateAiConnection()`'s `params` field on a `VoiceParams`/`ImageParams`-typed connection. If archetypes need a field `VoiceParams` doesn't have, extend the schema in `packages/shared/schemas` — do not reintroduce a parallel legacy-shaped store.
- Component tree lives under `apps/frontend/client/src/lib/views/settings/ai/`, following the `views/settings/<section>/` convention from C-464's `account/`.

## State & Data Models

No new top-level state. One schema decision this contract must make (see Open Questions): whether `VoiceArchetype[]` moves onto `VoiceParams` as an array field, or stays a separate per-account list keyed by provider. Sketch, pending that decision:

```ts
// packages/shared/schemas — extends the existing VoiceParamsSchema, additive.
type VoiceParams = {
  voiceId: string;
  speed: number;
  pitch: number;
  /** Named-role → this provider's voice id, e.g. "Female — warm" -> "af_bella". */
  archetypes?: VoiceArchetype[];
};
```

## Quality Requirements

- **Offline/degraded mode**: section fully usable offline for CRUD; network actions (Test, Verify, Fetch models, voice Preview, image Generate-preview) each show their own loading/error state, never block the rest of the form.
- **Accessibility/input**: provider tree rows and the Roles drawer follow the `role="tablist"`/`role="treeitem"`-appropriate semantics and keyboard nav pattern #238 already established for the group/section tabs. Masked key field has a visible show/hide toggle with an accessible label.
- **Performance budget**: no perceptible delay opening the section; the provider tree renders from in-memory state.
- **Security/privacy**: the masked-key prefill must never render the real key into a `value` attribute in plaintext — mask by default, reveal only behind the existing show/hide toggle, and never log a credential (matches C-464's own logging discipline).
- **Persistence/migration**: N/A — no vault shape change. If the VoiceArchetype schema question above lands as additive, existing connections default to no archetypes and the legacy `state.voice.voiceArchetypes` values migrate onto the resolved `narrator-voice` connection on first load, one-time.
- **Cancellation/retry/idempotency**: unchanged from today's Test/Verify/Fetch-models behavior — each is a fresh request per click, cancellable by navigating away.
- **Observability**: none new; reuse existing `debug`/`warn` logging conventions in the surrounding ViewModels.

## Migration & Rollback

- **Old data compatibility**: none of the underlying data changes shape (unless the VoiceArchetype decision below adds a field — additive, safe for old rows to lack it).
- **Migration**: if archetypes move onto `VoiceParams`, migrate `state.voice.voiceArchetypes` onto the `narrator-voice` role's resolved connection once, on load, guarded so it never runs twice (same idempotency discipline as C-463's `migrateVaultV1ToV2`).
- **Rollback**: no schema removed, so rollback is a plain revert of the UI PR; the underlying provider/connection/role data is untouched either way.
- **Feature flag or kill switch**: none — this replaces the only path to a section (`Connections`) that is already broken for the multi-model case, so there is no safe "half-shipped" state to flag around.
- **Failure recovery**: N/A — no new persistent state to corrupt.

## Scope Boundaries

- **In Scope:**
  - The status board, provider tree, and Roles drawer for the `ai` settings group.
  - Rewriting `connection_manager_view_model.svelte.ts` (or its replacement) onto the C-463 provider API; deleting `_providerCache` / `_getFallbackApiKey`.
  - Voice section: archetypes with per-archetype voice/speed/pitch and a real preview (a real line of dialogue, not the placeholder test string), local-install panel reusing `VoiceModelDownload`.
  - Image section: size presets per role (portrait/scene), a quality slider mapped to steps/cfg with the raw pair behind an advanced disclosure, checkpoint from the live engine list, style profile picker, and a real generated preview.
  - Deciding and implementing the VoiceArchetype schema question (Open Question 1).
  - `/dev/ai-settings` dev route with seeded fixtures (zero connections, one, several providers, one provider with three models, a rejected key) — this is also where the coverage currently in the deleted `providers_view_model.test.ts` gets re-homed, per C-463's own note that it needed re-homing here.
  - Removing `/dev/settings` (its only reason to exist — live volume sliders for a dev sandbox — is now redundant now that #239 made real settings persist correctly) is a two-line cleanup; do it here since this PR already touches the settings dev routes.

- **Out of Scope:**
  - **The three-mounts unification** (pause menu, `/capability` sharing this same registry via `contexts`). That field exists on the registry since #238 but nothing reads it yet — wiring it up is a separate contract. This section must render correctly standalone in the `page` context only.
  - **Generation-parameter UI** (temperature/top-P/etc. sliders and presets). #239 made these reach the request; whether to expose them as a settings control at all — vs. leaving them as an advanced per-role default — is a real design question the teardown didn't fully settle, and bundling it here risks scope creep on an already-large contract. Track as a fast-follow if wanted.
  - Retiring text providers with no working adapter (already done, PR #234) or doing the same for voice/image registries.
  - The Tauri hardware-detection wizard and engine sidecars (separate contracts, unblocked by this one but not part of it).
  - Any change to `capability_view.svelte` / `capability_view_model.svelte.ts` beyond what compiling against this contract's changes requires.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** one contract, but flagged for a possible mid-flight split along capability lines if AC count balloons during drafting. The status board + provider tree + Roles drawer are one cohesive outcome (they share the same data and the same "no re-entering a key" invariant); the voice and image capability-specific panels are logically separable from that core and from each other. If implementation reveals the voice/image panels are each substantial enough to be independently mergeable — plausible, since they involve real previews and local-install UX — split them into `C-465a` (provider tree + roles) and `C-465b` (voice) / `C-465c` (image) rather than force one enormous PR. Decide this explicitly before implementation starts, not mid-PR.

## Acceptance Criteria

### AC-1: A second model on an existing account needs no re-entered key
**Given** one OpenRouter connection already configured with a key
**When** the user adds a second connection, selects OpenRouter, and a matching `AiProvider` already exists
**Then** the key field is prefilled (masked) from that provider and the form never asks the user to paste it again.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | new connection editor ViewModel test | `/settings?group=ai` | Filled during verification |

**Watch Points**: this is the exact repro in Problem & Baseline Evidence — write the test against that repro directly, not a synthetic case.

### AC-2: Changing the key on one connection updates every sibling
**Given** two connections sharing one `AiProvider`
**When** the key is edited from either connection's editor
**Then** both connections' resolved credential reflect the new value (verified via `getApiKey`, matching the invariant PR #237 already tests at the service layer — this AC is that the UI actually calls the shared-provider update path, not a per-connection one).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | new connection editor ViewModel test | `/settings?group=ai` | Filled during verification |

### AC-3: Ambiguous key change prompts instead of silently forking or re-keying
**Given** a prefilled key from an existing provider
**When** the user pastes a *different* value and saves
**Then** the user is asked, in plain language, whether to update the shared account (naming how many connections share it) or create a separate account — and the app takes no action until answered.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | new connection editor ViewModel test | `/settings?group=ai` | Filled during verification |

**Watch Points**: this is the one place the word "account"/"provider" reaches a beginner at all — per the original design note, it should surface only here, after an ambiguous action, not as a persistent UI concept.

### AC-4: Status board reflects real per-capability state
**Given** a text connection with a valid key, no voice connection, and an unreachable image server
**When** the AI section is opened
**Then** the board shows text as connected with its model name, voice as not-configured, and image as offline with a reason — three independent rows, not one AI-wide badge.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit + Visual | AI section ViewModel test; `suites/ai_settings.visual.ts` | `/settings?group=ai` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- E2E / Visual:
    - **Visual**: new `suites/ai_settings.visual.ts`, route `/dev/ai-settings?fixture=mixed-status`, criteria: "Score 90+: three independent status rows for Text, Voice, Image, each showing a distinct connection state with no shared badge."

### AC-5: Role assignment survives and is honored
**Given** two text connections
**When** the user assigns connection A to `summarization` and leaves `narration` on connection B
**Then** `configService.resolveRole('summarization')` returns A and `getActiveTextProvider()` (which resolves `narration`) returns B — both from the UI action, not a test-only call to `setRoleAssignment`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | Roles drawer ViewModel test | `/settings?group=ai` | Filled during verification |

### AC-6: Voice archetype changes reach a real preview
**Given** an archetype's voice id changed to a different Kokoro voice
**When** the preview button is pressed
**Then** the TTS request uses the new voice id and a real line of dialogue from the active campaign (or a stated fallback line when none is active), not the old hardcoded test string.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Unit | voice section ViewModel test | `/settings?group=ai` | Filled during verification |

### AC-7: Image preview reflects the connection's resolved defaults
**Given** a portrait-role connection with a chosen checkpoint and size preset
**When** the preview is generated with no explicit overrides
**Then** the request sent to `image_generation_service.generateImage()` carries that checkpoint and size — proving the section's controls are the same `ImageParams` #239 wired the gateway to, not a separate preview-only path.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-7 | Unit | image section ViewModel test | `/settings?group=ai` | Filled during verification |

### AC-8: `/dev/ai-settings` covers the fixture matrix and the old test's assertions
**Given** the dev route
**When** it loads with each of: zero connections, one connection, several providers, one provider with three models, a connection whose key fails verification
**Then** each fixture renders without error, and the provider-verification, checkpoint-detection, and model-fetching assertions that lived in the now-deleted `providers_view_model.test.ts` (PR #233) are re-homed here.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-8 | Unit + Manual | `/dev/ai-settings` fixtures; ported test assertions | `/dev/ai-settings` | Filled during verification |

### AC-9: No behavioral regression
**Given** the existing suites
**When** the gate runs
**Then** client unit is **1818+ pass**, the failing set is exactly the pre-existing baseline (no new suite names), and the type-safety guard baseline holds at its current level (`T1=14 T2=4 T3=1` as of PR #241, confirm before merge — later work may have moved it).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-9 | Unit + E2E | `bun run fix && bun moon run :validate && bun run test` | `/settings?group=ai` | Filled during verification |

## Implementation Sequence

1. **Phase 0 (Decide the split)**: confirm whether this ships as one PR or splits per the Contract Size note — record the decision in Amendments before writing code.
2. **Phase 1 (Editor + provider tree, test-first)**: write AC-1/AC-2/AC-3 against the new editor ViewModel before building the view; this is the highest-value, highest-risk piece.
3. **Phase 2 (Status board + Roles drawer)**: AC-4, AC-5.
4. **Phase 3 (Voice section)**: archetype schema decision, panel, AC-6.
5. **Phase 4 (Image section)**: size presets, quality slider, style profile, AC-7.
6. **Phase 5 (Dev route + test re-homing)**: AC-8, remove `/dev/settings`.
7. **Phase 6 (Validation)**: `bun run fix && bun moon run :validate && bun run test`; AC-9.

## Edge Cases & Gotchas

- **A provider with zero remaining connections** (all deleted): the tree must not show an empty parent row forever — `deleteAiConnection` already prunes the orphaned provider at the service layer (PR #237's `_pruneOrphanProviders`), so the UI should reproject cleanly; verify it does rather than assuming.
- **Local providers in the tree**: Ollama/ComfyUI/Kokoro have no credential — the tree's provider row must render sensibly with no masked-key field at all, not an empty one.
- **Role reassignment on delete**: deleting a connection that held a role assignment must not leave a dangling role pointing at a gone connection — `_assignCapabilityRoles`/`_reproject` already handle this at the service layer (PR #237); the UI must re-render the Roles drawer reactively when it happens, not require a manual refresh.
- **Voice preview with no active campaign**: AC-6's "real line of dialogue" needs a defined fallback — do not let the preview silently do nothing or throw when there's no campaign context.

## Open Questions

Must be resolved before status becomes `approved`:

1. **Does `VoiceArchetype[]` move onto `VoiceParams`, or stay a separate per-provider list?** Moving it makes "switch providers, remap every NPC in one step" (the original design goal) work naturally, since archetypes travel with the connection. Keeping it separate is less invasive but leaves the disconnect between "which connection is `narrator-voice`" and "which archetypes exist" unresolved. *Recommendation*: move it onto `VoiceParams`, migrated once from `state.voice.voiceArchetypes` onto the connection that resolves the `narrator-voice` role.
2. **Do generation-parameter controls (temperature etc.) get a UI in this contract, or stay advanced-only via defaults?** Explicitly Out of Scope above pending this answer — flagging here so approval forces a decision either way rather than it being silently dropped. *Recommendation*: out of scope for this contract; track as a fast-follow once the core section has shipped and real usage shows whether anyone wants it exposed.
3. **Single PR or the three-way split named in Contract Size & Split Rule?** *Recommendation*: start as one PR; split only if Phase 1 alone proves large enough that review would be unreasonable, per the repo's own "split on independent mergeability, not size" rule — don't split preemptively.

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
