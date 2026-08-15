# MVP Contract Backlog — C-400 … C-416

> **Source:** `docs/strategy/mvp-assessment-2026-08-16.md`
> **ID range:** C-400 onward. C-397 … C-399 remain reserved by
> `data-layer-target-architecture.md` §5.1 (client asset migration, member
> submissions, social metadata) and are **not** MVP work.

## How to run these

**The P0 block is already authored as full contracts** — C-400, C-401, C-402,
and C-405 exist as `TEMPLATE.md` v2.0.0 files on disk. Run them directly; the
writer stage is unnecessary because the specification already exists:

```bash
bun run contract C-400 --root --critique
```

Path-source skips the writer, `--critique` keeps the critique stage as a
quality gate. Each of the four has Open Questions that must be resolved before
its status moves `draft → approved` — they are fact lookups and design calls,
not blockers on starting.

The remaining entries (C-403, C-404, C-406 … C-416) are **backlog seeds, not
contracts**. Each carries enough problem evidence, scope, and acceptance shape
to be expanded into a full contract. Two ways to expand one:

- Author the file directly (highest fidelity — nothing is re-derived), then
  `bun run contract C-4XX --root --critique`.
- `bun run contract --source prompt --root`, then point the writer at this
  file's entry plus the corresponding section of
  `docs/strategy/mvp-assessment-2026-08-16.md`.

> 🔴 **ID allocation caveat.** `prepareDirectSource`
> (`scripts/src/lib/agents/contract_pipeline.ts:463-467`) computes the next ID
> as `maxId + 1` from **contract filenames on disk** — it does not know about
> IDs reserved in this document or in the data-layer ADR. With C-405 on disk,
> the next `--source prompt` or `--source issue` run will allocate **C-406**,
> colliding with the reservation below. Either author reserved files before
> using those modes, or accept that the pipeline renumbers and update this
> document to match. `--source todo` is unusable here: `parse_backlog.ts:70`
> hardcodes `docs/TODO.md`, which no longer holds structured backlog items.

## Ordering

```
C-400 ─┐
C-401 ─┼─ P0 playability. Parallel; no shared files except C-400/C-403.
C-402 ─┤
C-405 ─┘
        ↓
C-403 → (depends on C-400: needs the unified resolver)
C-404, C-406, C-407, C-408 ─ P1 polish. Parallel.
        ↓
C-409, C-410, C-411 ─ P2 consistency + cleanup. Parallel, independent.
        ↓
C-412, C-413, C-414 ─ P2 infrastructure. Deliberately last.
        ↓
C-415, C-416 ─ P3 growth.
```

**Do not start P2 infrastructure before the P0 block lands.** The ordering is
the point of this document; see `mvp-assessment-2026-08-16.md` §1.

---

# P0 — MVP blockers

## C-400 — Unify LPC appearance resolution; no silent slot drops

> ✅ **Authored as a full contract:** [`C-400-unify-lpc-appearance-resolution.md`](C-400-unify-lpc-appearance-resolution.md). The entry
> below is the seed it was written from; the contract file is authoritative.

| Field | Value |
|---|---|
| **Priority** | P0 — the most damaging visual defect in the build |
| **Target** | `packages/frontend/engine/`, `apps/frontend/client/src/lib/services/game/` |
| **Depends on** | — |
| **Docs impact** | internal |

### Problem & baseline evidence

NPCs render as disembodied heads. Every NPC head is the same bald pale male
head regardless of its declared appearance. Some entities render as "invalid
NPC".

Three distinct root causes, all confirmed:

1. **Two divergent recipe resolvers for the same data.**
   - `packages/frontend/engine/src/worker/ecs_worker.ts:628`
     (`workerRecipeResolver`) emits `assetId: String(effectiveId)` — the raw
     numeric index as a string, e.g. `"23"`.
   - `apps/frontend/client/src/lib/services/game/game_engine_service.svelte.ts:921`
     resolves the same index against `generatedLpcSlots` into a real asset id,
     e.g. `torso/clothes/chainmail_male`.

2. **Silent slot drops.** In the main-thread resolver, when
   `slotDef?.variants[effectiveIdx]` is `undefined`, the loop `continue`s with
   no log and no fallback for `hair`, `torso`, `legs`, `feet`. Only `body`
   (`LPC_DEFAULT_BODY_ASSET_ID`) and `head` have guaranteed fallbacks. A head
   plus four dropped slots is a flying head.

