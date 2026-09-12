# Emberwatch rebuild — art, maps, cast and quest

**Status: proposed content specification, not implemented or published.**
**Scope agreed on 2026-09-11:** build the safe local R2 workspace and write this redesign/prompt pack first. Actual pack replacement, new rendering/compiler capabilities, live release and remote deletion remain subsequent work.

References: [workspace guide](../guides/catalog_workspace.md), [C-505](../contracts/C-505-canonical-scene-data-and-authoring-boundary.md), [semantic authoring boundary](../architecture/semantic_map_authoring.md), [visual asset foundation](visual_asset_foundation.md).

## 1. What we are replacing

Verified baseline:

- `content/packs/index.json`: 2.1.0; Git Emberwatch manifest: 4.1.0; published manifest: 3.2.0. Reconcile these at release time, not by blindly downloading over Git.
- Three maps: `village`, `inn`, `merchant_shop`. Four NPC definitions in Git; only three in the published manifest. Main quest is mostly “speak to elder → enter inn → obtain wand → return.”
- Six placeholder passages remain in the Git manifest's alternate endings, reactions and accounts.
- Published atlas: 544×272, no alpha channel. Old furniture/props share that terrain atlas. There is not a separate R2 object for every barrel or well frame.
- The current source atlas generator already contains some transparency fixes, but those are not evidence that R2 was updated. Re-running the old generator is not the proposed art overhaul.
- Browse index coverage and boot seed coverage differ dramatically. Publication must preserve the full library, not replace it with only the newly edited pack.

**Design direction:** a inhabited woodland border village, warm lantern light against a cold, failing protective boundary. Distinct silhouettes, readable paths and overlapping tree/building volumes. No green rectangles under props; no furniture squeezed into ground tiles; no repeating decorative ground layer.

## 2. Scene/authoring architecture: what exists and what does not

### Use the implemented foundation

- One canonical interpretation: source → validated `aikami.scene` → compiled runtime data. No second preview-only grid or renderer-side biome interpreter.
- Outdoor surface: one semantic terrain channel. The existing autotiler generates the base fill and necessary transition passes.
- Indoor surface: one baked frame grid for wood/stone floors. Do not also submit a semantic outdoor ground channel. Doorways connect maps; indoor “void” is explicitly nonwalkable.
- Stable scene, layer, frame, prop and placement IDs; immutable image/definition hashes and installed pack lock.
- Explicit decorative and overhead contributions. Collision/navigation must not be inferred from alpha or a prop's image bounding box.
- Compile on import/edit, not every render tick or save load. Installed accepted scenes run offline.

### Important current limits

C-505 intentionally does **not** ship region expansion, biome scatter, procedural houses, a corners-and-sides solver, new elevation traversal, or a lighting engine. Native scene v1 placements currently expose component/frame, position/origin, flips, `solid` and a role from `ground|decor|overhead`; they are **not** a general rich prefab or NPC-behavior schema.

The contract report also records that legacy NPC/spawn/prop properties are preserved through the source object layers, while native fallback reconstruction is narrower. Therefore, **do not blindly convert all gameplay objects to native placements and assume named spawns, NPC IDs, pickups and transitions survive.** Prove the conversion using the real pack before adopting native source files. If an additive schema/adapter capability is needed, scope it explicitly first; do not smuggle unknown properties into a strict schema.

### Two implementation lanes

1. **Content rebuild using today's engine:** author the five scenes in Tiled or supported native form; import through C-505; use existing corner16 terrain resolution and explicit placements. An authoring sketch can use region rectangles as design notation, but the accepted runtime input remains a supported scene. Preserve legacy object metadata where required until native parity is demonstrated.
2. **Reusable biome/region compiler, separately approved:** versioned reusable terrain/decal/object rules; deterministic region ownership, exclusions, reserved entrances, density/spacing and seeded scatter; compile to the same canonical scene. No per-frame generation and no ad-hoc `Math.random()` forest. Follow the promotion gate in `semantic_map_authoring.md` before implementation.

The second lane is the long-term optimal authoring setup, not an already implemented feature of this workspace. Avoid building an Emberwatch-only procedural engine that must later be replaced.

## 3. Map plan

All extents below are proposed **cell** dimensions; one cell = 32 pixels. Coordinates are +x right, +y down. Use bounded, authored scenes, not an enormous mostly empty map.

```text
                          RUINED SHRINE
                         /             \
                 woodland trail    culvert approach
                         \             /
                             OLD ROAD
                                |
            [woodland]      north gate      [stream]
                 |              |                |
           shrine path — VILLAGE SQUARE — INN COURTYARD
                 |          |         |          |
           smith yard    ward tree   MARKET — MERCHANT SHOP
                 |              |                |
                 +-------- south gate -----------+
                           player arrival
```

| Scene ID | Extent | Layout / purpose |
|---|---:|---|
| `village` (retain) | 64×48 | Southern arrival teaches movement; open central square frames the failing ward tree; inn east, shop southeast, smith west; northern gate leads to old road. Stream and woodland create an irregular outline instead of a rectangular lawn. |
| `inn` (retain) | 28×20 | Entry vestibule; warm common room; Rollo's alcove; Sella's counter; clear rear aisle. Tables create believable space without trapping the player/companion. |
| `merchant_shop` (retain) | 24×18 | Customer aisle, lateral counter and rear storage. Ledger inspection is readable and reachable from the public side; doors are not hidden by the counter. |
| `old_road` (new) | 72×36 | Broken waystation, an abandoned cart and two routes: shorter exposed bridge and longer woodland trail. Meet Ada/Tess; discover how the ward conduits failed. Rejoin before shrine transition. |
| `ruined_shrine` (new) | 40×36 | Forecourt, collapsed cloister and focal ward socket. Nemi near a safe entrance. Multiple approaches, one legible ritual area; no unsupported multi-level cliff traversal. |

### Composition and navigation rules

