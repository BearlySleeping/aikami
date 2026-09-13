---
id: C-522
title: "Hub and client access to the generation runner"
source: "direct — 2026-09-13 asset generation and Emberwatch review"
contract_type: full
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-13T00:00:00Z"
---

# Contract C-522: Hub and client access to the generation runner

## Metadata

| Field | Value |
|---|---|
| **Source** | User request; [Asset generation review](../research/asset-generation-review-2026-09.md) |
| **Target** | Hub routes/services; local runner pairing; client connection and Studio composition |
| **Type** | full |
| **Priority** | P1 — production asset pipeline |
| **Dependencies** | C-518, C-519; C-512 recovery; C-521 for audio |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | User-facing generation/creating-assets guides; affected Hub help |
| **Contract version** | 1.0.0 |
| **Production Surface** | Hub `/studio/assets` (new Hub route) and client `/studio/assets`; tooling local-runner pairing command declared by implementation |

Allocated as C-522 during the 2026-09-13 import. The 2026-09-13 review pack proposed it as C-521; the asset-generation series shifted up by one because C-516 is the combat direct-control contract. Baseline: see `docs/research/asset-generation-review-2026-09.md`.
## Problem & Baseline Evidence

Hub has catalog/LPC/Map Studio surfaces but no authenticated job handoff to a creator GPU. A Cloudflare Worker cannot access the creator machine via localhost, and browser private-network/CORS behavior makes naive direct probing unreliable.

Inspect the source in the reuse map at current HEAD before implementation. Baseline is source-reviewed, not freshly test-executed. Run the related existing project tests before editing; do not copy old contract execution reports as current evidence.

## User Outcome

A creator can start and review an asset job in the Hub using their paired local runner, while local client/CLI generation continues without an account.

## Success Measures

- Every mandatory AC below has execution evidence on its named production/tooling path.
- Generation stays asynchronous; no model/GPU/network/sign-in dependency is added to game boot, play or saves.
- Generation latency is measured on named hardware, not inferred from vendor marketing. Cache/accepted outputs are reused without regeneration.

## Existing System & Reuse Map

| Existing source | Action |
|---|---|
| `apps/frontend/hub/src/lib/server/api/index.ts` | reuse session gates/unconfigured responses |
| `apps/frontend/hub/src/lib/server/api/map_studio.ts` | reuse ownership/CAS patterns |
| `packages/backend/database/` | D1 job dispatch metadata only |
| `apps/backend/local-stack/` | opt-in local runner lifecycle |
| `apps/frontend/client/src/lib/services/ai/connection_verifier.ts` | reuse configured endpoint discovery patterns |

## Overview

A creator can start and review an asset job in the Hub using their paired local runner, while local client/CLI generation continues without an account. This contract extends the existing C-510/C-511 architecture with the bounded behavior below. Keep storage, transport and view concerns in their established layers.

## Design Reference

Read AGENTS.md, .context/CONTEXT.md and .context/index.md; then the applicable .pi/skills conventions, existing contract dependencies, docs/contracts/SHARED_SECTIONS.md, and the execution directives in `docs/research/asset-generation-review-2026-09.md`. The supplied review identifies current-source contradictions; current code and verified production behavior take precedence over historical claims.

## Architecture Directives

