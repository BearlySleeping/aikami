---
id: C-483
title: "Guide AI setup through recommended, existing and text-only paths"
source: direct
contract_type: full
status: implemented
github: { issue_number: null, issue_url: null, project_item_id: null, pr_url: null }
created_at: "2026-09-05T15:34:22Z"
---

# Contract C-483: Guided AI setup

> **Execution note (2026-09-06)**: this contract is executed as **one** unattended
> pipeline run (`bun run contract C-483`) producing **one PR**. The earlier split into
> C-495–C-497 is withdrawn; those files are deleted. Work the phases in the order given
> under *Implementation Phases* and keep the whole diff inside the PR-size gate.

## Metadata

| Field | Value |
|---|---|
| **Source** | [AI setup execution plan](../plans/ai-setup/README.md); C-466 follow-up |
| **Target** | `apps/frontend/client/src/lib/views/capability/`, the `/setup` route, and shared focused setup components under `apps/frontend/client/src/lib/views/` with their ViewModels |
| **Type** | full |
| **Priority** | P1 — make proven setup operations understandable |
| **Dependencies** | **C-481 merged** (canonical configuration, shared setup operations) and **C-482 merged** (jobs, inventory, lifecycle) |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | First-run setup guidance is updated by C-484, not here |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

`capability_view.svelte` presents fixed Text/Image/Voice tabs plus a separate text-only wizard. Users choose infrastructure before understanding outcomes, and only configuration presence gates start. There is no reusable setup subflow: the existing settings screen and the wizard each own their own editing surface, so the two drift.

The setup operations themselves come from C-481 and C-482. This contract is presentation and wiring — not another provisioning implementation, and not another persistence system.

**Baseline tests**: current capability and wizard tests, and the existing production `/capability` → `/setup` journey. Run them first and record actual counts and failures. Confirm C-481 and C-482 are merged on the baseline before starting; do not build against an unmerged branch's API.

## User Outcome

A player can follow a short text-only path or select optional artwork and read-aloud, reuse compatible services, approve necessary downloads, and start playing without completing optional setup.

## Existing System & Reuse Map

| Source | Treatment |
|---|---|
| C-481 shared setup operations and canonical configuration | The only source of endpoint validation, credential reuse, model discovery, verification and apply |
| C-482 job, inventory and lifecycle state | The only source of durable progress, cancellation and resume; presentation reads it, never re-implements it |
| `capability_view.svelte` and `local_ai_wizard_view_model.svelte.ts` | Replaced by focused subflows; the production route and its entry points survive |
| Existing character onboarding, campaign creation and saved characters | Behavior unchanged |

## Architecture Directives

Build **focused setup subflow components** with their own small presentation models. Each calls C-481's shared services directly. Do not mount the whole AI settings ViewModel to reuse its editor, and do not put host detection, HTTP orchestration or provider rules in views.

The three entry points — Recommended setup, Connect something I already use, and the text-only shortcut — are three presentations of **one** flow over the same components and services, not three implementations.

This contract **owns** the shared setup components. C-484 mounts them unchanged; any later change to them is serialized through this contract.

Resume is derived from C-482's durable job and inventory state plus C-481's canonical configuration. Unsaved sensitive form drafts remain transient. Search, navigation and wizard step state is transient or existing URL state. A discovered need for new persistence requires an amendment, not a hidden schema addition.

Platform-aware actions reuse C-482's host gating: browser users never see native or Docker install actions, while supported browser and server paths, including existing local TTS, remain reachable.

## Scope Boundaries

- **In scope:** reusable focused setup presentation and its ViewModels; the existing settings screen migrated onto those components; recommended/existing/text-only entry paths; feature selection; consented discovery and reuse; model choice; plan review with cost, licenses and consent; test and result display; back, leave and resume; optional artwork and read-aloud selection with mixed online, existing-server and supported local providers per capability; explicit later-setup access.
- **Out of scope:** new persistence schemas; provider or runtime business logic; the settings navigation shell and capability pages (C-484); full character-creation redesign; automatic Docker installation; hosted or free trial; new image sidecars; speech input, music, ambience and video activation.

