---
id: C-400
title: "Unify LPC Appearance Resolution — no silent slot drops"
source: "docs/strategy/mvp-assessment-2026-08-16.md §6.2 (MVP playthrough)"
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/151"
  pr_number: 151
created_at: "2026-08-16"
---

# Contract C-400: Unify LPC Appearance Resolution — No Silent Slot Drops

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/strategy/mvp-assessment-2026-08-16.md` §6.2 — live MVP playthrough 2026-08-16 |
| **Target** | `packages/frontend/engine/` (worker + spawner) and `apps/frontend/client/src/lib/services/game/` — one appearance resolution path |
| **Priority** | P0 — the most damaging visual defect in the shipped build; every NPC renders as a disembodied head |
| **Dependencies** | — (C-403 depends on this) |
| **Status** | implemented |
| **Promotion** | `—` |
| **Docs Impact** | internal — no user-facing docs page. `docs/architecture/limitations.md` "Observed MVP Defects" row is removed on completion. |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: NPCs in the Emberwatch content pack render as a
  disembodied floating head — no body, torso, legs, or feet. Every NPC head is
  the *same* bald pale male head regardless of the appearance declared for that
  NPC. Some entities render as "invalid NPC".

- **Reproduction**:
  1. `bun run dev`, start a campaign, load the Emberwatch `village` map.
  2. Observe two floating heads flanking the player spawn.
  3. Transition to `inn` — three floating heads.
  4. Transition to `merchant_shop` — one floating head.
  5. All heads are visually identical despite `village_elder`,
     `rollo_grasper`, and `merchant` declaring different `appearanceLayers`.

- **Root causes** (all four confirmed by inspection):

  **RC-1 — Three divergent recipe resolvers for the same data.**
  `packages/frontend/engine/src/worker/ecs_worker.ts:628` (`workerRecipeResolver`)
  emits the raw numeric index stringified:

  ```ts
  recipes.push({
    slot: WORKER_SLOT_NAMES[i] ?? `layer_${i}`,
    assetId: String(effectiveId),        // ← "23", not an asset id
    hexPalette: new Uint8Array(1024),
  });
  ```

  `apps/frontend/client/src/lib/services/game/game_engine_service.svelte.ts:921`
  and a near-identical copy in
  `apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts:1202`
  resolve the same index against `generatedLpcSlots` into a real asset id
  (e.g. `torso/clothes/chainmail_male`). Three code paths, same input,
  different output. Nothing asserts they agree. **The `game_boot_service` copy
  is the one the production `/game` route actually uses** —
  `game_canvas_view_model.svelte.ts` calls `gameBootService.boot()`, which
  builds `GameWorld` with its own `_buildLpcPipeline` (line 855). Replacing the
  worker and `game_engine_service` copies alone leaves the production path
  running the old resolver.

  **RC-2 — Silent slot drops.** In the main-thread resolver, when
  `slotDef?.variants[effectiveIdx]` is `undefined` the loop `continue`s with no
  log and no fallback. This applies to `hair`, `torso`, `legs`, and `feet`.
  Only `body` (via `LPC_DEFAULT_BODY_ASSET_ID`) and `head` have guaranteed
  fallbacks. **A head plus four silently dropped slots is a flying head.**

  **RC-3 — Forced head fallback masks RC-2.** The same resolver hard-codes
  `effectiveIdx = 94` whenever the computed variant does not start with
  `head/heads/`:

  ```ts
  if (slotName === 'head') {
    if (effectiveIdx < 0) { effectiveIdx = 94; }
    const headVariant = slotDef?.variants[effectiveIdx];
    if (!headVariant?.assetId.startsWith('head/heads/')) {
      effectiveIdx = 94;   // ← every out-of-range head becomes human_male
    }
  }
  ```

  The override is a real masking hazard — any out-of-range or non-head index
  silently becomes `head/heads/human_male`. **Fact check (see OQ-1):** the
  claim that `village_elder`'s head index 97 hits this path is *wrong* for the
  committed catalog — 97 (1-indexed) → `effectiveIdx` 96 →
  `head/heads/human/female_elderly`, which **passes** the prefix check. The
  catalog was last committed 2026-07-14 (unchanged at the 2026-08-16
  playthrough), so the uniform-head symptom cannot be attributed to RC-3 via
  the elder's index. The observed symptom more likely comes from the worker's
  numeric-string assetIds (RC-1) or the Tiled-property default fallback
  (RC-4) — confirmed at implementation time via OQ-3 logging. The override
  must still be removed: it is a latent silent-corruption path, and its
  presence is why RC-2 failures stay invisible in logs.

  **RC-4 — Two sources of truth for NPC appearance.** The content pack manifest
  declares `appearanceLayers` per NPC
  (`apps/frontend/client/static/content-packs/emberwatch/manifest.json`), but
  `packages/frontend/engine/src/systems/entity_spawner.ts:174`
  (`_getNpcAppearanceLayers`) reads them from **Tiled spawn-point properties**
  instead, silently falling back to
  `NPC_APPEARANCE_LAYERS = [3, 3, 23, 22, 7, 95]` (line 164) whenever the
  property is absent, has fewer than 6 entries, or contains any value `< 1`.
  Manifest/map drift is therefore invisible: `village.json` carries
  `appearanceLayers = "2,3,65,21,20,97"` on one spawn object, and any map
  object that omits it silently inherits the default body.

- **Existing implementation to reuse**:
  - `apps/frontend/client/src/lib/services/game/game_engine_service.svelte.ts:905-978`
    (`_buildLpcPipeline`) and the near-identical copy in
    `apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts:1182-1260`
    — both contain the same more-correct index→asset resolution; the unified
    implementation should be extracted from one and **both client copies
    replaced** (the `game_boot_service` copy is the production `/game` path).
  - `packages/frontend/engine/src/rendering/prop_texture_resolver.ts` and its
    test — the pattern for a resolver that lives in the engine with unit
    coverage.
  - `scripts/src/lib/ops/validate_wgsl.ts` — the pattern for a build-time
    content validator wired into `bun run validate:shaders`.
  - `apps/e2e/src/visual/suites/emberwatch.visual.ts` — already asserts
    `noLpcHeads` ("zero LPC character heads are used as props"); extend rather
    than duplicate.

- **Known gaps**: the existing resolvers have no unit test asserting
  worker/main-thread agreement, and no content-pack validation exists for
  appearance indices.

- **Baseline tests**: run before starting —
  `moon run e2e:test -- tests/client/game_boot.spec.ts`,
  `apps/e2e/src/visual/suites/emberwatch.visual.ts`,
  `apps/e2e/src/visual/suites/lpc.visual.ts`.

## User Outcome

After this contract, a **player** entering any Emberwatch map sees every NPC
rendered as a complete character — body, hair, torso, legs, feet, and head —
visually distinct from one another and matching the appearance the content pack
declares for them.

## Success Measures

- **Time/latency target**: no regression in map load time; resolution is a
  pure index lookup and must not add a network round trip.
- **Offline/degraded behavior**: an unresolvable slot renders a declared
  fallback asset and logs a warning — it never renders nothing.
- **Production journey enabled**: the Emberwatch vertical slice becomes
  visually presentable, which is a precondition for the cold-start playtest and
  for any gameplay video.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Index → asset id resolution | `game_engine_service.svelte.ts:921` **and** `game_boot_service.svelte.ts:1202` | **modify** — extract both to engine as the single implementation |
| Worker-side recipe building | `ecs_worker.ts:628` | **replace** — call the shared resolver |
| NPC appearance lookup at spawn | `entity_spawner.ts:174` | **modify** — read from content pack, not Tiled properties |
| Default layer constant | `entity_spawner.ts:164` | **modify** — becomes a per-slot fallback table, not a whole-stack default |
| Appearance ECS component | `packages/frontend/engine/src/components/appearance.ts` | **reuse** unchanged |
| Recipe → GPU batch | `render_worker.ts` `LpcBatchManager` | **reuse** unchanged |
| Build-time content validation | `scripts/src/lib/ops/validate_wgsl.ts` | **reuse** the pattern |

## Overview

LPC appearance resolution currently exists **three times** (worker resolver,
`game_engine_service` `_buildLpcPipeline`, and the production-path
`game_boot_service` `_buildLpcPipeline`), disagrees between the copies, and
fails silently. This contract collapses it to one implementation
that lives in the engine, gives every slot a declared fallback with a logged
warning, removes the hard-coded head override that was masking the failure, and
makes the content pack manifest the single source of NPC appearance. A
build-time validator prevents the class of drift that produced the bug.

## Design Reference

Follow the resolver-with-unit-test pattern of
`packages/frontend/engine/src/rendering/prop_texture_resolver.ts`. The resolver
is a pure function over `(layerIds, catalog)` — no Svelte, no `$state`, no I/O
— so it satisfies the Engine Boundary (directive #6) and is directly unit
testable from both the worker and main-thread call sites.

Content-pack validation follows `scripts/src/lib/ops/validate_wgsl.ts`: a
standalone Bun script that exits non-zero with an actionable message, wired
into the existing `bun run validate:*` family.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- The resolver moves into the **engine** package as a pure function. Both the
  worker and the client call it. Neither may keep a private copy — this is the
  invariant the contract exists to establish.
- The resolver takes the LPC catalog as an **injected argument**. It must not
  import client code, read globals, or reach for a singleton.
- **Every slot has a declared fallback.** The fallback table is data, not
  scattered `if` branches. There is no code path where an unresolved slot
  produces no recipe.
- **Every fallback logs once per entity per slot** at `warn`, naming the slot,
  the requested index, and the catalog size for that slot. Silent degradation
  is what hid this bug for the life of the project.
- The hard-coded `effectiveIdx = 94` head override is **removed**. Head
  validity becomes a content-load-time check, not a per-render correction.
- NPC appearance is read from the **content pack manifest**, keyed by `npcId`.
  Tiled spawn objects carry `npcId` only.
- `Appearance` component layout, `EngineBridge` message shapes, and the
  `LpcBatchManager` UBO packing are **unchanged** — this contract does not
  touch the render path below the recipe.

## State & Data Models

The resolver's contract, expressed as types (TypeScript `type` aliases only):

```ts
/** One engine appearance slot, in render order. */
type LpcSlotName = 'body' | 'hair' | 'torso' | 'legs' | 'feet' | 'head';