- Main routes 3–4 cells clear; secondary paths at least 2 where companions follow. Test the actual actor footprint, not just a painted path's width.
- Door interaction/arrival zones have explicit clear space. Transition destinations and names are reciprocal; no NPC can occupy the landing cell.
- Place landmark shapes first: ward tree, inn facade, gate, bridge, shrine. Scatter decoration only after entrances, navigation and encounter space are reserved.
- Trees cluster along boundaries with irregular breaks and visible trunks; don't evenly space a tree every few cells. Repeated art is fine; repeated placement IDs are not.
- Water remains semantically blocking; bridge/ford walkability is explicit. Do not solve movement by painting a bridge sprite over blocking water alone.
- Stone steps are visual height cues on a flat navigation plane until actual elevation traversal is supported. Elevation values alone do not create traversable stairs.
- Shadows and flowers are nonblocking ground/decor contributions. A canopy may cover the player; the trunk/base governs footprint. Do not mark the entire canopy rectangle solid.
- Retain existing named spawn/prop/NPC keys (`village_gate`, `inn_entrance`, `shop_entrance`, `village_well`, `shop_counter_l`, etc.) using an explicit source-identity mapping. Inspect Tiled object IDs too: matching a display name is not sufficient proof of save compatibility.

## 4. Terrain and biome art organization

### Terrain is not a bag of props

Use separate semantic layers and asset families:

| Family | Purpose | Initial representation |
|---|---|---|
| Meadow floor | Grass base with quiet variation | One `fill` base, three compatible visual variants |
| Packed earth | Roads and worn entrances | `corner16` overlay; complete 16-mask set |
| Gravel | Square/waystation paving | `corner16` overlay; complete 16-mask set |
| Ash/scarred earth | Shrine corruption scars | `corner16` overlay; complete 16-mask set |
| Water | Stream/pool | `corner16` overlay; complete 16-mask set; not walkable |
| Indoor floor | Planks, flagstone | Baked ground grid; matching fill variants, no outdoor underlay |
| Decals | Leaves, flowers, pebbles, cracks, small weeds | Transparent nonblocking frames |
| Objects | Trees, boulders, furniture, structures | Independent prop images/frames plus footprints/origins |

Suggested outdoor precedence: grass 0, dirt 10, gravel 20, ash 30, water 40. This is a proposed art setup using the existing layered solver, not a new universal terrain taxonomy. Test all adjacent families; change art/precedence rather than silently adding a second solver.

### Corner16 contract

The existing bit order is **NW=1, NE=2, SE=4, SW=8**. Mask 0 has no occupied corners; mask 15 is fully inside that terrain. Each corner is resolved from the surrounding semantic cells using precedence. Out-of-map treatment must remain the existing base-terrain convention.

- Author all 16 topological variants; the compiler may omit a visually empty contribution.
- Variants for a given mask must share the same boundary signature. Random texture variation cannot change a seam.
- Include straight edges, concave/convex corners, isolated islands, thin paths, diagonal contacts, map borders and three-material junctions in the test fixture.
- Do **not** ask ChatGPT to invent a production-ready 4×4 numbered Wang sheet. Generate approved material art and a consistent transition style; build/mask the 16 variants deterministically in authoring tooling, then visually correct and validate them.
- Mask generation/edge validation is **not implemented by `optimize`**. A PNG passing alpha validation does not prove it is a valid terrain set.

### Proposed reusable biomes (design labels, not executable JSON)

| Biome label | Ground | Decals | Objects / exclusions |
|---|---|---|---|
| Ember meadow | grass/dirt | sparse flowers, leaves | occasional oak/birch; no random blocking objects on routes |
| Village common | grass/gravel/dirt | weeds near boundaries | authored benches, crates, lamps; reserve plaza and doors |
| Old woodland | grass/dirt | leaf litter, mushrooms | clustered trees/rocks; reserve both travel routes |
| Stream bank | grass/dirt/water | reeds, wet stones | bank vegetation outside bridge approach/landing |
| Shrine scar | gravel/ash | cracks, moss | authored ruins and ward structures; ritual area stays clear |

If/when the compiler is built, each biome separately controls terrain, decals and objects with pinned candidate IDs/weights. Objects never compete with grass in the same weighted tile lottery.

## 5. Props, depth and shadows

**Keep the 32-pixel movement grid; stop forcing every visible object into 32×32.** Proposed native art sizes:

| Asset family | Approximate target canvas | Gameplay footprint |
|---|---:|---|
| Small barrel/crate | 32×48 or 48×48 | One authored base cell or smaller rectangle |
| Well / notice board | 64×80 / 64×64 | Explicit base rectangle; not full image |
| Oak / birch | 128×160 / 96×160 | Trunk/base approximately one cell; tune per art |
| Ward tree | 192×224 | Authored roots/base + separate interaction approach |
| Cottage / inn facade | 192×192 / 256×224 | Wall/footprint polygon or supported rectangles, door clearance |
| Shrine arch | 160×160 | Side pillars block; central passage stays open |
| Table / counter | 96×64 / modular 32×64 segments | Base footprint; continuous interaction aisle |

These are acceptance targets, not a request to stretch every generated image to those bounds. Final sizes depend on approved silhouettes at actual game zoom.

For each accepted prop record:

- Logical ID and stable frame names, including body/canopy/shadow passes where supported.
- Original art provenance; image/definition hashes; frame rectangle and intended native size.
- Visual ground-contact origin, separate from texture top-left and trim offsets.
- Movement footprint, sight-blocking policy and interaction reach.
- Actual supported render role/depth behavior. Prove that a character walking behind/in front of a tree/building changes occlusion correctly; don't invent a `depth` property the renderer ignores.
- Shadow presentation: neutral, semi-transparent contact/cast shape; consistent upper-left light, shadow down-right. No colored ground baked underneath.

Prefer a separately authored shadow contribution where the existing component/prop pipeline supports it, so moving art does not double-darken the ground. If that path is not proven, use a single controlled transparent sprite for the first art slice and explicitly verify depth limitations before expanding the library. No promise of dynamic light/shadow simulation in this rebuild.

For atlas packing: separate opaque terrain from transparent props/decor when the supported visual resolver allows it; otherwise preserve the same semantic separation in the compatible atlas. Use real packed frame rectangles, padding and edge extrusion. Never infer a tile by atlas row count or persist global GIDs as frame identity. Budget atlas dimensions (target ≤2048 per page), decoded memory and visible quads; do not combine the whole catalog into one texture.

## 6. Cast: ten useful NPCs, not decorative dialogue dispensers

