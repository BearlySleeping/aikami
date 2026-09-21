# Semantic map authoring — foundation and deferred compiler design

**Decision: 2026-09-09.** The maintainer chose **foundation now; biome compiler later**.

[C-505](../contracts/C-505-canonical-scene-data-and-authoring-boundary.md) implements validated canonical scenes and compatibility adapters. This document protects a future authoring boundary; the example below is **not an implemented API, schema or supported runtime map**. Do not accept it in the game loader until a separate compiler contract is approved and implemented.

## Three representations, three responsibilities

| Representation | Author/owner | Purpose |
|---|---|---|
| Authoring plan (future) | Human or LLM, validated by authoring tools | Regions, biome references, restrictions, structures and exceptional placements |
| Canonical scene (C-505) | Importer/compiler | Stable scene/object IDs, one terrain/ground authority, explicit layers, placements and locked visual references |
| Runtime data | Engine load/edit compilation | Typed terrain/occupancy arrays, resolved frame handles and cached render chunks |

A compact authoring plan need not list every tile. A runtime grid can still be dense and efficient. Do not optimize authoring JSON by making an LLM generate array indices, encoded GIDs or compressed base64. Do not make a renderer interpret natural language or call an LLM during map load.

The future compiler is interchangeable with a Tiled/native-scene importer: both output the same canonical scene. A save pins the compiled scene revision plus world-state deltas. It never depends on a provider/model remaining available or regenerating identical images.

## What ships in this foundation

- Stable named scene, layer, frame and placement identities, plus immutable dependency references.
- One normalized scene shape for existing inputs and native import/export.
- Layer-aware uniqueness, explicit source ownership and bounded validation.
- Existing `fill` and layered `corner16` terrain matching, collision/sight authority and chunk rendering.
- An explicit error for unsupported plan formats/matching modes.

**Not shipped here:** region expansion, biome scattering, prefab expansion, procedural houses, polygon editing, semantic generation tools, a new matching solver or world-generation UI. Do not add empty handlers or speculative schema branches merely to make the example validate.

## Proposed future authoring example

All references below are illustrative logical IDs. A future compiler must resolve them against an installed, immutable catalog lock; these names are not URLs or file paths and are not claimed to exist in today's catalog.

```json
{
  "kind": "aikami.map-plan.proposal",
  "version": 1,
  "id": "example/forest-clearing",
  "seed": "clearing-42",
  "catalogLock": "example/woodland-library-v1",
  "extent": { "width": 32, "height": 24, "tileSize": 32 },
  "regions": [
    {
      "id": "forest",
      "priority": 10,
      "rect": { "x": 0, "y": 0, "width": 32, "height": 24 },
      "biome": "example/temperate-forest@1"
    },
    {
      "id": "grass-only-clearing",
      "priority": 20,
      "rect": { "x": 8, "y": 8, "width": 8, "height": 8 },
      "biome": "example/meadow@1",
      "restrictions": {
        "surfaceAssets": ["example/grass-1", "example/grass-2"],
        "decalAssets": [],
        "objectAssets": []
      }
    }
  ],
  "placements": [
    {
      "id": "landmark-oak",
      "component": "example/oak-tree-1",
      "cell": { "x": 4, "y": 4 },
      "required": true
    },
    {
      "id": "ranger-house",
      "prefab": "example/ranger-cottage@1",
      "cell": { "x": 20, "y": 12 },
      "rotation": 0,
      "required": true
    }
  ]
}
```

Rectangles use cell units and half-open bounds: `x <= cellX < x + width`, similarly for Y. Axes are +x right, +y down. Explicit pixel-space visual offsets belong to components/placements, not to a confused mix of region coordinate units.

The example requests one forest, a grass-only clearing, an exact landmark tree and a known cottage. It does **not** request 768 hand-selected tile values or an invented house. A future free-form house generator would first produce a validated prefab/scene under a separate contract.

## Biomes are reusable rules, not mixed bags of images

A biome definition should separate:

- **Terrain:** semantic grass/dirt/water identities and compatible terrain sets.
- **Surface variation:** weighted candidates compatible with the selected terrain and adjacency signature.
- **Decals:** flowers, leaves and small nonblocking decoration with density/spacing rules.
- **Objects:** trees, rocks and structures with footprints, clearance and explicit occupancy rules.

Do not put `grass_1`, `flower_1` and `tree_1` into one equal-purpose tile lottery. Their rendering and gameplay roles differ. Recolor variants, topology variants and biome probabilities are also different axes.

Biome and prefab definitions are versioned assets. Editing a shared biome must not retroactively rearrange installed worlds.

