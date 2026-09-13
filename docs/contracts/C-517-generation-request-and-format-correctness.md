---
id: C-517
title: "Generation request and format correctness"
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

# Contract C-517: Generation request and format correctness

## Metadata

| Field | Value |
|---|---|
| **Source** | User request; [Asset generation review](../research/asset-generation-review-2026-09.md) |
| **Target** | packages/shared/local-ai; packages/shared/schemas; image CLI |
| **Type** | full |
| **Priority** | P1 — production asset pipeline |
| **Dependencies** | C-510, C-511 |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | User-facing generation/creating-assets guides; affected Hub help |
| **Contract version** | 1.0.0 |
| **Production Surface** | tooling: `bun run --cwd apps/backend/image generate:asset` |

Allocated as C-517 during the 2026-09-13 import. The 2026-09-13 review pack proposed it as C-516; the asset-generation series shifted up by one because C-516 is the combat direct-control contract. Baseline: see `docs/research/asset-generation-review-2026-09.md`.
## Problem & Baseline Evidence

ACE-Step replaces positivePrompt with recipe tags when tags are present; all shipped audio recipes provide tags. Portrait/expression recipes declare WebP while engines may return PNG, which toGeneratedAsset correctly rejects. BPM/key are recorded as though meaningful but are not mapped to native conditioning in the current v1 transport.

Inspect the source in the reuse map at current HEAD before implementation. Baseline is source-reviewed, not freshly test-executed. Run the related existing project tests before editing; do not copy old contract execution reports as current evidence.

## User Outcome

A creator gets an asset based on the actual requested subject, with an honest output format and effective-parameter report.

## Success Measures

- Every mandatory AC below has execution evidence on its named production/tooling path.
- Generation stays asynchronous; no model/GPU/network/sign-in dependency is added to game boot, play or saves.
- Generation latency is measured on named hardware, not inferred from vendor marketing. Cache/accepted outputs are reused without regeneration.

## Existing System & Reuse Map

| Existing source | Action |
|---|---|
| `packages/shared/local-ai/src/lib/engines/ace_step_engine.ts` | modify request compiler |
| `packages/shared/local-ai/src/lib/recipes/recipes.json` | correct immediate output defaults |
| `packages/shared/local-ai/src/lib/generated_asset.ts` | retain format validation |
| `packages/shared/local-ai/src/lib/asset_generation.test.ts` | extend CI-covered integration fixtures |

## Overview

A creator gets an asset based on the actual requested subject, with an honest output format and effective-parameter report. This contract extends the existing C-510/C-511 architecture with the bounded behavior below. Keep storage, transport and view concerns in their established layers.

## Design Reference

Read AGENTS.md, .context/CONTEXT.md and .context/index.md; then the applicable .pi/skills conventions, existing contract dependencies, docs/contracts/SHARED_SECTIONS.md, and the execution directives in `docs/research/asset-generation-review-2026-09.md`. The supplied review identifies current-source contradictions; current code and verified production behavior take precedence over historical claims.

## Architecture Directives

- Combine subject/positivePrompt and style tags into the ACE-Step prompt in one deterministic shared function. An explicit tags override must not erase the subject. Preserve lyrics/instrumental handling. Do not silently delete user detail in an LLM rewrite.
- Keep `requested`, `effective` and `measured` parameters distinct. For ACE-Step v1, BPM/key may be textual hints in the prompt; they are not native hard controls or measured output facts. Unsupported hard constraints fail before dispatch.
- Make portrait/expression recipe defaults PNG on the current PNG path. Later WebP requires an actual C-520 transformation; no extension relabeling. Decode/sniff returned bytes before acceptance, including a provider claiming the wrong Content-Type.
- Keep old CLI syntax and the v1 adapter operational. Do not change engine IDs to make a compatibility test green. C-511 already separates common engine IDs from persisted image preferences; preserve that current code, despite stale contract prose.
- Add CI tests under local-ai, not exclusively the image app whose live tests may be excluded from CI.

## State & Data Models

Add a schema-derived request audit with requested/effective fields and optional measured fields; do not invent measurements when the model only echoes a request. Existing descriptors remain readable.

All cross-boundary data has TypeBox schemas under packages/shared/schemas and Static-derived types under packages/shared/types. Portable generation core has no Bun/fs/Svelte imports. Use type aliases, not interfaces. New field names are proposed contracts, not claims that today's strict pack schemas already accept them.

