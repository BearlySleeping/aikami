---
id: C-520
title: "Versioned image workflows and asset preparation"
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

# Contract C-520: Versioned image workflows and asset preparation

## Metadata

| Field | Value |
|---|---|
| **Source** | User request; [Asset generation review](../research/asset-generation-review-2026-09.md) |
| **Target** | shared local-ai engines/recipes; local-stack model manifest; deterministic media processors; existing prop/LPC previews |
| **Type** | full |
| **Priority** | P1 — production asset pipeline |
| **Dependencies** | C-518, C-519; C-512 for Studio review UI |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | User-facing generation/creating-assets guides; affected Hub help |
| **Contract version** | 1.0.0 |
| **Production Surface** | tooling: `bun run --cwd apps/backend/image generate:batch`; client `/studio/assets` after C-512 recovery |

Allocated as C-520 during the 2026-09-13 import. The 2026-09-13 review pack proposed it as C-519; the asset-generation series shifted up by one because C-516 is the combat direct-control contract. Baseline: see `docs/research/asset-generation-review-2026-09.md`.
## Problem & Baseline Evidence

ComfyUI currently has an SD-style graph with LoRA/reference capabilities disabled, and recipe postprocess steps are rejected as unimplemented. Generated images do not carry proven alpha, native geometry, frame layout or deterministic atlas preparation.

Inspect the source in the reuse map at current HEAD before implementation. Baseline is source-reviewed, not freshly test-executed. Run the related existing project tests before editing; do not copy old contract execution reports as current evidence.

## User Outcome

A creator can produce and review a native-scale prop or portrait using a reference-controlled workflow, with deterministic preparation and an auditable rejection reason.

## Success Measures

- Every mandatory AC below has execution evidence on its named production/tooling path.
- Generation stays asynchronous; no model/GPU/network/sign-in dependency is added to game boot, play or saves.
- Generation latency is measured on named hardware, not inferred from vendor marketing. Cache/accepted outputs are reused without regeneration.

## Existing System & Reuse Map

| Existing source | Action |
|---|---|
| `packages/shared/local-ai/src/lib/engines/comfyui_engine.ts` | extend via versioned profile strategy |
| `packages/shared/local-ai/src/lib/recipes/recipe_registry.ts` | validate typed profiles/capabilities |
| `scripts/src/lib/ops/generate_emberwatch_props_atlas.ts` | reuse actual packing/frame format |
| `docs/plans/emberwatch_rebuild.md` | native-scale/alpha/occlusion requirements |
| `apps/frontend/hub/src/lib/views/` | reuse existing LPC/asset preview components |

## Overview

A creator can produce and review a native-scale prop or portrait using a reference-controlled workflow, with deterministic preparation and an auditable rejection reason. This contract extends the existing C-510/C-511 architecture with the bounded behavior below. Keep storage, transport and view concerns in their established layers.

## Design Reference

Read AGENTS.md, .context/CONTEXT.md and .context/index.md; then the applicable .pi/skills conventions, existing contract dependencies, docs/contracts/SHARED_SECTIONS.md, and the execution directives in `docs/research/asset-generation-review-2026-09.md`. The supplied review identifies current-source contradictions; current code and verified production behavior take precedence over historical claims.

## Architecture Directives

