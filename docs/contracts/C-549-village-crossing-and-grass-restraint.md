---
id: C-549
title: "Emberwatch village crossing on the straight reach + restrained grass"
source: "docs/reference/emberwatch-polish-review-and-plan.md — §1.3, §1.6, §5 Bridges and shores / Map composition; C-546 §Design; C-548 §Evidence"
contract_type: thin
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-24T00:00:00Z"
---

# Contract C-549: Emberwatch village crossing on the straight reach + restrained grass

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/reference/emberwatch-polish-review-and-plan.md` — §1.3, §1.6, §5 "Bridges and shores" and "Map composition"; C-546 §Design and §Evidence; C-548 §Evidence sequence |
| **Target** | `scripts/src/lib/ops/` (village builder, stream geometry, notice-board approach, grass painters, map navigation + validation), `packages/frontend/engine/src/` (restore regression test) |
| **Type** | thin |
| **Priority** | P2 — first half of the approved environment slice: a crossing that reads as one structure on a straight reach, and terrain that stops advertising the tile grid |
| **Dependencies** | C-546 (`placeBridge` + frame assembly), C-548 (GID→atlas coverage, reproducible evidence plane) |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | internal → none (authoring/generator change; no player-facing UI) |
| **Contract version** | 1.0.0 |
| **Production Surface** | `scripts/src/lib/ops/generate_emberwatch_atlas.ts` + `generate_emberwatch_maps.ts` (declared tooling commands); runtime consumes the generated atlas/maps through the existing `/game` tilemap path |

## Problem & Baseline Evidence

Verified against `origin/main` `783018eab` (C-548, PR #390) before any change.

- **The crossing sat at the stream's inside corner.** C-546 replaced the per-cell
  bridge stamp with `placeBridge`, but the village call still sat on the L-bend
  elbow: `region: { c0: 39, r0: 7, c1: 41, r1: 8 }`, `axis: 'ns'`. That is why
  C-546 had to pass `assertBanks: false` with an in-code comment — the east bank
  and the north approach were dry, so the strict perpendicular check could not
  hold. The crossing therefore still read as a span grafted onto a corner, not
  as a crossing of a straight reach.
- **The E–W reach was one cell deep.** `streamChannel()` laid `(c, 7)` for
  `c = 39…26` only; row 8 along that stretch was the sand bank. A north–south
  crossing needs two rows of water to sit between two banks, so the span could
  not be placed anywhere on the straight section without widening the reach.
- **The notice board was south of the crossing.** The landmark sat at `(45, 11)`
  with its dirt approach at `cols 39–40 × rows 9–22` plus `rows 10–11 × cols
  41–46` — the same side of the stream as the village square. The bridge was
  therefore decoration: nothing routed over it, because the board was reachable
  by walking east and north around the elbow.
- **Grass variants read as squares.** `paintGrassDark` painted from
  `RGB(58,116,50)` against the base's `RGB(74,143,60)` — a materially darker
  cell, so a scattered dark tile read as an isolated square. `paintGrassFlowers`
  scattered up to seven near-white `(240,240,240)` / magenta `(201,91,210)`
  flecks per tile at a seeded-but-per-tile position, so the flecks repeated on a
  regular lattice across the map. Confirmed in the C-548 evidence PNG
  (`village_crossing_noon.png`): alternating dark grass blocks and a visible
  dot grid.
- **Variant placement was independent per cell.** `scatter(m, rng, …, G.GRASS,
  G.GRASS_DARK, 0.14)` in `emberwatch_map_village.ts` and
  `generate_emberwatch_maps_extra.ts` made an independent Bernoulli draw per
  cell, so variants could never form a patch. No existing deterministic
  noise/cluster helper existed (`grep` for `noise|cluster|valueNoise|patch` found
  only `noiseCell`, a within-tile pixel helper that has no map-level notion).
- **Baseline tests**: `scripts:test` (2091 pass / 0 fail on the base),
  `frontend-engine:test` (1826 pass / 0 fail).

## User Outcome

A player leaving the village square for the notice board walks north up the
village road, crosses one continuous wooden deck over a two-row river, and
arrives at the board on the far bank. The river is a woodland boundary, not a
gate elsewhere: the road south of it is untouched, and the deck is the only
place the stream can be crossed. Grass reads as a meadow — no dark squares, no
regular bright flecks, variants in broad soft patches.

## Scope Boundaries

- **In Scope:** widen the E–W reach to rows 7–8; move the village crossing to
  cols 36–37 × rows 7–8 with `assertBanks: true`; re-route the notice-board
  approach and relocate the board to the crossing's north bank; update
  `reopenBridge`; add a crossing-on-shortest-route validation rule; add a
  `scatterPatches` value-noise helper and use it for the grass variants; rewrite
  the three grass painters around one shared base; pixel tests on the real
  painter output; a save/companion restore regression test; regenerated content;
  this contract.
- **Out of Scope:** buildings (next contract); any other map's layout; image-model
  art; stone floor/roof/wall painters (explicitly untouched); UI; guard
  thresholds, goldens or evaluator prompts; deploy/publish/apply; human visual
  acceptance.

## Acceptance Criteria

### AC-1: The crossing is on the straight E–W reach and the bank check is strict

**Given** the village builder
**When** the maps are generated
**Then** the E–W reach is water at rows 7–8 for cols 26–40, the crossing is
`placeBridge({ region: { c0: 36, r0: 7, c1: 37, r1: 8 }, axis: 'ns' })` with
`assertBanks: true` (the default — the `assertBanks: false` exception and its
comment are removed), the N–S reach stays one column group coming down from the
NE and meets the E–W reach at the elbow with no bridge, and every span cell
carries the frame its position requires.

**Verification**: `tooling: \`bun moon run scripts:test\`` —
`emberwatch_village_crossing.test.ts` (exact frame grid, both travel ends are
walkable land, both long sides are water, the elbow carries no bridge, no bridge
frame remains on the old 39–41 span). The strict check is itself the proof: a
mis-placed span throws from `placeBridge` at author time.