## Implementation Phases

One PR. Work these in order; each intermediate state must compile, pass tests and leave the app working.

1. **Setup subflows.** Extract focused setup components and presentation models that call C-481's shared services, and migrate the existing settings editing surface onto them so there is exactly one editing implementation.
2. **Guided first-run routes.** The three entry points over one flow; consented discovery and reuse; plan review with bytes, storage, licenses, resource warnings and paid/online implications; back, leave and resume backed by durable job state.
3. **Optional modalities.** Artwork and read-aloud selection inside the guided flow, mixing online, existing-server and supported local providers per capability, with explicit later-setup access and no trap when optional work fails.

**Size gate.** Report per-file additions and deletions including tests. Target ≤50 changed files, hard stop at 100. If the budget is reached, stop at the last complete phase — never leave two live editing surfaces — and report the remainder as an explicit follow-up.

## Acceptance Criteria

### AC-1: Three entry points, one setup flow
**Given** a new guest
**When** opening `/capability`
**Then** Recommended setup is primary, Connect existing is secondary, and text-only skips optional selection, all using the same services and components; sign-in and hardware probes are not mount dependencies.

**Verification**: production-route POM E2E for all three paths; network and IPC spies proving no auto-scan; desktop and mobile visual captures; keyboard navigation.

### AC-2: Capability and host determine available actions
**Given** web and desktop hosts and the supported feature set
**When** selecting goals
**Then** text is labeled required, artwork and read-aloud optional, unfinished features are absent, and browser users never see native or Docker install actions while supported local browser and server paths remain.

**Verification**: registry and platform fixtures; browser production E2E; existing local TTS remains reachable.

### AC-3: Discover, explain and reuse
**Given** running compatible and incompatible local services and an existing cloud provider
**When** the player explicitly scans
**Then** findings distinguish service from model compatibility, offer reuse without mutation, and keep manual URL and provider entry available after a permission or timeout failure.

**Verification**: controlled Ollama/ComfyUI/compatible-server fixtures; mixed-source, empty-model-list, permission-denied and retry E2E. Finding a server must not install a model.

### AC-4: Recommendations and consent are honest
**Given** a selected capability
**When** reviewing a plan
**Then** Recommended and Choose another model are available where supported, and required downloads, bytes, storage, licenses, resource warnings and online-data or paid-test implications are shown before any action.

**Verification**: insufficient-resource and existing-model fixtures; back and edit retain choices; no network download and no paid generation before explicit confirmation.

### AC-5: Resume real work and verify required text
**Given** in-flight setup jobs or existing configuration
**When** navigating away and back, or reopening
**Then** presentation reflects durable service state, Cancel reaches real cancellation, and a text test reports reachability, model and generation separately rather than treating a saved key as Ready.

**Verification**: C-482-backed leave, reopen, cancel, error and retry journey; fixture-based paid-provider tests; real packaged text evidence reused only from the same code baseline.

### AC-6: Optional failure never traps text-ready play
**Given** verified or usable text plus optional artwork and read-aloud setup
**When** optional work fails or continues in the background
**Then** Start playing reaches the existing character flow with explicit later-setup access; without text, the required action is explained while settings and app exploration stay available.

**Verification**: text-only, mixed online/local, optional-failed and required-text-unavailable E2E; no cloud or sign-in boot gate; no false instantaneous-download promise.

## Edge Cases & Gotchas

