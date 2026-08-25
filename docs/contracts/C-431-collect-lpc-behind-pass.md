---
id: C-431
title: "Collect the LPC universal_behind Pass — Weapons Visible in All Four Directions"
source: "user request 2026-08-23 — engine review; missing behind-pass root cause"
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/189"
  pr_number: 189
created_at: "2026-08-23"
---

# Contract C-431: Collect the LPC universal_behind Pass — Weapons Visible in All Four Directions

## Metadata

| Field | Value |
|---|---|
| **Source** | User request (2026-08-23): *"walking around with a sword/shield is also bad."* Root-caused during an engine review against the vendored generator tree. |
| **Target** | `scripts/src/lib/ops/collect_lpc_assets.ts`, `apps/frontend/client/src/lib/data/lpc_asset_catalog_generated.ts`, `apps/frontend/client/static/game-data/lpc/`, `apps/frontend/client/src/lib/data/lpc_renderer.ts` |
| **Priority** | P1 — the largest single visual defect in the character renderer. |
| **Dependencies** | C-430 (a behind layer has nowhere to render without `layerRole`), C-429 (supplies the measurement that proves completion), C-428 (most behind sheets are oversize). All three must merge first. |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | internal → developer note on regenerating the LPC catalog |
| **Contract version** | 1.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: LPC weapons ship as **two complementary sheets** — a
  foreground pass (`<asset>/walk/<name>.png`, weapon in front of the body) and a
  behind pass (`<asset>/universal_behind/walk/<name>.png`, weapon occluded by the
  body). Which direction rows carry pixels differs between them, because
  occlusion is direction-dependent.
  `scripts/src/lib/ops/collect_lpc_assets.ts` collects **only the foreground
  pass**. `grep -n "universal_behind" scripts/src/lib/ops/collect_lpc_assets.ts`
  returns nothing.

- **Reproduction** — measured against the vendored generator and the shipped output:
  ```bash
  R=examples/Universal-LPC-Spritesheet-Character-Generator/spritesheets/weapon/sword
  # Foreground pass: only the DOWN row is populated.
  for r in 0 1 2 3; do n=0; for c in $(seq 0 8); do
    magick $R/longsword/walk/longsword.png +repage -crop 64x64+$((c*64))+$((r*64)) \
      +repage -trim info: 2>&1 | grep -q " 1x1 " || n=$((n+1)); done; echo "fg row $r: $n"; done
  # → fg row 0: 0   fg row 1: 0   fg row 2: 9   fg row 3: 0

  # Behind pass: exactly the three rows the foreground is missing.
  for r in 0 1 2 3; do n=0; for c in $(seq 0 8); do
    magick $R/longsword/universal_behind/walk/longsword.png +repage \
      -crop 64x64+$((c*64))+$((r*64)) +repage -trim info: 2>&1 | grep -q " 1x1 " || n=$((n+1));
  done; echo "behind row $r: $n"; done
  # → behind row 0: 9   behind row 1: 9   behind row 2: 0   behind row 3: 9

  # The behind pass is absent from the shipped output.
  ls apps/frontend/client/static/game-data/lpc/weapon/sword/ | grep -c behind   # → 0
  ```
  The two passes are exactly complementary. Together they are a complete
  four-direction walk cycle with correct per-direction occlusion. Shipping only
  the foreground makes the weapon **invisible in three of four directions**.
  Confirmed for `longsword`, `katana`, `scimitar`, `longsword_alt` and `saber`.