3. **Forced head fallback masks the real bug.** The same resolver hard-codes
   `effectiveIdx = 94` whenever the computed variant does not start with
   `head/heads/`. Elder Thalia declares head index 97 → 96, which fails the
   prefix test → 94. Every NPC therefore gets `heads/human_male`.

Plus a **fourth** issue that makes all of the above hard to diagnose: NPC
appearance has two sources of truth. The content pack manifest declares
`appearanceLayers` per NPC
(`apps/frontend/client/static/content-packs/emberwatch/manifest.json`), but
`packages/frontend/engine/src/systems/entity_spawner.ts:174`
(`_getNpcAppearanceLayers`) reads them from **Tiled spawn-point properties**,
silently falling back to `NPC_APPEARANCE_LAYERS = [3,3,23,22,7,95]` (line 164)
when the property is absent, has fewer than 6 entries, or contains any value
`< 1`. Manifest/map drift is invisible.

### Reproduction

Boot Emberwatch, load `village`. Two NPCs render as floating heads; the
third (`village_elder`, the only spawn point carrying an `appearanceLayers`
property) is also affected. Repeats in `inn` and `merchant_shop`.

### Scope — in

- One resolver implementation, shared by worker and main thread. The worker
  must not invent numeric-string asset ids.
- Every slot gets a declared fallback. Replace all silent `continue` paths
  with a logged fallback (`logger.warn` with slot name, requested index, and
  catalog size).
- Remove the hard-coded index-94 head override; validate head indices against
  the catalog at content-pack load time instead of at render time.
- Content pack manifest becomes the single source of NPC appearance. The
  spawner reads `npcId` from Tiled and looks appearance up in the manifest.
- A validation script (pattern: `scripts/src/lib/ops/validate_wgsl.ts`) that
  fails the build when a manifest declares an appearance index outside its
  slot's catalog range.

### Scope — out

- Palette / recolour support (`hexPalette` stays zero-filled).
- Expression system changes.
- Any change to the LPC catalog generation itself.

### Acceptance shape

- **AC-1** Given Emberwatch `village`, when the map loads, then all three NPCs
  render with body, hair, torso, legs, feet, and head layers present.
- **AC-2** Given an NPC whose manifest declares an out-of-range index, when the
  content pack loads, then the build-time validator fails with the NPC id,
  slot, and offending index.
- **AC-3** Given a slot that cannot resolve at runtime, when the recipe is
  built, then a fallback asset is used **and** a warning is logged naming the
  slot.
- **AC-4** Given the worker and main-thread resolvers, when both resolve the
  same `layerIds`, then they produce identical `assetId` values (unit test
  asserting equality across both paths).
- **AC-5** Playwright visual snapshot of `village` with all three NPCs.

---

## C-401 — Stream dialogue narrative; collapse the two-call skill-check flow

> ✅ **Authored as a full contract:** [`C-401-stream-dialogue-narrative.md`](C-401-stream-dialogue-narrative.md). The entry
> below is the seed it was written from; the contract file is authoritative.

| Field | Value |
|---|---|
| **Priority** | P0 — highest perceived-quality-per-hour change in the repo |
| **Target** | `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts` |
| **Depends on** | — |
| **Docs impact** | internal |

### Problem & baseline evidence

`npc_dialogue_service.svelte.ts:795` claims:

> *"The gateway streams onChunk for narrative, then returns the full text +
> parsed structured object."*

It does not. `NpcDialogueTextGenerator` (line 96) has no `onChunk` parameter,
and the call site (line 797) passes only `messages`, `schema`, `schemaName`,
`signal`. **The production game does not stream.** Streaming works and is used
— `packages/frontend/ai-gateway/src/lib/sse.ts`,
`stream_orchestrator_service.svelte.ts`, `session_service.svelte.ts:857` — but
its only view-layer consumers are `chat_view_model.dev.svelte.ts` and the dev
sandboxes.

Compounding it: skill checks are a **two-call** flow. Line 1373 —
*"Call #2: Roll resolution — sends dice outcome to LLM for narrative."* So a
dice prompt costs two full non-streamed round trips with a frozen UI between
them. This is the reported "stuck when I get dice roll prompt".

### Reproduction

Talk to Elder Thalia on any local or free-tier model. The dialogue box is
frozen for the full generation. Trigger a skill check with Rollo → frozen
twice, with a dice prompt stranded in between.