Preserve the four existing NPC IDs. New NPC appearances use stable named LPC/component references, never mutable numeric catalog positions. Keep existing LPC animation assets for the first rebuild rather than asking an image model to generate hundreds of inconsistent animation frames. Generate portraits separately if wanted.

| ID / name | Location | Role and playable connection |
|---|---|---|
| `village_elder` / Thalia | Ward tree | Quest giver. Concealed years of deferred conduit maintenance to avoid panic; saving lives matters more than protecting her reputation. |
| `rollo_grasper` / Rollo | Inn alcove | Holds the Ward Wand after recovering it from a dead guardian. Opportunistic, but also the only person who tried to warn the village. Bargain, expose, persuade or fight. |
| `merchant` / Mara | Shop | Vendor and source of the repair ledger. Her profit motive conflicts with keeping the trade road open. |
| `village_guard` / Bram | South/north gate | Existing companion. Explains safe routes and reacts to the player's treatment of civilians; does not block quest completion if unrecruited. |
| `innkeeper_sella` / Sella | Inn counter | Saw who brought the wand in. Her custody receipt provides a noncombat conversation advantage. |
| `smith_orra` / Orra | Smith yard | Understands physical ward conduits. Optional supply task provides a repair kit and makes a peaceful outcome easier, not mandatory. |
| `cartographer_ivo` / Ivo | Market stall | Marks both shrine approaches. Turns “find the shrine” into a choice of routes, not a minimap scavenger hunt. |
| `shrine_keeper_nemi` / Nemi | Shrine forecourt | Knows the renewal rite and the cost of simply repeating it. Offers the alternative shared-ward solution after evidence is recovered. |
| `apprentice_tess` / Tess | Old-road waystation | Stranded with a damaged ward component. Help her reach safety/secure the component through a supported interaction—not a speculative escort AI. |
| `woodcutter_ada` / Ada | Woodland trail | Describes unusual roots and the culvert path. Points to a recoverable clue; gives woodland a human purpose. |

Schedules, escort pathfinding, voice acting and autonomous village simulation are out of this first content pass. Static authored placements with purposeful interactions are better than untested “living world” behavior.

## 7. Better main quest: The Fading Ward

### Central truth

The wand is necessary, but it is not the whole solution. The ward is failing because its physical conduits and the village's duty of upkeep were neglected. Rollo has exploited the crisis; Thalia has hidden its cause. Neither a single fight nor choosing the “right” NPC solves everything.

For the first rebuilt revision use one coherent authored truth. Existing randomized truth variants must either be fully authored and integration-tested against both evidence routes, or remain in the old pack revision. Do not ship placeholder accounts or let an LLM improvise which world facts are true.

### Main beats

1. **See the failure, meet Thalia.** Arrival frames the cracked ward tree. Thalia asks for the wand, points directly to Rollo, and offers the quest. Bram/Ivo establish the road and shrine, so the larger space has a purpose immediately.
2. **Investigate or confront.** Sella's receipt and Mara's ledger show that Rollo recovered the wand while maintenance funds were diverted. The player can take evidence to Rollo, bargain, attempt existing social checks, or trigger the existing combat resolution. Failure opens another route rather than creating an unfinishable quest.
3. **Walk the old road.** Ada identifies the longer safe trail; Tess and the damaged waystation demonstrate the actual conduit problem. Orra's optional repair kit helps. Both routes rejoin at the shrine; neither permanently locks out evidence.
4. **Understand the choice.** Nemi explains: restore the old centralized ward quickly, or use the evidence and intact component to bind a distributed ward shared by the village. The player must see the costs before committing. A third, explicit choice dismantles the unstable relic to protect people from its backlash at the cost of losing the magical perimeter.
5. **Return to a changed village.** Thalia, Rollo and Bram react to the chosen outcome. Reward once; persist the ending/world state; no repeatable wand farming. New art states make the resolution visible without requiring dynamic lighting.

### Three authored outcomes

- **`ward_renewed` — The Ward Renewed.** “Thalia seats the wand in the old stone cradle. Amber light climbs the ward tree, limb by limb, and rolls across the rooftops. The wall will hold. Beside her, Orra lays the broken conduit on the council table: this time, the work of keeping it alive will not stay hidden.” Retain `emberwatch.ending.renewed` where compatibility permits. Outcome restores the old structure but publicly acknowledges the maintenance debt.
- **`ward_reconciled` — The Shared Watch.** “Nemi breaks the circle of the old rite and invites the villagers inside it. Bram takes the first watch; Mara opens the repair ledger; even Rollo places a hand against the roots. The ward returns as a hundred smaller lights, moving from doorway to doorway. No keeper will carry it alone again.” Requires the actual evidence/component route, not a randomly guessed dialogue keyword. Retain the existing reconciled ending ID/flag if supported by the migration plan.
- **`ward_darkened` — A Watch Without Magic.** “The wand falls quiet in its stone cradle. Beyond the gate the night is only night again—dangerous, and no longer held at bay by a promise. Lanterns appear along the wall. Bram lifts the bar, looks back at the people gathering behind him, and says, ‘Then we keep watch ourselves.’” An informed choice with an explicit confirmation; never an accidental result of presenting the elder's seal. Retain the darkened ID/flag only with correct new gating.

These are proposed final narration texts, not proof that all branching mechanics already exist.

### Side quests

- **Orra: Tools for Tomorrow.** Retrieve intact couplings from the waystation; choose gold or a repair kit. Gives the old road a concrete purpose and supports, but does not gate, the main quest.
- **Sella: A Room Kept Warm.** Deliver supplies to Tess's waystation cache. Reveals the custody receipt and a sympathetic view of Rollo without declaring him innocent.
- **Ada: Mark the Safe Trail.** Visit two authored landmarks and report to Ivo. Reward exploration and unlock route information; no new random-marker generator required.

### Gameplay integration gate

Use existing quest/map-entry/item-pickup/NPC-interaction hooks and authoritative world-state checks wherever supported. Before authoring final JSON, prove support for multi-ending conditions, evidence presentation, one-time rewards, interaction-driven art states and the repair-kit choice. A “repair anchor” interaction, multi-condition objective or choice widget must not be written as an invented schema field. If unsupported, implement a scoped tested capability or simplify the content deliberately.

