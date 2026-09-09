---
id: C-504
title: "Stable character appearance identity and legacy migration"
source: direct
contract_type: full
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/285"
  pr_number: 285
created_at: "2026-09-09T00:00:00Z"
---

# Contract C-504: Stable character appearance identity and legacy migration

## Metadata

| Field | Value |
|---|---|
| **Source** | Character/environment asset audit and maintainer request, 2026-09-09 |
| **Target** | `packages/shared/lpc/`, `packages/shared/schemas/`, `packages/frontend/engine/`, `apps/frontend/client/`, `content/packs/`, `scripts/src/lib/ops/validate_content_appearance.ts` |
| **Type** | full |
| **Priority** | P0 — published NPCs resolve to incompatible anatomy |
| **Dependencies** | None; build on the existing C-400/C-442 code, do not rerun those contracts |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | user-facing — document appearance compatibility in `apps/frontend/docs/src/content/docs/` |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` and `scripts/src/lib/ops/validate_content_appearance.ts#validateContentAppearance` |

## Problem & Baseline Evidence

- `content/packs/emberwatch/manifest.json` stores legacy `appearanceLayers` indices. Rollo uses `[3,123,23,22,7,95]`; the merchant uses `[3,91,127,22,19,95]`.
- `packages/shared/lpc/src/lib/build_catalog.ts:122` sorts IDs, while `appearance.ts:212` resolves numeric positions directly. For these NPCs, body 3 changes from `body/bodies_male` to `body/bodies_child`; legs 22 changes from `legs/pants_male` to `legs/pants_child`; head 95 changes from `head/heads/human_male` to `head/heads/human/female_small`.
- The audit reproduced mismatched limbs from published bytes and these mappings. Tests must capture a small pinned input fixture; the implementation must not depend on audit files in `/tmp` or a live CDN response.
- `legacy_remap.ts` is exported/tested but not used in production loading. `validate_content_appearance.ts:116` still validates against the legacy fixture, not the runtime catalog interpretation.
- Existing persona `appearance.lpcRecipe` already uses named IDs. Preserve it through a compatibility adapter rather than unnecessarily rewriting every persona field.
- Baseline tests: `packages/shared/lpc/tests/legacy_remap.test.ts`, `legacy_order.test.ts`, `scripts/src/lib/ops/validate_content_appearance.test.ts`, and the existing game-boot/save journeys. Record existing failures before editing.

## User Outcome

A saved or authored character keeps its anatomy and outfit when the catalog is sorted, extended, republished, or loaded offline.

## Success Measures

- Catalog reorder/insertion does not change resolved named components.
- Legacy Emberwatch NPCs resolve to their intended adult bodies, trousers and heads in the actual game, before and after reload.
- Migration runs once at a content/save boundary, not inside the render tick; it adds no network or AI boot dependency.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Named component identity | Persona `appearance.lpcRecipe` | reuse through one normalization boundary |
| Original order | `packages/shared/lpc/tests/__fixtures__/legacy_catalog_order.json` | reuse after verifying provenance; promote a production-safe snapshot without importing tests at runtime |
| Legacy remap | `packages/shared/lpc/src/lib/legacy_remap.ts` | use only with its matching source/target snapshots; do not treat it as a universal migration |
| Resolver | `packages/shared/lpc/src/lib/appearance.ts` | add named input, retain a bounded legacy adapter |
| Content validation | `scripts/src/lib/ops/validate_content_appearance.ts` | use the same normalization and catalog input as production |
| Device saves | Existing client save/content hydration entry points | extend narrowly; retain original data on failed migration |

## Overview

Make named component IDs the durable appearance representation. Keep numeric handles only for resolved, session-local engine data or explicitly versioned legacy input. Catalog position is never a durable identity in new content.

## Design Reference