- Keep sd.cpp as the lightweight existing default. Add an opt-in pinned FLUX.2-klein-base-4B ComfyUI profile first, with exact checkpoint/encoder/VAE dependencies, checksums and workflow version. Select quantization only after compatibility/quality measurement. Qwen-Image-Edit-2511 is an optional challenger, not a mandatory download.
- Profiles declare semantic inputs and supported capabilities. Use installed node-schema introspection to validate the complete graph. No arbitrary workflow JSON/custom Python supplied by Hub or an LLM; only locally installed allowlisted templates. A legacy SD profile stays available.
- A future Mystic07 experimental profile must name FLUX.2-klein-base-9B, the exact LoRA checkpoint/hash and rights decision. Never attach its weights to the 4B base. Keep it excluded from production presets and normal model install. If rights are unresolved, provide a blocked benchmark fixture instead of downloading/running it.
- Generate individual source objects or reference edits. Derive terrain corner masks, frame packing and atlas metadata with code. Never ask diffusion to invent the runtime's exact atlas grid, collision or semantic IDs.
- Preserve raw source bytes. Implement typed preparation operations with pinned versions: decode/orient; deliberate resample with locked method; alpha extraction/cleanup; crop/trim preserving a ground-contact origin; frame packing with padding/extrusion; encode. Distinguish a stochastic segmentation model from deterministic cleanup and record it separately.
- Validate full-alpha ground versus isolated transparent props; checkerboard/colored-background suspicion requires review. Never remove opaque green by color key alone. Check alpha fringes on light/dark backgrounds, canvas bounds, clipped content and native 1x readability.
- Pixel-art resampling is per approved profile: nearest-neighbor for true pixel clusters; a deliberately reviewed downsample for oversized painted sources. Do not silently stretch width and height independently. State variants must share canvas, ground-contact and silhouette geometry; use edits/masks to change ward light rather than generating unrelated trees.
- Sprite-sheet QA reads actual LPC action/direction/frame conventions from repository constants. Reject missing/duplicate frames, wrong facing order, drifting feet, inconsistent body size and cut-off equipment. Show animated 1x playback. Human review required; geometry checks alone do not prove temporal coherence.
- Atlas pages target ≤2048 pixels per axis; measure decoded memory. Stable semantic frame names and trim/origin data survive repacking. Terrain capacity expansion is explicit and separate from prop pages.

## State & Data Models

WorkflowProfile identifies engine/model family, workflow hash, dependencies, semantic inputs and proven capabilities. PreparationProfile identifies transformations, source/output roles and QA limits. MediaValidationReport names exact raw/prepared hashes and machine/manual findings.

All cross-boundary data has TypeBox schemas under packages/shared/schemas and Static-derived types under packages/shared/types. Portable generation core has no Bun/fs/Svelte imports. Use type aliases, not interfaces. New field names are proposed contracts, not claims that today's strict pack schemas already accept them.

## Quality Requirements

- **Offline/degraded mode:** accepted installed assets stay usable without the runner or Hub; unavailable generation returns a typed reason.
- **Accessibility/input:** labelled keyboard controls and status/error announcements for affected UI; CLI surfaces use stable JSON and meaningful exit codes.
- **Performance budget:** default GPU concurrency one; bounded job/payload/artifact sizes; media preparation off the game render thread. Measure wall time, decoded memory and queue behavior.
- **Security/privacy:** validate boundaries, keep secrets/private prompts out of public projections, permit only owned artifact references and supported operations.
- **Persistence/migration:** Add profiles/processor versions without rewriting accepted originals. Existing recipes keep their legacy profile. New prepared artifacts receive new hashes; preserve old pack references and allow profile rollback. Disable experimental profiles independently.
- **Cancellation/retry/idempotency:** distinguish stopped waiting from confirmed native cancellation; do not repeat uncertain generation automatically; byte identity is SHA-256.
- **Observability:** job/candidate/profile/hash IDs, stage timings and failure codes; no raw private prompts, credential material or audio/image payloads in routine logs.

## Migration & Rollback

Add profiles/processor versions without rewriting accepted originals. Existing recipes keep their legacy profile. New prepared artifacts receive new hashes; preserve old pack references and allow profile rollback. Disable experimental profiles independently.

## Scope Boundaries

Pinned visual workflows, deterministic preparation and actionable visual QA. Does not redesign map topology, replace LPC wholesale or build a procedural region compiler.

## Contract Size & Split Rule