Test all acquisition paths, refusal/reacceptance, failed skill checks, companion absence, looting before accepting, evidence presented out of order, revisiting completed scenes, save/reload between every beat, and offline completion. No network response or image generation may be a quest progression dependency.

## 8. Image-generation handoff

Use ChatGPT image generation for original **source art**, not scene arrays, collision masks or a final atlas. The first artwork batch has now been supplied. Multi-subject templates were ambiguous when pasted as-is; **use the new [single-asset prompts](emberwatch_next_asset_prompts.md)** for the next batch. Each fenced block is complete and requests one concrete subject. Copy one block per request, not an entire document.

### Approved art-slice decisions

- **Lanczos3** is the approved downsampling kernel for all further candidates.
- **Alpha normalization approved and applied:** `normalize_alpha.mjs` transforms the lanczos3 candidates (alpha ≥ 200 → 255) into `approved/props/emberwatch/*.png` plus lossless WebP in a scratch workspace. All bodies are now fully opaque (bodySemi = 0); low-alpha edge contours and residue are preserved. `props_approved_lanczos3_2x.png` is the contact sheet. Originals and pre-normalization candidates are untouched; nothing is in the main upload working tree or R2.
- **Ward-tree treatment — decided (batch 2):**
  - **`ward_large` is the canonical landmark ward tree** for the village. It is the single authoritative ward-tree silhouette; nothing else substitutes for it in the village.
  - **`ward_small_a`, `ward_small_b` and `ward_small_c` are separate smaller grove/secondary trees.** They are explicitly **not** state-swap frames for the large landmark and must never be cross-faded or substituted into its slot. `a` is unlit; `b` and `c` carry the amber rune glow.
  - **`oak` and `birch` are approved** as the general woodland tree family.
  - Superseded: batch 1's `ward_a`/`ward_b`/`ward_c` state-variant idea and `ward_broad`. They stay available as normalized candidates but are not part of the approved set.
  - This decision is a **direction approval, not a runtime lock**: the tree setup is locked for wider use only after the in-game occlusion/collision test below passes.

### Corner16 terrain — first validated set (earth over grass)

`corner16_earth.mjs` generates a deterministic 16-frame earth corner16 set with no AI involvement:

- Contract-accurate: bit0=NW, bit1=NE, bit2=SE, bit3=SW; `earth_0.png`…`earth_15.png` in mask order per the engine's `cornerFrameName` derivation. Frames live in `corner16/earth/`.
- Geometry: per-pixel quadrant ownership of the nearest tile corner; isolated set corners render as quarter-discs (radius 16, centered on the tile corner); adjacent set corners join with straight dithered boundaries through the tile midpoints. 1px Bayer-dithered edges. Unset regions are alpha 0 so the base fill shows through. All boundaries pass through tile edge midpoints, so adjacent tiles join exactly.
- Validation 1 (engine): the real `autotileLayers` from `packages/frontend/engine/src/assets/autotile.ts` resolves an authored 28×18 test grid (blob, rectangle with hole, 1-wide strip, block) and the emitted frames are composited — `corner16_earth_testmap_2x.png` passed visual QA at 95/100: continuous transitions, no gaps, no seams, uniform texture.
- Validation 2 (deterministic): per-quadrant earth coverage asserted against expected mask geometry for all 16 frames — all masks OK (isolated quarter-discs ~73–84%, full quadrants ≥97%, unset ≤5.9% dither bleed).
- The mask sheet `corner16_earth_masks_4x.png` is intentionally seamless (no gridlines) — mask correctness is proven by the deterministic coverage check, not visual grid inspection.
- Still preview-only: not packaged, not in the pack terrain list, not uploaded. Integration into the Emberwatch pack (terrain entries + atlas) waits for the playable-village step.

### Received batch and local review

Eleven PNGs are in `.local/catalog/production/imports/`: four opaque outdoor material textures and seven transparent prop/sheet images. The inn, oak and well are separate images; `ew_b02.png` contains both a shop and shrine arch; the ward-tree files contain multiple subjects/variants. These can be extracted without requesting all the artwork again.

Review artifacts are under `.local/catalog/production/previews/art_pass_01/`:

- `props_nearest_1x.png` and `props_lanczos3_1x.png`: explicit crops at proposed game scale. Matching `2x` previews are nearest-upscaled for edge inspection.
- Grid order: oak / inn / well; shop / shrine arch / ward A; ward B / ward C / broad ward alternative.
- `terrain_repeat_comparison.png`: grass / earth / gravel / water; top row nearest, bottom row Lanczos3, each candidate repeated 8×8. These are uniform-material experiments, **not finished corner16 sets**.
- `report.json`: source hashes, exact crop recipes, candidate sizes, resampling methods and verified lossless-encoding results. `prepare.mjs` reproduces the local experiment.
- `composite_check.mjs` + `composite_report.json`: every candidate composited over grass, earth, dark and light backgrounds at 1× (`composite_ground_check_*.png`), a 1× village mock (`village_mock_lanczos3.png` + 2× zoom), and quantified alpha buckets. Results: bodies are 35–58% semi-opaque (alpha 200–254, mostly 251–253) but visually indistinguishable from opaque over real terrain; residue (alpha<32) is 2–5% with no visible halo in composites. Visual QA found no washed-out props, no halos and no repeat seams.
- `ward_align.mjs`: binarized-mask alignment between ward candidates at native size. ward_a↔ward_b 99.31% agreement at zero shift; ward_a/b↔ward_c 99.3% at dx=+3 (C is the same tree shifted 3px by its crop offset); ward_broad vs all ~76% — a genuinely different tree. A/B/C can serve as bright/subdued/unlit state variants once C's 3px shift is corrected in its crop recipe; alignment must be re-verified after any recrop.
- `ward_silhouette_comparison.png`: the four ward candidates side by side over grass.
- `workspace/working/game-data/`: candidate WebPs in an isolated scratch workspace. They are **not** in the main upload working tree, installed in the game or published to R2.

All original PNGs remain untouched. Source artwork has genuine zero-alpha background, but body opacity is commonly 251–253 rather than 255, with some low-alpha edge residue. No blanket alpha thresholding or background removal has been applied. Review over light/dark/material backgrounds before final acceptance.

