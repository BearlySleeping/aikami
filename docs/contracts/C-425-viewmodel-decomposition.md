---
id: C-425
title: "ViewModel Decomposition — split the two oversized ViewModels into focused sub-services"
source: "Split out of C-424 v3.0.0 (2026-08-21) — structural refactor separated from user-facing surface work"
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-21"
---

# Contract C-425: ViewModel Decomposition

## Metadata

| Field | Value |
|---|---|
| **Source** | Split out of C-424. It was AC-4 there: a pure refactor with no user-facing outcome, bundled with three user-facing ACs and gating them on the riskiest item in the contract. |
| **Target** | `apps/frontend/client/src/lib/views/chat/chat_view_model.svelte.ts` (1100 lines); `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts` (1640 lines) |
| **Priority** | P2 — maintainability only. Real, but no player ever sees it. |
| **Sequence** | **6 of 6** — last, and deliberately so. Do this after C-424 has already removed duplicated message-layer code from both ViewModels; decomposing first would mean decomposing code that is about to be deleted. |
| **Dependencies** | C-424 (sequence 3) must be fully landed |
| **Status** | draft |
| **Promotion** | `integrated` |
| **Docs Impact** | internal |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

Two ViewModels carry far too many responsibilities. Line counts verified
2026-08-21:

| File | Lines |
|---|---|
| `views/combat/combat_view_model.svelte.ts` | 1640 |
| `views/chat/chat_view_model.svelte.ts` | 1100 |

For scale, the next-largest surfaces are `dialogue_overlay.svelte` at 692 and
`vendor_view.svelte` at 628.

`chat_view_model` alone owns: message state and persistence, the composer
draft, slash-command parsing and dispatch, bridge-tag parsing, connected-chat
cross-posting, the agent pipeline, CYOA choice application and history,
impersonation, branch switching and TTS. Those are not one responsibility.

The cost is concrete: merge conflicts on a hot file, and a test surface where
every test loads the whole object.

- **Reproduction**: `wc -l` on the two files; read either constructor.
- **Baseline tests**: `chat_view_model` tests, `combat_view_model.test.ts`.
  All must be green before starting and after every step.

## User Outcome

No user-visible change — that is the point, and it is the acceptance bar. A
**developer** can change one concern without loading the other nine, and two
people can work on the same surface without colliding.

## Success Measures

- **Time/latency target**: no runtime change. Composition happens at construction.
- **Offline/degraded behavior**: unchanged.
- **Production journey enabled**: none directly. This buys future contract
  velocity, nothing else. If it starts costing player-facing work, stop.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| ViewModel base | `BaseViewModel` / `BaseViewModelContainer` | reuse — unchanged |
| Chat ViewModel | `chat_view_model.svelte.ts` | refactor — compose sub-services |
| Combat ViewModel | `combat_view_model.svelte.ts` | refactor — compose sub-services |
| Existing sub-VM pattern | `choice_buttons_view_model.svelte.ts` | reference — a working example of a focused child |

## Overview

Extract cohesive concerns out of each ViewModel into focused objects the
ViewModel composes and delegates to, preserving the public interface exactly so
no view and no existing test changes.

## Design Reference

- `choice_buttons_view_model.svelte.ts` — the pattern: a small ViewModel owning
  one concern, constructed by its parent, exposed through a typed interface.
- `BaseViewModel` — the base to keep using for sub-services with reactive state.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **The public `…ViewModelInterface` of each ViewModel does not change.** Views
  are untouched. This is the constraint that makes the refactor safe.
- Extract by concern, not by line count. Candidate seams:
  - *chat*: message state + persistence; composer/draft; slash commands;
    agent pipeline; CYOA + choice history.
  - *combat*: turn/initiative state; dice resolution; combat log.
  Confirm each seam against the code before extracting — do not treat this list
  as the plan.
- One concern per commit. Each extraction lands separately with the full suite
  green; do not batch extractions.
- Sub-services get their own focused tests. The parent keeps its existing tests
  **unmodified**.
- If a seam cannot be extracted without changing behaviour, **leave it**. A
  1640-line file with one honest seam removed is better than a broken refactor.

## State & Data Models

No new persistent state, no new schemas, no serialised types. Sub-services are
internal objects composed at construction.

## Quality Requirements

- **Offline/degraded mode**: unchanged.
- **Accessibility/input**: unaffected — no markup changes.
- **Performance budget**: no regression. Composition is construction-time.
- **Security/privacy**: no data-flow change.
- **Persistence/migration**: none.
- **Cancellation/retry/idempotency**: streaming, abort and retry behaviour
  preserved exactly — combat and chat both hold abort controllers; verify
  ownership does not fragment across sub-services.