## Resolution and conflicts (requirements for a future compiler)

1. Validate format, bounds, IDs, weights, dependency locks and supported capabilities before expanding anything. No arbitrary filesystem paths, URLs or executable expressions.
2. Resolve region ownership with explicit priority, independent of JSON array order. Identical-priority overlapping writers to the same semantic channel are errors unless an explicit, supported composition rule exists.
3. Apply region restrictions as hard constraints. An explicit required tree inside the grass-only clearing is an error; `required` does not bypass an exclusion. Never silently delete a required landmark to make the result fit.
4. Resolve explicit placements/prefab reservations before random scatter. Prefabs define the footprint, visual passes, entrances, clearance and any terrain modifications; they do not infer those from opaque image bounds.
5. Scatter remaining optional objects deterministically into allowed, unreserved candidates. Maintain clearances and reject/diagnose unsatisfied requirements. Do not move an explicit house or tree to a convenient different location without an author-approved rule.
6. Resolve terrain adjacency after final terrain ownership/prefab terrain changes. Choose surface variants only among frames with the same compatible edge/corner signature.
7. Produce one canonical scene, validate navigation/entrances and asset coverage, then atomically store the compiled artifact and provenance. No partial scene publication.

Random choice must be deterministic across supported runtimes: a versioned integer hash/PRNG with test vectors, keyed by seed + scene ID + rule ID + stable cell/placement identity. Do not use `Math.random()`, wall-clock time, iteration order or one global advancing RNG stream. Pin candidate IDs/weights and compiler version. Local edits should not reroll unrelated cells merely because an earlier operation was inserted.

The algorithm/version and sorted inputs must be explicit before that compiler ships. This foundation does not choose or implement a speculative RNG API.

## Duplicate-safe does not mean one sprite per coordinate

| Situation | Policy |
|---|---|
| Same placement ID declared twice | Reject |
| One scene loaded/imported twice into the same owner | Idempotent install, not duplicate spawning |
| Semantic ground and its baked fallback both submitted for rendering | Reject/select one documented source before emission |
| Same logical layer/pass writes the same cell twice | Resolve conflict before canonicalization; one final value |
| Grass + flowers + tree + shadow at one coordinate | Valid distinct contributions when explicitly permitted |
| Canopy above a character standing near its trunk | Valid render overlap; trunk footprint governs collision |
| Two tree placements referencing one texture | Valid separate identities; share texture resources |
| Two identical-looking layers with distinct purposes | Never delete by pixel/hash equality alone |

Repeated rendering each frame is normal. The invariant prevents duplicate logical submissions and unnecessary recompilation, not drawing a still-visible tile in the next frame.

## Terrain matching compatibility

Current support is `fill` and the existing binary-per-terrain, layered `corner16` convention in `packages/frontend/engine/src/assets/autotile.ts`. Preserve its corner bit order and precedence semantics through adapters.

A future generalized terrain set may declare matching modes such as corners or corners-and-sides, with normalized neighbor labels and a validated signature-to-frame table. This must be a versioned capability, not an alias that silently falls back to `corner16`.

- Corner order and side order must be documented independently of source atlas layout.
- Multi-terrain junctions, borders, missing signatures and rotated/flipped variants require fixtures.
- Weighted visual variants share a matching signature; random variation cannot break seams.
- Unsupported/incomplete tables fail validation or use an explicitly declared tested fallback—never a random frame.
- Chunked generation needs deterministic neighbor halos; generating chunks in a different order cannot change a seam. Infinite/chunk-streamed generation is future work, not required by C-505.

## Persistence, regeneration and LLM tooling

Store accepted compiled scenes and their dependency locks. Preserve stable IDs for landmarks and generated placements. Save deltas for doors, loot and NPC state target those IDs, not array positions. Regeneration is an explicit authoring operation with a diff/migration plan; it is not a side effect of loading a save.

A future LLM tool should retrieve compatible biome/prefab candidates, produce the bounded plan, run deterministic validation and return structured diagnostics for repair. Keep the accepted output independent of the model/provider. Low-level frame coordinates and render depth should come from validated asset metadata, not model guesses.

## Promotion gate for the deferred compiler

Before implementing it, write a separate contract with: exact supported operators; rectangle/polygon and overlap semantics; deterministic test vectors; pinned candidate/asset rules; mandatory-versus-optional placement behavior; footprint/entrance validation; resource limits; regeneration identity policy; preview/game parity; offline persistence; and a real authoring-to-game acceptance journey. This document alone is not approval to implement that engine.