/** Per-slot catalog: the variants available for one slot. */
type LpcSlotCatalog = {
  readonly slot: LpcSlotName;
  readonly variants: readonly { readonly assetId: string }[];
};

/** Fallback asset per slot, used when an index does not resolve. */
type LpcSlotFallbacks = Readonly<Record<LpcSlotName, string>>;

/** Why a slot resolved the way it did — carried for observability. */
type LpcSlotResolution =
  | { readonly kind: 'resolved'; readonly assetId: string }
  | {
      readonly kind: 'fallback';
      readonly assetId: string;
      readonly requestedIndex: number;
      readonly catalogSize: number;
    }
  | { readonly kind: 'empty' };

/** The resolver result: always six entries, never fewer. */
type LpcAppearanceResult = {
  readonly recipes: readonly {
    readonly slot: LpcSlotName;
    readonly assetId: string;
    readonly hexPalette: Uint8Array;
  }[];
  readonly resolutions: Readonly<Record<LpcSlotName, LpcSlotResolution>>;
};
```

Index **0 means *intentionally empty*** (used by `_buildPlayerData` for
`appearanceLayers[2]`/`[4]` — torso, feet): it resolves to an `empty` recipe
entry (slot present, `assetId: ''`, zero-filled palette, `active = 0` in the
UBO packer) and **must not** log a fallback warning. A non-zero index that is
out of range or missing from the catalog resolves to `fallback` and logs a
`warn`. Distinguishing the two is what prevents warning spam for every player
entity (see Edge Cases).

NPC appearance in the content pack manifest is already declared as
`appearanceLayers: number[]` on each NPC entry — **no schema change is
required**. The change is which reader is authoritative.

The 1-indexed convention (`index - 1` into `variants`) is preserved to keep
existing manifests valid. This is a footgun and must be documented in a comment
at the resolver, not silently maintained.

## Quality Requirements

- **Offline/degraded mode**: fully offline; the resolver is a pure index
  lookup. Missing catalog entries degrade to fallback assets, never to nothing.
- **Accessibility/input**: N/A — no input surface.
- **Performance budget**: resolution runs on entity spawn and on structural
  appearance change, not per frame. Must add no measurable cost to the 60fps
  loop. The existing fingerprint check in `render_worker.ts` already prevents
  redundant re-packing and must keep working.
- **Security/privacy**: N/A — no user data, no network.
- **Persistence/migration**: existing saves store appearance as layer indices.
  The index convention is unchanged, so old saves resolve identically — except
  where they previously resolved to *nothing*, which now renders a fallback.
  That is the fix, not a regression.
- **Cancellation/retry/idempotency**: the resolver is pure and idempotent.
- **Observability**: one `warn` per entity per slot on fallback, and a single
  `info` summary at content-pack load reporting how many NPC appearance indices
  failed validation.

## Migration & Rollback

- **Old data compatibility**: layer-index format unchanged; old saves load.
- **Migration**: none required.
- **Rollback**: revert the commit. No persisted state has changed shape, so
  rollback is clean.
- **Feature flag or kill switch**: not warranted — the current behavior is
  broken, so there is no working state to preserve behind a flag.
- **Failure recovery**: N/A — no migration step.

## Scope Boundaries

- **In Scope:**
  - One shared appearance resolver in `packages/frontend/engine`, called by
    both the worker and the client.
  - Declared per-slot fallbacks with logged warnings.
  - Removal of the hard-coded index-94 head override.
  - Content pack manifest as the single source of NPC appearance;
    `entity_spawner` reads `npcId` and looks up the manifest.
  - A build-time validator for appearance indices, wired into `validate:*`.
  - Unit test asserting worker and main-thread resolution are identical.
  - Extension of `emberwatch.visual.ts` to assert complete NPC bodies.

- **Out of Scope:**
  - Palette / recolour support — `hexPalette` stays zero-filled.
  - The expression system (`expression_system.ts`).
  - LPC catalog *generation* (`lpc_asset_catalog_generated.ts` and its
    generator) — this contract consumes the catalog, it does not rebuild it.
  - Player equipment → appearance propagation — that is **C-403**, which
    depends on this contract landing first.
  - The duplicated `appearanceLayers` builder in `game_boot_service.svelte.ts`
    and `game_engine_service.svelte.ts` — deduped by **C-411**.
  - Any change to `Appearance`, `EngineBridge`, or UBO packing.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** not split. The four root causes share one data model
(the layer-index → asset-id mapping) and one invariant (six slots always
resolve). Fixing RC-2 without RC-3 leaves the head override still masking
failures; fixing RC-1 without RC-4 leaves two appearance sources feeding one
resolver. Partial completion would leave two competing code paths live, which
the split rule names explicitly as a reason **not** to split.

## Acceptance Criteria

### AC-1: NPCs render complete bodies
**Given** the Emberwatch content pack is loaded
**When** the `village`, `inn`, and `merchant_shop` maps are entered
**Then** every NPC renders with all six slots present (body, hair, torso, legs,
feet, head) and no NPC renders as a head alone

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Visual | `apps/e2e/src/visual/suites/emberwatch.visual.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run e2e:run-visual-tests -- --suite=emberwatch`
  (runner: `apps/e2e/src/visual/runner.ts`, filter flag is `--suite=<id>`;
  there is no `e2e:visual` moon target)
- Integration: load each of the three maps in the browser and confirm visually.
- E2E / Visual:
    - **Functional**: `tests/client/game_boot.spec.ts` — extend with an
      assertion that the spawned NPC entity count for the loaded map equals the
      manifest NPC count for that map (current spec only checks boot completion;
      note village/inn/merchant_shop each declare exactly one NPC — the
      playthrough's 2/3/1 heads include emergent entities per OQ-3, so assert
      authored NPCs, not total character count).
    - **Visual**: extend `emberwatch.visual.ts` with a case
      `npcs-render-complete-bodies` on `/game`. Add TypeBox fields
      `allNpcsHaveBodies: Boolean` ("Whether every visible character sprite has
      a torso and legs beneath its head") and
      `noFloatingHeads: Boolean` ("Whether zero heads appear without a body").
      Add both to `requiredTrueFields`. Score 90+: the authored NPC on the
      loaded map (`village_elder` in `village`, `rollo_grasper` in `inn`,
      `merchant` in `merchant_shop`) renders complete with all six slots
      visible; no head appears without a body.

**Watch Points**:
- The existing `noLpcHeads` field in this suite means something different —
  heads used as *props*. Do not conflate the two; add new fields.
- The maps are dark at default ambient (see **C-404**). The visual case must
  force a lit state via `searchParams` or the VLM will report low confidence
  for reasons unrelated to this contract.

### AC-2: NPCs are visually distinct from one another
**Given** three NPCs declaring different `appearanceLayers` in the manifest
**When** they are rendered in the same scene
**Then** they resolve to different asset id sets, and no two share an identical
recipe list

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `packages/frontend/engine/src/__tests__/lpc_appearance_resolver.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: assert against the real Emberwatch manifest, not a fixture, so
  manifest drift breaks the test.
