---
id: C-517
title: "Generation request and format correctness"
source: "direct — 2026-09-13 asset generation and Emberwatch review"
contract_type: full
status: approved
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
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | `apps/frontend/docs/src/content/docs/guides/generating-assets.mdx` (recipe/output table + audio flags), `creating-assets.mdx`; Hub help N/A — no Hub generation front door exists until C-522 |
| **Contract version** | 1.1.0 |
| **Production Surface** | tooling: `bun run --cwd apps/backend/image generate:asset` |

Allocated as C-517 during the 2026-09-13 import. The 2026-09-13 review pack proposed it as C-516; the asset-generation series shifted up by one because C-516 is the combat direct-control contract. Baseline: see `docs/research/asset-generation-review-2026-09.md`.
## Problem & Baseline Evidence

ACE-Step replaces positivePrompt with recipe tags when tags are present: `packages/shared/local-ai/src/lib/engines/ace_step_engine.ts` compiles `prompt: request.tags?.trim() ? request.tags : request.positivePrompt`, and all three shipped audio recipes (`music`, `sfx`, `ambient` in `packages/shared/local-ai/src/lib/recipes/recipes.json`) set `defaults.tags` — so the subject never reaches the engine. `packages/shared/local-ai/src/lib/engines/ace_step_engine.test.ts:229` currently asserts that drop (`prompt === 'calm, ambient, forest'` for a request whose compiled prompt differs), so the test locks the defect in and must be corrected, not preserved.

Portrait/expression recipes declare `.webp` while sd-server returns PNG, and `toGeneratedAsset` (`packages/shared/local-ai/src/lib/generated_asset.ts`) rejects the mismatch — both recipes fail on the CLI path today. The client already has an ext-reconciliation seam (`apps/frontend/client/src/lib/services/image/generated_asset_workflow.ts#reconcileRecipeExt`), but it reconciles against the engine's *declared* MIME and no layer sniffs the returned bytes, so a provider claiming the wrong `Content-Type` is accepted. BPM/key are written into flat result metadata (`metadata.bpm`, `metadata.key`) without ever being mapped to native v1 conditioning — recorded as though they were measured facts.

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
| `packages/shared/local-ai/src/lib/engines/ace_step_engine.ts` | modify prompt compilation/submission (remove the tags-vs-prompt either/or) and make audio metadata honest |
| `packages/shared/local-ai/src/lib/engines/ace_step_engine.test.ts` | correct the assertion that locks in the tag-replaces-subject behavior (~line 229) |
| `packages/shared/local-ai/src/lib/recipes/recipes.json` | correct immediate output defaults (`portrait`, `expression` → `.png`) |
| `packages/shared/local-ai/src/lib/generated_asset.ts` | extend format validation — sniff bytes before the declared-MIME/ext agreement check (shared, so both sinks inherit it) |
| `packages/shared/local-ai/src/lib/asset_generation.test.ts` | extend CI-covered integration fixtures; carry the request audit out of `runAssetGeneration` |
| `apps/frontend/client/src/lib/services/image/generated_asset_workflow.ts` | reuse the existing ext-reconciliation seam — do not build a second one in `local-ai` |
| `apps/backend/image/scripts/generate_asset.ts` | extend CLI reporting (effective parameters; audit in the summary/JSON output) |
| `apps/frontend/docs/src/content/docs/guides/generating-assets.mdx` | update the recipe/output table and audio-flag docs |

## Overview

A creator gets an asset based on the actual requested subject, with an honest output format and effective-parameter report. This contract extends the existing C-510/C-511 architecture with the bounded behavior below. Keep storage, transport and view concerns in their established layers.

## Design Reference

Read AGENTS.md, .context/CONTEXT.md and .context/index.md; then the applicable .pi/skills conventions, existing contract dependencies, docs/contracts/SHARED_SECTIONS.md, and the execution directives in `docs/research/asset-generation-review-2026-09.md`. The supplied review identifies current-source contradictions; current code and verified production behavior take precedence over historical claims.

## Architecture Directives

