---
id: C-497
title: "Integrate optional artwork and read-aloud without trapping text-ready play"
source: "Split of C-483 into PR-sized contracts; AI setup execution plan queue row U03"
contract_type: thin
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-06T03:20:00Z"
---

# Contract C-497: Optional image and read-aloud integration

## Metadata

| Field | Value |
|---|---|
| **Source** | [C-483](C-483-guided-ai-setup.md) AC-2 and AC-6; queue row U03 |
| **Target** | Guided setup routes and the optional-capability subflows |
| **Type** | thin |
| **Priority** | P2 — optional capabilities must never block play |
| **Dependencies** | C-496, C-499 |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal → none |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: image and voice setup sit beside text as equal tabs, so an optional failure can read as a blocked setup.
- **Reproduction**: fail an optional image setup and observe whether Start playing remains reachable.
- **Existing implementation to reuse**: C-495's components and C-496's routes; existing local and browser TTS paths.
- **Known gaps**: mixed-provider setup across capabilities is not proven; optional failure handling is undefined.
- **Baseline tests**: capability and TTS tests.

## User Outcome

After this contract, a player can add artwork or read-aloud from any mix of providers, and if optional setup fails they still start playing with text.

## Scope Boundaries

- **In Scope:** optional artwork and read-aloud selection within the guided flow, mixed online, existing-server and supported local providers per capability, and explicit later-setup access.
- **Out of Scope:** speech input, music, ambience and video activation; new image sidecars; settings pages (C-498 through C-500).

## Acceptance Criteria

### AC-1: Text is required, the rest optional and honest
**Given** the capability selection
**When** it renders
**Then** text is labeled required, artwork and read-aloud optional, and unfinished features are absent rather than shown as nonfunctional.

**Verification**: registry and platform fixtures; assert unsupported features render nothing.

### AC-2: Optional failure never blocks play
**Given** verified text and a failing optional setup
**When** the optional step fails or is skipped
**Then** Start playing reaches the existing character flow, with explicit access to finish the optional setup later.

**Verification**: optional-failed and mixed online/local E2E; assert the character flow is reachable.

### AC-3: Missing text explains itself without trapping the app
**Given** no usable text configuration
**When** the player tries to start
**Then** the required action is explained while settings and app exploration remain available, with no cloud or sign-in boot gate.

**Verification**: required-text-unavailable E2E asserting settings remain reachable.

### AC-4: Mixed providers resolve per capability
**Given** different providers chosen for text, image and voice
**When** each capability generates
**Then** each resolves to its own configured provider through the canonical resolver.

**Verification**: mixed-provider integration test with recording transports per capability.

## Edge Cases & Gotchas

- **Read-aloud is not volume**: generating speech is distinct from ordinary audio playback and volume, which stay under Audio settings.
- **No false promises**: never present an instantaneous-download promise for a model that must be fetched.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