- E2E / Visual: **Functional**: N/A. **Visual**: covered by AC-1's case.

**Watch Points**:
- This AC is what proves RC-3 is fixed. If the head override survives anywhere,
  all three NPCs collapse to the same head asset and this test fails.

### AC-3: Unresolvable slots fall back and log
**Given** an appearance index outside its slot's catalog range
**When** the resolver runs
**Then** a declared fallback asset is used for that slot **and** a `warn` is
logged naming the slot, the requested index, and the catalog size

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `packages/frontend/engine/src/__tests__/lpc_appearance_resolver.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: assert `recipes.length === 6` for every input, including an
  all-zeros and an all-`999` input.
- E2E / Visual: N/A.

**Watch Points**:
- Assert on the *absence* of `continue`-style drops by checking recipe count,
  not by checking that specific assets appear. A count assertion cannot be
  satisfied by accident.

### AC-4: Worker and main-thread resolvers agree
**Given** any array of six layer indices
**When** both the worker path and the client path resolve it
**Then** they produce identical `slot` and `assetId` sequences

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `packages/frontend/engine/src/__tests__/lpc_appearance_resolver.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: table-driven over at least the three Emberwatch NPC layer
  arrays, the player's array, the all-zeros array, and an out-of-range array.
- E2E / Visual: N/A.