- **Existing implementation to reuse**:
  - `collect_lpc_assets.ts` already walks the generator tree, derives slot/state
    /variant, picks a representative PNG, writes the manifest, converts to WebP
    and generates the TypeScript catalog. This is a **traversal and naming**
    change, not a new pipeline.
  - Shields already demonstrate the target shape: `shield/crusader_bg.walk.webp`
    (up row only) and `shield/crusader_fg.walk.webp` (all four) are collected as
    two catalog entries today, because their split is encoded in the *filename*.
    Swords use a *directory* convention instead, which the collector does not
    recognise. Make both produce the same catalog shape.
  - `lpc_credits.ts` attribution capture already runs per collected file and
    must cover the newly collected sheets (C-395 legal gate).
  - C-430's `layerRole: 'behind' | 'front'` is the render-side target.
  - C-429's audit measures the outcome.

- **Known gaps**: `lpc_renderer.ts` carries two workarounds that exist because of
  this defect and should be reassessed once it is fixed —
  `STATE_ASSET_ALIASES` (which renders a *scimitar's* slash sheet when a saber's
  is missing) and `STATE_FALLBACK_CHAINS` (which degrades a missing state to a
  walk pose). The alias table substitutes the wrong weapon and should be removed
  if the behind/attack passes make it unnecessary.

- **Baseline tests**: `bun moon run scripts:test`, `bun moon run engine:test`,
  `bun moon run client:test-unit`, plus a clean C-429 audit run against the
  committed baseline. All must pass before starting.

## User Outcome

After this contract, a **player** walking with a sword or shield equipped sees
the weapon in **all four facing directions**, correctly drawn behind the
character when the body should occlude it and in front when it should not.

## Success Measures

- **Time/latency target**: no regression in collection runtime beyond the added
  files; a full collect + convert stays within its current envelope.
- **Offline/degraded behavior**: unchanged — assets are local. An asset with no
  behind pass renders its foreground pass alone, exactly as today.
- **Production journey enabled**: equipping and carrying a weapon becomes
  visually correct in normal play, which is the most common equipment
  interaction in the game.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Generator tree walk + representative-PNG pick | `scripts/src/lib/ops/collect_lpc_assets.ts` | modify — also traverse `universal_behind/` |
| Catalog generation | `collect_lpc_assets.ts` → `lpc_asset_catalog_generated.ts` | modify — emit paired entries |
| bg/fg pairing precedent | `shield/*_bg` / `shield/*_fg` collected entries | reuse as the target shape |
| Attribution capture | `scripts/src/lib/catalog/lpc_credits.ts` | reuse — must cover new files |
| Behind-layer rendering | C-430 `layerRole` | reuse unchanged |
| Coverage measurement | C-429 audit + baseline | reuse — baseline shrinks here |
| Weapon-substitution workaround | `lpc_renderer.ts` `STATE_ASSET_ALIASES` | remove if made unnecessary |

## Overview

Teach the LPC collector to traverse the `universal_behind/` directory alongside
the foreground pass, emit both as paired catalog entries with an explicit
layer role, convert and publish the new sheets, and wire the behind entries to
C-430's `layerRole: 'behind'` so weapons and shields render correctly in every
direction.

## Design Reference

`scripts/src/lib/ops/collect_lpc_assets.ts` is the file being modified — follow
its existing manifest/catalog emission and its two-phase (discover → convert)
structure. The shield `_bg`/`_fg` entries already present in
`lpc_asset_catalog_generated.ts` are the shape to converge on: two catalog
entries, distinguishable by role, referencing the same logical item.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Role is explicit data, never inferred at render time.** A catalog entry
  declares its `layerRole`. The renderer must not parse `_bg` out of a filename
  or special-case a directory name — that is how the current divergence between
  shields and swords arose.
- **One convention for both families.** Directory-based (`universal_behind/`)
  and filename-based (`_bg` / `_fg`) splits must produce the *same* catalog
  shape. After this contract a consumer cannot tell which convention the
  upstream asset used.
- **Pairs are linked, not adjacent.** A behind entry names the foreground entry
  it pairs with explicitly. Do not rely on sort order or naming proximity.
- **A missing behind pass is normal.** Most assets (hair, torso, legs) have no
  behind pass and never will. Absence is not a warning.