Native-size downsampling and cropping are deliberate art transformations; lossless WebP then preserves the transformed PNG's visible pixels/alpha. It does not mean the resized result is identical to the high-resolution original. The ward A/B/C silhouettes are candidates, not proven aligned animation/state frames.

Generate only barrel, crate and notice board next using the new prompt document. Keep NPC portrait batches and additional environment variants on hold until the first in-game art slice is approved. *(Superseded: batch 2 delivered barrel, crate, notice board, table, chair, counter and bed, plus the wood-floor material. See “Second batch — prepared, awaiting approval”.)*

### In-game prop verification (ward tree)

`ward_large` is installed as a real pack prop and placed in the village at `(336, 288)` (cell `10,9`), alongside `woodland_oak` at `(208, 288)` and `ward_grove_b` at `(464, 288)`. The runtime test passed:

| Check | Result |
|---|---|
| Prop spawns from the authored map | ✅ entities 6/7/8 at exactly `(336,288)`, `(208,288)`, `(464,288)` |
| Ground-contact origin | ✅ the roots meet the ground at the authored `y = 288` (row 8/9 boundary) with the manifest anchor `(0.5, 1.0)`; no float, no sink |
| Trunk/base collision | ✅ the player is hard-blocked from entering the trunk cell from above — 13 key presses and multiple click-to-move targets produced **zero** downward movement at `y ≈ 287.2` |
| Renders **behind** the canopy | ✅ with the player above the base (`y = 279`) the trunk and standing stone draw over the character |
| Renders **in front** of the trunk | ✅ with the player below the base (`y = 304`) the character draws over the tree's roots |

**Tree setup is now locked for wider use.** The collision is the actor's two-row box (`feetY − 32 .. feetY`) against the prop's cell, so a prop blocks the cell it stands on plus anything the actor's box overlaps when standing adjacent — which is why approach from directly above is refused and approach from below succeeds.

### Prop-atlas layer (oversized props)

The grid atlas is a fixed 16×8 grid of 32×32 cells with per-cell edge extrusion, and every approved prop is larger than 32×32 (inn 256×224, ward tree 192×152, table 96×42). Oversized props therefore ship as one or more irregularly-packed pages:

- `content/packs/emberwatch/props/*.png` is the standalone authoring source of truth.
- `scripts/src/lib/ops/prop_atlas_packer.ts` packs them (deterministic shelf packing, 1px extruded borders, content-sized pages, automatic spill to `props-2.*` when a page hits the budget).
- `scripts/src/lib/ops/generate_emberwatch_props_atlas.ts` emits `props.webp` / `props.json` and **fails the build** on duplicate frame names across the grid atlas and every page.
- The manifest declares an extensible `propAtlases[]` (never a singular `propsAtlas`). Prop definitions reference stable frame names only — never a page index or coordinates.
- `createPropFrameResolver` preloads the grid atlas plus every page and resolves by name. `PropTextureResolver(frame) => resolution | null` is unchanged externally. A name declared by two sources is **dropped from the index** rather than resolved by precedence, and the client logs an explicit error.

### Issues found while verifying — all fixed

Four defects surfaced by putting real art through the real pipeline. All are
fixed, each with regression coverage:

- **The worker never booted.** `WorkerSession` posted `INITIALIZE_ENGINE` with the buffers only in the transfer list, never in the message. A transferable that is not reachable from the message is detached but never delivered, so the worker destructured `buffers` as `undefined`, threw on `buffers.length`, never created a world, and every `LOAD_MAP` failed with “world not initialized” behind a 15 s timeout.
- **A correlated `ENGINE_ERROR` was ignored for a pending request.** `request({ expect: 'MAP_LOADED' })` waited out its full timeout instead of rejecting with the worker's error — which is what turned a one-line error into a 15 s mystery. A correlated `ENGINE_ERROR` is now always terminal for its request.
- **A republish served the previous revision.** The registry's seeding gate keyed on the seed's `generatedAt`, so a republish that kept the timestamp was treated as “already seeded”: the registry kept the old hash, `reconcile()` found nothing stale, and the previous revision kept being served by tag even though the new bytes had downloaded. The fingerprint is now content-derived (generation + derivation revision + a digest over every persisted row field).
- **The Tiled adapter discarded the prop frame name.** `tilemapToScene` set `frame: type`, so a canonical placement lost `ward_large.png` and the round-trip wrote `frame: 'prop'` back out. The frame now comes from the object's `frame` property.
- **Raw Tiled JSON skipped normalization.** It was cast straight to `TilemapData`, bypassing the `objectgroup` split and flip-bit masking, so any map with spawn/transition objects was rejected with `layer "spawns" has no band…`. `normalizeTilemap()` is now shared by every path.
- **Hub views used unregistered classes.** After the daisyUI removal, 13 views still used `border-border`, `bg-card`, `text-foreground`, `text-muted-foreground`, `bg-muted`, `bg-accent`, `shadow-elevated` and friends — Tailwind generates nothing for an unregistered colour, so cards rendered with no surface and muted text at full contrast, silently. All ~160 occurrences now use the tokens `aikami_theme.css` registers.

### Provenance gap — fixed

- **The pack manifest validates cleanly.** All 64 `asset.missing-provenance` errors (across the atlas, 48 tiles and 15 props) are resolved. The policy: `source` is always required; `license` and `author` are required for licensed/third-party assets but optional for generated work (`source: "generated:<provider>"`, e.g. `"generated:gpt"`). Generated art has no licence to declare and no human author to credit, and the rebuild rules forbid inventing either, so the strict original requirement would have forced a false claim. Every Emberwatch asset now records `source: "generated:gpt"`; the validator only demands `license`/`author` for non-generated sources and still rejects any licence value that is present but not a known SPDX identifier. `[emberwatch] validatePack passes` is green.

### Dev note — the client loads assets from the published CDN

The client is fully de-bundled: it resolves every asset through `PUBLIC_ASSETS_BASE_URL`, `static/game-data/maps` and `static/game-data/contentPacks` are empty, and `AssetStore._originUrl` returns null without an origin. A local art/map/manifest change is therefore invisible in-game until it is published. `scripts/src/lib/ops/local_asset_origin.ts` serves a local origin that overrides the changed artifacts and proxies the rest read-only to the CDN, so the in-game test above ran with **zero remote writes**.

