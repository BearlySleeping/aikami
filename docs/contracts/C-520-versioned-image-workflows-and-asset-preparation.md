---
id: C-520
title: "Versioned image workflows and asset preparation"
source: "direct — 2026-09-13 asset generation and Emberwatch review"
contract_type: full
status: implemented
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
| **Status** | implemented |
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

## Execution Report

### Summary

Implemented the versioned image-workflow layer and the deterministic preparation/QA layer as portable data + code in `@aikami/local-ai`/`@aikami/schemas`/`@aikami/constants`, and wired both into the named production path (`generate:batch`) plus the ComfyUI adapter. Workflow profiles pin engine graph, model family, weight filenames, semantic-input bindings and proven capabilities; the compiled graph is validated against the installed ComfyUI node schema before any submission. Preparation profiles pin an ordered pixel transformation set plus QA limits; the host decodes/encodes (dependency-free PNG codec), the kernel owns pixels, and every prepared artifact carries a `MediaValidationReport`.

Deferred and explicitly unverified: the live ComfyUI + FLUX.2-klein-base-4B GPU smoke (ComfyUI is not installed/running in this environment — start attempt and log captured below), the FLUX 4B artifact SHA-256 pins (no weights available locally, so they are *reported as unresolved* rather than invented), the in-game state-swap preview and native-scale animation playback checks, and the real Emberwatch atlas repack (`prop_atlas_packer` requires `sharp`, which is not installed here).

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ⚠️ | Semantic inputs provably reach the declared graph nodes (`compileWorkflow` asserts the profile's declaration against the template's markers at load, and the compiled prompt is asserted node-by-node in unit and engine tests). Unknown node class / uninstalled weight / missing input / oversize payload all fail *before* `POST /prompt` (`validateCompiledWorkflow`, `assertCompiledWorkflowRunnable`; proven with a fake `fetch` that records calls — no `/prompt` is issued). **The live GPU smoke is not executed**: `herdr_session start image-comfyui` failed within 120 s and no ComfyUI container is running (`docker ps` shows only `aikami-local-stack-image-1` on :8188), so the opt-in 4B profile could not be run. Its three required artifacts also carry no pinned SHA-256 because no local copies exist — `describeWorkflowProfileReadiness` reports exactly that instead of claiming verification. |
| AC-2 | ✅ | The legacy SD profile declares `lora: false`; a LoRA request is refused with `unsupported-capability` before the graph is built, and the engine instance issues **zero** HTTP calls. A LoRA-capable profile refuses anything outside its allowlist (`unsupported-lora`), and the registry refuses *at load* any profile whose allowlist names another model family — so the Mystic07 9B LoRA can never be attached to the 4B base. The Mystic07 profile itself is `experimental-blocked` with a recorded `blocked` rights decision and is refused at construction. `ComfyUiGenerationEngine.capabilities` is now derived from the selected profile, so a capability UI cannot advertise a node the graph does not contain. |
| AC-3 | ✅ (machine) / ⚠️ (live candidate) | Same raw bytes + same profile version produce byte-identical output (`checkPreparationDeterminism`, plus explicit hash equality in the host test), on the real CLI path: `generate:batch --preparation-profile prop-native-alpha` was driven end-to-end and produced `media-validation.json` with matching raw/prepared hashes and the staged file hashing to the prepared hash. Resample methods are pinned per profile; `pixel-art` + a blending method is refused at registry load and reported as `resample-blended`. Ground rectangles, alpha fringes, clipped content, off-centre ground contact and unreadable native-scale artifacts are machine findings with stable codes. **Not executed:** the same run against a real locally generated 512×512 candidate — the CPU-only sd.cpp render did not finish inside the tool's deadline (recorded in Deviations). |
| AC-4 | ⚠️ | Canvas, origin and ground contact are preserved by construction (`trim` anchors on the content's bottom-centre contact point and records the crop origin; the report carries `groundContact`) and asserted on fixture pairs: two variants of one base produce identical canvas size and identical `groundContact` while differing bytes. **Not executed:** the in-game preview swap (no generated variant exists to swap in). |
| AC-5 | ⚠️ | Sheet QA reads the runtime's own layout from `@aikami/lpc` (`LpcAnimationState`, `LpcDirection`, `FRAMES_PER_STATE`, `LPC_STATE_NAMES`, `resolveLpcSheetGeometry`) — no second copy of the grid. Missing direction, wrong frame count, empty frame, duplicate frame, drifting feet, inconsistent body size, clipped cell and a declared facing order other than up/left/down/right are all rejected; an undeclared facing order is reported as *unverified*, and every run emits an explicit native-1× animation-review requirement naming the existing LPC assets as the release fallback. **Not executed:** reviewing an actual generated sheet in the running game (no generated sheet exists). |
| AC-6 | ⚠️ | Page size, frame-within-page bounds with the extruded border, duplicate frame names across pages, expected-vs-actual frame counts, explicit terrain cell capacity and unresolvable map references are all validated with stable codes, and the frame index resolves every packed name. **Not executed:** the real Emberwatch repack — the packer (`prop_atlas_packer`, `generate_emberwatch_props_atlas`) loads `sharp` lazily and `sharp` is not installed in this environment, and the generated `tilesets/*.json` pages are build output that is absent from the worktree. The validator is not yet called by the packaging script. |

### Files Created

| File | Purpose |
|---|---|
| `packages/shared/schemas/src/lib/generation/workflow_profile.ts` | TypeBox schemas for versioned workflow profiles and graph templates |
| `packages/shared/schemas/src/lib/generation/preparation_profile.ts` | TypeBox schemas for preparation profiles, the operation union and QA limits |
| `packages/shared/schemas/src/lib/generation/media_validation.ts` | TypeBox schemas for findings, `MediaValidationReport` and prepared artifacts |
| `packages/shared/types/src/lib/generation/workflow_and_preparation.ts` | `Static`-derived types re-exported from `@aikami/types` |
| `packages/shared/constants/src/lib/media_preparation.ts` | Stable processor identity, profile ids, validation codes, terrain capacity |
| `packages/shared/local-ai/src/lib/workflows/workflow_compiler.ts` | Marker extraction, binding/template cross-check, compile, node-schema validation |
| `packages/shared/local-ai/src/lib/workflows/workflow_profile_registry.ts` | Registry, integrity check, request-shaped resolution, readiness report |
| `packages/shared/local-ai/src/lib/workflows/workflow_templates.json` | Pinned graphs: legacy SD-XL, FLUX.2-klein 4B, blocked Mystic07 9B fixture |
| `packages/shared/local-ai/src/lib/workflows/workflow_profiles.json` | Shipped profiles with dependencies, bindings, capabilities and rights decisions |
| `packages/shared/local-ai/src/lib/workflows/workflow_compiler.test.ts` | AC-1 compile/validate coverage |
| `packages/shared/local-ai/src/lib/workflows/workflow_profile_registry.test.ts` | AC-2 capability/LoRA/exclusion coverage |
| `packages/shared/local-ai/src/lib/preparation/rgba_image.ts` | Portable RGBA surface, premultiplied resampling, largest-opaque-rectangle, ground contact |
| `packages/shared/local-ai/src/lib/preparation/prepare_image.ts` | The deterministic single-image kernel |
| `packages/shared/local-ai/src/lib/preparation/preparation_qa.ts` | Machine findings + report assembly |
| `packages/shared/local-ai/src/lib/preparation/preparation_profile_registry.ts` | Preparation-profile registry and encode-extension resolution |
| `packages/shared/local-ai/src/lib/preparation/preparation_profiles.json` | Shipped preparation profiles |
| `packages/shared/local-ai/src/lib/preparation/atlas_bounds.ts` | Atlas bounds/capacity/frame-resolution validation |
| `packages/shared/local-ai/src/lib/preparation/sprite_sheet_qa.ts` | LPC animation QA against the runtime's own constants |
| `packages/shared/local-ai/src/lib/preparation/__fixtures__/rgba_fixtures.ts` | Real pixel-buffer fixtures |
| `packages/shared/local-ai/src/lib/preparation/prepare_image.test.ts` | AC-3/AC-4 determinism, trim, aspect-ratio coverage |
| `packages/shared/local-ai/src/lib/preparation/preparation_qa.test.ts` | AC-3 finding coverage and report shape |
| `packages/shared/local-ai/src/lib/preparation/atlas_bounds.test.ts` | AC-6 coverage |
| `packages/shared/local-ai/src/lib/preparation/sprite_sheet_qa.test.ts` | AC-5 coverage |
| `apps/backend/image/scripts/png_codec.ts` | Dependency-free PNG decode/encode (8-bit, non-interlaced) |
| `apps/backend/image/scripts/preparation_host.ts` | Host decode → kernel → encode → hash → report |
| `apps/backend/image/scripts/preparation_host.test.ts` | Codec round-trip and host preparation coverage |
| `apps/backend/image/scripts/generate_batch_engines.ts` | Engine construction for the batch CLI (endpoints, deadlines, profile) |
| `apps/backend/image/scripts/generate_batch_profiles.ts` | Preparation hook, profile observations, `media-validation.json` |
| `apps/backend/image/scripts/generate_batch_test_support.ts` | Shared CLI test harness (extracted so both suites use one copy) |
| `apps/backend/local-stack/stack/generation/preparation.ts` | The runner's preparation stage and its types |
| `apps/backend/local-stack/stack/generation/job_reports.ts` | The single `GenerationJobReport` projection |

### Files Modified

| File | Change |
|---|---|
| `packages/shared/local-ai/src/lib/engines/comfyui_engine.ts` | Optional `workflowProfileId`; profile-derived `capabilities`; preflight node-schema validation and pin-before-upload; legacy path preserved byte-for-byte |
| `packages/shared/local-ai/src/lib/engines/factory.ts` | `workflowProfileId` passed through to the ComfyUI adapter |
| `packages/shared/local-ai/src/index.ts` | Export the new workflow and preparation modules |
| `packages/shared/local-ai/package.json`, `tsconfig.json` | Depend on `@aikami/lpc` (the sprite-sheet QA reads the runtime's own layout constants) |
| `packages/shared/lpc/src/index.ts` | Re-export `FRAMES_PER_STATE` and `LPC_STATE_NAMES` (already `export const` in `animation.ts`) |
| `packages/shared/schemas/src/index.ts`, `packages/shared/types/src/index.ts`, `packages/shared/constants/src/index.ts` | Barrel exports for the new modules |
| `apps/backend/local-stack/stack/generation/runner.ts` | Optional `prepare` stage between raw persistence and staging; `mediaValidations` on the result |
| `apps/backend/local-stack/stack/generation/index.ts`, `batch_reports.ts` | Export the new modules; import the moved `jobReport` |
| `apps/backend/local-stack/tsconfig.json` | `@aikami/lpc` + `$logger` paths (transitive through `@aikami/local-ai`) |
| `apps/backend/image/scripts/generate_batch.ts` | `--workflow-profile` / `--preparation-profile`; engine factory and profile wiring extracted to keep the file inside the source-size budget |
| `apps/backend/image/scripts/generate_batch_usage.ts` | Document the two new flags |
| `apps/backend/image/scripts/generate_batch.test.ts` | C-520 production-surface tests; harness extracted to a support module |
| `apps/backend/image/package.json` | Add `scripts/preparation_host.test.ts` to the test task |
| `apps/frontend/docs/src/content/docs/guides/generating-assets.mdx` | Document both flags and the versioned-profile / deterministic-preparation model |
| `bun.lock` | Workspace dependency edge (`@aikami/local-ai` → `@aikami/lpc`) |

### Deviations from Spec

1. **FLUX.2-klein-4B dependency hashes are deliberately absent.** The contract asks the opt-in profile to pin "exact checkpoint/encoder/VAE dependencies, checksums and workflow version". No local copies of those artifacts exist in this environment and inventing hashes is explicitly banned. The profile pins the *filenames*, the *template hash* and the *workflow version*, marks the three artifacts `required: true` with no `sha256`, and `describeWorkflowProfileReadiness` reports all three as unresolved. The hard pre-submit gate remains the installed node schema, which refuses an artifact the running loader does not offer.
2. **`mode_types.py`-style scope note: the legacy profile declares `initImage: false`.** The pinned legacy template is the txt2img graph only; rather than claim an img2img path its template does not contain, the profile declares the capability false. The pre-C-520 adapter keeps its dynamic img2img builder for requests that select no profile, so no behaviour regressed.
3. **`packages/shared/lpc/src/index.ts` gained two re-exports.** `FRAMES_PER_STATE` and `LPC_STATE_NAMES` already existed as `export const` in `animation.ts`; exposing them on the barrel is what lets AC-5's QA read the runtime's own frame counts instead of hard-coding them. Additive, no behaviour change.
4. **New dependency edge `@aikami/local-ai` → `@aikami/lpc`.** The portable core stays free of Bun/fs/Svelte imports (verified: `local-ai:typecheck` and the AC-0 boundary tests pass), but it now reads a second shared data package. Consumers that newly resolve `lpc` transitively needed a `$logger` path mapping; `local-stack/tsconfig.json` was the only one missing it (the client and engine already declare it).
5. **Code was extracted to stay inside `guard-source-file-size`.** `runner.ts`, `generate_batch.ts` and `generate_batch.test.ts` would each have crossed the 800/1500-line hard limit; the profile wiring, the engine factory, the preparation stage, the job-report projection and the CLI test harness now live in their own modules. The extraction is behaviour-preserving — the pre-existing C-519 suite passes unchanged.
6. **`validate()` could not run.** The Pi `validate` tool fails in this environment with `Parse failed: Invalid project record at index 0` on every invocation (reproduced twice, before and after the last edits), so the equivalent gates were run directly: `bun moon run :typecheck` across all 41 projects (clean, including `client` and `hub`), the touched projects' test tasks, `bun run guard`, and `biome check`.

### Test Results

- Unit (portable core): `local-ai:test` — 417 pass, 0 fail (baseline 313 pass, 0 fail; +104 new tests across 6 new files).
- Unit (plumbing): `local-stack:test` — 145 pass, 8 skip, 0 fail. `constants:test` — 161 pass, 0 fail. `lpc:test` — 80 pass, 0 fail.
- E2E/production-surface: `image:test` — 53 pass, 0 fail, including three new C-520 cases that drive the documented command `bun run --cwd apps/backend/image generate:batch …` (preparation applied end-to-end with matching hashes; `--workflow-profile` refused on a non-ComfyUI engine; unknown profile tolerated by `--plan`).
- Typecheck: `bun moon run :typecheck` — 41 projects, 0 errors (`client:typecheck` and `hub:typecheck` included).
- Lint: `biome check` clean on every created/modified file.
- Guards: `bun run guard` — type-safety, MVVM, service-conventions, data-plane, test-boundary, view-model-composition and image-component all pass. `guard-source-file-size` fails on **one pre-existing** file, `scripts/src/lib/agents/contract_pipeline/orchestrator.ts` (2439 > 2335 exception ceiling at base commit `309e0da`), which this contract does not touch; all files created or modified here are within budget.
- Visual: **not applicable** — this contract adds no client UI. The production evidence is CLI/stdout and the written `media-validation.json` artifact, not a screenshot.
- Baseline regression: 0 new failures. Two pre-existing environment failures are unchanged and unrelated to this contract:
  1. `guard-source-file-size` on `scripts/src/lib/agents/contract_pipeline/orchestrator.ts` (2439 > 2335 exception ceiling at base commit `309e0da`, untouched here).
  2. `frontend-engine:test` — 1405 pass, 3 fail, all three in `emberwatch_content_audit.test.ts` asserting that `atlas.json`, `props.webp` and `props.json` exist under `apps/frontend/client/static/game-data/sprites/tilesets/`. That directory is gitignored (`.gitignore:259` ignores the whole `static/game-data/` tree) and absent from any fresh worktree, so the assertions cannot pass before the atlas build runs. This contract changes neither the audit test nor the packer.

### Blocked evidence (named, not claimed)

| Gate | Exact status |
|---|---|
| Live ComfyUI + FLUX.2-klein-4B (AC-1) | `herdr_session start image-comfyui` → "Services failed to start within 120s: image-comfyui"; the service log shows the container created and attaching but no healthy endpoint. `docker ps` lists only `aikami-local-stack-image-1` (`127.0.0.1:8188`, sd-server). `http://127.0.0.1:8189/object_info` never answered (11 attempts over 55 s). No ComfyUI `/object_info` is therefore available to validate the 4B graph against. |
| Real 512×512 candidate through preparation (AC-3) | A real `generate:batch --run --preparation-profile prop-native-alpha` against the running sd.cpp server on `:8188` dispatched one engine request and then hit the 300 s poll deadline on CPU; the job is honestly `reconciliation_required`/`submission_unconfirmed` rather than silently retried. The preparation stage is therefore evidenced on the documented command with a fake engine returning genuine PNG bytes, not on real sd.cpp output. |
| Real Emberwatch atlas repack (AC-6) | `prop_atlas_packer.ts` resolves `sharp` through a lazy `require`; `sharp` is not installed in this environment (`Cannot find package 'sharp'` from `apps/backend/image`), and the packed `tilesets/*.json` pages are build output absent from the worktree. |
| In-game preview / animation playback (AC-4, AC-5) | No generated variant or sheet exists yet, and this environment has no assembled pack containing one, so the game-side swap and 1× playback checks could not be performed. |

Per the contract's Test Hooks: the exact missing gates are named above rather than marked verified, and this contract is handed off as `implemented`, not `verified`.