- **Observability**: existing `debug`/`warn` calls must survive the move.
  A silently dropped log is a regression.

## Migration & Rollback

No persistent state. **Rollback**: revert per extraction — each is a separate,
independently revertible commit.

## Scope Boundaries

- **In Scope:** extracting cohesive sub-services from the two named
  ViewModels; tests for each sub-service; preserving public interfaces.
- **Out of Scope:** any behaviour change; any view change; other ViewModels;
  changing the `BaseViewModel` pattern; renaming public members;
  "while I'm here" improvements of any kind.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**One increment per extracted concern.** Chat first (smaller, and C-424 will
have already thinned it), combat second. Any extraction may be abandoned
without abandoning the contract.

## Acceptance Criteria

### AC-1: Chat ViewModel decomposed with zero behaviour change

**Given** `chat_view_model.svelte.ts`
**When** cohesive concerns are extracted into composed sub-services
**Then** its public interface is unchanged, **every existing chat test passes
unmodified**, and each extracted sub-service has its own tests.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + E2E | existing `chat_view_model` tests **unmodified** + new sub-service tests | chat | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-unit`, `moon run e2e:test-client`
- Integration: full chat session E2E. **If an existing test needed editing,
  behaviour changed — that is a fail.**

### AC-2: Combat ViewModel decomposed with zero behaviour change

**Given** `combat_view_model.svelte.ts`
**When** cohesive concerns are extracted
**Then** its public interface is unchanged, every existing combat test passes
unmodified, and each sub-service has its own tests.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + E2E | existing `combat_view_model.test.ts` **unmodified** + new sub-service tests | combat | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-unit`, `moon run e2e:test-client`
- Integration: full combat encounter E2E, including flee and defeat paths.

### AC-3: Each sub-service has one nameable responsibility

**Given** each extracted sub-service
**When** reviewed
**Then** its responsibility can be stated in one sentence without "and", it has
its own tests, and it does not reach back into its parent ViewModel.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Review | One-sentence responsibility per sub-service, recorded in the Execution Report | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun run typecheck`
- Integration: reviewer confirms no parent back-reference and no shared mutable
  state between siblings.

> **Deliberately not an acceptance criterion:** line-count reduction. It rewards
> moving code between files rather than improving it, and a decomposition that
> merely relocates 1640 lines into six files has achieved nothing. AC-3 is the
> real bar.

## Implementation Sequence

1. **Phase 1** — Confirm C-424 has landed and re-measure both files; the seams
   may look different once duplicated message-layer code is gone.
2. **Phase 2 (Chat)** — Extract one concern. Full suite. Ship. Repeat.
3. **Phase 3 (Combat)** — Same, one concern at a time.
4. **Phase 4 (Validation)** — Full client suite, E2E, `bun run typecheck`.

## Edge Cases & Gotchas

- Svelte 5 runes: `$state` in an extracted class stays reactive only if the
  instance is reached through a live reference. Verify reactivity after the
  first extraction before doing five more.
- Both ViewModels own abort controllers and streaming state. Splitting a
  concern that shares an abort signal can silently break cancellation without
  failing a test — exercise abort explicitly.
- `BaseViewModel.create()` and the container lifecycle: sub-services must be
  disposed with their parent or listeners leak across chat switches.
- The chat ViewModel's slash-command intercept will have changed under C-421
  (dice routing). Rebase on it rather than reverting it.
- This contract has no player-visible payoff. If a player-facing contract needs
  attention, it outranks this one every time.

## Open Questions

Must be resolved before status becomes `approved`:

- **OQ-1 — is this worth doing at all right now?** It is real debt, but it buys
  no player value, and C-424 will already have removed a meaningful slice of
  both files. **Recommendation: re-measure after C-424 lands and decide then.**
  If chat drops below ~700 lines, defer this contract indefinitely rather than
  refactoring for its own sake.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-08-21 | Split out of C-424 AC-4 (v2 contract format; this is the contract's first revision). Replaced "line-count reduction is verified" with a single-responsibility bar (AC-3) and recorded why. Added the zero-behaviour-change constraint as the safety property, runes/abort/lifecycle gotchas, and OQ-1 questioning whether the contract should run at all after C-424. | review 2026-08-21 |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

Target: **`integrated`**. No visual evidence required — there is nothing to see.

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