This contract's single outcome is the User Outcome above. Keep implementation behind one coherent path; avoid parallel legacy/new authorities. If live-code discovery reveals another independently mergeable capability, document a follow-up rather than silently broadening this contract. See SHARED_SECTIONS.md.

## Acceptance Criteria

### AC-1: Profile genuinely runs

**Given** a pinned compatible local ComfyUI install and 4B model, **when** submit a reference-bound prop through the common batch runner, **then** the semantic inputs reach the right graph nodes; the prepared artifact resolves through the existing registry; unavailable nodes/models fail before submit.

### AC-2: No false LoRA capability

**Given** legacy SD profile and incompatible/unapproved LoRA request, **when** compile/run, **then** unsupported model-family/LoRA combinations fail before HTTP submission; capability UI matches the selected profile.

### AC-3: Deterministic preparation

**Given** one fixed raw image and processor profile, **when** prepare twice and pack with unrelated props inserted, **then** prepared bytes/hashes are repeatable on the pinned processor; stable frame identities/origins are preserved; no ground rectangle or alpha fringe passes review.

### AC-4: State edit remains aligned

**Given** one accepted ward-tree base, **when** prepare its repaired/depowered variants, **then** origin/canvas/footprint are unchanged; only approved visual regions differ; swaps do not jump in the game preview.

### AC-5: Animation is judged as animation

**Given** LPC-valid baseline and malformed generated sheets, **when** validate and play each at native scale, **then** bad frame order/count/baseline is rejected, reviewer sees motion not only a contact sheet, and existing LPC stays the release fallback.

### AC-6: Atlas remains bounded

**Given** an irregular prop set and full terrain atlas, **when** compile pack artifacts, **then** frame bounds/padding are valid, capacity overflow fails visibly, and maps resolve every referenced frame.

**Evidence Matrix**

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | profile integration + live GPU smoke | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:batch`; client `/studio/assets` after C-512 recovery | Unverified — populate during execution |
| AC-2 | unit + Studio smoke | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:batch`; client `/studio/assets` after C-512 recovery | Unverified — populate during execution |
| AC-3 | fixture integration + native-scale contact sheet | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:batch`; client `/studio/assets` after C-512 recovery | Unverified — populate during execution |
| AC-4 | visual + game scene smoke | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:batch`; client `/studio/assets` after C-512 recovery | Unverified — populate during execution |
| AC-5 | animation fixture + production preview | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:batch`; client `/studio/assets` after C-512 recovery | Unverified — populate during execution |
| AC-6 | engine integration + walk-behind scene | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:batch`; client `/studio/assets` after C-512 recovery | Unverified — populate during execution |

**Test Hooks**

- Baseline/targeted: existing affected tests under local-ai, schemas, frontend storage, client, Hub and scripts as applicable. Determine exact Moon project task names from current moon.yml; do not invent passing task output.
- Functional E2E: Playwright in apps/e2e/tests/client or tests/hub, exercising the production path above. Use compiled Svelte tests for reactivity/lifecycle.
- Visual: when UI/game rendering changes, use apps/e2e/src/visual/suites with the current defineConfig/export-default and TypeBox case conventions. Assess native-scale readability/geometry and accessible state presentation. Static contact sheets do not replace in-game/animation evidence.
- Audio: when audio changes, save measured reports and listening notes over delivered renditions; automated geometry/schema checks cannot hear a bad loop.
- Final gates: `bun moon run :validate`, applicable guards and touched-project tests. If a required tool/model is unavailable, identify the exact missing gate; do not mark verified/completed.

## Implementation Sequence

1. Pin and validate one compatible 4B graph, keeping legacy SD unchanged.
2. Implement preparation/QA profiles with fixture evidence.
3. Wire common candidate review and existing previews.
4. Run the small Emberwatch visual slice; keep animation experiment nonblocking.

## Edge Cases & Gotchas

A ComfyUI Load LoRA node in a tutorial is not proof that the repository graph, model family or license supports that LoRA.

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