### Second batch — art direction approved

Nine new PNGs arrived in `.local/catalog/production/imports/` (the other ten are byte-identical to batch 1). Artifacts are under `.local/catalog/production/previews/art_pass_02/`; `prepare.mjs` and `corner16.mjs` reproduce everything.

**Pipeline change — subject extraction.** A plain bounding-box crop drags in neighbours: `ward_small_b`'s box included a sliver of the large ward tree's roots, and several crops carried 1px residue specks. `prepare.mjs` now labels 8-connected components at alpha ≥ 32, keeps the dominant one plus any part ≥ 2% of it, zeroes the rest and re-trims. That is a real despeckle, not a crop. Dropped: birch 6 components/532px, ward_small_c 2/307, ward_small_a 2/188, ward_small_b 2/48, oak 3/29.

**Furniture** (7 new, all real alpha, all alpha-normalized):

| ID | Canvas | Source aspect → canvas | Body semi-opaque → after |
|---|---:|---|---|
| `barrel` | 34×48 | 0.716 → 0.708 | 74.3% → 0% |
| `crate` | 44×48 | 0.905 → 0.917 | 72.1% → 0% |
| `notice_board` | 64×58 | 1.111 → 1.103 | 59.8% → 0% |
| `table` | 96×42 | 2.324 → 2.286 | 60.4% → 0% |
| `chair` | 26×48 | 0.537 → 0.542 | 54.3% → 0% |
| `counter` | 96×40 | 2.473 → 2.400 | 79.0% → 0% |
| `bed` | 58×96 | 0.601 → 0.604 | 79.8% → 0% |

Sizes preserve each subject's aspect ratio with the spec's target as the long edge — the spec explicitly forbids stretching art to fit those bounds, so `table` is 96×42 rather than 96×64.

**Trees — the reference sheet was a sheet, not an asset.** `ew_p02_ward_tree_with_refrence.png` is a reference sheet: 7 material swatches plus 5 separate trees. Component segmentation (`.local/.../segment_ref.mjs`) found them; the middle small tree is *touching* the large ward tree, so it cannot be separated by components — a row-occupancy profile over x=1030..1267 has its minimum at y=744 (n=39), which is the cut between the large tree's roots and that tree's canopy.

| ID | Canvas | Note |
|---|---:|---|
| `oak` | 126×160 | deciduous, full canopy |
| `birch` | 70×160 | slender pale trunk |
| `ward_large` | 192×152 | the landmark: gnarled trunk, amber rune crack, standing stones, spreading roots |
| `ward_small_a` | 96×96 | stones, **unlit** |
| `ward_small_b` | 96×96 | stones, **lit** |
| `ward_small_c` | 96×96 | stones, **lit** |

The ward variants share geometry because they are the same drawing at different scales/lit states — unlike batch 1's `ward_a/b/c`, which needed a 3px crop correction to align. This supersedes the open A/B/C-vs-`ward_broad` question: the sheet supplies one large landmark plus three small grove variants.

**Materials** (32×32, fully opaque): `wood_floor` (from `ew_t05_wood_floor.png`) and `cobblestone` (from a swatch on the reference sheet — a material that existed nowhere else).

Terrain opacity is now enforced explicitly. Ground is opaque by definition, but a material cropped from an AI sheet keeps the sheet's soft edges (source swatch alpha 0..253); Lanczos3 turns that into a ring of semi-transparent pixels, which tiled is a see-through floor. Cobblestone needed 939 of 1024 pixels forced to 255.

**Corner16 sets — four, all engine-validated.** `corner16.mjs` generalizes pass 1's single-purpose generator to any (base, overlay) pair. Each set: 16 frames, composited through the real `autotileLayers`, with a coverage assertion (every emitted frame name matches `^<overlay>_(\d|1[0-5])\.png$`, no mask renders empty, mask 0 is fully transparent).

| Set | Base ← overlay | Biome |
|---|---|---|
| `gravel_over_grass` | grass ← gravel | Village common |
| `earth_over_gravel` | gravel ← earth | Village common |
| `water_over_grass` | grass ← water | Stream bank |
| `cobblestone_over_wood_floor` | wood_floor ← cobblestone | Indoor hearth/apron |

Each emits 96 overlay cells on the 28×18 test grid. Test maps: `corner16_<set>_testmap_2x.png`.

**Integrated into the pack (procedural material painters).** `water_over_grass` was already the committed `water` terrain. The remaining three sets now have manifest terrain entries and deterministic in-repo painters, so the committed atlas generator produces them without the preview-only AI sheet pipeline:

| Terrain id | Precedence | Set | Base ← overlay (in generator) |
|---|---:|---|---|
| `gravel` | 3 | `gravel_over_grass` | grass ← gravel |
| `earth` | 4 | `earth_over_gravel` | gravel ← earth |
| `cobblestone` | 5 | `cobblestone_over_wood_floor` | wood_floor ← cobblestone |

`generate_emberwatch_atlas.ts` now dispatches corner frames through a `CORNER_TERRAIN_PAINTERS` map (base + overlay painters per terrain id) instead of the hardcoded `dirt|water` regex. The village map's `aikami.terrain` channel uses them: a gravel plaza (rows 5–7, cols 2–6) with an embedded earth patch (rows 6–7, cols 3–4), so both the over-grass and over-gravel layering paths are exercised. `autotileLayers` resolves all six layers with zero frames missing from the regenerated atlas. `cobblestone_over_wood_floor` is declared for indoor hearth/aprons but has no map placement yet (the inn/shop use the baked indoor grid, which has no terrain channel).

