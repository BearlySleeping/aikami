---
id: C-483
title: "Guide AI setup through recommended, existing and text-only paths"
source: direct
contract_type: thin
status: draft
github: { issue_number: null, issue_url: null, project_item_id: null, pr_url: null }
created_at: "2026-09-05T15:34:22Z"
---
# Contract C-483: Guided AI setup

## Metadata
| Field | Value |
|---|---|
| **Source** | [AI setup execution plan](../plans/ai-setup/README.md); C-466 follow-up |
| **Target** | Client capability/setup views and shared focused setup components |
| **Type** | thin |
| **Priority** | P1 — make proven setup operations understandable |
| **Dependencies** | C-481 through P08; C-482 through T01; U03 also needs C-484 S02; milestone dependencies avoid whole-contract cycles |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | Short first-run setup guidance in `apps/frontend/docs/src/content/docs/` |
| **Contract version** | 1.0.0 |

## Problem & Baseline Evidence
`capability_view.svelte` presents fixed Text/Image/Voice tabs and a separate text-only wizard. Users choose infrastructure before understanding outcomes, and only configuration presence gates start. Existing setup operations come from C-481/C-482; this is presentation/wiring, not another provisioning implementation.
Baseline: current capability/wizard tests and existing production `/capability` -> `/setup` journey. Confirm dirty working-tree changes have been incorporated into the approved baseline before replacing any views.

## User Outcome
A player can follow a short text-only path or select optional artwork/read-aloud, reuse compatible services, approve necessary downloads and start playing without completing optional setup.

## Scope Boundaries
In: reusable focused setup presentation, recommended/existing/text-only paths, feature selection, consented discovery/reuse, model choice, review/test/result, back/leave/resume and platform-aware actions.
Out: new persistence schemas, provider/runtime business logic, full character creation redesign, automatic Docker install, hosted/free trial, new image sidecar, speech input/music/ambience/video activation.
Reuse canonical config and C-482 job/inventory state for resume. Unsaved sensitive form drafts remain transient; no additional onboarding persistence system. Schema needs discovered during implementation require conversion/amendment, not a hidden addition.

## Acceptance Criteria
### AC-1: Three entry points, one setup flow
Given a new guest, when opening `/capability`, then Recommended setup is primary, Connect existing is secondary, and text-only skips optional selection using the same services/components; sign-in and hardware probes are not mount dependencies.
**Verification**: production-route POM E2E for all paths, network/IPC spies proving no auto-scan, desktop/mobile visual captures and keyboard navigation.

### AC-2: Capability and host determine available actions
Given web/desktop and supported features, when selecting goals, then text is labeled required, artwork/read-aloud optional, unfinished features absent, and browser users never see native/Docker install actions while supported local browser/server paths remain.
**Verification**: registry/platform fixtures and browser production E2E; existing local TTS remains reachable.

### AC-3: Discover, explain and reuse
Given running compatible or incompatible local services and an existing cloud provider, when the player explicitly scans, then findings distinguish service/model compatibility, offer reuse without mutation, and keep manual URL/provider entry available after permission/timeout failure.
**Verification**: controlled Ollama/ComfyUI/compatible-server fixtures; mixed-source, empty-model-list, permission-denied and retry E2E. Finding a server must not install a model.

### AC-4: Recommendations and consent are honest
Given a selected capability, when reviewing a plan, then Recommended and Choose another model are available where supported; required downloads, bytes, storage, licenses, resource warnings and online data/paid-test implications are shown before action.
**Verification**: insufficient-resource and existing-model fixtures; back/edit retains choices; no network download or paid generation before explicit confirmation.

### AC-5: Resume real work and verify required text
Given setup jobs or existing configuration, when navigating away/back or reopening, then presentation reflects durable service state, Cancel reaches real cancellation, and a text test reports reachability/model/generation separately rather than treating a saved key as Ready.
**Verification**: C-482-backed leave/reopen/cancel/error/retry journey; fixture-based paid-provider tests; real packaged text evidence from T01 reused only on the same code baseline.

### AC-6: Optional failure never traps text-ready play
Given verified/usable text and optional artwork/read-aloud setup, when optional work fails or continues, then Start playing reaches the existing character flow, with explicit later setup access. Without text, explain the required action while keeping settings/app exploration available.
**Verification**: text-only, mixed online/local, optional-failed and required-text-unavailable E2E; no cloud/sign-in boot gate or false instantaneous-download promise.

## Edge Cases & Gotchas
Do not mount the whole AI settings ViewModel to reuse its editor. Focused view models call shared setup services; settings later consumes those same subflows.
A previously verified but now unreachable endpoint is not permanently Ready. Testing cloud generation must be explicit; a stopped owned engine can be ready-to-start without being Running.
Keep ordinary audio playback/volume separate from generating read-aloud speech. Existing character onboarding, campaign creation and saved characters must retain their behavior.
Visual evidence uses production routes and the existing AI visual suite convention, not only a sandbox. Confirm evaluator billing before spending.

## Amendments
No amendments; draft specification. Scope/AC changes require version bump and user approval.

## Promotion Lifecycle
See [shared promotion rules](SHARED_SECTIONS.md#promotion-lifecycle).
## Status Lifecycle
See [shared status rules](SHARED_SECTIONS.md#status-lifecycle). Append execution report when all ACs pass; U01/U02 alone do not complete this contract.