Use the pure shared resolver pattern from C-400 and the offline device-store ownership in `AGENTS.md`. Follow [shared testing conventions](SHARED_SECTIONS.md#testing-conventions). Run first using `bun run contract C-504`; see [execution order](../plans/visual_asset_foundation.md). This contract also owns omitted-role equipment merge correctness. Hub tags belong to C-496, duplicate map data to C-505 and atlas source alpha to C-506.

## Architecture Directives

1. Introduce one normalization function for pack NPCs, persona recipes, save restoration and worker/main-thread inputs. Do not create another client-only interpretation.
2. Persist named, namespaced component IDs. A normalized component carries its slot, asset ID and explicit layer role; intentionally empty slots remain distinguishable from missing/unresolvable data.
3. Tie legacy numeric arrays to a declared catalog-order snapshot. For the shipped Emberwatch revision, use the verified original fixture. Recognize an unversioned legacy save only through an authoritative save/pack version or recovered catalog fingerprint, never by its array length or whether the indices happen to be in range.
4. If provenance is ambiguous, do not guess, overwrite or silently migrate. Preserve the original record, expose a structured diagnostic and offer the existing recovery path or a clearly identified whole-character safe preset. Never manufacture a mixed-body recipe with unrelated per-slot defaults.
5. Existing string IDs remain valid aliases. C-496 later adds immutable visual revision locking; C-504 must not wait for or reimplement that format.
6. Normalize missing `layerRole` to `front` before `(slot, layerRole)` equipment merge matching, not only after composition. Catalog ordering and array iteration order must not determine draw order. Preserve distinct rear/front passes.

## State & Data Models

Add a versioned named appearance representation to existing content/save schemas; do not change unrelated persona or save state. Its semantic shape is:

- `formatVersion`: explicit new representation version.
- `components`: entries with `slot`, stable `assetId`, explicit `layerRole`, and supported existing palette data.
- `legacyProvenance`, when migrated: source format/catalog snapshot identity, sufficient to explain the conversion.

Use unique `(slot, layerRole)` entries for this base-appearance representation. Multi-pass equipment introduced by C-496 belongs to a visual component definition, not repeated base-slot selections. Empty asset IDs used by the current internal resolver must not accidentally pass as valid downloadable asset references.

The legacy array and persona string-map are accepted input variants, not extra sources to merge after normalization. Resolve to session-local numeric handles only after named identity is established. A compiled palette/table packaged atomically with its indices is not the same as an unversioned global catalog index.

## Quality Requirements

- **Offline/degraded mode:** existing installed packs and saves normalize without fetching a catalog; bundle/install the required migration snapshot.
- **Accessibility/input:** existing error/recovery UI must expose a readable diagnostic; no new character editor is required.
- **Performance budget:** cache normalized immutable appearances by input revision; no JSON serialization or migration in the per-frame loop.
- **Security/privacy:** validate external recipes; no dynamic evaluation, arbitrary URLs or source-path execution.
- **Persistence/migration:** retain an untouched recoverable copy until successful atomic persistence; migration is idempotent.
- **Cancellation/retry/idempotency:** interrupted writes leave either the old or new valid record, not a hybrid.
- **Observability:** record source version, affected entity ID and missing component ID, not whole private save contents.

## Migration & Rollback

- Inventory every writer/reader of `appearanceLayers` and `lpcRecipe`, including content packs, player hydration, worker events and save restoration, before coding.
- Recover the old mapping by stable ID from the original snapshot, not by numerically applying a remap to an arbitrary newer catalog.
- Convert known shipped pack data to named references; keep legacy read compatibility for existing installations. Do not mutate published v1 bytes in place.
- Preserve original legacy records until new records have passed validation and atomic persistence. Keep the old loader available during the rollout window.
- An old client need not understand the new schema: protect it with a versioned pack/client compatibility boundary and retain the old pack revision. Do not rely on lossy round-tripping to legacy indices for rollback.
- Missing catalog entries must not cause a partially converted save to be written. Unknown-version input follows the explicit recovery behavior above.

## Scope Boundaries

- **In Scope:** identity normalization, known legacy migration, pack/save/worker integration, production-aligned validation and regression evidence.
- **Out of Scope:** generic atlas format, new image generation, complete item-system redesign, new body rigs, material-shader work, unrelated save fields, catalog republishing without separate authorization.

## Contract Size & Split Rule

One compatibility outcome across its readers/writers; all must land together. Target 30–55 changed paths including role-merge regression tests. Reassess at 75, stop for a split plan at 85, and never publish a PR with 100 or more changed paths. Do not split migration from its production wiring.

## Acceptance Criteria

### AC-1: Known legacy identities survive normalization
**Given** the original snapshot and shipped Emberwatch appearances, **when** normalized through the production content entry point, **then** Rollo/merchant use the intended male body, male trousers and human male head, and the elder's identity is restored too. Worker and main thread resolve the same recipe.

### AC-2: New content is independent of catalog position
**Given** a named appearance, **when** entries are shuffled, inserted before existing entries or unrelated assets are removed, **then** the same component IDs resolve. New persisted appearances contain no unversioned global numeric positions. Missing referenced assets produce a diagnostic rather than substituting whichever entry occupies that index. Production-shaped equipment inputs with omitted roles merge exactly like explicit `front`; distinct rear/front passes remain distinct without duplicate outfits.

### AC-3: Migration is safe, explicit and idempotent
**Given** known legacy, already migrated, malformed and unknown-provenance saves, **when** loading, retrying or interrupting persistence, **then** known input migrates once, new input is unchanged, invalid/ambiguous input remains recoverable, and `0` retains its intentionally-empty meaning.

### AC-4: Validation exercises the runtime interpretation
**Given** the same pack/catalog inputs, **when** running `validateContentAppearance` and booting `/game`, **then** both agree on named identities and invalid recipes. A fixture-only validator cannot approve an interpretation that runtime rejects. Readable diagnostics name the pack, NPC, slot and source snapshot.

### AC-5: The actual scene remains correct after restoration
**Given** an installed Emberwatch campaign, **when** entering the inn and shop, walking in four directions, saving, reloading and repeating offline, **then** the intended NPCs render without the child/adult mismatch. Assert resolved IDs as well as inspecting pixels; do not rely only on a visual model score.

**Evidence Matrix**:

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | pinned legacy fixture + worker/main-thread recipe comparison | `packages/frontend/engine/src/game_world.ts#GameWorld` | Required before implementation handoff |
| AC-2 | Unit + integration | insertion/reorder/removal regression | `packages/shared/lpc/src/lib/appearance.ts#resolveLpcAppearance` | Required before implementation handoff |
| AC-3 | Integration | restore/interrupted-write/unknown-version cases | `/game` | Required before implementation handoff |
| AC-4 | Tooling | runtime/validator parity assertions | `scripts/src/lib/ops/validate_content_appearance.ts#validateContentAppearance` | Required before implementation handoff |
| AC-5 | E2E + visual | named NPC scene captures and offline reload | `/game` | Required before implementation handoff |

**Test Hooks**: extend the existing LPC/appearance tests; add a focused production journey under `apps/e2e/tests/client/` and a suite under `apps/e2e/src/visual/suites/`. Run affected-project fix/typecheck/build/tests plus `bun run validate:content`. Follow the testing skill; a sandbox-only pass is insufficient.

**Watch Points**: fixture order versus JS lexicographic order; default-role normalization; preserving `0`; old saves lacking a source marker; missing assets; no code importing test fixtures in production; no network dependency for migration.

## Implementation Sequence

1. Record baseline and enumerate data boundaries; verify/freeze the source snapshot.
2. Implement/test normalization and safe migration, then wire every boundary and validator.
3. Convert known pack definitions, verify the real scene/save/offline path, and produce the PR evidence packet.

## Edge Cases & Gotchas

- Deterministic sorting does not make persistent positional IDs stable.
- A remap valid for two snapshots can be wrong for a third.
- A six-slot array may include intentionally empty equipment-owned slots; do not require clothing to establish anatomical identity.
- Existing test helpers often supply `layerRole: 'front'` even when production callers omit it; test both inputs.

## Open Questions

- None. Unknown provenance is explicitly not guessed. Exact field placement follows the existing save/content schemas and must preserve the semantics above.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-09-09 | Initial draft; implementation approval pending maintainer review | — |

## Promotion Lifecycle

See [promotion lifecycle](SHARED_SECTIONS.md#promotion-lifecycle).

## Status Lifecycle

See [status lifecycle](SHARED_SECTIONS.md#status-lifecycle). No implementation or verification is claimed by this draft.