### The actual design problem

A `{narrative, command, choices}` envelope cannot be naively streamed. Two
viable approaches — the contract must pick one and record why:

- **(a) Partial-JSON streaming.** Stream the response and incrementally parse
  the `narrative` field, revealing text as it arrives. Keeps one call. Requires
  a tolerant partial-JSON reader and depends on the model emitting `narrative`
  before `command`/`choices` (enforceable via schema property order for most
  providers, but not guaranteed).
- **(b) Two-call split.** Call 1 streams plain narrative prose with no schema.
  Call 2 (non-streamed, small, fast) extracts the command envelope from the
  completed narrative. Doubles call count but each is simpler, and call 2 can
  run against a cheaper/faster model.

**Recommendation: (b).** It is robust across every provider, it makes the
existing skill-check second call a consistent pattern rather than a special
case, and it removes the dependency on JSON field ordering. Cost is one extra
short completion per turn, which is negligible next to a frozen UI.

### Scope — in

- `onChunk` on `NpcDialogueTextGenerator` and every call path to it.
- Token-by-token reveal in the dialogue view, with a visible generating state.
- Skill-check flow: the dice prompt must appear with narrative already
  streamed, and the resolution call must stream too.
- Abort on `End Chat` mid-generation (`signal` is already threaded — verify it
  reaches the adapter).
- Timeout + user-visible error state. Today a stalled call is indistinguishable
  from a slow one.

### Scope — out

- Prompt/context-window tuning.
- Combat narration (separate path).
- Provider failover.

### Acceptance shape

- **AC-1** Given any text provider, when an NPC turn generates, then the first
  token renders in the dialogue box within 1500 ms of the request.
- **AC-2** Given a skill check, when the dice prompt appears, then the
  preceding narrative is already fully visible.
- **AC-3** Given `End Chat` pressed mid-generation, when the request aborts,
  then no further tokens render and no error toast appears.
- **AC-4** Given a provider that stalls past the timeout, when the deadline
  passes, then an actionable error renders and the authored fallback turn is
  offered.
- **AC-5** E2E asserting incremental text growth across at least three frames.

---

## C-402 — Fix NPC/player movement deadlock

> ✅ **Authored as a full contract:** [`C-402-fix-npc-player-movement-deadlock.md`](C-402-fix-npc-player-movement-deadlock.md). The entry
> below is the seed it was written from; the contract file is authoritative.

| Field | Value |
|---|---|
| **Priority** | P0 — soft-locks play |
| **Target** | `packages/frontend/engine/src/systems/` (collision, movement, GOAP) |
| **Depends on** | — |
| **Docs impact** | internal |

### Problem & baseline evidence

The player becomes stuck when an NPC walks toward them.

`packages/frontend/engine/src/systems/entity_spawner.ts:112-115`:

```
NPC collision mask: blocks walls, other NPCs, and the player (two-way
blocking so a future GOAP/moving NPC cannot walk through the player).
const NPC_COLLISION_MASK = CollisionLayer.wall | CollisionLayer.npc | CollisionLayer.player;
```

and line ~396: *"player cannot walk through them (PLAYER_COLLISION_MASK
includes npc)"*.

Two-way blocking with no resolution rule: a moving NPC pathing into the player
tile and a player pathing into the NPC tile mutually block, and neither yields.
The GOAP/pathfinding layer (C-191, C-192) has no push-out, no repath-on-block,
and no "living entities are soft obstacles" concept.

### Reproduction

Stand still in `village` and wait for an NPC to path toward the player.
Movement input stops taking effect.

### Scope — in

- A resolution rule for actor-vs-actor collision. Options the contract must
  choose between and record:
  - **(a)** NPCs treat the player as a soft obstacle: repath around, never
    block. Player never collides with NPCs.
  - **(b)** Mutual push-out — the lower-priority actor is displaced to the
    nearest free tile.
  - **(c)** NPCs stop at `interactionRadius` and never enter the player's tile.
  - **Recommendation: (c) + (a).** NPCs halt at interaction range, and the
    player passes through NPCs. This removes the deadlock class entirely rather
    than resolving it per-frame, and interaction radius is already declared per
    NPC in the map data (`interactionRadius: 48`).
- Stuck detection as a safety net: if the player's intended movement is blocked
  for N consecutive ticks with input held, log and force-resolve.