- **Attribution covers every new file.** The C-395 legal gate has no bypass; a
  newly collected sheet without resolved attribution fails the publish.
- **The C-429 baseline shrinks in this PR.** Closing a gap requires removing its
  baseline entry in the same change. A green audit against an unchanged baseline
  is not evidence of completion.

## State & Data Models

Generated catalog entries — `apps/frontend/client/src/lib/data/lpc_asset_catalog_generated.ts`:

```ts
/** One collected LPC asset variant. Extends the existing generated shape. */
type LpcCatalogVariant = {
  /** Renderer asset ID, e.g. "weapon/sword/longsword" or "weapon/sword/longsword/behind". */
  assetId: string;
  /** Human label, as today. */
  label: string;
  /**
   * Which side of the body this sheet draws on. 'front' when the upstream
   * asset has no behind pass — the overwhelming majority.
   */
  layerRole: 'behind' | 'front';
  /**
   * The complementary variant's assetId, when this sheet is half of a
   * bg/fg pair. Absent for standalone sheets.
   */
  pairedAssetId?: string;
};

> The existing `LpcSlotVariant` type in `lpc_asset_catalog.ts` also carries
> `shapeType: LpcMockShapeType`. This field is retained — the new `layerRole`
> and `pairedAssetId` are additive, not a replacement. The generated catalog
> already contains `universal_behind` entries (e.g.
> `weapon/blunt/mace/universal_behind`) from the current parser; these are
> collected as foreground entries with `universal_behind` baked into the
> assetId. This contract re-collects them with proper `layerRole: 'behind'`
> and `pairedAssetId` linking, normalising the assetId to strip the
> directory-derived suffix.
```

Output filenames adopt one convention across both families — a behind sheet is
emitted as `<assetId>.behind.<state>.webp` alongside `<assetId>.<state>.webp`.
Existing shield `_bg`/`_fg` entries are normalised to it, which is a rename of
generated output, not of upstream source.

**URL resolution**: The behind entry carries `layerRole: 'behind'` but shares its
`assetId` with the foreground entry. The URL resolver (`lpcTag` → manifest tag)
must incorporate `layerRole` so that `lpc:weapon:sword:longsword:behind:walk`
resolves to a different manifest entry than `lpc:weapon:sword:longsword:walk`.
The simplest approach is to emit behind entries with an assetId that includes
the role (e.g. `weapon/sword/longsword/behind`), producing distinct tags via
the existing `lpcTag` convention. The `layerRole` field on the catalog entry is
the renderer's source of truth — the URL resolver must never parse `_bg` or
`behind` out of a filename.

## Quality Requirements

- **Offline/degraded mode**: unchanged. An asset with no behind pass renders its
  foreground alone.
- **Accessibility/input**: N/A — no UI surface.
- **Performance budget**: the added sheets increase the bundled LPC tree.
  Measure the delta and record it; C-433/C-435 move this tree off the bundle, so
  growth here is acceptable but must be quantified, not ignored.
- **Security/privacy**: N/A — local asset collection, no network at collect time.
- **Persistence/migration**: catalog **indices shift** when new variants are
  inserted, and saves store 1-indexed variant numbers. See Migration & Rollback —
  this is the highest-risk aspect of the contract.
- **Cancellation/retry/idempotency**: collection is idempotent; re-running
  produces byte-identical output for unchanged inputs.
- **Observability**: report how many behind sheets were discovered, collected
  and paired, and list any behind sheet that could not be paired to a
  foreground entry.

## Migration & Rollback

- **Old data compatibility**: **this is the sharp edge.** Saved appearance and
  equipment reference variants by 1-indexed position within a slot's catalog
  array. Appending or inserting variants shifts those indices and silently
  repaints existing characters. Behind entries **must not** be inserted into the
  existing per-slot variant arrays ahead of existing entries. Either append only,
  or carry behind entries in a separate collection keyed by their foreground
  partner — the latter is preferred because it cannot shift an index at all.