- Hub browser and client are separate hosts even if route names match. Reuse shared schemas/recipe projection and UI components where appropriate; do not make Hub import client singletons or OPFS implementations.
- Implement a runner-initiated authenticated outbound claim/status flow. Use short-lived pairing code, explicit account/device binding, expiring/revocable narrowly scoped credentials and a creator-visible paired-device list. No public port-forward, public ComfyUI endpoint or Worker request to arbitrary private IPs.
- Hub stores owner-scoped dispatch/status metadata in D1; local runner remains authority for local execution and bytes. Jobs route to one paired device. Use claim leases with attempt generation/fencing to reject stale status/results. D1 uniqueness/CAS must enforce one claim; use existing Cloudflare queue infrastructure if present, not an assumed unconfigured service.
- A job contains allowlisted recipe/profile IDs and reference artifact IDs, never executable code, shell commands, arbitrary graph JSON or arbitrary callback/engine URL. Reject cross-owner references and device capability mismatches before claim.
- For remote review, the paired creator explicitly enables upload of private preview/output artifacts. Keep blobs in private staging with owner-scoped short-lived retrieval. This transfer is not community publication. If upload is off/unavailable, show local-only result and support export/import. Apply expiry and reference-aware cleanup.
- Client direct-loopback mode uses configured endpoints, explicit origin allowlist and paired local token. Verify browser secure-context, CORS and private/local-network permission behavior on supported targets. No wildcard credentialed CORS. If blocked, use the outbound-paired route when authorized or a portable bundle handoff; report the limitation accurately.
- Both UIs call the C-519 protocol through services. Show unavailable/disconnected/queued/running/preparing/review states and truthful cancel behavior. No secret API keys in browser bundles, query strings or logs.
- Offline local use and accepted-asset playback cannot depend on Hub sign-in/pairing. Closing Hub cannot cancel a durable local job accidentally. Revocation prevents new claims and result retrieval; define handling for an already running job without destroying its local result.

## State & Data Models

PairedRunner, DispatchLease and owner-scoped artifact tickets reference C-519 job IDs. Local execution state is reconciled with Hub dispatch, not overwritten by stale polling. Tokens contain scope/expiry and are stored using established secret-storage conventions.

All cross-boundary data has TypeBox schemas under packages/shared/schemas and Static-derived types under packages/shared/types. Portable generation core has no Bun/fs/Svelte imports. Use type aliases, not interfaces. New field names are proposed contracts, not claims that today's strict pack schemas already accept them.

## Quality Requirements

- **Offline/degraded mode:** accepted installed assets stay usable without the runner or Hub; unavailable generation returns a typed reason.
- **Accessibility/input:** labelled keyboard controls and status/error announcements for affected UI; CLI surfaces use stable JSON and meaningful exit codes.
- **Performance budget:** default GPU concurrency one; bounded job/payload/artifact sizes; media preparation off the game render thread. Measure wall time, decoded memory and queue behavior.
- **Security/privacy:** validate boundaries, keep secrets/private prompts out of public projections, permit only owned artifact references and supported operations.
- **Persistence/migration:** Add D1 pairing/dispatch records without changing identity or game-save ownership. Keep private staging separate from public catalog objects. Disable Hub generation routes to roll back; local jobs and accepted files remain intact. Expire/revoke credentials deliberately.
- **Cancellation/retry/idempotency:** distinguish stopped waiting from confirmed native cancellation; do not repeat uncertain generation automatically; byte identity is SHA-256.
- **Observability:** job/candidate/profile/hash IDs, stage timings and failure codes; no raw private prompts, credential material or audio/image payloads in routine logs.

## Migration & Rollback

Add D1 pairing/dispatch records without changing identity or game-save ownership. Keep private staging separate from public catalog objects. Disable Hub generation routes to roll back; local jobs and accepted files remain intact. Expire/revoke credentials deliberately.

## Scope Boundaries

Secure job dispatch/review for an existing local runner and Studio. No community publication, arbitrary remote execution or built-in hosted GPU fleet.

## Contract Size & Split Rule

This contract's single outcome is the User Outcome above. Keep implementation behind one coherent path; avoid parallel legacy/new authorities. If live-code discovery reveals another independently mergeable capability, document a follow-up rather than silently broadening this contract. See SHARED_SECTIONS.md.

## Acceptance Criteria

### AC-1: Three front doors share semantics

**Given** same locked request via CLI, client and paired Hub, **when** submit to one runner, **then** all produce the same effective request schema and candidate lineage, with a shared resource budget and no duplicated generation path.

### AC-2: Pairing and ownership

**Given** two accounts and two devices, **when** claim/read/cancel with crossed owner IDs or revoked tokens, **then** unauthorized requests fail, pending artifacts remain private, and revoked devices cannot claim new jobs.

### AC-3: Browser handoff works

**Given** supported browser and local runner plus a browser that blocks loopback access, **when** generate from the production Hub/client routes, **then** paired outbound mode completes; blocked direct mode offers an actionable fallback instead of a false success.