🔴 **Atlas headroom is now zero.** The 48 baked tiles plus five corner16 terrains × 16 masks fill all 128 cells (16×8) exactly. A sixth corner16 terrain requires growing `ATLAS_ROWS` (maps' tileset blocks and `tilecount` must follow) before it can be added.

**Remote state unchanged.** No upload or deletion has occurred; the committed manifest is the source of truth and the atlas is a gitignored build artifact regenerated at release.

### Reference art direction — not a multi-asset generation request

> Create production source artwork for Emberwatch, a top-down 2D fantasy JRPG. Use a consistent three-quarter overhead view like a classic orthogonal RPG, not isometric diamonds, not a side view, and not a perspective camera with a horizon. The world uses a 32-pixel ground grid and humanoid characters approximately 48–64 pixels tall at final game scale. Use deliberate pixel-art clusters, crisp readable silhouettes, restrained texture detail, muted moss greens, warm old timber, cool slate stone and small amber accents. Light comes from upper left. Avoid glossy plastic, photographic textures, blurred edges, cinematic depth of field, heavy black outlines and text. Match the attached approved reference image exactly in palette, viewpoint and detail density when one is provided. Output the image itself, not a mockup, screenshot, annotated sheet or framed presentation.

### EW-T01 — grass material

> Generate one seamless square grass-ground texture: low, worn meadow grass in muted olive and moss green, subtle small color clusters, no tall blades projecting above the ground, no flowers, no stones, no paths, no objects, no directional cast shadows. The texture must be quiet enough behind characters. Make opposite edges match for seamless horizontal and vertical repetition. Full opaque coverage is intentional for this ground material. Aim for a pattern that remains readable when prepared as a 32×32 game tile. No border, bevel, labels or grid. This is a material source tile, not an illustrated field or landscape.

### Received outdoor materials

Grass, packed earth, gravel and water have been supplied. Do not regenerate them yet. Native-scale repeat/edge validation comes next; water animation is not a prerequisite. The next prompt document has a standalone wooden-floor request, with no alternative-subject placeholders.

### EW-P01 — oak tree

> One mature woodland oak tree, isolated and centered. Three-quarter top-down JRPG view. A broad irregular canopy with three readable leafy masses, a visible trunk at the lower center, a few roots meeting the ground, and an asymmetric silhouette. Muted moss-green foliage with warm highlights at upper left and cooler undersides. Preserve enough trunk visibility to understand where a character can walk behind it. Leave generous empty margins; do not crop leaves or roots. **Real transparent alpha background**, including all negative spaces. No grass tile, ground mound, scenery, shadow plane, colored background, checkerboard pattern or text. Do not bake a large cast shadow into this body sprite; subtle shading inside the tree itself is welcome. Intended final canvas about 128×160 pixels, with a narrow trunk footprint rather than a solid rectangular canopy footprint.

### Received birch and ward-tree sheets

The supplied sheets already include birch and ward-tree artwork. Three ward candidates have been extracted from `ew_p02_ward_tree_with_refrence_2.png`, with a broad alternative from `ew_p02_ward_tree.png`. Approve one base silhouette first. Before treating amber/dormant variants as state swaps, align their ground contact and geometry; similar-looking generated trees are not automatically interchangeable frames. *(Superseded by batch 2: `ew_p02_ward_tree_with_refrence.png` is a reference sheet that yields one large landmark ward tree plus three small lit/unlit grove variants — see “Second batch — prepared, awaiting approval”.)*

### EW-B01 — inn exterior

> One standalone medieval woodland inn exterior in three-quarter overhead orthogonal JRPG view, front entrance facing the bottom of the image. Broad warm timber-and-plaster body, a weathered dark slate roof, stone chimney, an amber window beside the door, and a blank hanging sign with a candle-shaped emblem but no lettering. Charming and practical, not a castle. The entrance must be obvious and centered enough to place a walkable approach. Show the roof and front facade consistently with the approved tree viewpoint. Real transparent alpha around the complete building; leave empty margins and do not crop roof or chimney. No ground tile, grass rectangle, surrounding village, characters or large cast shadow. Preserve separate readable roof/body shapes for later authored occlusion. Intended final art approximately 256×224 pixels. Output one building, not a sheet or scene.

### Received shop and shrine arch

Both are present in `ew_b02.png` and have been cropped into separate native-size candidates. No new generation request is needed. The arch's open center remains transparent; its walk-through collision geometry must still be authored explicitly.

### Next furniture batch

The well has been supplied. [Batch 2](emberwatch_next_asset_prompts.md) has separate ready-to-paste requests for barrel, crate, notice board, table, chair, counter and bed. Each specifies one subject and includes the style/alpha rules. Start with the first three; do not submit a list of alternative furniture names. *(Batch 2 is delivered and prepared — see “Second batch — prepared, awaiting approval”.)*

### EW-D01 — decals

> Generate exactly one small cluster of fallen ochre leaves for a top-down JRPG ground decal. Use the approved Emberwatch terrain only as a muted-color reference, with crisp pixel-art-inspired detail and upper-left light. Real alpha background; no square patch of soil or grass, frame, grid, large shadow or text. Sparse irregular silhouette, low contrast, readable at roughly 16–32 game pixels. Output only this one cluster with margin, not alternatives or a collection.

### EW-S01 — optional separate shadow source

> Using the attached approved object without changing its canvas size or ground contact, create a separate shadow-only image on real transparent alpha. Soft-edged but pixel-art-compatible neutral cool-gray contact/cast shadow projected down-right by the upper-left light. Keep opacity restrained; no solid black patch, no object body, no ground color, no checkerboard. Preserve alignment with the reference canvas. If the cast shadow needs more room, do not crop it; report that alignment needs a larger shared canvas rather than independently moving the shadow.

A generated shadow is still source art. Align it explicitly with the body and test compositing; do not trust the model to preserve exact pixel coordinates. A deterministic hand-authored shadow may be better for small props.

### Deferred portrait reference descriptions

These are character-design notes, **not a prompt to paste as a group**. Portraits will get one named-subject request each after the environment style is approved. No NPC animation sheets are needed in this art batch.

Descriptions: Thalia, an elderly woman with silver braided hair and a weathered green shawl; Rollo, a wiry tired traveler with a repaired leather coat and wary half-smile; Mara, a confident middle-aged trader in a mustard waistcoat; Bram, a sturdy guard in worn mail with an amber cloth knot; Sella, a broad-shouldered innkeeper in rolled sleeves; Orra, a soot-marked smith with a practical apron; Ivo, a bespectacled mapmaker with ink-stained cuffs; Nemi, a patient shrine keeper with a slate-blue hood; Tess, a young adult apprentice carrying a cracked copper instrument; Ada, a weathered woodcutter with a red scarf.

### Generated-image acceptance checklist

- PNG contains actual alpha where required. Fully transparent pixels and negative spaces exist; the preview's checkerboard is not baked into the art.
- Viewpoint/palette/native scale match the first approved batch. Check at 1× game zoom, not only the source's large display size.
- No clipped canopy, roof, feet, object legs or shadow; sufficient transparent margins.
- No opaque green/white halo after compositing over grass, dirt, stone and a dark test background. Partial-alpha contours and shadows remain neutral.
- No random text, fake atlas coordinates or unintended extra objects.
- Terrain repeat seams and all transition masks are verified separately.
- Original retained under `imports/`; deliberate native-size/cropped source retained alongside it. The optimizer does not perform that art direction work.
- Lossless WebP compared by decoded pixels/alpha; smaller size is measured, not assumed. Generated pixel art is not automatically “optimized” just because the extension changed.
- Provenance records tool/model, date, prompt ID and source image hash; no invented human artist attribution or automatic CC0 declaration for generated work. Existing LPC credits remain verbatim and travel with the release.

## 9. Execution and publication gates

1. **Foundation — done this pass:** safe local snapshot/download/diff/staging-upload tooling, image alpha inspection/optimization, this specification. Nine baseline files downloaded; no remote writes/deletions.
2. **Art slice — done, verified in-game.** grass + oak + inn approved at native zoom (lanczos3, alpha-normalized). A deterministic earth corner16 set plus four batch-2 sets (`gravel_over_grass`, `earth_over_gravel`, `water_over_grass`, `cobblestone_over_wood_floor`) are generated and engine-validated. Batch 2 adds seven furniture props, six trees and two materials. `ward_large` is installed as a pack prop and placed in the village, and the in-game occlusion/collision test **passed** — see “In-game prop verification” below. The three new corner16 sets are integrated into the pack terrain list with deterministic atlas painters and placed in the village map as a gravel plaza with an embedded earth patch; the runtime autotiler resolves all six layers with no missing atlas frames. (Gate-2 remainder from the previous pass — the sets were preview-only — is now closed for the outdoor sets; `cobblestone` is declared but awaits an indoor map placement.)
3. **Playable village — in progress (staged).** The full ten-NPC cast is authored with stable C-504 `appearance` IDs (no numeric catalog positions) and placed: Thalia/Bram/Orra/Ivo in the village, Rollo/Sella in the inn, Mara in the shop, Ada/Tess on the old road, Nemi in the shrine. **Scene resize done this pass:** the retained scenes now meet the proposed extents — `village` 64×48, `inn` 28×20, `merchant_shop` 24×18 (the two expansion maps already matched). The builders were split into `emberwatch_map_shared.ts` / `emberwatch_map_retained.ts` within the source-size budget; every spawn/npc/prop id and transition target is preserved, positions were re-authored, and all transition trigger rects are non-degenerate. Reciprocal targets were updated (village north gate ↔ `old_road`, village west/east gates ↔ shop/inn) and the manifest default spawn coordinates follow. `generate_emberwatch_maps.test.ts` locks the extents and object identities, and the engine audit now covers all five maps. Remaining: the full art-directed layout pass (landmark composition, stream/woodland outline) beyond the structural rebuild.
4. **Quest extension — in progress (staged).** `old_road` (72×36) and `ruined_shrine` (40×36) are authored and wired to the village north gate with reciprocal transitions. The Fading Ward quest now has eight objectives covering the inn evidence (Sella's receipt), Mara's ledger, the old road and the shrine, plus the three authored ending narrations (Renewed / Shared Watch / A Watch Without Magic) gated by `evidence.presented.*` flags. Three side quests are authored (`tools_for_tomorrow`, `a_room_kept_warm`, `mark_the_safe_trail`) using only supported trigger hooks. Evidence is four entries with stable ids. All content validates against `ContentPackManifestSchema` and `validatePack`.
5. **Compatibility/QA — in progress (staged), materially advanced.** A v4 save round-trips `packVersion` + `worldSeed` through checksum validation. The manifest onboarding steps migrated from the legacy bare-string `action` to the discriminated `{ kind: 'input', actionId }` shape. **This pass wired and tested the previously-unwired paths:** the boot version-mismatch branch is extracted into `pack_version_compat.ts#planPackVersionHydration` (unit-tested for compatible/mismatch/map-missing/fallback cases); the unused `InstalledPackLock` path now backs old-revision resolution (`resolveSaveRevision` + `installedPackRevisionStore`, with hash verification); and golden compatibility tests lock quest objective indices/prerequisites, inventory keys and scene/map identity (`emberwatch_content_stability.test.ts`), plus resized-scene bounds, transition reciprocity and spawn-walkability (`emberwatch_content_audit.test.ts`). The revision store is process-local pending a persistent Turso/OPFS backend.
6. **Candidate release — partially done (staged).** `content/packs/index.json` is reconciled to the manifest (4.2.0, matching name/version/updatedAt) with a reconciliation guard test. Manifest `version`/`updatedAt` bumped for the new content. The map/manifest entries in `asset_hashes.json` were refreshed for the resized scenes; full `asset_credits.json` regeneration and a staging publication rehearsal remain staged for the release pass; nothing has been uploaded to production.
7. **Retirement — not executed (by design).** The pack references the new atlas/props; no old R2 bytes have been deleted. There is still no reference/retention-audit tool (a known gap) — deletion stays blocked until one exists and is reviewed.


### Required evidence before calling the pack rebuilt

- Actual shared-preview and `/game` captures of all five maps using locked new artwork, not rectangles or mock assets.
- Alpha/edge/corner/junction test sheet; checkerboard prop previews; no duplicate ground source.
- Walk behind/in front of trees, under archway, across bridge; collision/sight agree with supported semantics. No inaccessible NPCs, door arrivals or quest props.
- All main quest resolution paths and side quests exercised, including failures and out-of-order discovery; no placeholder narration.
- Save/reload across map transitions, looted containers, evidence, companion state, quest completion and endings; old saves still resolve old revisions.
- Offline install/play/save/reload with all required art available and no generator/network boot dependency.
- Measured texture/decode budgets, load-time compilation and frame behavior; no repeated per-frame compilation or accidental new atlas fetches.
- Affected-project lint/typecheck/tests, complete candidate release validation, remote upload receipts and rollback reference.

Until that evidence exists, this document remains the rebuild specification—not an execution report claiming the pack has been replaced.
