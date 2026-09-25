---
id: C-562
title: "Emberwatch five-map polish adoption"
source: "direct"
contract_type: thin
status: in_progress
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/403"
created_at: "2026-09-25T16:35:00+02:00"
---

# Contract C-562: Emberwatch five-map polish adoption

## Metadata

| Field | Value |
|---|---|
| **Source** | Direct request after C-561: roll accepted terrain/house/prop work through the inn, merchant shop, old road, and ruined shrine. |
| **Target** | `emberwatch_map_retained.ts`, `generate_emberwatch_maps_extra.ts`, generated four-map JSON, and navigation/visual evidence. |
| **Type** | thin |
| **Priority** | P1 — proves the accepted kit survives all authored map contexts without interior terrain regressions. |
| **Status** | in_progress |
| **Promotion** | integrated |
| **Docs Impact** | internal — map content and evidence. |
| **Contract version** | 2.0.0 |
| **Production Surface** | production `/game` map loads through the generated Emberwatch pack. |

## Problem & Baseline Evidence

- C-559 and C-561 are implemented on the synced PR base. The four non-village maps still use the pre-pass prop layout, so the new structural vocabulary has not been exercised in interiors, the waystation, or the shrine.
- Interior terrain remains intentionally baked; applying outdoor semantic terrain to inn/shop would recreate the C-559 floor regression.
- Existing map validation, transition reciprocity, and locked identities are the mechanical safety net.

## User Outcome

The inn, merchant shop, old road, and ruined shrine use the accepted perimeter-post vocabulary in their own functional zones, while terrain, house, collision, transitions, and story identities remain stable and navigable.

## Scope Boundaries

- **In Scope:** two perimeter posts per adopted map; map-builder placement; regenerated four-map JSON; navigation/identity/visual evidence.
- **Out of Scope:** new terrain families, changing interior floors, changing house geometry, prop asset generation, combat redesign, save migration, and production promotion.

## Acceptance Criteria

### AC-1: Four-map placement

**Given** the generated C-561 registry
**When** the four map builders compile
**Then** inn, merchant shop, old road, and ruined shrine each place exactly two `perimeter_post` props in zone-appropriate cells, with no duplicate local object IDs.

**Verification**: focused builder/map-compile tests and generated JSON inspection.

### AC-2: Stable terrain and identity

**Given** the C-559 base
**When** the four maps are regenerated
**Then** indoor terrain channels remain absent, existing story/transition/spawn identities remain unchanged, and no C-562 code changes C-559 water or village terrain semantics.

**Verification**: `emberwatch:locked-ids`, `emberwatch:validate`, interior/terrain regression tests, and map diff review.

### AC-3: Navigation and visual evidence

**Given** the four updated maps
**When** route, collision, and same-camera evidence checks run
**Then** both routes/transitions remain reachable, posts do not seal a required corridor, and each map has overlay-off before/after evidence with loaded-content identity.

**Verification**: `bun run emberwatch:validate`; C-562 `.evidence/` capture; human review remains separate.

## Edge Cases & Gotchas

- Perimeter-post art is tall while collision is intentionally base-sized; review its footprint in the C-561 report rather than widening collision blindly.
- New prop object IDs are intentionally recorded in the locked-identity golden by this contract; no existing story/transition/spawn identity changes.
- Do not regenerate or hand-edit interior terrain to make a post visually fit.

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

C-562 regenerated the four adopted maps from current builders and placed two map-specific perimeter posts in each. The generated pack remains deterministic, all five maps validate with zero warnings/blockers, and the only intentional locked-identity change is the eight new decorative prop IDs recorded in the golden. Four candidate-origin evidence lanes are published; technical capture is complete, while human visual acceptance remains open.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Exactly two posts per adopted map; local object ids remain unique. |
| AC-2 | ✅ | Interiors remain terrain-free; map validation and locked identities pass after deliberate eight-ID golden update. |
| AC-3 | ⚠️ | Four 1280×720 WebGL/entity-guarded lanes and checksums pass; human review pending. |

### Files Created

| File | Purpose |
|---|---|
| `docs/contracts/C-562-emberwatch-five-map-polish-adoption.md` | Contract and execution report. |

### Files Modified

| File | Change |
|---|---|
| `scripts/src/lib/ops/emberwatch_map_retained.ts` | Inn/shop perimeter-post placements. |
| `scripts/src/lib/ops/generate_emberwatch_maps_extra.ts` | Old-road/shrine perimeter-post placements. |
| `content/packs/emberwatch/maps/{inn,merchant_shop,old_road,ruined_shrine}.json` | Regenerated four-map adoption output. |
| `content/packs/emberwatch/manifest.json` | Regenerated style/post registry. |
| `scripts/src/lib/ops/emberwatch_locked_ids.golden.json` | Deliberate eight-ID decorative-post addition. |
| `docs/reference/emberwatch-map-validation.json` | Regenerated validation summary. |

### Deviations from Spec

None.

### Test Results

- Unit: prop/map focused tests passed, including 62 terrain/prop/map tests and 4-post adoption assertions.
- Content: five-map validation passed with 0 warnings and 0 blockers; locked IDs pass after the documented golden update.
- Visual: `.evidence/C-562-inn`, `C-562-merchant`, `C-562-old-road`, and `C-562-shrine` each contain 1280×720 before/after PNGs, valid checksums, and candidate manifest SHA-256 `5fd619ecdb04…`; human acceptance remains separate.
- Full gate: `bun moon ci --base=origin/main` — 81 completed, 2 skipped, 0 failed.