## Quality Requirements

- **Offline/degraded mode:** accepted installed assets stay usable without the runner or Hub; unavailable generation returns a typed reason.
- **Accessibility/input:** labelled keyboard controls and status/error announcements for affected UI; CLI surfaces use stable JSON and meaningful exit codes.
- **Performance budget:** default GPU concurrency one; bounded job/payload/artifact sizes; media preparation off the game render thread. Measure wall time, decoded memory and queue behavior.
- **Security/privacy:** validate boundaries, keep secrets/private prompts out of public projections, permit only owned artifact references and supported operations.
- **Persistence/migration:** Additive audit fields; existing rows and staged bytes remain untouched. Read old descriptors as legacy metadata. Revert new recipes/compiler if needed; do not mutate accepted old files.
- **Cancellation/retry/idempotency:** distinguish stopped waiting from confirmed native cancellation; do not repeat uncertain generation automatically; byte identity is SHA-256.
- **Observability:** job/candidate/profile/hash IDs, stage timings and failure codes; no raw private prompts, credential material or audio/image payloads in routine logs.

## Migration & Rollback

Additive audit fields; existing rows and staged bytes remain untouched. Read old descriptors as legacy metadata. Revert new recipes/compiler if needed; do not mutate accepted old files.

## Scope Boundaries

Request semantics, format correctness, precise documentation. Excludes new models, job persistence, Studio and publication.

## Contract Size & Split Rule

This contract's single outcome is the User Outcome above. Keep implementation behind one coherent path; avoid parallel legacy/new authorities. If live-code discovery reveals another independently mergeable capability, document a follow-up rather than silently broadening this contract. See SHARED_SECTIONS.md.

## Acceptance Criteria

### AC-1: Prompt reaches transport

**Given** music, sfx and ambient recipes each contain generic tags, **when** generate three different subject prompts and inspect the submitted HTTP body, **then** each body includes its subject and style tags; explicit overrides, empty tags and instrumental lyrics behave deterministically.

### AC-2: Bytes agree with format

**Given** PNG and WebP fixture engines, **when** run portrait/expression generation plus mislabeled-byte failures, **then** valid results have matching decoded format, MIME, extension and descriptor hash; incompatible results fail before staging.

### AC-3: Controls are honest

**Given** BPM/key and unsupported hard controls are requested, **when** compile and submit through ACE-Step v1, **then** effective hints are visible and requested values are not presented as measured metadata; unsupported controls have a readable error.

### AC-4: Existing behavior survives

**Given** existing prop/audio fixtures and an aborted request, **when** run scoped tests and one reachable-engine smoke if hardware is available, **then** old syntax, seed handling, timeout and truthful cancel capabilities remain correct; unavailable hardware is recorded as unverified.

**Evidence Matrix**

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | CI integration + payload assertions | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:asset` | Unverified — populate during execution |
| AC-2 | CLI integration + decoder fixture | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:asset` | Unverified — populate during execution |
| AC-3 | unit + CLI smoke | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:asset` | Unverified — populate during execution |
| AC-4 | integration + smoke | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:asset` | Unverified — populate during execution |

**Test Hooks**

- Baseline/targeted: existing affected tests under local-ai, schemas, frontend storage, client, Hub and scripts as applicable. Determine exact Moon project task names from current moon.yml; do not invent passing task output.
- Functional E2E: Playwright in apps/e2e/tests/client or tests/hub, exercising the production path above. Use compiled Svelte tests for reactivity/lifecycle.
- Visual: when UI/game rendering changes, use apps/e2e/src/visual/suites with the current defineConfig/export-default and TypeBox case conventions. Assess native-scale readability/geometry and accessible state presentation. Static contact sheets do not replace in-game/animation evidence.
- Audio: when audio changes, save measured reports and listening notes over delivered renditions; automated geometry/schema checks cannot hear a bad loop.
- Final gates: `bun moon run :validate`, applicable guards and touched-project tests. If a required tool/model is unavailable, identify the exact missing gate; do not mark verified/completed.

## Implementation Sequence

1. Capture current payload and MIME failure fixtures.
2. Fix shared compilation and immediate recipe output declarations.
3. Update CLI effective-parameter reporting and guide.
4. Run local-ai tests plus affected CLI tests; record actual smoke evidence.

## Edge Cases & Gotchas

A fake server echoing the prompt is transport evidence only, not semantic audio-quality evidence.

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