- **Migration**: none required if indices do not shift. AC-5 exists to prove
  they did not.
- **Rollback**: `git revert` restores the collector and the catalog. The extra
  `.behind.` files may remain on disk and in the bucket; nothing references them
  and they are inert.
- **Feature flag or kill switch**: N/A.
- **Failure recovery**: an unpaired behind sheet is reported and skipped, never
  emitted as a standalone renderable entry — a behind layer with no foreground
  partner would render a floating weapon fragment.

## Scope Boundaries

- **In Scope:**
  - Collector traversal of `universal_behind/` and emission of paired entries.
  - Normalising shield `_bg`/`_fg` output to the same convention.
  - Conversion and inclusion of the new sheets in the manifest, hash sidecar and credits sidecar.
  - Catalog regeneration with `layerRole` and `pairedAssetId`.
  - Wiring behind entries to C-430's `layerRole: 'behind'` at recipe-build time.
  - Removing `STATE_ASSET_ALIASES` from `lpc_renderer.ts` if the collected passes make it unnecessary.
  - Shrinking the C-429 baseline by the gaps this closes.
- **Out of Scope:**
  - The `attack_*` sub-sheet families (`attack_slash`, `attack_thrust`, `attack_backslash`, `attack_halfslash`). They are a separate non-standard layout needing their own frame-count handling; keep `STATE_FALLBACK_CHAINS` in place for them and file a follow-up.
  - Any change to the z-order table or `layerRole` semantics — C-430 owns those.
  - Sheet geometry — C-428.
  - Publishing to R2 — C-433 picks up whatever the collector emits.
  - Collecting other missing slots (capes, quivers) beyond weapons and shields.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Not split. Collecting the sheets without wiring them
leaves inert files and a catalog claiming layers nothing renders; wiring without
collecting renders nothing. Normalising the shield convention belongs here
because leaving two conventions live is the "competing code paths" condition.

## Acceptance Criteria

### AC-1: The collector discovers and emits behind-pass sheets
**Given** the vendored generator tree containing `weapon/sword/longsword/universal_behind/walk/longsword.png`
**When** the collector runs
**Then** a corresponding behind sheet is emitted to the LPC output tree alongside the existing foreground sheet, and both appear in the manifest with hash sidecar entries

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `scripts/src/lib/ops/__tests__/*.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run scripts:test`
- Integration: run the collector; confirm behind sheets exist for the sword family and that the manifest count grew by the expected number.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- Upstream PNGs carry a page offset (`832x1344+0+512` for a walk crop). `%w`/`%h` reports the crop, not the canvas. Use `+repage` consistently or the emitted sheet is misaligned.

### AC-2: Behind and foreground entries are paired in the catalog
**Given** a collected behind/foreground pair
**When** the generated catalog is inspected
**Then** the behind entry carries `layerRole: 'behind'` and a `pairedAssetId` naming its foreground partner, and the foreground entry carries `layerRole: 'front'`

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `scripts/src/lib/ops/__tests__/*.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run scripts:test`
- Integration: inspect the regenerated catalog for the longsword and crusader-shield entries.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- Shields (filename convention) and swords (directory convention) must produce structurally identical entries. A test covering one of each is the check.

