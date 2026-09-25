# Emberwatch authoring guide

How to change the five Emberwatch maps (`village`, `inn`, `merchant_shop`,
`old_road`, `ruined_shrine`) **without** editing generated Tiled JSON, atlas
coordinates, catalog rows or R2 metadata by hand.

For the pipeline audit behind these rules, read
[`docs/architecture/emberwatch-map-authoring.md`](../architecture/emberwatch-map-authoring.md).

---

## 1. Authoritative files (edit these)

| What you are changing | Edit | Then run |
|---|---|---|
| Map geometry, terrain, paths, water, collision | `scripts/src/lib/ops/emberwatch_map_village.ts`, `emberwatch_map_retained.ts` (inn, shop), `generate_emberwatch_maps_extra.ts` (old_road, shrine) | `generate_emberwatch_maps.ts` |
| Semantic authoring primitives | `scripts/src/lib/ops/emberwatch_authoring.ts` | — |
| Prop world size, anchor, shadow, collision, frame binding | `scripts/src/lib/ops/sync_emberwatch_props.ts` (`PROP_PRESENTATION`, `EMBERWATCH_PROPS`) | `bun run emberwatch:props` |
| Terrain + tile definitions | `content/packs/emberwatch/manifest.json` (`terrains`, `tiles`) | regenerate atlas |
| Terrain atlas artwork | `scripts/src/lib/ops/generate_emberwatch_atlas.ts` | `generate_emberwatch_atlas.ts` |
| Standalone prop artwork | `content/packs/emberwatch/props/*.png` | `generate_emberwatch_props_atlas.ts` |
| Generation/acceptance inputs | `docs/plans/emberwatch_asset_brief.json`, `docs/plans/emberwatch_legacy_prop_replacements.json` | `bun run emberwatch:accept` |

## 2. Generated files — never hand-edit

| Generated output | Producer |
|---|---|
| `content/packs/emberwatch/maps/*.json` | `generate_emberwatch_maps.ts` |
| `manifest.json#props` | `sync_emberwatch_props.ts` |
| `apps/frontend/client/static/game-data/sprites/tilesets/atlas.*` | `generate_emberwatch_atlas.ts` |
| `apps/frontend/client/static/game-data/sprites/tilesets/props*.*` | `generate_emberwatch_props_atlas.ts` |
| `static/game-data/asset_seed.json` | `generate_asset_seed.ts --write` |
| `docs/reference/emberwatch-map-validation.json` | `emberwatch_map_validation.ts` |
| `docs/reference/emberwatch-visual-report.json` | `emberwatch_visual_report.ts` |

`content/packs/emberwatch/maps/*.json` **is** committed, but it is output: edit
the builder, regenerate, and commit the regenerated JSON.

## 3. The semantic authoring API

`emberwatch_authoring.ts` is the readable surface. Coordinates are **cells**
(32px), and the compiler is the existing deterministic emitter — no authoring
concept ever reaches the renderer.

```ts
import {
  cell, G, terrainRegion, waterRegion, collisionRegion, decor,
  path, placeProp, placeLandmark, placeNpc, placeSpawn, placeTransition,
} from './emberwatch_authoring.ts';

// A three-wide road from the south gate to the square.
path({ map, from: { c: 32, r: 0 }, to: { c: 32, r: 24 }, gid: G.PATH, width: 3 });

// A paved apron.
terrainRegion(map, { c0: 28, r0: 20, c1: 37, r1: 28 }, G.STONE_FLOOR);

// Water that blocks until you carve a crossing.
waterRegion(map, { c0: 20, r0: 1, c1: 23, r1: 34 });
collisionRegion(map, { c0: 20, r0: 17, c1: 23, r1: 19 }, false); // bridge

// Objects: ids are LOCKED — see §5.
placeLandmark(12, 'ward_tree_landmark', 'The Ward Tree', 'ward_large.png', 32, 23);
placeNpc(20, 'smith_orra', 'Orra the Smith', 'orra_greeting', 8, 29);
placeProp(26, 'yard_anvil', 'Smith Anvil', 'anvil.png', 5, 28);
placeTransition({
  id: 1007,
  targetMap: 'old_road',
  targetSpawnId: 'old_road_from_village',
  target: { x: cell(34), y: cell(33) },
  at: { c: 31, r: 0, width: 2, height: 1 },
});
```

### Move the inn two cells east

Edit the village building shell and its forecourt/road cells in
`emberwatch_map_village.ts`:

```ts
placeBuildings(m):  building(m, 49, 12, 9, 8, G.STONE_WALL, 'south'); // was 47
paintPads(m):       fillRect(m, 49, 20, 58, 22, G.STONE_FLOOR);       // was 47..56
```

The east-gate `transition` and the `from_inn` spawn keep their **ids**; only
their `x`/`y` move with the building.

### Widen the main path to three cells

```ts
// before: fillRect(m, 31, 1, 33, H - 2, G.PATH)  (already 3 wide)
path({ map, from: { c: 32, r: 1 }, to: { c: 32, r: 46 }, gid: G.PATH, width: 3 });
```

### Make the square less rectangular

Replace the square fill with an irregular region plus scatter:

```ts
terrainRegion(map, { c0: 28, r0: 20, c1: 37, r1: 28 }, G.STONE_FLOOR);
decor(map, 27, 22, G.STONE_FLOOR);
decor(map, 38, 26, G.STONE_FLOOR);
```

## 4. Props — resize, anchor, shadow, replace

All prop presentation lives in **one** table. Change it, run
`bun run emberwatch:props`, regenerate the props atlas:

```ts
// sync_emberwatch_props.ts
'prop_well.png': {
  renderSize: { width: 48, height: 72 },              // was 64×80
  shadow: { kind: 'ellipse', width: 34, height: 14, opacity: 0.2 },
},
```

- `renderSize` is the **logical world size**; it is never the texture size.
- `anchor` is the transform origin (`{ x: 0.5, y: 1 }` = bottom-centre).
- `shadow` is a separate contact footprint; the collision footprint is
  `EMBERWATCH_PROPS[id].collision` and is authored independently — never
  inferred from art.

To replace a legacy frame, update `EMBERWATCH_PROPS[id].frame` to the new
`prop_*.png`. Do not add more frames to `LEGACY_GRID_PROP_FRAMES`; see
`docs/plans/emberwatch_legacy_prop_replacements.json` for the six that remain.

## 5. Locked vs polishable

**Locked** (a polish edit must not change these; the identity guard fails if it
does): map ids, transition ids + `targetMap` + `targetSpawnId`, spawn ids, NPC
ids, prop ids, dialogue keys, quest ids, evidence ids, affordance ids.

**Polishable**: x/y, terrain shape, path geometry, prop frame, logical render
size, anchor, shadow, decoration, tree density, building visual footprint,
non-gameplay clutter, and NPC position that preserves story semantics.

```shell
bun run emberwatch:locked-ids          # fail if a locked id drifted
bun run emberwatch:locked-ids --update # deliberate gameplay change: re-seal
```

Moving an NPC or prop is polish — its **id** stays. If you need to change
gameplay data (a transition target, a quest id), that is an explicit design
change: run validation, read the report, then `--update` the golden.

## 6. Studio mode

```shell
bun run emberwatch:studio
```

Orchestrates the **same ordered build the release seal runs** (one shared list,
`emberwatch_build_steps.ts`): source tile-table validation → install portraits →
install audio → generate the terrain atlas → generate the prop-atlas pages →
regenerate the canonical maps → scan assets → `generate_asset_seed.ts --write`
→ re-validate → check the candidate plane → serve the local candidate origin →
launch the client → print URLs and toggles.

| Flag | Effect |
|---|---|
| `--watch` | rebuild on authored-source changes |
| `--no-client` / `--no-serve` | run checks only / don't launch one side |
| `--skip-build` | launch against the current artifacts |
| `--port <n>` | local origin port (default 8788) |

It never writes to the network and never runs model generation. Because the
studio runs the full build, a fresh worktree no longer needs a manual
portraits/audio/atlas step before its first run.

### Fresh-worktree sequence

```shell
# 0. Isolated worktree (any branch from origin/main).
git worktree add ~/.herdr/worktrees/aikami/<name> -b <branch> origin/main
bun run worktree:bootstrap -- --cwd ~/.herdr/worktrees/aikami/<name>
cd ~/.herdr/worktrees/aikami/<name>

# 1. Read-only production snapshot (needs scripts/.env.production; no writes).
bun run --cwd scripts catalog:workspace snapshot --mode production

# 2. Build + serve the local candidate plane (origin :8788, client :5173).
bun run emberwatch:studio
#    …or, when the generated artifacts are already current:
bun run emberwatch:studio --skip-build
```

The studio resolves the newest snapshot under
`.local/catalog/production/snapshots` for the terrain-atlas rule; a release
snapshot stores its seed content-addressed (`remote/seed/<hash>/asset_seed.json`),
which the origin reads directly. The client's `.env.emulator.local` already
points `PUBLIC_ASSETS_BASE_URL` at `http://localhost:8788`.

## 7. Validators

```shell
bun run emberwatch:validate        # navigation, transitions, props, identity
bun run emberwatch:audit           # coverage audit (blockers must be 0)
bun run emberwatch:visual-report   # agent-readable prop/map report
bun run emberwatch:visual-audit    # human contact sheet
bun run emberwatch:locked-ids      # stable-identity guard
bun run emberwatch:legacy-props    # legacy replacement manifest status
```

`emberwatch:validate` computes walkability from manifest tile solidity + the
collision layer + **solid prop origin cells** (the runtime's tile-granular
rule), then checks transition landings, bounce-back, overlapping triggers,
blocked doorways, NPC placement, evidence reachability, prop-blocked routes,
water partitions and route width. It never infers collision from PNG alpha.
Its report is `docs/reference/emberwatch-map-validation.json`.

## 8. Debug overlays (development only)

Set `?authoring=true` on the client URL. Toggle layers with
`?authoringLayers=`:

```
?authoring=true&authoringLayers=grid,walkable,connectivity,transitions,props,npcs,ids
```

Layers: `grid`, `walkable`, `connectivity`, `transitions`, `destinations`,
`propBounds`, `propCollision`, `propAnchor`, `shadowBounds`, `npcs`,
`landmarks`, `ids`. `?e2e=true` still enables the plain walkability grid. None
of this reaches the production HUD.

The walkability/collision grid draws **above** the terrain and prop bands but
below entities (C-548), so it is visible on the terrain maps — the earlier
`-2000` band sat under the opaque ground and could never be seen.

## 9. Regenerate + prove determinism

```shell
bun scripts/src/lib/ops/generate_emberwatch_maps.ts
bun scripts/src/lib/ops/generate_emberwatch_maps.ts   # twice
git diff --exit-code -- content/packs/emberwatch/maps # must be empty
```

Or let the studio do it. Tests: `bun moon run scripts:test` covers the
builders, the validator, the identity golden and the reports;
`bun moon run frontend-engine:test` covers the overlay geometry.