- Combine subject/positivePrompt and style tags into the ACE-Step prompt in one deterministic shared function. An explicit tags override must not erase the subject. Preserve lyrics/instrumental handling. Do not silently delete user detail in an LLM rewrite. The current adapter chooses one source (`request.tags?.trim() ? request.tags : request.positivePrompt`); the compiled request must be authoritative and submitted verbatim rather than re-selected at dispatch.
- One byte-format authority. Put the sniff where the shared descriptor derivation can use it (`generated_asset.ts`), and have the existing client seam (`generated_asset_workflow.ts#reconcileRecipeExt`) consume the sniffed type instead of trusting a declared `Content-Type`. Do not add a second reconciliation path.
- Keep `requested`, `effective` and `measured` parameters distinct. For ACE-Step v1, BPM/key may be textual hints in the prompt; they are not native hard controls or measured output facts. Unsupported hard constraints fail before dispatch.
- Make portrait/expression recipe defaults PNG on the current PNG path. Later WebP requires an actual C-520 transformation; no extension relabeling. Decode/sniff returned bytes before acceptance, including a provider claiming the wrong Content-Type.
- Keep old CLI syntax and the v1 adapter operational. Do not change engine IDs to make a compatibility test green. C-511 already separates common engine IDs from persisted image preferences; preserve that current code, despite stale contract prose.
- Add CI tests under local-ai, not exclusively the image app whose live tests may be excluded from CI.

## State & Data Models

Add a schema-derived request audit with requested/effective fields and optional measured fields; do not invent measurements when the model only echoes a request. Existing descriptors remain readable.

`GenerationResult.metadata` is a flat `Record<string, string | number>` (`packages/shared/types/src/lib/media/generation.ts`) and stays flat — the audit crosses that seam as prefixed scalar keys (`requestedBpm`, `effectiveBpm`, `requestedKey`, `effectiveKey`, `requestedInstrumental`), never as a nested object, and never as a bare `bpm`/`key` that reads as a measured fact. The structured audit schema lives under `packages/shared/schemas/src/lib/generation/` with its type derived via `Static<typeof Schema>` and re-exported from `@aikami/types`, and `AssetGenerationStaging` carries it so the CLI can print it and C-518 can consume corrected metadata. Ownership: C-518 owns the durable provenance/candidate record, C-517 owns only the request/effective/measured audit and its transport keys; C-520 owns any real WebP transformation.

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

**Given** the `music`, `sfx` and `ambient` recipes (each carrying generic `defaults.tags`), **when** `bun run --cwd apps/backend/image generate:asset <recipe> "<subject>"` runs against a fake `/generate` endpoint that records the submitted body, **then** every recorded body's `prompt` contains the subject text **and** the style tags; an explicit `--tags` override still contains the subject; an empty/whitespace `--tags` falls back to the compiled template; and `lyrics` is `[inst]` for `instrumental: true`, the supplied lyrics otherwise, and a vocal request with no lyrics still fails loudly.

### AC-2: Bytes agree with format

**Given** fixture engines returning genuine PNG and genuine WebP bytes (a test-only recipe may declare `.webp`; no shipped recipe may until C-520 provides a real transformation) plus engines whose declared `Content-Type` disagrees with their bytes, **when** portrait/expression generation runs through the CLI and through the shared descriptor derivation, **then** accepted results have matching sniffed format, MIME, extension and `sha256`, and every mislabeled or undecodable payload fails with a readable error before any bytes are staged.

### AC-3: Controls are honest