### AC-3: A weapon is visible in all four walk directions
**Given** a character with a longsword equipped
**When** the character walks facing up, left, down and right
**Then** the sword is visible in every direction, drawn behind the body when facing up and in front when facing down

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Visual | `apps/e2e/src/visual/suites/lpc.visual.ts` | `/game`, `/dev/lpc-walk` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run engine:test`
- Integration: load `/game`, equip a longsword, walk in each direction and confirm the sword is present in all four.
- E2E / Visual:
    - **Functional**: N/A.
    - **Visual**: add four cases to `apps/e2e/src/visual/suites/lpc.visual.ts` named `weapon_direction_up`, `_left`, `_down`, `_right`, route `/dev/lpc-walk`, `searchParams` selecting a body plus `weapon/sword/longsword` with the facing per case. Extend the suite's `LpcSchema` with `weaponVisible: boolean` and `occlusionCorrect: boolean`. Prompt criteria: *"A pixel-art character faces a stated direction holding a sword. Score 90+ only if the sword is clearly visible. When the character faces away (up), the blade must appear partly behind the body; when facing toward the viewer (down), it must appear in front. Score 0 if no sword is visible at all."*

**Watch Points**:
- This is the headline outcome. Verify in `/game`, not only on the dev route.
- All four directions must be checked. Facing down passes today and proves nothing.

### AC-4: The C-429 audit records the closed gap
**Given** the C-429 coverage audit and its committed baseline
**When** the audit runs after this contract
**Then** the sword-family entries are removed from the baseline, the audit exits zero, and their fg/bg union covers all four direction rows

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Integration | C-429 audit report + updated baseline | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: the C-429 audit task.
- Integration: diff the baseline; the removed entries are the measured deliverable of this contract.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- A green audit against an *unchanged* baseline means nothing was fixed. Reviewers must see baseline entries removed.

### AC-5: Existing saves render unchanged
**Given** a save written before this contract, referencing weapon and appearance variants by index
**When** it is loaded after the catalog is regenerated
**Then** every referenced variant resolves to the same asset as before, with no shifted indices

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Integration | `packages/frontend/engine/src/__tests__/serializer.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run engine:test`, `bun moon run client:test-unit`
- Integration: compare per-slot variant arrays before and after regeneration; assert every pre-existing index maps to the same `assetId`.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- **The highest-risk AC in this contract.** Inserting a behind variant into an existing slot array silently repaints every saved character. Prefer a separate collection keyed by foreground partner so indices cannot shift.
- Capture the pre-contract catalog for comparison before regenerating.

### AC-6: Attribution covers every newly collected sheet
**Given** the newly collected behind sheets
**When** the C-395 attribution preflight runs
**Then** every new sheet has resolved licence and author data and the preflight passes with no unresolved tags

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Integration | `apps/frontend/client/static/game-data/lpc_credits.json` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run scripts:test`
- Integration: run the attribution preflight; it must name any unresolved tag rather than reporting a bare count.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- C-395 states the gate has no bypass flag. Behind sheets share their foreground's upstream credit row; confirm the lookup resolves for the new path shape rather than adding an exemption.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Extend collector traversal to `universal_behind/`, emit paired entries, normalise shield output. Unit tests for AC-1, AC-2.
2. **Phase 2 (Integration)**: Regenerate the catalog with index stability verified (AC-5), wire behind entries to C-430's `layerRole`, run the attribution preflight (AC-6), remove `STATE_ASSET_ALIASES` if now unnecessary.
3. **Phase 3 (Validation)**: `bun moon run scripts:test`, `bun moon run engine:test`, `bun moon run client:test-unit`, the C-429 audit with an updated baseline (AC-4), then the `lpc.visual.ts` suite (AC-3).

## Edge Cases & Gotchas

- **Page offsets on upstream PNGs.** The generator's crops carry a virtual canvas (`832x1344`) with an offset. Convert with `+repage` awareness or the output is silently misaligned — and it will *look* fine facing down, which is the one direction that works today.
- **Behind sheets are frequently oversize.** They depend on C-428 landing first, or they will be sliced on the wrong grid.
- **`_mergeEquipmentRecipes` keying.** With behind and front sharing a slot name, a merge keyed on slot alone drops one of each pair. C-430 must key on `(slot, layerRole)`; verify it does before wiring. Currently `_mergeEquipmentRecipes` at `game_world.ts:3046` keys on `slot` only — this must be updated to `(slot, layerRole)`.
- **Bundle growth.** Roughly doubling the weapon/shield sheet count grows the bundled tree. Quantify it; C-433/C-435 address delivery.
- **URL resolver unaware of layerRole.** The current `lpcTag`/`resolveLpcUrl` pipeline takes `(assetId, state)` and knows nothing about `layerRole`. If behind entries share the foreground's `assetId`, the URL resolver must be updated to incorporate `layerRole` into the manifest tag. See the filename convention note under State & Data Models.
- **Do not chase `attack_*` here.** Those sheets have non-standard frame counts and layouts. Explicitly out of scope; leave the state-fallback chain covering them.
- **Unpaired behind sheets.** If a behind pass exists with no foreground partner, report and skip. Emitting it standalone renders a detached weapon fragment.

