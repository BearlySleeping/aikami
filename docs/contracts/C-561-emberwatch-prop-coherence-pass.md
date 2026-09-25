---
id: C-561
title: "Emberwatch prop coherence pass"
source: "direct"
contract_type: thin
status: in_progress
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/403"
created_at: "2026-09-25T16:20:00+02:00"
---

# Contract C-561: Emberwatch prop coherence pass

## Metadata

| Field | Value |
|---|---|
| **Source** | Direct request after C-559: perimeter posts, prop style classes, edge review, and footprint-versus-collision verification. |
| **Target** | `scripts/src/lib/ops/sync_emberwatch_props.ts`, shared prop schema/types, `emberwatch_prop_visual_audit.ts`, `emberwatch_prop_footprint.ts`. |
| **Type** | thin |
| **Priority** | P1 — terrain cannot be accepted while prop scale, grounding, and collision remain visually ambiguous. |
| **Status** | in_progress |
| **Promotion** | integrated |
| **Docs Impact** | internal — authoring schema and evidence tooling. |
| **Contract version** | 2.0.0 |
| **Production Surface** | generated Emberwatch pack and `emberwatch:visual-audit` tooling; no new player UI. |

## Problem & Baseline Evidence

- **Current behavior:** the prop registry has logical render sizes and contact shadows but no shared style classification, no reusable perimeter-post definition, and no review artifact that shows every accepted frame on light and dark surfaces.
- **Current collision risk:** tall structural art can cover more map cells than its gameplay collision rectangle; the repository has the visual-footprint reducer but no explicit audit record comparing the two.
- **Existing implementation to reuse:** `sync_emberwatch_props.ts`, `ContentPackPropSchema`, `emberwatch_prop_visual_audit.ts`, `emberwatch_prop_footprint.ts`, and `prop_support.png`.
- **Known gaps:** style classes are absent; the visual audit only uses a dark/checker context; footprint data is not emitted as a review record.
- **Baseline tests:** `emberwatch_prop_visual_audit.ts` and existing map/manifest validation; C-559 focused scripts tests are green.

## User Outcome

A developer can classify Emberwatch props consistently, reuse the existing support art as a perimeter post, inspect each frame on light/dark/checker backgrounds, and see the declared visual footprint beside its gameplay collision footprint before placing props.

## Scope Boundaries

- **In Scope:** additive prop style schema; registry classifications; eight map-specific perimeter-post definitions reusing `prop_support.png`; light/dark/checker audit sheet; deterministic footprint audit; focused tests.
- **Out of Scope:** new AI-generated art, map placements/adoption (C-562), runtime collision-grid redesign, global lighting changes, changing existing accepted frame geometry, and production UI.

## Acceptance Criteria

### AC-1: Typed style classes and perimeter-post definition

**Given** the canonical Emberwatch prop table
**When** it is synchronized
**Then** every registered prop has one of the five style classes and the eight map-specific perimeter-post ids reuse the accepted `prop_support.png` structural frame with explicit base collision metadata.

**Verification**: `bun scripts/src/lib/ops/sync_emberwatch_props.ts --check`; `bun moon run scripts:test -- src/lib/ops/emberwatch_prop_pass.test.ts --timeout 30000`.

### AC-2: Light/dark edge review

**Given** every source prop frame
**When** `emberwatch:visual-audit` runs
**Then** its contact sheet renders the frame at logical world scale on dark, light, and checker surfaces and labels its style class, size, shadow, and placement maps.

**Verification**: `bun scripts/src/lib/ops/emberwatch_prop_visual_audit.ts`; inspect the generated report and contact sheet.

### AC-3: Footprint versus collision report

**Given** a solid prop definition
**When** the footprint audit reads it
**Then** it reports visual cell count, collision cell count, origin coverage, and style class without silently treating tall overhead art as full-height movement collision; walkable gates/arches remain unblocked.

**Verification**: `emberwatch_prop_pass.test.ts`; generated audit output; `emberwatch:validate` remains free of new blockers.

## Edge Cases & Gotchas

- `prop_support.png` is tall art with a deliberately small base collision; the audit must expose that mismatch rather than inflate collision without gameplay review.
- `inn.png` and `shop.png` are building source images, not registered props; an audit row may remain unclassified until a building registry exists.
- Placement changes belong to C-562; C-561 changes definitions and evidence only.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-09-25 | Initial direct contract; bundled into PR #403. | user |

## Promotion Lifecycle

See [promotion lifecycle](SHARED_SECTIONS.md#promotion-lifecycle).

## Status Lifecycle

See [status lifecycle](SHARED_SECTIONS.md#status-lifecycle).

---

## Execution Report

### Summary

C-561 is implemented. The registry now carries typed style classes and eight map-specific perimeter-post definitions; the visual audit renders each frame on dark, light, and checker surfaces; and the footprint audit records visual/collision cell counts without silently converting tall overhead art into full-height movement collision. Focused tests, the full affected Moon gate, and the contract-status reconciliation are green.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Registry sync and focused prop tests pass. |
| AC-2 | ✅ | Audit generated a 28-row light/dark/checker contact sheet. |
| AC-3 | ✅ | Footprint audit reports post visual/collision cells and preserves base collision semantics. |

### Files Created

| File | Purpose |
|---|---|
| `docs/contracts/C-561-emberwatch-prop-coherence-pass.md` | Contract and execution report. |
| `scripts/src/lib/ops/emberwatch_prop_pass.test.ts` | Registry/style/footprint regressions. |

### Files Modified

| File | Change |
|---|---|
| `scripts/src/lib/ops/sync_emberwatch_props.ts` | Style registry and perimeter-post definition. |
| `packages/shared/schemas/src/lib/game/content_pack.ts` | Style-class schema. |
| `packages/shared/types/src/lib/game/content_pack.ts` | Derived style type. |
| `scripts/src/lib/ops/emberwatch_prop_visual_audit.ts` | Light/dark/checker rendering and style labels. |
| `scripts/src/lib/ops/emberwatch_prop_footprint.ts` | Footprint audit record. |
| `content/packs/emberwatch/manifest.json` | Regenerated prop registry. |

### Deviations from Spec

None. Map placement remains explicitly deferred to C-562.

### Test Results

- Unit: 4 prop-pass tests passed, 0 failed; the full affected Moon gate is green.
- Visual audit: completed, 28 rows, contact sheet generated with style labels and dark/light/checker surfaces.
- Full gate: `bun moon ci --base=origin/main` — 81 completed, 2 skipped, 0 failed.