### AC-4: Disconnect is recoverable

**Given** running job and leased Hub dispatch, **when** close tab, interrupt network, restart runner, then reconnect, **then** status reconciles without duplicate submission; stale lease updates cannot overwrite a newer attempt.

### AC-5: No Hub dependency offline

**Given** cached assets/local models and no sign-in/network, **when** launch client, generate locally and play/save, **then** all local paths work; Hub generation is visibly unavailable without impairing game functionality.

### AC-6: Accessible review

**Given** completed image/audio job, **when** review via keyboard in Hub Studio, **then** progress/error announcements, image preview/audio controls, accept/reject and local-only/export states are usable.

**Evidence Matrix**

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | cross-surface integration | Test/log/media report for this scenario | Hub `/studio/assets` (new Hub route) and client `/studio/assets`; tooling local-runner pairing command declared by implementation | Unverified — populate during execution |
| AC-2 | security integration + Hub E2E | Test/log/media report for this scenario | Hub `/studio/assets` (new Hub route) and client `/studio/assets`; tooling local-runner pairing command declared by implementation | Unverified — populate during execution |
| AC-3 | browser E2E on target matrix | Test/log/media report for this scenario | Hub `/studio/assets` (new Hub route) and client `/studio/assets`; tooling local-runner pairing command declared by implementation | Unverified — populate during execution |
| AC-4 | failure injection integration | Test/log/media report for this scenario | Hub `/studio/assets` (new Hub route) and client `/studio/assets`; tooling local-runner pairing command declared by implementation | Unverified — populate during execution |
| AC-5 | offline production smoke | Test/log/media report for this scenario | Hub `/studio/assets` (new Hub route) and client `/studio/assets`; tooling local-runner pairing command declared by implementation | Unverified — populate during execution |
| AC-6 | Hub E2E + visual evidence | Test/log/media report for this scenario | Hub `/studio/assets` (new Hub route) and client `/studio/assets`; tooling local-runner pairing command declared by implementation | Unverified — populate during execution |

**Test Hooks**

- Baseline/targeted: existing affected tests under local-ai, schemas, frontend storage, client, Hub and scripts as applicable. Determine exact Moon project task names from current moon.yml; do not invent passing task output.
- Functional E2E: Playwright in apps/e2e/tests/client or tests/hub, exercising the production path above. Use compiled Svelte tests for reactivity/lifecycle.
- Visual: when UI/game rendering changes, use apps/e2e/src/visual/suites with the current defineConfig/export-default and TypeBox case conventions. Assess native-scale readability/geometry and accessible state presentation. Static contact sheets do not replace in-game/animation evidence.
- Audio: when audio changes, save measured reports and listening notes over delivered renditions; automated geometry/schema checks cannot hear a bad loop.
- Final gates: `bun moon run :validate`, applicable guards and touched-project tests. If a required tool/model is unavailable, identify the exact missing gate; do not mark verified/completed.

## Implementation Sequence

1. Implement authenticated owner/device pairing and dispatch CAS.
2. Implement runner outbound client with scoped artifact upload.
3. Wire Hub Studio and client transport adapters.
4. Run crossed-owner, reconnect and browser-origin production journeys.

## Edge Cases & Gotchas

A URL containing 127.0.0.1 is relative to the process making the request, not automatically the player device.

## Open Questions

No conceptual choice is required to begin the scoped implementation. Hardware, credentials, model/license eligibility and actual measured performance are execution preflight facts. Use the declared unavailable/fallback behavior rather than inventing access or silently expanding scope. Record any new material design question before changing the contract.

## Amendments

This is a newly proposed draft; existing contract approval/amendment rules still apply. Do not self-assign user approval or upgrade status based on this document's presence.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-09-13 | Initial proposed scope | Pending contract adoption |

## Promotion Lifecycle

See docs/contracts/SHARED_SECTIONS.md. An implemented code path without required production, visual or audio evidence is not release_verified.

## Status Lifecycle

See docs/contracts/SHARED_SECTIONS.md. Preserve accurate draft/implemented/verified/completed distinctions.