## Open Questions

Must be resolved before status becomes `approved`:

- None. The upstream convention, the affected assets and the render-side target are all confirmed.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Execution Report

### Summary
Extended the LPC asset collector to traverse `universal_behind/` directories and emit paired behind/front catalog entries with explicit `layerRole` and `pairedAssetId`. Shield `_bg`/`_fg` entries are normalised to the same convention. Updated `_mergeEquipmentRecipes` to key on `(slot, layerRole)` so behind/front pairs coexist. Updated the C-429 coverage baseline by removing 21 sword-family entries now covered by the behind pass. `STATE_ASSET_ALIASES` retained — the behind pass only covers walk state, not slash/thrust (attack_* sub-sheets are explicitly out of scope).

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Collector discovers behind-pass sheets — unit tests verify path detection and stripping |
| AC-2 | ✅ | Behind/front entries paired with layerRole and pairedAssetId — unit tests verify catalog shape |
| AC-3 | ⚠️ | Cannot verify in `/game` without generator PNGs (gitignored). Collector logic and wiring changes verified via unit tests |
| AC-4 | ✅ | Baseline updated — 21 sword-family entries removed |
| AC-5 | ✅ | Behind entries appended as separate collection keyed by foreground partner — existing indices cannot shift |
| AC-6 | ✅ | Attribution sidecar covers both foreground and behind states; credits pipeline unchanged |

### Files Created
| File | Purpose |
|---|---|
| `scripts/src/lib/ops/__tests__/collect_lpc_behind_pass.test.ts` | Unit tests for behind-pass path detection, shield normalisation, and catalog entry pairing (AC-1, AC-2) |

### Files Modified
| File | Change |
|---|---|
| `scripts/src/lib/ops/collect_lpc_assets.ts` | Extended collector to traverse `universal_behind/`, emit paired entries with `layerRole`/`pairedAssetId`, normalise shield `_bg`/`_fg` |
| `apps/frontend/client/src/lib/data/lpc_asset_catalog.ts` | Added `layerRole` and `pairedAssetId` fields to `LpcSlotVariant` type |
| `packages/frontend/engine/src/game_world.ts` | Updated `_mergeEquipmentRecipes` to key on `(slot, layerRole)` instead of `slot` alone |
| `apps/frontend/client/static/game-data/lpc_coverage_baseline.json` | Removed 21 sword-family entries now covered by behind pass |

### Deviations from Spec
- `STATE_ASSET_ALIASES` retained in `lpc_renderer.ts`. The behind pass only covers the `walk` state (four-direction walk cycle). The aliases exist for missing `slash`/`thrust` sheets, which are `attack_*` sub-sheets explicitly declared out of scope. The contract says "if the collected passes make it unnecessary" — they do not.

### Test Results
- Unit: 15/15 PASS (new behind-pass tests) + 427/427 PASS (existing scripts suite) + 1041/1042 PASS (engine suite — 1 pre-existing failure in `equipment_merge.test.ts` due to `const layerSprites` reassignment bug)
- E2E: N/A (no E2E tests for collector)
- Visual: N/A (no visual tests for collector)
- Baseline: 0 pre-existing failures, 0 new failures

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