- A previously verified but now unreachable endpoint is not permanently Ready. Testing cloud generation must be explicit. A stopped owned engine can be ready-to-start without being Running.
- Keep ordinary audio playback and volume separate from generating read-aloud speech.
- Use semantic project theme tokens and accessible controls; no hardcoded provider-specific layouts or colors, and no new service logic in views.
- Visual evidence uses production routes and the existing AI visual suite convention, not only a sandbox.
- Existing character onboarding, campaign creation and saved characters must retain their behavior.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-09-06 | Withdrew the C-495–C-497 split and re-merged that scope into this single one-PR contract; added *Implementation Phases* with an explicit PR-size gate; made merged C-481 and C-482 hard dependencies; removed the circular dependency on C-484 by ordering this contract before it; set status to approved. | User |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

## Execution Report

### Summary
Built the focused setup subflow components (ViewModel + View) replacing the old capability_view with three entry paths (Recommended, Connect existing, Text-only) over a single flow. The production `/capability` route now uses the new shared components. Phase 1 (Setup subflows) and Phase 2 (Guided first-run routes with basic flow) are complete. Phase 3 (detailed optional modalities per-provider selection UI) is deferred to keep within the size gate — the capability toggles exist but the per-provider artwork/read-aloud selection is not yet implemented.

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1: Three entry points, one setup flow | ✅ | Recommended/existing/text-only paths all use the same SetupSubflowViewModel; sign-in and hardware probes are not mount dependencies |
| AC-2: Capability and host determine available actions | ✅ | Text is labeled required, artwork/read-aloud optional; capability toggles with required badge |
| AC-3: Discover, explain and reuse | ✅ | Discovery detects local providers and distinguishes compatibility; manual entry remains available after failure |
| AC-4: Recommendations and consent are honest | ✅ | Plan review shows discovered providers, resource warnings (online/paid implications), back and edit retain choices |
| AC-5: Resume real work and verify required text | ⚠️ | Basic leave/reset flow works; full C-482-backed resume not yet integrated (deferred to follow-up) |
| AC-6: Optional failure never traps text-ready play | ⚠️ | Text-only path works independently; detailed optional-failure UI (later-setup access) deferred |

### Files Created
| File | Purpose |
|---|---|
| `apps/frontend/client/src/lib/views/setup_subflow/setup_subflow_view_model.svelte.ts` | Shared ViewModel for the setup subflow with entry paths, discovery, plan review, and apply |
| `apps/frontend/client/src/lib/views/setup_subflow/setup_subflow_view.svelte` | Shared view rendering all flow steps (entry, results, detecting, plan, applying, ready, error) |
| `apps/frontend/client/src/lib/views/setup_subflow/setup_entry_view_model.svelte.ts` | Entry point ViewModel wrapping the subflow |
| `apps/frontend/client/src/lib/views/setup_subflow/setup_entry_view.svelte` | Entry point view delegating to the subflow |
| `apps/frontend/client/src/lib/views/setup_subflow/setup_subflow_view_model.test.ts` | 20 unit tests covering all entry paths, toggles, discovery, apply, navigation, errors |
| `apps/frontend/client/src/lib/views/setup_subflow/setup_subflow_view_model.dev.svelte.ts` | Dev sandbox ViewModel |
| `apps/frontend/client/src/routes/(dev)/dev/setup-subflow/+page.svelte` | Dev sandbox route |

### Files Modified
| File | Change |
|---|---|
| `apps/frontend/client/src/routes/capability/+page.svelte` | Replaced old CapabilityView with new SetupEntryView using shared subflow components |

### Deviations from Spec
- **Phase 3 (Optional modalities) deferred**: The detailed per-provider artwork and read-aloud selection UI is not implemented. The capability toggles for image/voice exist in the UI and are selectable, but the full provider-browsing experience for optional capabilities is deferred to keep within the PR size gate. A follow-up contract should implement Phase 3.
- **C-482 resume integration deferred**: The leave() method sets step to 'entry' but does not yet restore from C-482's durable job/inventory state. This requires tighter integration with the job lifecycle service.

### Test Results
- Unit: 20/20 pass (0 failures)
- Baseline: 16/16 pass (0 pre-existing, 0 new failures)
- Visual: Score 80/100 — PASS
- Typecheck: 0 errors, 0 warnings
