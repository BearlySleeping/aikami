# Emberwatch map authoring — current pipeline and the 5.x authoring boundary

**Audit date:** 2026-09-21 · **Scope:** the five Emberwatch maps
(`village`, `inn`, `merchant_shop`, `old_road`, `ruined_shrine`) at pack
version 5.0.0.

This note maps every current source of truth before the authoring/studio
tooling was added. It is the reference for the locked-vs-polishable split and
for `docs/guides/emberwatch-authoring.md`.

## 1. What is authored, what is generated

| Layer | Path | Kind |
|---|---|---|
| Map geometry + objects | `scripts/src/lib/ops/emberwatch_map_village.ts`, `emberwatch_map_retained.ts` (inn + shop), `generate_emberwatch_maps_extra.ts` (old_road + ruined_shrine), helpers in `emberwatch_map_shared.ts` | **authored source** (TypeScript) |
| Runtime map emitter | `scripts/src/lib/ops/generate_emberwatch_maps.ts` | generator (writes Tiled JSON) |
| Generated runtime maps | `content/packs/emberwatch/maps/{village,inn,merchant_shop,old_road,ruined_shrine}.json` | **generated output** — committed, never hand-edited |
| GID ↔ frame ↔ terrain tables | `scripts/src/lib/ops/generate_emberwatch_tables.ts` (reads `manifest.json`) | derived |
| Terrain atlas | `scripts/src/lib/ops/generate_emberwatch_atlas.ts` → `static/game-data/sprites/tilesets/atlas.{webp,json}` | generated (gitignored) |
| Prop atlas | `scripts/src/lib/ops/generate_emberwatch_props_atlas.ts` ← `content/packs/emberwatch/props/*.png` → `static/game-data/sprites/tilesets/props*.{webp,json}` | generated (gitignored) |
| Prop definitions | `scripts/src/lib/ops/sync_emberwatch_props.ts` → `manifest.json#props` | **authored source** (TS table → manifest) |
| Terrain + tile definitions | `content/packs/emberwatch/manifest.json#terrains/#tiles` | authored |
| Seed / boot core | `generate_asset_seed.ts --write` → `static/game-data/asset_seed.json`; `offline_core.json` | generated / committed |
| Local rehearsal origin | `scripts/src/lib/ops/local_asset_origin.ts` + `emberwatch_candidate_plane.ts` | dev tool |

**The chain is one-directional:** authored TS/manifest → generator → committed
map JSON → atlas build output → runtime. Nothing downstream feeds back.

## 2. Where each gameplay concern lives

| Concern | Authoritative source |
|---|---|
| Map IDs | `manifest.json#maps`; builder `emit(...)` names |
| Transition IDs, targets, fallbacks | builder `transition(...)` calls (e.g. `emberwatch_map_village.ts`) |
| Spawn / arrival marker IDs | builder `spawn(...)` calls |
| NPC IDs | builder `npc(...)` calls |
| Prop IDs | builder `prop(...)` calls + `manifest.json#props` |
| Quest / evidence / story IDs | `manifest.json#quests/#evidence` + prop ids (`sella_receipt`, `tess_component`, `ward_socket`) |
| Terrain shape / paths | builder fill/scatter/override calls (`terrainOverrides`) |
| Collision | `MapData.collision` in builders **and** `manifest.tiles[].isWalkable` (both must agree per `emberwatch_content_audit.test.ts`) |
| Visual props | `manifest.json#props[].frame/renderSize/anchor/collision/shadow` |
| Atlas dependencies | `manifest.json#atlas/#propAtlases` |

## 3. Existing abstraction — reuse, do not replace

C-505 already ships a **canonical scene** (`aikami.scene`,
`packages/shared/schemas/src/lib/game/scene.ts`) and the engine scene module
(`packages/frontend/engine/src/assets/scene/`) as the runtime/normalized
interpretation. `docs/architecture/semantic_map_authoring.md` records the
maintainer decision: **foundation now, region/biome compiler later**, and
explicitly forbids accepting region/biome authoring documents until a separate
compiler contract exists.

Therefore this work **does not** introduce a second, competing map model and
**does not** build a region/biome compiler. The semantic authoring API is a
consolidation of the existing builder primitives (cell-coordinate helpers,
named placement functions) plus validation, identity locks and tooling around
the existing deterministic generator. The generated runtime format is
unchanged.

## 4. Locked vs polishable

Derived from save/quest/transition resolution and validated by
`emberwatch_locked_identity.ts`:

- **Locked:** map IDs, transition IDs + `targetMap` + `targetSpawnId`, spawn
  IDs, NPC IDs, prop IDs, evidence/story object IDs, quest IDs.
- **Polishable:** x/y placement, terrain shape, path geometry, prop visual
  frame, logical render size, anchor, shadow, decoration, tree density,
  building visual footprint, non-gameplay clutter, NPC position when it does
  not change story semantics.

The lock is a committed golden of the observed stable IDs
(`emberwatch_locked_ids.golden.json`). A regeneration that drops, renames or
retargets a locked ID fails the identity guard until a human updates the
golden deliberately.

## 5. Tooling added on top (this work)

- `emberwatch_authoring.ts` — semantic primitives for map + prop authoring.
- `emberwatch_map_validation.ts` — navigation/transition/asset validation.
- `emberwatch_locked_identity.ts` — stable-ID golden + diff.
- `emberwatch_visual_report.ts` — agent-readable per-prop/per-map report.
- `emberwatch_studio.ts` — one local command: validate → regenerate → check →
  serve → boot.
- `authoring_overlay.ts` (engine) — dev-only toggleable layers.
- `docs/guides/emberwatch-authoring.md`, `docs/plans/emberwatch_polish_brief.*`
  — the Astra handoff.
