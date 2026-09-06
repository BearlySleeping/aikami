---
id: C-488
title: "Route every AI consumer through one canonical resolution"
source: "Split of C-481 into PR-sized contracts; AI setup execution plan queue row P08"
contract_type: thin
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-06T03:20:00Z"
---

# Contract C-488: Canonical resolution for all AI consumers

## Metadata

| Field | Value |
|---|---|
| **Source** | [C-481](C-481-ai-configuration-convergence.md) Success Measures; queue row P08 |
| **Target** | `apps/frontend/client/src/lib/services/ai/`, `audio/tts_service.svelte.ts`, image generation service, `ai_gateway_service.svelte.ts` |
| **Type** | thin |
| **Priority** | P1 — completes C-481's user-visible promise |
| **Dependencies** | C-487 |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal → none |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: gateway mode resolution and the text, image and TTS services each select parts of a request independently; some look a key up by registry ID.
- **Reproduction**: compare `ai_gateway_service` mode detection with `tts_service`'s narrator-voice resolution — two independent paths to one decision.
- **Existing implementation to reuse**: C-487's operations; the existing per-agent/request connection override mechanism.
- **Known gaps**: no single resolver produces one snapshot per request; fallbacks to environment or first-row selection remain reachable.
- **Baseline tests**: gateway, TTS and image service tests plus `config_service.test.ts`.

## User Outcome

After this contract, a player sees the same configuration they selected during setup and settings actually used during gameplay, for narration, portraits and read-aloud alike, and it survives a reload.

## Scope Boundaries

- **In Scope:** one resolver returning a capability-discriminated provider/connection/model/endpoint/params snapshot per request; routing all existing text, image and TTS consumers through it; removing the temporary legacy mutation methods once call sites are covered.
- **Out of Scope:** UI redesign (C-495 onward), runtime lifecycle (C-489 through C-493), agent-pipeline redesign, and any new schema.

## Acceptance Criteria

### AC-1: One snapshot per request
**Given** a generation request for text, image or voice
**When** it is resolved
**Then** exactly one canonical snapshot supplies model, endpoint, auth and params, credentials reach only the transport, and no consumer independently looks up a key by registry ID or falls back to environment, localStorage or first-row selection.

**Verification**: recording transports for narration, dialogue, portrait, scene, narrator-voice and NPC-voice; assert one resolution per request and zero fallback paths.

### AC-2: Overrides inherit, pin and fail closed
**Given** an explicit request override, a role override, a capability default, and a `null` disable
**When** resolving
**Then** a valid explicit override wins, absent inherits, `null` disables, and an invalid or disabled selection fails closed rather than substituting another account or cloud.

**Verification**: resolver matrix across all three capabilities including dangling, cross-capability and disabled cases.

### AC-3: Reload parity and no silent substitution
**Given** a configuration exercised before a reload
**When** the app reloads and the same requests run
**Then** the effective configuration is identical, and changing a default leaves pinned or disabled overrides intact.

**Verification**: before/after reload integration tests; default-change tests asserting overrides survive.

### AC-4: Legacy mutation paths removed
**Given** full call-site coverage
**When** this contract completes
**Then** the temporary legacy mutation methods introduced by C-486 are removed, and no second store exists.

**Verification**: grep-level absence assertions plus the full client suite; migration fixtures still pass.

## Edge Cases & Gotchas

- **Premium migration check**: C-481 asks for an independent check of migration fixtures, effective routing and persistence after this slice — not a second broad redesign.
- **Existing overrides**: per-agent and per-request connection overrides stay supported through the same validation boundary; do not redesign agent pipelines to accommodate the resolver.
- **Projections**: `defaultConnectionId`, `defaultByCapability` and `isDefault` project capability defaults, not primary-role overrides. A consumer needing a role's actual selection uses the resolver.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
