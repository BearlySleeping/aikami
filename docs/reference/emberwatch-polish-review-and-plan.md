# Emberwatch 5.0 — visual coherence and UX recovery plan

Reviewed 23 September 2026. Repository baseline: `ee5478ceea7cba4078a3fba901872acb61a826bf` (`main`, including PR #385).

## Recommendation

Keep the existing engine, canonical scene model, map builders, asset provenance, local Studio and release pipeline. Change how visual quality is specified, produced and accepted. Prove a small production-rendered environment kit before expanding it across the five maps. Redesign the actual contents of the management screens and dialogue surface, rather than applying another theme to their existing layout.

The screenshots show a real coherence problem. Correct transparency and smaller render dimensions are necessary but insufficient: terrain, architecture, character sprites and props currently speak different visual languages. Houses and bridges also have construction problems that better image prompts alone cannot solve.

This is a read-only review and proposed design. No repository changes, issue creation, deployments or asset generation were performed. Source was retrieved at the pinned commit using GitHub. I reviewed the attached screenshots directly. I did not run the application, execute its test suites, inspect a live deployment's content hashes, or certify gameplay/performance. Historical test results below are reports from the cited PRs/contracts, not new test results. The screenshots' deployed revision is unknown; distinguish observed appearance from current-source findings.

## 1. Findings, ordered by impact

### 1.1 The project has an asset pipeline, but not a sufficiently enforced environment art system

**Observed:** the waystation combines detailed, smoothly shaded props; pixelated LPC characters; noisy square grass variants; a strongly repeated purple-grey floor; and flat brick boundary tiles. The props look like individual illustrations laid on top of a tile map.

**Confirmed in source:** `generate_emberwatch_atlas.ts` still procedurally paints the terrain, floor, wall, roof and bridge tiles. `sync_emberwatch_props.ts` explicitly mixes existing GPT-generated art with local sd.cpp/Anima frames. The asset brief uses `ward_large.png` as its common approved style reference. Its prose asks for “hand-painted pixel-friendly” objects while keeping LPC as the production animation source.

A tree is useful for palette and mood, but is insufficient as the sole reference for perspective, wall height, furniture proportions, orthogonal roof construction or pixel-cluster size. “Pixel-friendly” also leaves the executor free to accept a smooth illustration that merely survives shrinking.

**Recommendation:** adopt a crisp, restrained environment style calibrated to the actual LPC actors. Keep the actors as the fixed visual ruler for the first slice. Build a reference board from a complete approved in-engine scene plus category references: terrain, architecture, furniture and vegetation. Judge the combination at gameplay scale. Do not preserve an asset just because an earlier record says “accepted.” Preserve its provenance, then reevaluate suitability.

Sources: [terrain painter][atlas], [prop registry][props], [asset brief][brief].

### 1.2 Buildings are constructed as flat diagrams

**Confirmed:** `emberwatch_map_village.ts` uses `paintShell()` to put walls around a rectangular footprint and `paintInterior()` to fill its inside with `G.ROOF`. Both use ground tile placement. `building()` opens doors and landings but does not construct a raised facade, roof slope, eaves or a coherent architectural silhouette. The repository contains `inn.png` and `shop.png`, but these building calls do not use them, and the canonical prop registry inspected does not register those images as the village buildings.

This is a construction-model problem. A border of wall texture around roof texture cannot communicate a three-quarter building convincingly. The supplied screenshots do not show every village house, so this diagnosis rests on the user's report plus the current builder code.

**Recommendation:** add an authored building assembly within the existing authoring system. It should compose a foundation/ground contact, raised facade, roof/eaves, doorway, occupancy and occlusion. Preserve the existing transition IDs and explicitly align each doorway's visible threshold, trigger and arrival marker. Start with one south-facing building; test side/north doors as distinct orientations rather than rotating a south-facing picture.

Use a small modular kit for ordinary houses and a few bespoke landmark assemblies. Whole-building sprites are viable for landmarks if their anchors, door positions, occupancy and roof behavior are authored together. Do not scatter full-building illustrations over unchanged tile shells.

Source: [village builder][village].

### 1.3 The bridge artifact follows directly from the tile painter

**Confirmed:** `paintBridge()` paints water, a 16-pixel-wide band of planks and two rails inside each 32×32 tile. The village repeats that tile over three columns and two rows; the old road repeats it across four columns and three rows.

Repeating the tile along its width can extend one narrow bridge. Repeating it across its depth repeats water gaps and rails inside the crossing. This is consistent with the screenshot's parallel strips of decking separated by water. The village code even calls this a stone bridge while using the wooden bridge frame: intent and implementation have drifted.

**Recommendation:** represent a crossing as one authored structure. Separate opaque deck interior, end abutments, outer rails, support/contact shadow, water underneath, and traversal. Rails belong at the outside edges, not in every deck cell. Author orientation and span explicitly. Preserve normal water elsewhere and retain water's gameplay semantics; a traversable bridge overlays it through the existing movement representation.

Reuse the existing scene/layer model. If the current tile/prop representation cannot express the minimal bridge assembly, extend that boundary narrowly and prove runtime transport before migrating crossings.

Sources: [bridge painter][atlas], [village crossing][village], [old-road crossing][extra].

### 1.4 Ambient lighting is inconsistent in the inspected render path

**Confirmed code asymmetry:** `game_world.ts` writes the day/night or interior ambient colour into the tilemap's `uTint`. `composePropDisplay()` creates a Sprite with size and anchor but no corresponding ambient tint. The inspected frame renderer does not consume the environment ambient for those prop displays.

**Inference needing runtime verification:** this can intensify the pasted-on appearance at dawn/night: ground darkens while a standalone prop retains its source brightness. The screenshot shows 06:54 Dawn, so this is especially worth isolating before rejecting every source image. Actor lighting needs the same end-to-end audit; do not assume the layered LPC shader behaves identically to a prop Sprite.

**Recommendation:** one documented ambient policy for terrain, props, buildings and actors. Preserve explicit emissive exceptions for embers/windows. Do not tint the HUD. Do not double-apply ambient to terrain when introducing a shared policy. Add a small in-engine comparison with identical neutral colour patches represented as terrain and sprites, at noon, dawn, night and indoors. Include static enemies and late-loading textures. Confirm visual parity, then profile the actual chosen implementation.

Sources: [world renderer][world], [prop composition][presentation], [frame renderer][frame].

### 1.5 The previous size repair fixed a renderer defect, not the whole art problem

PR #378 correctly stopped texture preparation dimensions from becoming world dimensions. Keep that fix. However, preserving the aspect ratio of a wrong candidate does not make it the intended object.

Concrete example: the barrel job asks for an upright cask and has a 48×56 review target. The current presentation table renders `prop_barrel.png` at 48×35; the screenshot shows a horizontal cask. That mismatch needs a conscious art decision or candidate replacement, not further scaling. Similarly, the standing support is authored at 20×96: a tall post can be legitimate, but its disconnected placement and relationship to the ruined structure need composition review.

**Recommendation:** measure opaque subject bounds, not only PNG canvas size. Specify orientation, ground-contact point, expected top-plane depth, object category and relative scale to the actor. Validate that the candidate depicts the requested thing. Reject wrong geometry; do not stretch it into compliance. Runtime `renderSize` should express intentional world scale, not rescue arbitrary preparation output.

Sources: [PR #378](https://github.com/BearlySleeping/aikami/pull/378), [asset brief][brief], [prop registry][props].

### 1.6 Grass variation and flooring advertise the grid

**Confirmed:** `paintGrassDark()` uses a materially darker base than regular grass; builders scatter dark and flower variants by cell. Stone floor is a repeated 8×8 bevel pattern within every 32px tile. Roof and wall painters likewise encode surface textures without the larger architectural forms needed to interpret them.

**Observed:** isolated dark grass squares, regularly spaced bright flecks and a dominant embossed floor compete with characters and props. This is not simply a missing decorative border.

**Recommendation:** terrain variants should share similar edge values and restrained contrast. Use broad, spatially correlated patches and sparse decals for variation rather than independent dark cells. Establish bank, path and foundation transitions from a coherent material family. Distinguish walkable surfaces through structure and edge treatment; reserve the strongest value contrast for actors, doors, interactables and landmarks.

Keep deterministic placement and the corner16 mechanism where appropriate. Generated base textures can be useful, but trim sheets, transition masks and atlas layout should be assembled deterministically. Do not ask an image model to invent a correctly indexed tile sheet.

Sources: [atlas painter][atlas], [village builder][village], [road builder][extra].

### 1.7 Transparency preparation currently creates an art-direction tradeoff

PR #380 added `prop-luminance-alpha-ground` because the local engine produces RGB. The profile extracts alpha from near-black backgrounds and says objects must be bright enough to preserve dark pixels above its luminance floor.

This is not proof that every current asset has damaged alpha. It is a concrete risk: very dark legitimate features and very dark background pixels are not semantically distinguishable by luminance alone. Requiring brighter objects to survive extraction also pulls against the requested muted style. Deterministic processing does not make the mask correct.

**Recommendation:** prefer native alpha or a separately reviewed foreground mask. If luminance extraction is retained for particular assets, make it an explicitly reviewed exception with dark-feature and edge inspection. Review on light, dark and checkerboard backgrounds and in the scene. Keep raw source, mask, prepared sprite and final-size result. Mask generation can be assisted, but should not be assumed correct merely because it is automatic.

Sources: [PR #380](https://github.com/BearlySleeping/aikami/pull/380), [preparation profiles][profiles].

## 2. What the previous work accomplished—and where acceptance broke down

PR numbers and contract numbers are distinct: contract C-375 predates PR #375.

| Work | Useful outcome | Why it did not close this problem |
|---|---|---|
| C-375 / C-376 | Prop resolution, collision and depth architecture | A reliable rendering foundation does not itself provide coherent artwork or architectural composition. |
| C-506 | Lossless atlas evidence, depth tests and walkability diagnostics | Marked implemented, but its report leaves movement-boundary readability and overall presentation evidence pending. Contact shadows/wall faces remain visual work. |
| C-520 / C-523, PR #363 | Preparation and asset pilot/offline integration | PR #363 honestly reported uncertified visual results, including map-readability failures, and withheld release verification. Preserve that distinction. |
| PR #375 | V5 content, asset integrity and safer release lifecycle | Large improvement to what bytes are shipped and how they are promoted. Those proofs are orthogonal to whether the scene looks good. |
| PR #378 | World sizing, contact shadows, well/portrait source repair | Corrected genuine integration defects. It explicitly left the human visual gate open. |
| PR #379 | Semantic builder helpers, navigation validation, locked identities, local Studio | Valuable tools to retain. The resulting polish brief is mostly prose direction plus mechanical completion criteria. |
| PR #380 | Five-map edits and replacement of six legacy furniture frames | “No legacy frames” measures provenance/completeness, not visual compatibility. Bridge/building construction remained inadequate. |
| C-527–C-530 / PRs #353, #357, #361, #365 | Shell navigation, HUD preferences, theme runtime and publishing | Useful ownership and customization foundations; not proof that content layout, dialogue and settings form a polished experience. |
| C-543 / PR #367 | Production management host, game-scoped styles, theme integration | Improved wiring and readability. The current screens still inherit sparse feature layouts and competing surface colours; populated inventory/party visual cases were explicitly omitted. |
| PR #385 | Combat diagnostics, HUD editor and input/canvas fixes | Recent useful engineering work, but not an environment-art or whole-UX acceptance pass. |

The failure is not simply “the agent ignored the specification.” Some requirements were vague, some visual evidence remained pending, and some checks actively permit the result the user dislikes.

In `management_workspace.visual.ts`, the evaluator definition exempts a top-aligned form or list from excessive dead space. Its theme failure only triggers when all specified identity cues are absent. Its prompt also prescribes a high score for the intended pattern. These checks can verify intended branding and absence of extreme defects while accepting poor density, hierarchy and composition. There is no basis here to allege deliberate gaming; the observable problem is an overly permissive, implementation-shaped rubric.

The C-543 report also documents a legitimate evidence fix: screenshots had been distorted into square images, and preserving aspect ratio corrected that. Keep that fix. Do not equate all evaluator changes with weakening. Separate evidence correctness from art judgment.

Sources: [C-506][c506], [C-543][c543], [UI visual rubric][uirubric], [current polish brief][polish].

## 3. Recommended visual direction and alternatives

| Approach | Benefit | Cost/risk | Judgment |
|---|---|---|---|
| Cohesive environment kit calibrated to existing LPC actors | Preserves animation investment; addresses terrain, houses, bridges and props together | Requires selective rejection/reworking of accepted images and deliberate art review | Recommended |
| Convert the entire game to smooth illustrated art | Could suit some generated props | New character animation direction, terrain, combat and effects; much broader scope | Defer unless you want a new overall visual identity |
| Keep all current art and add scaling/shadows/postprocessing | Cheap incremental improvement | Cannot repair perspective, wrong silhouettes, flat houses or repeated bridge rails | Useful only for verified technical defects |

The recommended look is restrained woodland fantasy with crisp shapes, readable top planes and consistent cluster/detail scale. Avoid making “pixel art” an excuse for noisy one-pixel texture. UI typography can remain smooth and highly readable; it need not imitate the sprite raster. A different portrait rendering style can work when it is consistent across characters and deliberately framed as illustration.

Do not choose a fixed palette size or new generation model as the first decision. Lock a convincing scene and derive practical production rules from it. Use existing tooling until it demonstrably cannot meet those rules.

## 4. The first proof: one complete scene, not another asset batch

Build a review scene using the production renderer and real pack assets. Prefer an isolated review configuration of an existing map over introducing a separate runtime scene model. Include:

- One ordinary house with a visible facade, roof plane, eaves, door and short approach.
- A stream crossing with one continuous deck and readable banks/abutments.
- Grass, worn earth and a small stone/foundation surface with transitions.
- One tree, upright barrel and crate, plus the actual LPC player and one NPC.
- An interaction prompt and a short dialogue state.

The exact footprint should be selected to fit one normal gameplay viewport after confirming the real camera settings. A contact sheet and full-map overview are supplementary; neither substitutes for that viewport.

**Explicit pass conditions:**

1. The house is recognizable as a raised building before debug overlays are enabled. Its door looks usable and matches the trigger.
2. The bridge reads as one crossing, with no internal rail repetition, water gaps through its walkable deck, floating endpoints or invisible walkable water beside it.
3. Grass does not read as alternating dark squares, and flooring stays subordinate to actors.
4. Props share perspective, material/value range and detail density with the scene. Wrong-orientation candidates fail even if their file metrics pass.
5. Actor feet meet the floor; props have deliberate ground-contact origins. Walk around the tree and house, stop and reverse near depth boundaries, and cross the bridge edges.
6. Noon, dawn, night and interior transitions preserve lighting relationships. Emission is intentional and does not brighten an entire object accidentally.
7. Capture normal gameplay at 1280×720, 1920×1080 and the user's wide 2048×1152 case. Add a compact supported viewport and 200% UI text. Record world zoom separately from UI text scaling.
8. Present a short movement recording plus stills, with overlays both off and on. The human reviewer accepts the actual candidate; the implementation model records technical results and open visual questions.

No batch replacement or all-map rollout until this scene is accepted. If it fails, change the scene/kit and resubmit a concrete comparison. Do not compensate by adding more props.

## 5. Asset and map production changes

### Asset record: enough information to make a picture placeable

Extend the existing asset brief and prop definitions only where a field is missing; do not create a competing registry. Each visual should have its approved reference revision, category/orientation, final opaque-subject bounds, intended world size, ground origin, occupancy, interaction point, lighting/emissive policy, and render/occlusion role. Distinguish what already exists (`renderSize`, `anchor`, `collision`, `shadow`) from any new fields proposed.

Keep source and prepared hashes and exact candidate lineage. Add an evidence link to the scene where the asset was accepted. Technical preparation and visual acceptance are separate states. An altered sprite, mask, crop, presentation size or lighting treatment invalidates the corresponding visual evidence.

**Production loop:** approved scene/category references → a few candidates → reject wrong perspective/shape → mask and cleanup → deliberate final-resolution preparation → atlas → in-engine composition → human acceptance. An agent may recommend a candidate; it must not invent a human approval record.

Nearest-neighbor display is useful for crisp raster art, but shrinking a smooth illustration with nearest-neighbor alone is not a style conversion. Inspect and simplify the final raster; remove inconsistent subpixel detail and excessively soft edges. Do not stretch axes independently.

### Buildings

Create a minimal reusable kit: facade faces, foundation, door/window, roof planes, ridge/eave/corner pieces, and a small set of authored assemblies. Keep architectural ornament sparse. Use darker facade planes and a coherent roof silhouette to express depth; avoid outlining every ground tile.

Separate base occupancy from the roof's visual overhang. Existing base-Y sorting and overhead bands should be reused where they work. A doorway under an eave may need a separate foreground piece; a single enormous sprite is not automatically sufficient. Include door interaction while behind the eave and when a companion follows. Do not introduce dynamic interiors/roof fading unless the first proof demonstrates a need beyond the existing map-transition design.

### Bridges and shores

Author span, orientation, width and end cells in one helper that emits both visual layers and traversal facts. Deck interiors must tile without internal rails. Allow one wood bridge and one later stone variant; do not prematurely create a universal bridge generator.

Water continues around/under the crossing. Add bank transition, restrained shadow and short approach wear. Movement tests should include crossing, attempting to step off the side and moving along either bank. Companion-width checks supplement this, rather than defining visual quality.

### Map composition

Keep current map extents and stable story IDs initially. Tighten the playable composition within them rather than immediately shrinking maps and risking saved positions. Later geometric changes need an explicit policy for saves that resume inside new occupancy.

Use the ward tree as a visual destination; arrange arrival, approach and services so the player reads the village before wandering into empty space. Group dwellings into a few meaningful clusters. Use service-specific silhouettes, threshold materials and light, not a forest of labels.

For the old road, make the waystation ruin physically legible: surviving wall faces, collapsed masonry, connected structural remnants, clustered cart/debris and a clear conversation space. A free-standing 96px post should read as a remnant of something, not an unexplained obstacle. Validate the purported direct and woodland routes as actual distinct navigable routes, not just comments in the builder.

For the inn and shop, design from functional zones: arrival, circulation, seating/customer area, counter, storage/private space. Check the existing combat proof footprint against those zones. Furniture dimensions, spacing and collision must agree; repeating a standalone counter illustration is not automatically a seamless counter run.

For the shrine, use the approach, broken enclosure and ritual focus to guide the player. Keep the strongest landmark distinct from ordinary trees and props without increasing every object's brightness.

## 6. UI and UX: keep the shell; redesign the player tasks

The current shell's single focus boundary, section state retention, return behavior and theme roles are valuable. Replacing them would repeat solved work. The missing work is inside and across its production surfaces.

### Exploration HUD

Offer a carefully composed default with a compact player/vitals group, a quiet time indicator and one discoverable menu entry. Show interaction hints close enough to the action to be noticed without covering feet/targets. Keep the objective tracker contextual or user-pinned; group tutorial prompts with it rather than creating another detached floating panel.

Preserve customization, readable presets and temporary hiding. Define collision/priority rules for widgets and dialogue. Test the actual default first; configurability should not be required to make the game comfortable.

### Character

The screenshot and source expose an editable character sheet: tiny score steppers, saving-throw toggles labeled “Save,” class-first identity and a large empty lower region. “Save” is particularly ambiguous next to normal game-saving actions; here it means saving-throw proficiency.

Lead with character name/portrait, class/level, health and meaningful derived values. Use readable stat groups and ability descriptions. Make freeform editing an explicit mode for users who want it; normal character inspection should not resemble a database editor. Do not silently remove supported customization. If progression-controlled editing is desired, it is a separate domain decision. Replace the ambiguous label with “Saving throw proficiency” or an accessible compact equivalent.

### Inventory

Use the actual equipped character preview if its existing production-capable preview can be reused efficiently. Compose equipment alongside the bag and selected-item details, rather than a large centered cross of empty cards above an empty bag. At compact widths, stack these areas deliberately.

Keep equip/use/unequip obvious and keyboard accessible. Use the existing icon system or one consistent icon family rather than unrelated emoji. Empty states should fit the available content without dominating the screen. Crucially, review a populated inventory with long names, stack counts, unusable items and a selected item—not only the empty screen.

### Journal

Open on active quests when present. Show objectives and progress clearly; retain the distinction between authoritative quests, player notes and generated recaps. Notes should use a list/detail layout; open an editor when creating or editing a note. Do not permanently reserve a full-height blank editor beside an empty list. Provide concise next actions and meaningful empty states.

### Dialogue

The code still uses the older `base-*`/`primary` surface language, detached 112px portrait frames and a fixed 45vh chat panel. The screenshot shows one short line surrounded by a large empty conversation region, with controls competing at the bottom.

Use a compact bottom dialogue stage with the speaker portrait/name attached to the message area. Expand history only when requested or when needed; retain the existing full-view option. Preserve free text, choices, streaming, interruption/retry, TTS and combat/recruitment interactions. Keep the composer visible with long replies and small viewports. Use the same surface hierarchy as management and pause. Distinguish ending a conversation from destructive actions; it need not default to alarming red.

Portrait consistency matters separately: crop, head scale, lighting and frame treatment should be uniform across NPCs and player. Do not infer a stale fallback solely from the player's illustrated portrait; verify its asset identity before calling it a resolution bug.

### Pause and settings

Pause should prioritize Resume, saving feedback and settings. Move HUD controls into one coherent interface/customization destination while keeping quick hide reachable if useful. Clarify the different effects of “End Session” and “Quit to Main Menu”; preserve both only if their separate behavior is meaningful and explained.

The AI settings screenshot repeats “Not configured” and offers “Set Up” with little explanation. Replace the empty status screen with a capability-specific explanation, current availability, a clear setup action and what remains playable without it. Offer local/existing provider choices through the existing connection editor. Do not make cloud setup or sign-in a boot requirement, and do not imply unavailable AI behavior is enabled.

### Theme and layout discipline

Define coherent roles for canvas scrim, panel, raised panel, inset, selection, focus and destructive actions. The present mix of brown/brass workspace surfaces, near-black legacy cards and violet controls needs an intentional hierarchy. Retain theme customization, but test the default plus one non-default theme across dialogue, pause, inventory, journal and settings entry—not merely computed colour changes in one surface.

Favor existing semantic classes and components with real behavior/structure. Avoid both a new theme engine and a global stylesheet full of overrides compensating for unchanged layouts. Screen content should have a purposeful maximum width and responsive composition; making every section occupy nearly the whole viewport does not automatically improve it.

Sources: [management host][host], [character content][character], [inventory][inventory], [journal][journal], [dialogue][dialogue], [game styles][styles], [AI setup surface][settings].

## 7. Contract sequence for an implementation model

Use fresh contract IDs selected from the current repository; the labels below are proposed work packages, not allocated IDs. Do not combine them into one “polish everything” PR.

| Package | Scope | Required evidence and exit condition |
|---|---|---|
| P0 — Baseline and evidence integrity | Identify app commit, pack revision/hash, atlas/prop identities, camera, time, viewport and saved preferences. Fix evidence capture if needed. | Reproduce the reported screenshots from the correct candidate plane. Neutral, aspect-preserving captures; explicit unresolved deployment differences. |
| P1 — Rendering consistency | Diagnose/fix ambient parity; verify pixel sampling, subject scale and ground-origin handling in the real path. | Same scene at four lighting states; neutral colour probe; late-load/map-transition coverage; no HUD tint or terrain double tint. |
| P2 — Approved environment slice | One building, crossing, terrain family, actor and a few props; minimal building/bridge authoring helpers. | Human accepts the in-engine scene at normal scale and in motion. Correct visual boundaries and doorway/bridge traversal. |
| P3 — Five-map adoption | Apply the accepted kit, replace incompatible props, rebuild building/bridge assemblies and improve composition. | Five-map journey with locked identities, quest/evidence/encounter smoke, before/after camera pairs, save compatibility and no missing assets. |
| P4 — Production UI composition | Redesign actual dialogue/pause/character/inventory/journal contents and default HUD, preserving existing ownership. | Real production routes; populated/empty/loading/error states; keyboard/focus behavior; compact and 200% text; default and alternate theme. Split into smaller PRs by surface group if needed. |
| P5 — Candidate acceptance and release | Existing build/seal/promote flow with exact visual evidence bound to candidate. | Human accepts candidate; staging verification and then separately authorized production promotion; rollback identity retained. |

P4 can follow its own UI design review while P2/P3 proceed, but keep source ownership and approvals explicit. No speculative new editor, region/biome compiler, 3D renderer or animation pipeline belongs in these packages.

Each contract must include: exact baseline, observable problem, approved reference/evidence, runtime producer-to-consumer path, explicit non-goals, acceptance matrix, rollback/save implications, and a precise stop point. Replace adjectives like “polished,” “coherent” and “grounded” with demonstrated comparisons and named observable defects.

Keep existing guard and validation requirements. Do not lower a failing threshold, update a golden or change an evaluator prompt solely to get a pass. Legitimate test/evidence corrections require an explanation independent of the desired result.

## 8. Visual acceptance that will not repeat the same failure

Use three distinct decisions:

1. **Technical validity:** resolvable exact assets, correct alpha/atlas margins, supported frames/materials, stable IDs, sound navigation, correct input/focus behavior, no runtime errors.
2. **Visual regression:** deterministic scene states and camera positions compared with a human-approved baseline. Pixel differences flag review; they do not determine beauty. Include the loaded-content identity in evidence metadata.
3. **Art and usability acceptance:** side-by-side native-size captures plus motion judged against the approved scene and actual player tasks. Human decision required; an image evaluator supplies defect suggestions, not final approval.

Calibrate the revised rubric with the screenshots from this request as negative examples. It should identify the relevant defect in each: disconnected prop style, repeated bridge strips, flat architecture where shown in new baseline captures, tiny character controls, wasted inventory layout, permanent blank note editor and oversized short dialogue. Do not require every screen to fail every category, and do not force an arbitrary numerical score.

Use neutral questions: “Where does the deck stop?”, “Which doorway is usable?”, “Which two elements use incompatible rendering styles?”, “What action can the player take next?”, “Is space allocated according to the content?” Avoid telling the evaluator that the existing layout is correct. Keep before and after framing identical.

Release evidence must name app commit, content candidate/hash, asset origins, viewport, DPR, world zoom, UI text scale, theme, map position and game time. A green report from yesterday's assets is not evidence for today's candidate. Unknown information must remain unknown.

## 9. Additional cleanup and issues worth addressing

- **Contract status honesty:** reconcile C-506's implemented status with its explicitly pending visual evidence. Retain historical reports; add a current evidence/debt summary instead of deleting inconvenient failures.
- **Content identity diagnostics:** a development/review overlay should show the actually loaded pack/atlas revision. Investigate differences between deployed screenshots and current `main` before deciding a fix failed. Keep this out of normal player flow.
- **Material fallback:** builders already document fallback grass for missing terrain families. Reject unavailable required terrain/frame references during candidate validation; do not treat a plausible grass fallback as successful authored output.
- **Asset debt classification:** replace the single “legacy/nonlegacy” success notion with observed quality categories: placeholder, compatible, needs cleanup, incompatible, unresolved. A new generated PNG can still be incompatible.
- **Populated-state fixtures:** add deterministic state through real domain/storage seams for inventory, party, quests and long dialogue. Test-only storage setup is legitimate when it feeds the same production stores/components. Do not add fake URL flags that make the production view draw a different implementation.
- **Collision/visual footprint:** audit interactables, large furniture, support posts, gate/arch side supports and counter runs against authoritative navigation. A walkable arch opening does not imply its pillars should also be walkable. These are verification targets, not asserted new collision bugs from still images.
- **Save positions:** stable IDs alone do not protect a saved character coordinate from a newly moved wall. Specify a deterministic safe relocation policy or migration for affected saved positions before broad layout changes.
- **Developer affordances:** a small cog appears over some UI screenshots. Determine whether it is a development control or actual player UI before changing it. Production acceptance must prove unintended debug controls are absent in a production build; hiding them in a screenshot is insufficient proof.
- **Prompt contradictions:** the crate description requests an illegible stencil but also forbids lettering; the village bridge is called stone but painted wood. Resolve these contradictions before handing generation to a model.
- **World density:** improve route purpose and placement instead of adding content merely to fill empty map cells. Keep breathing room, but make it intentional and support the story journey.
- **Performance:** measure the final representative scene with shadows, roof layering and populated UI, using existing profiling lanes. Avoid promising budgets from unit tests or using FPS as a substitute for input/readability checks.
- **Scope discipline:** combat internals, provider optimization and unrelated backend rewrites are outside this audit. PR #385's combat diagnostics are useful for regression checks, but their presence is not evidence that combat as a whole is verified.

## 10. Copy-paste execution prompts

### Prompt A — begin with baseline and diagnosis

```text
Work in BearlySleeping/aikami. This task is the first bounded phase of the
Emberwatch visual recovery plan, not permission to implement the entire plan.

Read AGENTS.md, .context/CONTEXT.md, .context/index.md and relevant .pi skills.
Use the existing herdr/worktree workflow when available; preserve unrelated
local changes. Fetch current main and record the exact baseline SHA. Reconcile
differences from review baseline ee5478ceea7cba4078a3fba901872acb61a826bf.

Read the attached review and the current Emberwatch authoring, release, asset
brief and polish documents. Inspect PRs #375, #378, #379, #380, #385 and contracts
C-506/C-543. Historical green checks are not new visual acceptance.

Deliver P0 and the diagnosis for P1:
1. Use the existing emberwatch:studio/local candidate path and the production
   /game renderer. Record the actually loaded app/content/atlas identities,
   viewport, DPR, camera zoom, map/position, game hour and UI preferences.
2. Capture the waystation, bridge, village house, dialogue, character,
   populated/empty inventory and journal states. Preserve screenshot aspect
   ratio. Clearly distinguish unavailable states from passing states.
3. Trace ambient colour from environment UBO to terrain, standalone props,
   LPC actors and static enemies. Check noon/dawn/night/interior. Do not infer
   correctness from a comment. Show whether terrain and props receive the same
   factor, and identify a minimal correction if they do not.
4. Trace bridge tiles and building assembly. Demonstrate the repeated-rail /
   water-gap and flat-shell problems on the current build before proposing
   their replacement. Check whether any have already been fixed.
5. Compare current visual rubric behavior with the supplied negative examples.
   Report which rubric rules permit the defects. Do not change prompts just
   to improve a score.

Do not batch-generate artwork, redesign all maps, alter gameplay IDs, mark
human acceptance, deploy or publish. If assets, models or runtime prerequisites
are unavailable, name the exact blocked evidence and stop that portion; do not
substitute a mock scene and claim production verification.

Return a concise cause/evidence table, actual screenshots or recording, exact
reproduction commands, and a narrowly scoped P1 change proposal. Propose the
environment slice using concrete existing scenes/assets. Stop for review of
those artifacts before expanding scope.
```

### Prompt B — implement an approved rendering correction and environment slice

```text
Implement only the rendering correction and environment-slice design approved
in the preceding review. Restate the exact approved scope and baseline first.
Use existing canonical scenes, builders, prop definitions, corner16 support,
local Studio and candidate tooling. Do not introduce a second scene model.

For lighting, prove the defect and fix the production path without double
tinting terrain, tinting HUD, or breaking explicit emissive content. Verify
late texture loads and map transitions. Use focused behavioral tests through
repository Moon tasks and actual before/after captures.

For the slice, create one coherent building/door, one continuous bridge,
terrain transitions and a few compatible props beside an actual LPC actor.
Keep raw source/provenance. Retain renderSize/anchor/collision separation.
Reject wrong orientation/perspective instead of stretching or silently changing
the brief to fit a candidate. Preserve existing stable gameplay identities.

Bridge rails belong only on the crossing's outer edges; a multirow crossing
must not repeat water gaps between deck rows. Building facade/roof/threshold
must form a raised volume; do not wrap ground roof tiles in a flat wall ring.
Use the existing depth/overhead machinery and verify passage/occlusion in motion.

Render at real gameplay scale at 1280x720, 1920x1080 and 2048x1152, with noon,
dawn/night and interior coverage as relevant. Supply overlay-off images and a
walk-around recording plus overlay-on collision/anchor evidence. Record hashes.

Run applicable technical gates, but report technical pass and visual acceptance
separately. Do not certify your own work as human-approved. Do not migrate all
five maps, batch-generate further assets, deploy, change guard thresholds or
rewrite goldens to conceal failures. Stop with the reviewable slice.
```

### Prompt C — apply the accepted kit to the maps

```text
Apply only the exact environment kit and visual policy approved in the slice.
Use authored TS builders and sync_emberwatch_props.ts; regenerate downstream
maps/atlases/manifests through existing commands. Do not hand-edit generated
runtime files. Keep stable quest/evidence/NPC/transition/prop identities.

Work one map at a time: village, inn, shop, old road, shrine. For each, explain
the player route, focal point, usable doors and functional zones before editing.
Replace flat house shells and repeated-strip bridges with the approved
assemblies. Improve terrain continuity and prop clustering. Do not compensate
for poor composition with more clutter or stronger contrast.

For each map submit same-camera before/after images at gameplay scale, a short
traversal recording, navigation/identity validation, interaction/quest/evidence
checks and the applicable combat proof. Check saved positions against changed
occupancy. Use the existing accepted migration policy; if none covers a needed
change, surface the decision instead of silently stranding saves.

Stop each map's visual expansion when its required review is unresolved. Keep
technical failures and subjective visual questions separate. Do not publish
or overwrite a released candidate under the same asserted content identity.
```

### Prompt D — redesign one approved UI surface group

```text
Implement only the approved production UI surface group from P4. Preserve the
existing management session, overlay ownership, focus restoration, keyboard
input suppression, theme runtime and HUD preference service. First trace their
current consumers; do not build a parallel shell or theme system.

Change task flow and layout, not just colours. Use the approved references for
spacing, density and surface roles. Character inspection should not default to
tiny unrestricted editing controls; preserve editing behind an explicit mode
when supported. Inventory needs equipment/bag/item details and realistic data.
Journal notes should not reserve a full-height unused editor. Short dialogue
should fit a compact stage with an attached speaker identity and accessible
composer/history. Preserve supported conversation capabilities.

Create populated/empty/loading/error state coverage via existing domain or
storage seams feeding production components. Do not fake screenshots with
alternate query-driven UI. Verify default and one alternate theme, compact
viewport and 200% text, keyboard navigation, focus restore, held-key behavior,
long content, streaming/cancellation where applicable and Escape one scope at
a time. Confirm exact End Session/Quit behavior before relabeling or removing.

Supply actual /game captures and interaction evidence against the approved
reference. A VLM score alone is insufficient. Do not tell the evaluator that
the current layout is correct or exempt its known defect. Report observed
limitations honestly, then stop with a reviewable result.
```

The first useful implementation is P0/P1 followed by the small approved environment scene. Another all-in-one generation, map, UI and release prompt is likely to repeat the same failure pattern.

## Source index

All file links below are pinned to the reviewed commit. PR links describe their historical changes and reported checks.

[atlas]: https://github.com/BearlySleeping/aikami/blob/ee5478ceea7cba4078a3fba901872acb61a826bf/scripts/src/lib/ops/generate_emberwatch_atlas.ts
[props]: https://github.com/BearlySleeping/aikami/blob/ee5478ceea7cba4078a3fba901872acb61a826bf/scripts/src/lib/ops/sync_emberwatch_props.ts
[brief]: https://github.com/BearlySleeping/aikami/blob/ee5478ceea7cba4078a3fba901872acb61a826bf/docs/plans/emberwatch_asset_brief.json
[village]: https://github.com/BearlySleeping/aikami/blob/ee5478ceea7cba4078a3fba901872acb61a826bf/scripts/src/lib/ops/emberwatch_map_village.ts
[extra]: https://github.com/BearlySleeping/aikami/blob/ee5478ceea7cba4078a3fba901872acb61a826bf/scripts/src/lib/ops/generate_emberwatch_maps_extra.ts
[world]: https://github.com/BearlySleeping/aikami/blob/ee5478ceea7cba4078a3fba901872acb61a826bf/packages/frontend/engine/src/game_world.ts
[presentation]: https://github.com/BearlySleeping/aikami/blob/ee5478ceea7cba4078a3fba901872acb61a826bf/packages/frontend/engine/src/rendering/prop_presentation.ts
[frame]: https://github.com/BearlySleeping/aikami/blob/ee5478ceea7cba4078a3fba901872acb61a826bf/packages/frontend/engine/src/game_world/frame_renderer.ts
[profiles]: https://github.com/BearlySleeping/aikami/blob/ee5478ceea7cba4078a3fba901872acb61a826bf/packages/shared/local-ai/src/lib/preparation/preparation_profiles.json
[c506]: https://github.com/BearlySleeping/aikami/blob/ee5478ceea7cba4078a3fba901872acb61a826bf/docs/contracts/C-506-emberwatch-visual-readability.md
[c543]: https://github.com/BearlySleeping/aikami/blob/ee5478ceea7cba4078a3fba901872acb61a826bf/docs/contracts/C-543-production-management-workspace-and-hud-correction.md
[uirubric]: https://github.com/BearlySleeping/aikami/blob/ee5478ceea7cba4078a3fba901872acb61a826bf/apps/e2e/src/visual/suites/management_workspace.visual.ts
[polish]: https://github.com/BearlySleeping/aikami/blob/ee5478ceea7cba4078a3fba901872acb61a826bf/docs/plans/emberwatch_polish_brief.md
[host]: https://github.com/BearlySleeping/aikami/blob/ee5478ceea7cba4078a3fba901872acb61a826bf/apps/frontend/client/src/lib/views/game/ui/hud/management_host.svelte
[character]: https://github.com/BearlySleeping/aikami/blob/ee5478ceea7cba4078a3fba901872acb61a826bf/apps/frontend/client/src/lib/views/game/dashboard/character_sheet_content.svelte
[inventory]: https://github.com/BearlySleeping/aikami/blob/ee5478ceea7cba4078a3fba901872acb61a826bf/apps/frontend/client/src/lib/views/inventory/inventory_view.svelte
[journal]: https://github.com/BearlySleeping/aikami/blob/ee5478ceea7cba4078a3fba901872acb61a826bf/apps/frontend/client/src/lib/views/journal/journal_view.svelte
[dialogue]: https://github.com/BearlySleeping/aikami/blob/ee5478ceea7cba4078a3fba901872acb61a826bf/apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte
[styles]: https://github.com/BearlySleeping/aikami/blob/ee5478ceea7cba4078a3fba901872acb61a826bf/packages/frontend/theme/src/lib/aikami_game_ui.css
[settings]: https://github.com/BearlySleeping/aikami/blob/ee5478ceea7cba4078a3fba901872acb61a826bf/apps/frontend/client/src/lib/views/settings/ai/capability_detail_content.svelte
