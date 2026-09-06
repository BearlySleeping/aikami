---
id: C-487
title: "Share connection setup, verification and model-discovery operations"
source: "Split of C-481 into PR-sized contracts; AI setup execution plan queue row P07"
contract_type: thin
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-06T03:20:00Z"
---

# Contract C-487: Shared connection setup and verification operations

## Metadata

| Field | Value |
|---|---|
| **Source** | [C-481](C-481-ai-configuration-convergence.md) Architecture Directives; queue row P07 |
| **Target** | `apps/frontend/client/src/lib/services/ai/`, `packages/frontend/ai-gateway/` |
| **Type** | thin |
| **Priority** | P1 — onboarding and settings must share one set of setup operations |
| **Dependencies** | C-486 |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal → none |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: `ai_settings_view_model.svelte.ts` owns HTTP and model-listing rules directly; `connection_verifier.ts` (added by the P02 work) owns probe logic separately. Onboarding cannot reuse either without mounting the settings ViewModel.
- **Reproduction**: inspect `fetchModels` and `PROVIDER_MODEL_FETCH` usage in the settings ViewModel — the orchestration lives in the ViewModel, not a service.
- **Existing implementation to reuse**: `connection_verifier.ts` and its injectable `FetchTransport`; existing gateway protocol adapters, cancellation and typed errors.
- **Known gaps**: no shared "apply configuration" operation; model discovery and verification are not expressed as cancellable operations with deadlines.
- **Baseline tests**: `connection_verifier.test.ts`, `ai_settings_view_model.test.ts`.

## User Outcome

After this contract, a player gets identical endpoint validation, credential reuse, model discovery and verification behavior whether they are in first-run setup or in settings, because both call the same operations.

## Scope Boundaries

- **In Scope:** shared setup services owning endpoint validation, credential reuse, model discovery, verification and applying configuration; deadlines and caller cancellation; stale-response rules; typed redacted failures.
- **Out of Scope:** consumer routing (C-488), installer or runtime lifecycle (C-489 through C-493), UI composition (C-495 onward), and new provider integrations.

## Acceptance Criteria

### AC-1: One operation set, two callers
**Given** the settings surface and a non-settings caller
**When** each validates an endpoint, reuses a credential, lists models or verifies a connection
**Then** both call the same service operations, and ViewModels own only drafts and presentation.

**Verification**: tests drive the operations directly and through the real settings ViewModel; no HTTP orchestration remains in the ViewModel.

### AC-2: Endpoint and account identity are respected
**Given** two instances sharing a registry ID and a rotated credential
**When** any operation runs
**Then** each uses its own endpoint and optional authentication, no request reaches another instance, and rotation preserves `providerId`.

**Verification**: recording transport asserts requested URL and headers per instance; fixture credentials only, never real secrets.

### AC-3: Explicit action, deadline, cancellation and staleness
**Given** an in-flight setup operation
**When** the caller cancels, the deadline elapses, or a newer request supersedes it
**Then** the operation stops, a stale response cannot overwrite a newer draft or mark a changed configuration verified, and nothing runs on mount.

**Verification**: abort, timeout and interleaved-request tests; assert zero requests on mount.

### AC-4: Discovery failure still permits a manual model
**Given** a provider whose model listing is unsupported or failing
**When** the player supplies a model ID manually and the adapter supports it
**Then** the configuration saves, remains usable, and is never marked ready on that basis.

**Verification**: unsupported-listing and listing-error fixtures; saving unverified configuration is allowed and explicitly not ready.

### AC-5: Failures are typed and redacted
**Given** any operation failure
**When** it is logged or turned into a user-visible error
**Then** it is one of not-configured, unsupported, invalid config, auth, transport/timeout, cancelled, stale result, locked/corrupt/unsupported-version vault or persistence conflict/failure, and redaction happens before logging.

**Verification**: per-case tests; assert no raw provider response body and no secret-bearing URL appears in any message.

## Edge Cases & Gotchas

- **Not inference proof**: health, auth and model-listing success prove reachability, not that the selected model can generate. Paid tests, previews or private prompt transmission require explicit informed consent.
- **Transport policy**: credential-bearing traffic requires HTTPS and an approved origin; HTTP is permitted only with no attached credential. Never forward keys across an unencrypted or unapproved redirect, and reject URL user-info credentials.
- **No policy weakening**: do not relax browser CORS, mixed-content or CSP, or native permissions, to make a test pass.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