**Given** BPM/key and unsupported hard controls are requested, **when** `--bpm`/`--key` are compiled and submitted through ACE-Step v1, **then** the run report (CLI summary and the engine's flat metadata keys) labels them `requested*`/`effective*` with no bare `bpm`/`key` key that reads as measured and no `measured*` key unless the engine actually reported the value; an unsupported hard control still fails before dispatch with an error naming the field and the engine.

### AC-4: Existing behavior survives

**Given** existing prop/audio fixtures and an aborted request, **when** `bun moon run local-ai:test`, `bun moon run schemas:test` and the CLI suite (`apps/backend/image/scripts/generate_asset.test.ts`) run alongside the guided smoke `bun run --cwd apps/backend/image generate:asset portrait "<subject>" --timeout 120 --steps 4 --width 256 --height 256` against a reachable sd-server, **then** old CLI syntax, seed handling, timeout and truthful cancel capabilities (`cancel: false` for `ace-step`) are unchanged; where no reachable engine/hardware exists, that leg is recorded as unverified, never as passed.

### AC-5: Documentation matches shipped behavior

**Given** the guides that document the CLI, **when** the recipe/output table and the audio-flag documentation are read after this change, **then** `generating-assets.mdx` lists `portrait`/`expression` as `.png` (no `.webp` claim before C-520), documents `--tags`/`--bpm`/`--key` as requested/effective hints rather than guaranteed conditioning, and documents no flag or output the code no longer produces.

**Evidence Matrix**

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | CI integration + payload assertions | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:asset` | Unverified — populate during execution |
| AC-2 | CLI integration + decoder fixture | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:asset`; secondary runtime consumer: client registration seam (`generated_asset_workflow.ts`) | Unverified — populate during execution |
| AC-3 | unit + CLI smoke | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:asset` | Unverified — populate during execution |
| AC-4 | integration + smoke | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:asset` | Unverified — populate during execution |
| AC-5 | doc/code consistency | Diff of the guide against the shipped table/flags | docs: `apps/frontend/docs/src/content/docs/guides/generating-assets.mdx` (no runtime path) | Unverified — populate during execution |

**Test Hooks**

- Baseline/targeted: `bun moon run local-ai:test`, `bun moon run schemas:test`, `bun moon run image:test`, plus `client:test`/`scripts:automation-unit` when those projects are touched. Moon project ids are flat (`local-ai`, `schemas`, `image`, `client`). `image:test` is declared `runInCI: false`, so run it as `env -u CI bun moon run image:test` (moon skips those tasks under `CI=true`) and keep the payload/format assertions in `local-ai`, which does run in CI. Do not invent passing task output.
- Functional E2E: Playwright in apps/e2e/tests/client or tests/hub, exercising the production path above. Use compiled Svelte tests for reactivity/lifecycle.
- Visual: when UI/game rendering changes, use apps/e2e/src/visual/suites with the current defineConfig/export-default and TypeBox case conventions. Assess native-scale readability/geometry and accessible state presentation. Static contact sheets do not replace in-game/animation evidence.
- Audio: when audio changes, save measured reports and listening notes over delivered renditions; automated geometry/schema checks cannot hear a bad loop.
- Final gates: `bun moon run :validate`, applicable guards and touched-project tests. If a required tool/model is unavailable, identify the exact missing gate; do not mark verified/completed.

## Implementation Sequence

1. Capture current payload and MIME/format failure fixtures — correct `ace_step_engine.test.ts`'s `prompt` assertion rather than preserving it.
2. Fix shared prompt compilation, the ACE-Step submission, byte sniffing in the shared descriptor derivation, and the immediate recipe output declarations.
3. Carry the request audit out of `runAssetGeneration`, update CLI effective-parameter reporting, and update `generating-assets.mdx`.
4. Run `local-ai:test` + `schemas:test` + `image:test` (`env -u CI`) and the guided smoke; record actual evidence, naming any leg left unverified.

## Edge Cases & Gotchas

A fake server echoing the prompt is transport evidence only, not semantic audio-quality evidence.

## Open Questions

No conceptual choice is required to begin the scoped implementation. Hardware, credentials, model/license eligibility and actual measured performance are execution preflight facts. Use the declared unavailable/fallback behavior rather than inventing access or silently expanding scope. Record any new material design question before changing the contract.

## Amendments

This is a newly proposed draft; existing contract approval/amendment rules still apply. Do not self-assign user approval or upgrade status based on this document's presence.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-09-13 | Initial proposed scope | Pending contract adoption |
| 1.1.0 | 2026-09-13 | Critic pass: cited the exact defect sites (`ace_step_engine.ts` prompt selection, `ace_step_engine.test.ts:229`, `recipes.json` portrait/expression `.webp`, flat `metadata.bpm`/`metadata.key`); added the missing reuse-map entries (the ACE-Step unit test, the CLI, the client ext-reconciliation seam, the guide) and corrected `generated_asset.ts` from "retain" to "extend with byte sniffing"; specified the flat prefixed audit keys and the C-518/C-520 boundaries; made AC-1–AC-4 observable with named commands and artifacts; added AC-5 (docs consistency) with its evidence row; named the real moon tasks and the `env -u CI` caveat; narrowed Docs Impact (Hub help is N/A before C-522) | critic |

## Promotion Lifecycle

See docs/contracts/SHARED_SECTIONS.md. An implemented code path without required production, visual or audio evidence is not release_verified.

## Status Lifecycle

See docs/contracts/SHARED_SECTIONS.md. Preserve accurate draft/implemented/verified/completed distinctions.
