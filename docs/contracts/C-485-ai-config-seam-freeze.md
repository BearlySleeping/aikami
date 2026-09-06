---
id: C-485
title: "Freeze the AI configuration schema, definition and storage seams"
source: "Split of C-481 into PR-sized contracts; AI setup execution plan queue row P05"
contract_type: thin
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-06T03:20:00Z"
---

# Contract C-485: AI configuration seam and typed API freeze

## Metadata

| Field | Value |
|---|---|
| **Source** | [C-481](C-481-ai-configuration-convergence.md) architecture directives; queue row P05 |
| **Target** | `packages/shared/schemas/src/lib/domain/providers_config.ts`, `packages/shared/types/src/lib/domain/`, `packages/shared/constants/src/lib/providers.ts` |
| **Type** | thin |
| **Priority** | P1 — every later C-481 and C-482 slice builds against these exports |
| **Dependencies** | C-481 (parent specification), C-463 |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal → none |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: `providers_config.ts` defines v1 and `VaultPayloadV2Schema` (`schemaVersion: 2`). There is no v3 schema and no `routing` shape.
- **Reproduction**: grep the schemas package for `schemaVersion` — only 1 and 2 appear.
- **Existing implementation to reuse**: `AiProviderSchema`, `AiConnectionSchema`, `RoleAssignmentsSchema` keep their exported names; `providers.ts` registries supply capability metadata.
- **Known gaps**: capability, locality and required-key rules are re-derived in `ai_settings_view_model.svelte.ts` and `connection_verifier.ts` (`LOCAL_PROVIDERS`, `OLLAMA_NATIVE`, `OPENAI_COMPAT`). `config_service._findProviderByRegistry` resolves an account by first registry-ID match, which C-481 forbids.
- **Baseline tests**: `config_service.test.ts`, `config_migration.test.ts`, schemas package tests. Run before starting; record actual counts.

## User Outcome

After this contract, a developer can build the remaining AI configuration work against one frozen, tested set of schema, definition and storage seams instead of re-deriving provider rules per call site.

## Scope Boundaries

- **In Scope:** the v3 payload and `routing` schemas alongside v1/v2; their inferred types; capability/provider definitions with typed accessors; a typed storage/restore interface; typed failure taxonomy; tests for every export added.
- **Out of Scope:** writing `schemaVersion: 3` anywhere, changing `config_service.load()`/`save()` behavior, migration transformations (C-486), setup operations (C-487), consumer routing (C-488), and every C-482 installer concern.

## Acceptance Criteria

### AC-1: v3 schema exists without being activated
**Given** the shipped v2 vault format
**When** the v3 schema and types are added
**Then** v3 validates `schemaVersion: 3`, `providers`, canonical `connections`, `routing` and preserved options/presets, while `config_service` still loads and saves v2 exactly as before and nothing writes v3.

**Verification**: schema tests for valid/invalid v3 payloads; existing v1/v2 fixtures still validate; `config_service.test.ts` unchanged in behavior.

### AC-2: Routing expresses inherit, pin and disable distinctly
**Given** sparse capability defaults and sparse role overrides
**When** an override is absent, set to a connection ID, or set to `null`
**Then** the three states are distinguishable in the type itself, not by convention.

**Verification**: type-level and schema tests asserting all three states round-trip and that absent is not conflated with `null`.

### AC-3: Params are capability-discriminated and identity is stable
**Given** a text, image or voice connection
**When** it is validated or an account is selected
**Then** params are discriminated by capability in the schema — a text connection cannot validate with image params — and an account resolves by stable `providerId` across a credential rotation, with two instances sharing a registry ID remaining distinct.

**Verification**: schema rejection tests per capability; identity tests for rotation and duplicate registry IDs; any first-registry-match helper removed or deprecated with its replacement in place.

### AC-4: Definitions are single-source and unsupported operations are typed
**Given** a capability/provider definition
**When** locality, required URL/key rules or model-discovery support are needed
**Then** they are read from the definition, an advertised operation without schema and adapter support fails a registry test, and an unsupported operation returns typed unavailability rather than defaulting to text.

**Verification**: registry tests distinguishing usable definitions from label-only stubs; `voice` remains the TTS key; STT/music/ambience/video stay unsupported.

### AC-5: Storage and restore seams are frozen and testable
**Given** a vault that is absent, locked, corrupt or of an unknown version
**When** the storage seam reads it
**Then** the four cases are distinguished, reads never rewrite storage, PIN/key handling and snapshot-before-rewrite are expressed in the interface, and crash/retry leaves the original intact.

**Verification**: fake-adapter tests for all four cases plus crash/retry; no live vault rewrite in this contract.

## Edge Cases & Gotchas

- **Public API freeze**: prefer fewer, well-named exports — every export here is one C-486 through C-488 and C-490 must build against. Return the frozen export list in the execution report; that list is the real deliverable.
- **Four distinct facts**: feature support, reachability, selected-model compatibility and last successful generation must stay distinguishable in the types. C-465 and the P03 work established this in presentation; the seam must not collapse it again.
- **No speculative framework**: no new persistence system or capability registry that C-481 assigns to later slices.
- **Dependency direction**: schemas, types and constants live in `packages/shared/*` and apps import them (`@aikami/schemas`, `@aikami/types`, `@aikami/constants`) — that is the whole point of the freeze. The forbidden direction is the reverse: no shared package may import from `apps/**`, and no app may re-export a shared type as its own.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