### Scope — out

- Combat positioning.
- Crowd/flow-field pathfinding.

### Acceptance shape

- **AC-1** Given an NPC pathing toward a stationary player, when they meet,
  then player input continues to move the player.
- **AC-2** Given a player walking into an NPC, when they overlap, then neither
  entity is permanently blocked.
- **AC-3** Deterministic engine-replay test (pattern:
  `apps/e2e/engine_replay.test.ts`) covering both approaches.

---

## C-405 — Cut world generation from the critical path

> ✅ **Authored as a full contract:** [`C-405-cut-worldgen-from-critical-path.md`](C-405-cut-worldgen-from-critical-path.md). The entry
> below is the seed it was written from; the contract file is authoritative.

| Field | Value |
|---|---|
| **Priority** | P0 — the front door is currently a dead end |
| **Target** | `apps/frontend/client/src/routes/setup/`, `src/lib/views/worldgen/`, `src/lib/views/start/` |
| **Depends on** | — |
| **Docs impact** | user-facing — setup guide |

### Problem & baseline evidence

"Start campaign" routes to `/setup`, which collects genre, tone, setting,
difficulty, and goals, then runs world generation. **The output is discarded** —
the MVP loads the Emberwatch content pack regardless.

`docs/strategy/vision-and-directives.md:88` is explicit:

> *"Do not make AI world generation the front door."*

It currently is, and it feeds nothing. Directive #4 requires that *"every
generative feature must compile into the same versioned content/state contracts
used by authored content."* No such compiler exists — issue #81 ("Reintroduce
Generated Campaigns as a Content-Pack Compiler") is the open placeholder.

The generator itself is good. A sample run produced a coherent setting
("Duskhollow"), 6 NPCs with archetypes and descriptions, 7 locations, 3 story
arcs with objectives and quest-giver bindings, and HUD widget configuration.
This contract does not delete that work.

### Secondary problem

Generation is slow on OpenRouter free models and runs sequentially. Setting
prose, NPC roster, locations, and story arcs are largely independent and can
be fanned out.

### Scope — in

- "Start campaign" goes **directly** to persona creation → Emberwatch. No
  `/setup` in the default path.
- World generation moves behind an explicit **Advanced** entry (directive #7,
  progressive disclosure), clearly labelled as producing a preview that is not
  yet playable — or gated off entirely until the compiler exists. The contract
  must choose; **recommendation: keep it reachable and label it honestly**,
  because it is the most impressive artifact in the build and it costs nothing
  to leave visible once it is off the critical path.
- Content-pack selection UI when more than one pack is installed
  (`whispering-caves` already exists alongside `emberwatch`).
- Parallelize the generation calls that are independent.

### Scope — out