### AC-2: The notice-board approach meets the crossing at both ends

**Given** the re-routed approach
**When** the map is walked
**Then** the south approach runs from the existing dirt path at cols 39–40 to
the span's south end, the north side runs from the span's north end to the
notice-board walk, each bank has a short worn-earth approach, and the board
itself sits on the crossing's far side.

**Verification**: `emberwatch_village_crossing.test.ts` (south approach is dirt
at 39,9/36,9/37,9; north approach is walkable dirt at 36,6 and 37,6; the board
pad is walkable). `tooling: \`bun run emberwatch:validate\`` — the notice board
is reachable from the village arrival.

### AC-3: The crossing is on the shortest path from the square to the notice board

**Given** the regenerated village
**When** map validation runs
**Then** a new `crossing-not-on-shortest-route` blocker fires if the shortest
walkable path from the village square to the notice-board pad does not cross the
span, and 0 blockers are reported on the committed pack.

**Verification**: `tooling: \`bun run emberwatch:validate\`` (0 blockers);
`emberwatch_village_crossing.test.ts` ("the real pack has no crossing-route
blocker"). Negative case verified by hand: carving a second dry crossing at
cols 32–33 × rows 7–8 makes the rule fire with `crossing-not-on-shortest-route`.

### AC-4: A restored position on newly-water ground is relocated

**Given** a save taken before the crossing moved
**When** the world is restored (`RESTORE_PLAYER` / `LOAD_MAP`)
**Then** `clampSpawnToWalkable` relocates the player from a cell the change made
water onto the nearest walkable cell, and leaves an unaffected position alone.

**Verification**: `tooling: \`bun moon run frontend-engine:test\`` —
`emberwatch_crossing_restore.test.ts`, which builds the oracle from the real
committed village collision layer rather than a fixture, so it cannot drift from
the geometry.

### AC-5: Grass variants share the base value and do not read as squares

**Given** the packed atlas produced by the real painter
**When** every grass variant is measured
**Then** each variant's mean luminance is within ±4% of the base grass, every
variant's edge rows/columns are within 1.5 of the base's, the flower variant has
no high-contrast decal pixels, no non-grass hue, no channel spread beyond the
base family, and no fixed-grid decal placement.

**Verification**: `tooling: \`bun moon run scripts:test\`` —
`emberwatch_grass_variants.test.ts` (reads `packAtlas()`, the same bytes the
generator writes).

### AC-6: Variants are placed in broad correlated patches, deterministically

**Given** the village and old-road builders
**When** the grass variants are scattered
**Then** placement comes from a seeded value-noise threshold (broad soft
patches) rather than an independent per-cell draw, the same seed always
produces the same map, and a non-base cell is never repainted.

**Verification**: `emberwatch_village_crossing.test.ts` ("scatterPatches forms
broad deterministic patches": same seed equal, different seed different, no
non-base repaint, variants are a minority of the grass);
`tooling: \`bun scripts/src/lib/ops/generate_emberwatch_maps.ts\`` twice →
`git diff --exit-code -- content/packs/emberwatch/maps` is empty.

## Design

### Village stream + crossing

| | Before (C-546) | After (C-549) |
|---|---|---|
| E–W reach | row 7 only, cols 26–39 | rows 7–8, cols 26–40 |
| Crossing span | cols 39–41 × rows 7–8 (elbow) | cols 36–37 × rows 7–8 (straight) |
| `assertBanks` | `false` + comment | default `true`, no exception |
| Board | `(45, 11)`, south of the stream | `(37, 4)`, north bank, on a worn-earth pad |
| Board approach | cols 39–40 rows 9–22 + rows 10–11 cols 41–46 | same trunk + south spur (row 9, cols 36–40) + north spur (row 6, cols 36–37) |

The N–S reach stays at col 40 (rows 3–7) and meets the widened E–W reach at the
elbow; no bridge is placed there, so the crossing is the only dry passage.

### Real collision delta (diffed from `origin/main` village.json, not the hand list)

The pre-work ASCII sketch drew the N–S reach at cols 41–42 and its collision list
omitted the col 40→41 moves. Diffing the committed collision layer before and
after gives **16 changed cells**, and the hand list was wrong in a way that
mattered: the dominant effect is **row 8 becoming water across the reach**, not
the crossing moving.

| cell | collision | ground (before → after) |
|---|---|---|
| (36,7) | 1 → 0 | water → bridge_corner_nw_ns |
| (37,7) | 1 → 0 | water → bridge_corner_ne_ns |
| (39,7) | 0 → 1 | bridge_corner_nw_ns → water |
| (40,7) | 0 → 1 | bridge_end_n → water |
| (27,8) | 0 → 1 | sand → water |
| (28,8) | 0 → 1 | sand → water |
| (29,8) | 0 → 1 | sand → water |
| (30,8) | 0 → 1 | sand → water |
| (31,8) | 0 → 1 | sand → water |
| (32,8) | 0 → 1 | sand → water |
| (33,8) | 0 → 1 | sand → water |
| (34,8) | 0 → 1 | sand → water |
| (35,8) | 0 → 1 | sand → water |
| (38,8) | 0 → 1 | sand → water |
| (39,8) | 0 → 1 | bridge_corner_sw_ns → water |
| (40,8) | 0 → 1 | bridge_end_s → water |

Reading it: 2 cells become walkable (the new span), 14 become solid. The 12
`sand → water` cells at cols 27–35 and 38 in row 8 are the widening; the four
former bridge cells at (39,7), (40,7), (39,8), (40,8) are the old span becoming
river. The N–S reach did **not** move (col 40 rows 3–7 is unchanged), so the
sketch's cols 41–42 placement was not adopted — and the hand list's missing
col 40→41 moves describe a change that was never made.

A further **755 cells change ground only** with no collision change: these are
the grass-patch relocation (420 `grass → grass_dark`, 154
`grass_dark → grass`, 31 `grass → grass_variant`, 48
`grass_variant → grass`, 23 `grass_variant → grass_dark`, plus small counts
where the notice-board pad/dirt replaced grass). Regenerate with the existing
commands; the map is deterministic.

### Crossing-on-shortest-route rule

`emberwatch_map_bridge_route.ts` (new) asserts authored route pairs over the
existing walkability grid using a new breadth-first `shortestPath` helper in
`emberwatch_map_navigation.ts`. Two rules:

- `crossing-route-unreachable` — no walkable route between the anchors.
- `crossing-not-on-shortest-route` — the shortest route never touches the
  crossing span, i.e. the crossing is bypassable and does not read as the way
  there.

Anchors must be **reachable from the map's arrival spawns**, not merely
walkable: the assertion is about the path a player actually takes, and a
walled-off anchor would make the answer meaningless. A blocked/isolated anchor
skips the rule (the connectivity rules already report that as a blocker with a
better message) rather than double-reporting.

This is deliberately an **assertion on the real pack**, so a future builder
edit that repaints a bank or reopens the reach fails validation with both
anchor regions named.

### Grass restraint

`generate_emberwatch_grass_frames.ts` (new) owns the grass material. All three
painters compose from one `paintGrass`, so a variant cannot drift in base value
or edge value by construction:

- `paintGrass` — unchanged base fill, noise and speckle.
- `paintGrassDark` — was a separate dark base; now the shared base plus a sparse
  9-pixel dapple at `RGB(66,130,54)` / `(70,134,58)`.
- `paintGrassFlowers` — was 7 saturated flecks; now the shared base plus 5
  clumps at `RGB(88,154,70)` / `(64,126,52)`, placed by seeded RNG across the
  cell.

Measured on `packAtlas()` (base mean 121.961, base edge mean 121.980):

| frame | mean | Δ vs base | edge mean | Δ vs base |
|---|---|---|---|---|
| `grass_dark.png` | 121.814 | −0.12% | 121.783 | −0.197 |
| `grass_variant.png` | 121.786 | −0.14% | 122.214 | +0.233 |
| `grass_edge_n.png` | 121.818 | −0.12% | 121.821 | −0.160 |
| `grass_edge_s.png` | 121.994 | +0.03% | 121.119 | −0.861 |
| `grass_edge_w.png` | 122.094 | +0.11% | 122.324 | +0.344 |
| `grass_edge_e.png` | 121.633 | −0.27% | 122.030 | +0.049 |

Before this change `grass_dark` was ~10% darker than the base; every variant is
now within 0.3%.

### Variant placement

No existing map-level noise/cluster helper existed, so `scatterPatches` was added
to `emberwatch_map_shared.ts`: a coarse lattice of seeded random values,
smoothstep-interpolated, thresholded per cell. Larger `scale` = broader patches.
It only repaints cells still holding `baseGid`, so paths, water, pads and
buildings are never touched. Used for the village, old road and shrine grass
variants with distinct seeds.

## Edge Cases & Gotchas

- **`assertBanks: true` is now load-bearing for the village.** With the crossing
  off the elbow, a stream edit that repaints a bank cell throws from
  `placeBridge` at author time instead of producing a crossing with a dry end.
  This is the point of the change.
- **Row 8 was the sand bank, not water.** Widening the reach overwrote 12 bank
  cells; the bank pass still paints row 9, so the south shore reads as a bank
  below a two-row river.
- **The board moved; its `propId` did not.** `notice_board` is polishable
  (position) per `emberwatch_locked_identity.ts`; `emberwatch:locked-ids` is
  unchanged.
- **Sella's line stays true.** "Take the north road out of the square. She is at
  the waystation, past the bridge." — the crossing is still the way north out of
  the square, so no dialogue edit was needed.
- **Determinism:** `generate_emberwatch_maps.ts` twice produces byte-identical
  output. Variant placement is seeded, never `Math.random()`.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-09-24 | Initial contract | user (direct prompt) |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---

## Execution Report

### Summary

Moved the village crossing off the stream's inside corner onto the straight
E–W reach and widened that reach to two rows, so the span now satisfies
`placeBridge`'s strict bank check with no `assertBanks: false` exception. The
notice board moved to the crossing's north bank (its `propId` unchanged) and the
dirt approach was re-routed to meet the span at both banks, which is what makes
the crossing the shortest path from the square to the board rather than
decoration — a new `crossing-not-on-shortest-route` validation rule asserts that
and was verified to fire when a second crossing is carved. Grass now has one
shared material behind all three painters, so dark and flower variants sit within
0.3% of the base instead of reading as dark squares and a bright dot grid, and
variant placement moved from independent per-cell draws to a seeded value-noise
patch threshold. A real-map restore test proves `clampSpawnToWalkable` relocates
a player whose saved cell is now river.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | `assertBanks: true` (default), no exception; exact frame grid + bank/elbow/old-span assertions |
| AC-2 | ✅ | South spur (row 9, cols 36–40) and north spur (row 6, cols 36–37) both walkable; board pad walkable |
| AC-3 | ✅ | New rule; passes on the pack, verified to fire when a bypass exists |
| AC-4 | ✅ | Real-map oracle; newly-water restore relocates, walkable restore untouched |
| AC-5 | ✅ | All variants within ±4% mean (actual ≤0.3%) and ≤1.5 edge; no high-contrast/off-hue/grid decals |
| AC-6 | ✅ | `scatterPatches` deterministic; two regens byte-identical; no non-base repaint |

### Files Created

| File | Purpose |
|---|---|
| `scripts/src/lib/ops/generate_emberwatch_grass_frames.ts` | The grass material + its variants (one shared base by construction) |
| `scripts/src/lib/ops/emberwatch_map_bridge_route.ts` | `crossing-not-on-shortest-route` / `crossing-route-unreachable` rules |
| `scripts/src/lib/ops/emberwatch_village_crossing.test.ts` | Crossing geometry, approach, route rule, `scatterPatches` |
| `scripts/src/lib/ops/emberwatch_grass_variants.test.ts` | Grass mean/edge/sparsity/hue/grid pixel tests on `packAtlas()` |
| `packages/frontend/engine/src/__tests__/emberwatch_crossing_restore.test.ts` | Real-map restore clamp + companion-path report |

### Files Modified

| File | Change |
|---|---|
| `scripts/src/lib/ops/emberwatch_map_village.ts` | E–W reach rows 7–8; crossing at 36–37 × 7–8 (no `assertBanks:false`); board to (37,4) + pad; `paintNoticeBoardApproach`; `reopenBridge` 36–37; `scatterPatches` |
| `scripts/src/lib/ops/emberwatch_map_shared.ts` | `scatterPatches` seeded value-noise helper |
| `scripts/src/lib/ops/emberwatch_map_navigation.ts` | `shortestPath` BFS helper (complexity-flattened into `expandBfsCell`/`runBfs`/`tracePath`) |
| `scripts/src/lib/ops/emberwatch_map_validation.ts` | Call `validateBridgeRoutes` per map |
| `scripts/src/lib/ops/emberwatch_authoring.ts` | `placeBridge` docstring: no call site opts out of the strict check now |
| `scripts/src/lib/ops/generate_emberwatch_atlas.ts` | Import the grass painters from their module (C-549); file shrank below its size baseline |
| `scripts/src/lib/ops/generate_emberwatch_maps_extra.ts` | Old road + shrine `scatterPatches`; `scarWard` seed-based |
| `scripts/src/lib/ops/guard_source_file_size_baseline.json` | Sanctioned reduction locked in (atlas generator shrank after the grass extraction) |
| `content/packs/emberwatch/maps/{village,old_road,ruined_shrine}.json` | Regenerated |
| `content/packs/asset_hashes.json` | Regenerated by `scan_assets` |
| `docs/reference/emberwatch-map-validation.json` | Regenerated (0 blockers) |

### Generated files changed + commands

1. `bun scripts/src/lib/ops/generate_emberwatch_atlas.ts` → terrain atlas (gitignored build output; 544×340, 144 frames)
2. `bun scripts/src/lib/ops/generate_emberwatch_props_atlas.ts` → props (gitignored)
3. `bun scripts/src/lib/ops/install_emberwatch_portraits.ts` + `install_emberwatch_audio.ts` (gitignored)
4. `bun scripts/src/lib/ops/generate_emberwatch_maps.ts` → the three map JSONs (tracked)
5. `bun scripts/src/lib/ops/scan_assets.ts` → `content/packs/asset_hashes.json` (tracked)
6. `bun run emberwatch:validate` → `docs/reference/emberwatch-map-validation.json` (tracked)

### Deviations from Spec

- **The notice-board pad is worn earth, not paving.** The first pass reused
  `STONE_FLOOR` (what the old board pad had). The evidence capture showed a
  large grey paved slab dominating the north bank, which is wrong for a board on
  a woodland edge and would have put the out-of-scope stone-floor painter on this
  contract's critical path. Changed to `G.DIRT`.
- **The notice board was moved, not just re-routed.** The task asked to "re-route
  the notice-board dirt approach so it meets the new crossing at both ends
  (south approach from the existing path at 39–40, north side to the
  notice-board walk)". As authored, the board sat at `(45, 11)` on the same side
  of the stream as the square, so a "north side to the notice-board walk" is
  geometrically impossible without moving it, and "the crossing must be on the
  shortest path from the square to the notice board" is false while the board is
  reachable around the elbow. The user was asked and chose to move the board to
  the north bank. `propId` unchanged (`notice_board` is polishable);
  `emberwatch:locked-ids` unchanged.
- **The N–S reach was not moved to cols 41–42.** The pre-work sketch drew it
  there, but the task said the N–S reach "stays one column group", and keeping
  it at col 40 is what makes the crossing the only dry passage (the primary N–S
  road at cols 31–33 is cut by the widened reach). The hand collision list's
  implied col 40→41 moves were therefore never made — the real delta table in
  §Design is the diffed truth.
- **The old road and shrine also switched to `scatterPatches`.** The task said
  "village/old road"; the shrine's `scarWard` used the same per-cell `scatter`
  for `GRASS_DARK`, so leaving it would have left the identical grid-advertising
  defect on a third map. It is a two-line seed change, not a layout change.
- **Companion restore was reported, not fixed**, as instructed. See §Evidence.

### Test Results

- `tooling: \`bun moon run scripts:test\`` — **2106 pass / 0 fail**
- `tooling: \`bun moon run frontend-engine:test\`` — **1832 pass / 0 fail**
- `tooling: \`bun moon run scripts:typecheck\`` / `frontend-engine:typecheck` — pass
- `tooling: \`bun moon run scripts:lint\`` / `frontend-engine:lint` — pass
- Structural guards (`bun run scripts/src/lib/ops/run_guards.ts`) — **10/10 pass**
- `tooling: \`bun run emberwatch:validate\`` — **0 blockers**, 1 newly introduced,
  accepted warning (`route-width-below-minimum` village/transition:old_road):
  the C-549 crossing provides 2 cells of clearance, below the companion-safe
  minimum of 3. The crossing remains 2 cells wide.
- `tooling: \`bun run emberwatch:locked-ids\`` — unchanged
- Determinism: `generate_emberwatch_maps.ts` twice → byte-identical

A known-flaky `emberwatch_release_cli` subprocess suite intermittently exceeds
its 5s per-test timeout under parallel load; it is unrelated to this change
and is green on a clean re-run.

### Save & companion restore findings

- **Player:** `RESTORE_PLAYER` and `LOAD_MAP` both run `clampSpawnToWalkable`
  with the full-box `isPlayerSpawnBlocked` oracle. A save that lands on a cell
  the crossing change made water (e.g. `(38,8)`, a long-side cell, or `(40,7)`,
  the old span) is relocated to the nearest walkable cell, and a still-walkable
  position is left untouched. Covered by
  `emberwatch_crossing_restore.test.ts`, which builds the oracle from the real
  committed village collision layer.
- **Companion: not clamped, unchanged by this contract — reported, not fixed.**
  `ecs_worker.ts`'s `RESTORE_PLAYER` clamps only `playerEntityId`; there is no
  `clampSpawnToWalkable` call for entities carrying the `Companion` component, and
  `LOAD_GAME` re-registers restored entities in the spatial grid without
  repositioning them. A companion restored onto newly-water ground therefore
  keeps its saved coordinates. It is not a freeze like the player's C-378
  deadlock (the follow system re-paths, and `updateMovement` rejects the blocked
  step), but it is a real gap: a companion can be restored inside a wall and
  then path from an invalid origin. Fixing it properly is not a one-liner with
  the same clamp (a companion needs its own mask/footprint, and the follow
  system would need a re-path signal), so it is left for a follow-up with a
  pending behavioral test for restoring a companion onto water.

### Nav assertion

Added to the existing map validation (`emberwatch_map_validation.ts` calls
`validateBridgeRoutes` per map; the rule lives in
`emberwatch_map_bridge_route.ts`, using a new BFS `shortestPath` in
`emberwatch_map_navigation.ts`):

- Registered pair: village `square→notice_board`, from the square's paving
  `(31,21)–(33,23)`, to the notice-board pad `(35,5)–(36,5)`, via the span
  `(36,7)–(37,8)`.
- On the committed pack: **0 blockers**. The shortest route (22 cells) runs up
  the village road, over the span, and onto the board's pad.
- Negative case verified: carving a ford at cols 32–33 × rows 7–8 makes the rule
  fire with `crossing-not-on-shortest-route` and validation fails.

### Evidence

Same-camera before/after pairs at 1920×1080 DPR1, default zoom, noon, overlays
off, plus dawn for the crossing and one collision-overlay shot. WebGL renderer
asserted (C-548 guard) before every capture; the "before" plane is a clean
`origin/main` worktree at `783018eab`, both planes built from the real read-only
release snapshot.

Directory: `/tmp/opencode/c549-evidence/` — 16 PNGs plus `index.md` (identities,
per-file camera cell and game time, observations) and the machine-readable
capture/walk indexes.

| Absolute path | What it shows |
|---|---|
| `/tmp/opencode/c549-evidence/before_village_crossing_noon.png` | origin/main at the new span's camera: one-row stream, bridge off at the elbow, dark grass squares + a regular fleck lattice |
| `/tmp/opencode/c549-evidence/after_village_crossing_noon.png` | two-row river, one continuous deck, worn-earth approaches, uniform meadow |
| `/tmp/opencode/c549-evidence/before_village_crossing_dawn.png` | the same "before" frame at 06:00 |
| `/tmp/opencode/c549-evidence/after_village_crossing_dawn.png` | the same "after" frame at 06:00 |
| `/tmp/opencode/c549-evidence/before_village_crossing_noon_collision.png` | walkability overlay, before |
| `/tmp/opencode/c549-evidence/after_village_crossing_noon_collision.png` | walkability overlay, after — river red on both sides, span green under the deck |
| `/tmp/opencode/c549-evidence/before_village_square_noon.png` | village square before — the grass defect at its clearest |
| `/tmp/opencode/c549-evidence/after_village_square_noon.png` | village square after |
| `/tmp/opencode/c549-evidence/before_old_road_crossing_noon.png` | old-road regression pair, before |
| `/tmp/opencode/c549-evidence/after_old_road_crossing_noon.png` | old-road regression pair, after (culvert unchanged; grass patches only) |
| `/tmp/opencode/c549-evidence/after_walk_01…06_*.png` | six-frame keyboard walk: north bank → onto the deck → blocked stepping west into the river → stopped at the far rail stepping east → across to the south bank → clear |

The walk's per-frame player cells (read from `__AIKAMI_DEBUG__`): (36,5) →
(36,7) → (36,7) → (37,7) → (37,9) → (37,11). The unchanged cell at step 3 is
the runtime proof that the long side of the span is not walkable.

**No visual acceptance is claimed — the human decides.**

## Known follow-ups

1. **Companion restore clamping** — a companion restored onto invalid ground
   keeps its saved coordinates. Needs its own clamp/footprint plus a follow
   re-path signal; not a one-liner.
2. **The notice board is now a short detour from the north gate.** Arriving from
   the old road at `(32,3)` reaches the board in 7 cells without crossing. That
   is correct — the assertion is specifically square→board — but the board now
   serves two arrival directions, which a later composition pass may want to
   reconcile.
3. **No buildings.** P2's other half (a real building assembly) is the next
   contract; `paintShell`/`paintInterior` still make flat shells.
4. **Stone floor/roof/wall painters untouched**, per the task's explicit
   non-goal. The repeated 8×8 floor bevel is still there.