**Watch Points**:
- After unification there is only one implementation, so this test is a
  **regression guard against re-forking**, not a check of current behavior.
  Name it so its purpose survives the next refactor.

### AC-5: Invalid appearance indices fail the build
**Given** a content pack manifest declaring an appearance index outside its
slot's catalog range
**When** the content validator runs
**Then** it exits non-zero, naming the pack id, NPC id, slot, offending index,
and the valid range

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | `scripts/src/lib/ops/validate_content_appearance.test.ts` (colocated with the op — the ops dir convention; e.g. `logs.test.ts`, `parser_sync.test.ts`) | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun run validate:content` (new root script in the
  `validate:shaders`-style family) **plus a `scripts:validate-content` moon
  task with `runInCI: true`** (following the `scripts:guard-data-plane`
  pattern in `scripts/moon.yml`) — the actual CI gate is `moon ci`
  (`.github/workflows/pr-checks.yml` runs `bun moon ci`), not the root
  `bun run ci` script, and the root `validate` script does not exist.
  Wire it so the validator fails the build in CI.
- Integration: run against the real `emberwatch` and `whispering-caves` packs
  and confirm both pass after the fix.
- E2E / Visual: N/A.

**Watch Points**:
- `village_elder` currently declares head index 97, which is exactly the case
  RC-3 was masking. **Resolved (OQ-1): 97 is valid** — 1-indexed 97 →
  `head/heads/human/female_elderly`, which passes the `head/heads/` prefix
  check. The manifest stays; no head index in the three Emberwatch arrays is
  out of range (verified against `lpc_asset_catalog_generated.ts`: head has
  142 variants, indices 86–131 are `head/heads/*`). The validator must pass
  all three Emberwatch NPCs unchanged.
- **whispering-caves NPCs declare only 4 appearanceLayers** (`[1,3,7,14]` and
  `[8,9,11,13]`), not 6. The validator must NOT require exactly 6 entries:
  validate only the indices that are present, and treat missing trailing
  slots (feet, head) as absent → runtime fallback. AC-5's integration step
  says "confirm both packs pass" — a strict 6-length rule would fail
  whispering-caves on purpose and contradict the AC.

### AC-6: NPC appearance comes from the manifest
**Given** a Tiled spawn object carrying only `npcId`
**When** the NPC spawns
**Then** its appearance is read from the content pack manifest entry for that
`npcId`, and the Tiled `appearanceLayers` property is ignored

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Unit | `packages/frontend/engine/src/__tests__/entity_spawner.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: remove `appearanceLayers` from a `village.json` spawn object and
  confirm the NPC still renders correctly from the manifest.
- E2E / Visual: covered by AC-1.

**Watch Points**:
- The stale `appearanceLayers` properties in the three Emberwatch map files
  should be **deleted** in this contract, not left as dead data — leaving them
  recreates the two-sources-of-truth condition for the next reader.
- An NPC spawn whose `npcId` has no manifest entry is the "invalid NPC" case
  reported in the playthrough. It must log an error naming the id and skip the
  spawn cleanly rather than creating a partial entity.

## Implementation Sequence

1. **Phase 1 (Data/Logic)** — Create the resolver in
   `packages/frontend/engine/src/rendering/lpc_appearance_resolver.ts` as a
   pure function over `(layerIds, catalog, fallbacks)`. Port the correct logic
   from `game_engine_service.svelte.ts:921`, minus the head override. Add the
   per-slot fallback table. Write the unit tests for AC-2, AC-3, AC-4 first —
   they define the contract of the function.
2. **Phase 2 (Integration)** — Replace `workerRecipeResolver`
   (`ecs_worker.ts:628`) and **both** `_buildLpcPipeline` inner resolvers
   (`game_engine_service.svelte.ts:921` and
   `game_boot_service.svelte.ts:1202`) with calls to the shared function.
   Delete all three old implementations — leaving the `game_boot_service`
   copy in place keeps the production `/game` path on the buggy resolver and
   AC-1 fails. Change `_getNpcAppearanceLayers`
   (`entity_spawner.ts:174`) to look up the manifest by `npcId`; handle the
   missing-entry case with a logged skip. Strip the now-dead
   `appearanceLayers` properties from the three Emberwatch map JSON files.
3. **Phase 3 (Validation)** — Add
   `scripts/src/lib/ops/validate_content_appearance.ts` following the
   `validate_wgsl.ts` pattern; add the `validate:content` root script **and a
   `scripts:validate-content` moon task with `runInCI: true`** so it runs in
   the `moon ci` gate (see AC-5 Test Hooks). Extend `emberwatch.visual.ts`
   with the AC-1 case. Run
   `bun run typecheck`, `moon run engine:test`, `moon run e2e:test`, and the
   visual suite.

## Edge Cases & Gotchas

- **1-indexed layer values.** Manifests store 1-indexed variant numbers;
  `variants` is 0-indexed. The `- 1` is load-bearing and easy to lose in a
  refactor. Document it at the resolver and assert it in a unit test.
- **Index 0 means "no layer" for some slots.** `_buildPlayerData` deliberately
  writes `appearanceLayers[2] = 0` and `[4] = 0` (torso, feet). Under the new
  "every slot always resolves" rule, a literal 0 must be distinguishable from
  "unresolvable" — 0 should mean *intentionally empty* and must not emit a
  fallback warning. Getting this wrong will spam warnings for every player
  entity. (C-403 revisits whether those zeroes should exist at all.)
- **Worker/main-thread module boundary.** The worker cannot import client code.
  The resolver must live in the engine package with no client imports, or the
  worker build breaks.
- **The catalog is large.** `lpc_asset_catalog_generated.ts` is generated and
  sizeable; do not deep-clone it per resolution. Pass it by reference.
- **`emberwatch.visual.ts` already has a `noLpcHeads` field** meaning "heads
  used as props". Adding a similarly named field will confuse the VLM prompt.
  Name new fields distinctly (`noFloatingHeads`, `allNpcsHaveBodies`).
- **Head slot semantics.** The prefix check `head/heads/` implies the head slot
  catalog also contains ears, faces, and similar. If so, the fallback table for
  `head` must point at a real `head/heads/` asset, and validation must enforce
  the prefix rather than the render path correcting it.

## Open Questions

Must be resolved before status becomes `approved`:

- **OQ-1 — RESOLVED (fact lookup, 2026-08-16):** `village_elder`'s head index
  **97 is valid**. `GENERATED_LPC_SLOTS` head slot has 142 variants;
  1-indexed 97 → 0-indexed 96 → `head/heads/human/female_elderly`, which
  starts with `head/heads/` and therefore **passes** the RC-3 prefix check.
  Consequence: the RC-3 mechanism narrative in the Problem section was wrong
  for the elder — the override does not fire for index 97 with the committed
  catalog (catalog last committed 2026-07-14, unchanged at playthrough). No
  manifest head index needs correcting. The override is still removed (it is
  a latent silent-corruption path), and AC-5's validator must pass the three
  Emberwatch NPC arrays as-is.
- **OQ-2 — RESOLVED (fact lookup, 2026-08-16):** all five non-head elder
  indices resolve. `[2,3,65,21,20]` → `body/bodies_female`,
  `hair/bangs_adult`, `torso/clothes/robe_female`, `legs/pants_female`,
  `feet/shoes/basic_thin` — all in range (body 52, hair 169, torso 166, legs
  41, feet 34 variants). Rollo `[3,123,23,22,7,95]` and merchant
  `[3,91,127,22,19,95]` also resolve in full. **No Emberwatch appearance
  authoring pass is needed**; the manifests are valid against the committed
  catalog. (whispering-caves still declares only 4 layers per NPC — handled by
  the AC-5 validator policy, not an authoring pass here.)
- **OQ-3 — CONFIRMED (map inspection, 2026-08-16):** each Emberwatch map
  contains exactly **one** `npc` spawn object carrying `npcId` (village =
  `village_elder`, inn = `rollo_grasper`, merchant_shop = `merchant`). The
  playthrough observed 2/3/1 floating heads per map, which exceeds the authored
  NPC count — so the extra "invalid NPC" entities are **not** authored spawns
  with missing manifest entries; they are emergent-world / GOAP entities
  (option (b)) or duplicates of the single NPC. AC-6's missing-entry skip is
  still required, but the "invalid NPC" count observed in the playthrough will
  not drop to zero from this contract alone. Log every NPC spawn (id + source)
  on the three maps during implementation to confirm which entities the
  playthrough saw; do not extend this contract's scope to emergent-world
  entities.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-08-16 | Initial draft from `mvp-assessment-2026-08-16.md` §6.2. | — |
| 2.0.0 | 2026-08-16 | Critic pass: added the third resolver copy (`game_boot_service.svelte.ts:1202`, the production `/game` path) to RC-1/Reuse Map/Phase 2; corrected RC-3 mechanism claim and resolved OQ-1/OQ-2 (index 97 valid, all Emberwatch indices resolve) + OQ-3 (maps have one authored NPC each; extra heads are emergent entities); added whisper-caves 4-layer validator policy to AC-5; fixed visual-suite moon task name; wired `validate:content` into `moon ci` via `scripts:validate-content`. | critic |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

Target for this contract: **`release_verified`** — it has a production route
(`/game`), an E2E path, and a visual suite. Anything less leaves the headline
defect unproven.

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