- The content-pack compiler itself (issue #81 — a separate, large contract).
- Deleting worldgen code.

### Acceptance shape

- **AC-1** Given a fresh install, when "Start campaign" is pressed, then the
  player reaches persona creation without passing through world generation.
- **AC-2** Given two installed content packs, when starting a campaign, then a
  pack picker is shown.
- **AC-3** Given the Advanced world-generation entry, when a world is
  generated, then the UI states plainly that the result is a preview.
- **AC-4** Generation wall-clock time on a fixed provider drops measurably
  versus the sequential baseline (record both numbers).

---

# P1 — MVP coherence and polish

## C-403 — Propagate equipment changes to the LPC sprite

| Field | Value |
|---|---|
| **Priority** | P1 |
| **Target** | `apps/frontend/client/src/lib/services/game/equipment_service.svelte.ts`, engine `Appearance` |
| **Depends on** | **C-400** (needs the unified resolver) |

**Problem:** equipping or unequipping armour, weapons, or shields does not
change the player's rendered sprite. `equipment_service.svelte.ts` already
imports `LpcLayerRecipe` and `EQUIPMENT_SLOT_ORDER` (lines 13, 122, 341), and
the engine already emits `APPEARANCE_CHANGED` and supports structural
re-registration (`render_worker.ts:270-300`) — the wiring between them is
absent.

**Note:** `_buildPlayerData` hard-zeroes two slots —
`appearanceLayers[2] = 0; appearanceLayers[4] = 0` (torso and feet) at
`game_boot_service.svelte.ts:1360-1361`, duplicated at
`game_engine_service.svelte.ts:873-874`. Whatever that workaround was for, it
guarantees equipped torso and feet can never render. Resolve it here; dedupe
the block as part of C-411.

**Acceptance shape:** equipping the Iron Armour bought from Mara visibly
changes the player sprite within one frame; unequipping reverts it; the change
survives save/load.

---

## C-404 — Ambient lighting and map readability

| Field | Value |
|---|---|
| **Priority** | P1 |
| **Target** | engine rendering / lighting, Emberwatch content pack |
| **Depends on** | — |

**Problem:** at default night ambient the Emberwatch maps are near-unreadable —
terrain, props, and walkable floor are hard to distinguish, and the interiors
(`inn`, `merchant_shop`) read as undifferentiated dark rooms.

**Scope:** raise the night ambient floor; ensure interiors are lit
independently of the world clock; give interactables a readable contrast
treatment (rim light or outline) so props are findable in low light. Verify the
starting time-of-day for a new campaign — booting a first-time player into
night is a poor first impression regardless of the lighting curve.

**Acceptance shape:** visual snapshots of all three Emberwatch maps at the
campaign start state, with props and NPCs distinguishable from terrain.

---

## C-406 — `/capability` correctness and polish

| Field | Value |
|---|---|
| **Priority** | P1 — first screen a new player sees |
| **Target** | `apps/frontend/client/src/lib/views/capability/` |
| **Depends on** | — |

**Problem:** providers are reported as `detected` when they are not.
`capability_view_model.svelte.ts:103` shows `voiceStatus: 'detected'` as a
literal default rather than a probe result. The auto-seed path (lines 389-483)
then creates connections with `source: 'detected'` off the back of that status,
so a false positive becomes a persisted, apparently-configured connection.

**Scope:** every status must derive from an actual probe with an explicit
`unknown` / `probing` / `detected` / `unavailable` state; no literal defaults.
Auto-seeding only on a confirmed probe. Show what was probed and what came
back. Retry affordance. Visual polish pass on the screen.

**Acceptance shape:** with no local engines running, no provider reports
`detected` and no connection is auto-seeded; unit tests cover each status
transition.

---

## C-407 — Dialogue UI overhaul

| Field | Value |
|---|---|
| **Priority** | P1 (AC covering choice overflow is P0) |
| **Target** | `apps/frontend/client/src/lib/views/game/ui/`, chat components |
| **Depends on** | C-401 (streaming lands in the same view) |

**Problems, observed on the Elder Thalia screen:**

1. **Choice buttons overflow into a horizontal scrollbar** — choices past the
   third are effectively invisible. This hides valid player actions and is the
   P0 element of this contract.
2. Portrait strip at the top is clipped and overflows the viewport.
3. Portrait art direction is incoherent: AI-generated painterly portraits sit
   beside raw LPC sprite crops. Pick one and apply it everywhere. The LPC
   paperdoll is the zero-dependency baseline the README already promises —
   recommendation is to derive portraits from the paperdoll and treat generated
   portraits as an opt-in enhancement.
4. Message area is ~70% dead space for a single message.
5. `TTS` toggle is unlabelled and unstyled.
6. Emoji prefixes on choices are inconsistent (🕯️ 🤝 🪄 ⚔️ 🎲 💬 📋). Either
   map emoji to `intentType` systematically (`quest` / `skill_check` / `trade`
   / `dialogue` are already declared in the manifest) or drop them.

**Scope — out:** the free-text input mechanic itself; TTS behaviour.

**Acceptance shape:** all choices reachable without horizontal scrolling at
1280×720 and at 800×600; portraits fully visible; no clipped elements at either
size; choice emoji derived from `intentType`.

---

## C-408 — Persona creation: inline LPC preview and parallel generation

| Field | Value |
|---|---|
| **Priority** | P1 |
| **Target** | `apps/frontend/client/src/lib/views/onboarding/`, `views/character/lpc_preview/` |
| **Depends on** | — |

**Problem:** the persona flow redirects to `/dev` for LPC preview, leaking the
developer workbench into the player path. `views/character/lpc_preview/`
already exists with a Pixi facade and view model — it is not wired into
onboarding.

Generation is also slow on free-tier models and sequential.

**Scope:** embed `lpc_preview` directly in
`onboarding_appearance_step_view.svelte`; live update as slots change;
parallelize independent generation calls. Remove every `/dev` link from the
player flow (overlaps C-410).

**Acceptance shape:** persona creation completes end-to-end with no navigation
outside the onboarding route group; appearance changes reflect in the preview
without a page change.

---

# P2 — Consistency, cleanup, infrastructure

## C-409 — Shared design tokens across client, hub, site, docs

| Field | Value |
|---|---|
| **Priority** | P2 — one day of work |
| **Target** | `packages/frontend/configs`, four app `app.css` files |

**Problem:** `apps/frontend/client/src/app.css` and
`apps/frontend/hub/src/app.css` are byte-for-byte identical, both on stock
daisyUI `light`/`dark`. Site and docs are plain Tailwind with no shared tokens.
All four look like default daisyUI.

**Explicitly not in scope: removing daisyUI.** 135 of 227 client `.svelte`
files use daisy classes (~4,700 occurrences). See
`mvp-assessment-2026-08-16.md` §4.

**Scope:** one custom `@plugin "daisyui/theme"` brand palette in a shared
package; client and hub import it; the same values exported as plain `@theme`
custom properties for site and docs. Delete the duplicated stanzas.

**Acceptance shape:** one file defines the palette; all four apps render brand
colours in light and dark; no app declares its own theme colours.

---

## C-410 — Gate dev routes out of production builds

| Field | Value |
|---|---|
| **Priority** | P2 |
| **Target** | `apps/frontend/client/src/routes/(dev)/`, build config |

**Problem:** `apps/frontend/client/src/routes/(dev)/+layout.svelte` has no
guard — only an `isScreenshot` branch. All 47 sandbox routes ship to
`aikami.bearlysleeping.com`. They are a maintenance tax, they broadcast "this
is a workbench", and several expose provider and prompt internals that
directive #7 puts behind Advanced.

**Scope:** exclude the `(dev)` route group from production builds, or gate it
behind an explicit build flag. E2E and visual-testing suites must keep working
— they drive these routes heavily, so the gate must be enabled in test builds.

**Acceptance shape:** a production build contains no `(dev)` route; the E2E
suite passes unchanged against a test build.

---

## C-411 — Repository cleanup

| Field | Value |
|---|---|
| **Priority** | P2 — small, unambiguous, safe |
| **Target** | multiple |

| Item | Evidence |
|---|---|
| Delete `packages/frontend/dataconnect` | 0 `.ts` files; D-1 says remove |
| Delete `packages/frontend/firestore` | 0 `.ts` files; D-2 says remove |
| Remove their path references | `apps/frontend/client/tsconfig.test.json`, `apps/frontend/client/.fast-check/tsconfig.json`, `apps/frontend/hub/.fast-check/tsconfig.json`, `packages/frontend/storage/tsconfig.json`, `packages/frontend/services/tsconfig.json` |
| Dedupe the `appearanceLayers` builder | `game_boot_service.svelte.ts:1327-1362` ≡ `game_engine_service.svelte.ts:840-875`, including the identical magic `appearanceLayers[2] = 0; appearanceLayers[4] = 0` (see C-403) |
| `docs/contracts/PROGRESS.md` freshness | ✅ Partly resolved 2026-08-16 by running `sync_contracts.ts` — C-394/395/396 now read `👍 approved` rather than `📝 draft`. Remaining issue: all three are merged to `main` but their contract files still carry `approved`, not `completed`, so the dashboard understates reality. Decide whether `sync_contracts.ts` should run in CI or as a pre-commit hook so it cannot drift again |
| Delete `apps/backend/firebase/src/controllers/scheduler/daily.ts` | Logs a hardcoded object and returns; no behaviour (folded into C-412 if that runs first) |

**Acceptance shape:** `bun run typecheck` and `bun run test` pass; no reference
to the deleted packages remains; `PROGRESS.md` reflects `main`.

---

## C-412 — Retire Firebase Functions into the hub's Elysia API

| Field | Value |
|---|---|
| **Priority** | P2 |
| **Target** | `apps/backend/firebase/`, `apps/frontend/hub/` |
| **Depends on** | none, but do **not** run before the P0 block |

**Problem:** `apps/backend/firebase/src/controllers/` is ~150 lines of real
logic across five files — `callable/auth.ts` (39), `poll_device_handoff.ts`
(63), `auth/created.ts` (21, logs only), `auth/deleted.ts` (logs only),
`scheduler/daily.ts` (21, no-op). Supporting them costs a whole deploy target,
emulator surface, IAM configuration, and secret pipeline. The hub is already an
Elysia server on Cloud Run.

**Scope:** move `auth` and `poll_device_handoff` to hub Elysia routes; delete
the logging-only triggers and the no-op scheduler; remove the Functions deploy
stage from `scripts/src/lib/deploy/firebase.ts` and `cloudbuild.yaml`.

**Explicitly out:** Firebase Auth, Storage, FCM, App Check all stay (D-12).
This retires Functions only.

**Acceptance shape:** sign-in and device handoff work end-to-end against the
hub; no Functions deploy remains in the pipeline; emulator setup is
correspondingly simpler.

---

## C-413 — Reverse the Cloud Run inference plan (ADR amendment)

| Field | Value |
|---|---|
| **Priority** | P2 — a decision and a document, not a build |
| **Target** | `docs/architecture/data-layer-target-architecture.md`, `docs/strategy/deferred.md` |

**Problem:** the plan of record is Cloud Run for image / text / TTS / STT once
pay-as-you-go users appear. Cloud Run GPU (L4) is ~$0.71/hr with a 20–30 s
cold start for model weight load — the player waits on that for their first
line of dialogue. Self-hosted inference only wins at sustained high
utilization, which a pre-revenue project does not have.

**Decision to record:** the `service` mode of `AiProviderGateway` is a **thin
metered proxy over Anthropic / OpenAI / Gemini**, not GCP-hosted GPUs.
Directive #10 already makes this a swap at one layer.

**Scope:** an amendment to the data-layer ADR (or a new ADR if inference
hosting is judged out of its scope) recording the decision, the cost
comparison, and the conditions under which self-hosting would be revisited.
Update the corresponding line in `docs/strategy/deferred.md` from "Phase 5
work" to "rejected, see ADR".

**No code changes.** The `service` adapter interface already exists (C-320).

---

## C-414 — Standalone install script for the local stack

| Field | Value |
|---|---|
| **Priority** | P2 — low urgency |
| **Target** | `apps/backend/local-stack/`, release pipeline |

**Problem:** the no-clone path exists (`local-stack/README.md:17-24`) but
requires fetching 9 compose files and hand-authoring `.env` — worse than
cloning, so nobody will choose it. Meanwhile the documented Quick Start's step
1 is "Clone the repo", so everyone clones.

**Scope:** `curl -fsSL https://aikami.sh/install | sh` fetches the compose
files and runs the hardware wizard. Ship `stack init` as a Bun-compiled
single-file binary published with each release. Rewrite the Quick Start so the
install script is step 1 and cloning is the contributor path.

**Explicitly out:** containerizing the wizard — GPU detection from inside a
container without the NVIDIA toolkit is unreliable, and detection is the
wizard's whole purpose.

**Acceptance shape:** on a clean machine with only Docker installed, the
one-liner produces a running stack; CI exercises it.

---

# P3 — Growth

## C-415 — Character card (V2/V3) import

| Field | Value |
|---|---|
| **Priority** | P3 — highest-leverage growth item in this backlog |
| **Target** | client persona/NPC import |

**Rationale:** supporting the SillyTavern character-card PNG format plugs
Aikami into an existing library of tens of thousands of community characters on
day one. It is the cheapest way to make worlds feel populated without authoring
content, and it is a distribution lever into exactly the audience identified in
`mvp-assessment-2026-08-16.md` §5.2.

**Reference implementation to read:**
`examples/Marinara-Engine/packages/client/src/lib/character-import.ts`,
`card-asset-links.ts`, `card-version-history.ts`, `character-token-count.ts`.

**Design constraint:** an imported card is a *persona or NPC*, never a
campaign. It must compile into the existing NPC schema, including the six
ability scores — cards do not carry stats, so the import needs a defaulting or
inference step. That step is the interesting part of this contract.

---

## C-416 — Merchant UI refinement

| Field | Value |
|---|---|
| **Priority** | P3 — already the strongest screen in the build |
| **Target** | vendor view |

**Problems:** the haggle panel occupies 50% of the screen while empty ("Start a
conversation to haggle with the vendor"); every item uses a generic 📦 emoji
instead of item art.

**Preserve:** gold display, `Need 50 more` affordance on unaffordable items,
stat deltas (`+5`, `+8`, `+2`), keyboard hints (`Esc close`, `Enter send`).
These already work well.

**Scope:** collapse the haggle panel until engaged; render item icons from the
content pack.
