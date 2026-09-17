# Emberwatch release-path repair — implementation notes (2026-09-16)

Status: **implementation in progress — no publish, deploy or activation has occurred. Emberwatch is not released.**

This document records the failure chain re-confirmed against the current HEAD and
the local repairs made under Prompt 1 of
`tmp/emberwatch-audit-and-execution-prompts.md`. Historical audit findings are
treated as hypotheses until reconfirmed here.

Source baseline: `cc8043f10` (matches the audit). Work branch:
`feat/emberwatch-release-repair-p1`.

## 1. Failure chain (reconfirmed)

### 1.1 Branch/promotion gap

| Branch | SHAs accessible locally | Observed manifest |
|---|---|---|
| main | `cc8043f10` | 4.4.0 |
| staging / production | not present locally | (audit: 3.2.0) |

- `.github/workflows/release.yml` does not deploy `main` on merge; web deploy
  follows staging/production pushes or explicit dispatch. A manual dispatch with
  no apps selected defaults to the client-tauri app, not the web client.
- No local staging/production branch or remote deployment receipt was readable in
  this session, so the *served* application identity remains **unverified**. The
  promotion gap is a code/workflow fact; the live build identity is not.

### 1.2 Publisher/consumer mismatch (the core defect — confirmed in code)

Confirmed producer/consumer disagreement:

- **Producer** (`scripts/src/lib/catalog/pipeline.ts`): wrote seed files under
  content-addressed keys `seed/<sha256>/<filename>` (L145 of `runSeedPublish`) and
  advanced `index/v1/release.json` (L109, L432) naming those immutable keys.
- **Consumer** (`apps/frontend/client/src/lib/services/assets/asset_store.svelte.ts`):
  fetched the **mutable legacy aliases** `seed/asset_seed.json`
  (`SEED_KEY`, L34) and `seed/offline_core.json` (`OFFLINE_CORE_KEY`, L55)
  directly — never `index/v1/release.json`.

So a successful content-addressed publication does not have to update what the
game reads. The two surfaces can drift forever.

- `scripts/src/lib/ops/local_asset_origin.ts` writes those legacy paths (L253,
  L258), so local in-game verification can pass while production publication does
  not reach the same reader. It also calls `buildPackLock` (L282) which the real
  publisher does **not** call at all — the real publisher never writes
  `index/v1/pack_lock.json`.
- The single release-aware reader in the repo is tooling-only:
  `scripts/src/lib/catalog/workspace_remote.ts#fetchWorkspaceSnapshot`
  (L169–305). No client module resolves the release pointer.

**Repair direction (implemented here):** one shared, schema-validated
release-resolution path used by *both* the client boot path and the local origin,
reading the immutable release graph and failing closed on corrupt new metadata
(legacy fallback only for a genuinely absent pointer).

### 1.3 Save/revision + offline guarantees (partly repaired — see §2.7)

- `installed_pack_lock.ts` fetched `index/v1/pack_lock.json` (L96) and memoized
  by origin, so the lock a consumer verified audio against could belong to a
  **different release** than the catalog it had just resolved — and the
  publication window (pointer advanced, alias not yet written) was observable.
  **Repaired in §2.7:** the lock is now the release graph's own hash-verified
  dependency, and the mutable alias is read only on the explicit pointer-less
  legacy path.
- The hash comparison uses **boot-seed row hashes**, not a fresh read/hash of the
  cached bytes (L130–148, `installedAudioHashes`). Registry metadata is treated
  as proof of available bytes.
- `pack_version_compat.ts#planPackVersionHydration` explicitly disclaims
  retained-revision resolution (its own comment, L9–10). It warns on version
  mismatch and redirects only when the saved map disappears.
- `docs/plans/emberwatch_rebuild.md` (L429) claims `resolveSaveRevision` +
  `installedPackRevisionStore` are "wired and tested". **Neither symbol exists
  anywhere in the tree** (`grep` returns nothing). The plan overstates the code —
  exactly the class of claim the audit warns about. This is a documented-but-
  unimplemented seam and is left explicitly **not done** rather than relabelled.
  **Still true after §2.7:** the persistent multi-revision install store was
  not implemented here; the catalog is still a single active revision and the
  store's transactional semantics (§2.7) are in-memory only.
- `apps/e2e/tests/client/emberwatch_journey.spec.ts` allows the asset origin
  during its offline phase (per the audit); reduced-network is not cold-offline.

### 1.4 Story is not an authored player choice (repaired — see §2.7)

- `quest_state_service.svelte.ts` `_completeQuest` (L1106–1118) picked the ending:
  existing `chosenEndingId`, else first ending whose `requiresWorldStateFlag` is
  set, else `endingIds[0]`. Evidence flags could therefore select a conclusion
  with no explicit player choice.
  **Repaired in §2.7:** completing a multi-ending quest's required objectives now
  parks it at an explicit resolution point, and only `chooseEnding` commits a
  conclusion. Evidence still unlocks; it never selects.
- A second, related defect was found in the same pass: `_checkTerminalCompletion`
  treated an **optional** terminal objective as a quest conclusion, so talking to
  Sella at the inn (`fading_ward` objective 2, optional) ended the whole main
  quest and skipped the wand, the old road, the shrine and the elder's final
  decision. Optional leaves are now excluded from that path (§2.7).
- Manifest 4.4.0 still carries placeholder text: two placeholder reactions and
  two placeholder truth accounts (`[PLACEHOLDER account — maintainer to author]`),
  and `evidence[*].supportsTruthId` values (`conduits_were_neglected`,
  `rollo_recovered_the_wand`, `ward_conduits_failed`,
  `thalia_concealed_the_debt`) do **not** match the `truthVariants` ids
  (`rollo_owns_the_ledger`, `thalia_owns_the_seal`).
- Side-quest mechanics underdeliver their prose (couplings checked by map entry /
  NPC interaction, not pickup; supplies checked by conversation).
  - **Reconfirmed, with one correction:** the "trail checked by re-entering a map
    the NPC already stands on" claim is **false**. `mark_the_safe_trail`'s
    objective 1 is a map entry with a prerequisite on Ada's conversation, and
    `acceptQuest` runs `_applyRetroactiveMapObjectives` after activating newly
    ready objectives — so accepting from Ada (who stands on `old_road`) satisfies
    objective 1 in the same call. No re-entry is required.
    `emberwatch_story.test.ts` locks that in.
  - The coupling/supply prose is a real over-promise (the game models no couplings
    item and no satchel), repaired by rewriting the objectives and the dialogue
    and narration lines that asserted a handover — see §2.3.

### 1.5 Catalog preservation

- `asset_hashes.json` is stale relative to the committed manifest:
  `scripts:test` → `pack index reconciliation > asset_hashes.json hashes are
  fresh for the manifest and every map` **fails** at baseline (`emberwatch:manifest`
  hash mismatch). This is a pre-existing release-pass gap, not introduced here.

### 1.6 Map transition retrigger on the old road (found in this pass)

The audit flagged the old-road arrival markers as an "immediate-retrigger risk
requiring actual entry/exit testing". The risk is real, and it is not
theoretical:

- `ZoningSystem` treats a Tiled transition object's `(x, y)` as the **top-left**
  of the trigger rectangle, centres the ECS zone entity on it, and tests the
  player's position **inclusively** against the rectangle.
- `LOAD_MAP` places the player exactly on the resolved named arrival marker
  (`_resolveSpawnInStaging`), and the walkability clamp only repositions when
  the target cell is blocked — cells (34,35) and (34,0) on `old_road` are
  collision-free.
- `old_road` authored `old_road_from_village` at `(1088,1120)` and
  `old_road_to_shrine` at `(1088,0)` — **exactly the top-left corner** of the
  `village` and `ruined_shrine` exit rectangles at those same coordinates.

So entering the old road from the village (or returning from the shrine)
spawned the player inside the outgoing zone and fired that transition on the
next tick: the player was bounced straight back and the old road — and with it
main-quest objectives 5–7 — was unreachable. The other three maps place their
arrival markers clear of their exit rectangles, which is why only `old_road`
was affected.

Repaired in the authoritative generator (`generate_emberwatch_maps_extra.ts`),
not by hand-editing the map, and guarded by a new invariant in the engine
content audit (see §2.4).

## 2. What this change set implements

Review unit 1 — **publication/consumption correctness** (Prompt 1 §A):

1. `packages/shared/schemas` release-pointer reader helper shared by producer and
   consumer surfaces where it belongs.
2. Client `release_resolver.ts` — fetch + validate `index/v1/release.json`,
   verify root/shards/seed dependencies by hash, return a release-consistent
   boot seed + offline-core. Corrupt/malformed new metadata fails closed; only a
   genuinely absent pointer takes the legacy path.
3. `asset_store.svelte.ts` resolves through the release resolver, retaining the
   legacy aliases only as the explicit, logged compatibility path.
4. Real publisher (`pipeline.ts`) writes the per-pack `index/v1/pack_lock.json`
   through `buildPackLock` and includes it in the release graph, so the client's
   audio verification has a producer.
5. `local_asset_origin.ts` serves the same release graph (release pointer +
   pinned dependency keys), not just legacy aliases.
6. A publisher→consumer integration test that builds a release into an isolated
   in-memory object store with the real `runCatalogPublish`, then loads it
   through the shared release-graph resolver — it must not depend on manufactured
   legacy `seed/asset_seed.json` paths. This does not cover the client fetch
   adapter, client error mapping, catalog parsing, or legacy fallback.

Review unit 2 — **story/evidence truthfulness** (Prompt 1 §C):

- Manifest: single authored truth (remove the second randomized variant),
  align evidence `supportsTruthId` to real truth-variant facts, and remove
  placeholder reactions/accounts. Explicit player ending choice seam.

Review unit 3 — **scene/asset binding** (Prompt 1 §D) and **release tooling/docs**
(§F): assessment + targeted fixes where the source generator (not manual map
edits) is authoritative.

Review unit 4 — **guard truthfulness** (Prompt 1 follow-up):

- `guard:all` failed on two guards, not one. `guard-source-file-size` is fixed by
  a real extraction (§2.3), and `guard-orphaned-capability` — which the earlier
  handoff reported as passing — was failing on four files of new code. Both are
  green now; the orphan remediation is §2.5.

Sections B (persistent revision store), D-full (art composition), E (asset
production) and the deployment-verification half of F require hardware,
generation budget, accepted art or remote credentials and are reported as
**unexecuted** rather than claimed.

A second pass (§2.7) repaired three correctness defects left by the first:
the consumer read the mutable pack-lock alias instead of the selected release's
pinned lock; a failed catalog refresh destroyed the previously verified catalog;
and endings resolved without the player's explicit final choice (including one
path where an optional side objective ended the whole main quest). It also
replaced a stale content-audit fixture with a structural gate (§3.2) and made
the quest-flow E2E lane runnable again (§3.3).

### 2.3 Guard repair and story correctness (this pass)

**File-size guard.** The evidence lifecycle moved out of
`quest_state_service.svelte.ts` into `quest_evidence.ts` (discovery, presentation,
the discoverable projection, and the prop/map-qualified discovery helper). The
service keeps thin delegates and one private `_evidenceContext()` accessor. The
service is 1719 lines (was 1803, baseline 1762) and its test file 1695 (was
1717, baseline 1716); both reductions are locked into
`guard_source_file_size_baseline.json` via `--update-baseline`, which only ever
shrinks an allowance.

**Story correctness, verified on the shipped pack.** `emberwatch_story.test.ts`
loads `content/packs/emberwatch/manifest.json` through the real
`ContentPackManifestSchema` and drives the real services. It proves, on the
content that actually ships:

- all three endings, with the unconditioned one resolving when no choice is
  made and each conditioned one resolving only on an explicit `chooseEnding`;
- both evidence flags, under both sampled truths (`the_ledger`/`sella_receipt`
  only under `rollo_owns_the_ledger`; `elders_seal`/`tess_component` only under
  `thalia_owns_the_seal`), with repeated presentation idempotent;
- a reload taken before the final conversation keeps a committed choice, and a
  choice made after the quest resolved is refused;
- a failed persuasion check leaves the wand unheld, so no ending resolves;
- the darkened ending needs no recruited Bram;
- all three side quests complete through their authored triggers, and every
  objective in the pack names a supported hook resolving to a real map, NPC,
  encounter or item.

**Catalog sidecar refreshed.** `content/packs/asset_hashes.json` carried three
stale pins. `emberwatch:manifest` was already stale at baseline (the known
`scripts:test` failure); the `old_road` map pin is refreshed for the regenerated
map; and the `index` pin was stale too — 407 bytes against the 402-byte
`content/packs/index.json` that `catalog_entries.ts` would publish, the same
class of defect as §1.2. All three now match the bytes on disk.

**Prose reconciled with the supported actions.** The three side quests promised
mechanics the game does not model. `tools_for_tomorrow` now asks for a report on
the waystation rather than an intact-couplings handover, `a_room_kept_warm` asks
after Tess rather than carrying a meal, and `mark_the_safe_trail`'s description
no longer claims the route is walked. The Orra/Sella dialogue and the two ending
narrations that asserted a handover were rewritten to match; no escort AI, no
item that cannot be picked up, and no LLM-decided outcome was added. The pack
hash in `content/packs/asset_hashes.json` was refreshed.

### 2.4 Map transition retrigger (this pass)

`generate_emberwatch_maps_extra.ts` now authors the two old-road arrival markers
two tiles inside the map, clear of the exit rectangles, and
`emberwatch_content_audit.test.ts` gains the invariant that no named arrival
spawn lies inside any transition rectangle on the same map. `old_road.json` was
regenerated by the generator (not hand-edited) and its hash refreshed.

### 2.5 Orphaned-capability remediation (this pass)

`guard-orphaned-capability` was failing on the new modules. Fixed by reducing
unnecessary public surface rather than by baselining real capabilities:

- `discoveredEvidenceFlag`/`presentedEvidenceFlag` and the release-resolver
  legacy key constants are module-private; the dead `RELEASE_POINTER_KEY` export
  (the schemas reader owns that key) is deleted; `isEndingUnlocked`,
  `EndingChoiceResult`, `QuestEvidenceContext` and `ReleaseResolutionSource` are
  internal, with `asset_store` now deriving `ResolvedCatalog['source']` instead
  of re-spelling the union.
- `QuestStateService.chooseEnding`/`getEligibleEndings` gained a real production
  reference: the C-495 AC-3/AC-6 test seam (`game_test_seam.ts`) now exposes the
  explicit ending choice, mirroring the existing `presentEvidence` probe, so the
  AC-6 journey can drive the production choice path.
- Three type-position-only exports (`DiscoverableEvidence`, `EligibleEnding`,
  `ResolvedCatalog`) are recorded in the guard's baseline with an explanatory
  `_comment`, the documented pattern for a public return contract the guard's
  value-position reference scan cannot see.

### 2.6 C-523 headline status reconciled

`docs/contracts/C-523-...md` carried frontmatter `status: implemented` while its
own AC table recorded AC-1/AC-2/AC-3/AC-5 partial, AC-4 pending and AC-6 not
delivered. The headline is downgraded to `in_progress` with a dated
reconciliation note. Nothing is relabelled `verified` and no release is claimed
verified while the evidence below is missing.

### 2.7 Release-path and story-correctness repair (second pass)

Three correctness defects remained after the first pass. Each is fixed in the
code it belongs to, with tests that exercise the real producer → resolver →
consumer graph rather than a client-only special case.

**The selected release's pack lock is now the one runtime verification uses.**
The first pass made the publisher write an immutable content-addressed lock and
pin it in the release pointer, but the consumer still fetched the mutable
`index/v1/pack_lock.json` alias on its own and memoized it by origin. That could
pair release N+1's catalog with release N's lock, and it observed the
publication window in which the pointer has advanced but the alias has not.
Now:

- `release_resolver.ts` identifies the lock among the pointer's **already
  hash-verified** dependencies and parses it with `InstalledPackLockSchema`; the
  resolved catalog carries `packLock` plus an explicit `packLockSource`
  (`release` | `legacy-alias` | `absent`). No extra network lookup is added.
- `asset_store.svelte.ts` retains that lock on the active snapshot.
- `verifyPackLockAudio` no longer fetches anything: it takes the lock as an
  argument and became a pure, synchronous decision. `authored_audio_cue_source`
  passes `assetStore.packLock`.
- A release that pins no lock reports `absent` and reads **no** alias; only a
  genuinely pointer-less install (HTTP 404 on `index/v1/release.json`) reads the
  mutable alias, and that provenance is logged and reported.
- A hash-valid but schema-invalid pinned lock fails resolution
  (`corrupt-release`) instead of degrading to "no lock".

Runtime evidence: with the local asset origin publishing the immutable-key shape
(`index/v1/revisions/<sha256>/pack_lock.json`), 659 origin requests across the
game and sandbox boots produced **exactly one** request for the mutable alias,
and that one came from a run whose dev server still had the pre-fix module graph
cached. No post-fix boot requested it.

**Catalog replacement is transactional.** The store previously cleared the whole
active catalog when `resolveCatalogRelease()` failed, so a failed attempt to
refresh from release N to N+1 destroyed the working release N — a real hazard,
because the persistent multi-revision install store does not exist yet (§1.3).
Now the complete candidate is resolved into locals and only then swapped in, and
a failure keeps the previous verified snapshot byte-for-byte. An initial boot
with no valid catalog still fails closed and exposes the error. `rescanAssets`
shares ONE fresh attempt among concurrent callers (a failed attempt is cleared
so it stays retryable), so two writers can never race into the same state.

**Endings are a real final player decision.** Completing a multi-ending quest's
required objectives used to resolve the quest immediately — committing the
unconditional ending when the player had made no choice — and the ending UI was
presented from quest acceptance onward. Now:

- A quest that authors **two or more reachable** endings finishes its required
  objectives into an explicit `awaitingEndingChoice` state (a serialized
  `QuestProgress` field, so a reload preserves it) instead of resolving.
- `chooseEnding()` is refused until the quest is resolution-ready, and a
  successful choice IS the resolution: it delivers rewards, commits the ending
  world-state flag, records exactly one `QuestResolved` event and journal entry,
  and is idempotent on repeat.
- Quests with nothing to choose between (no endings, a single ending, or every
  conclusion still locked) keep auto-completion. That is what the shipped side
  quests do — their one `done` ending is a completion outcome, not a decision —
  and it is why the rule keys on "more than one reachable conclusion" rather
  than on "authors any ending".
- A quest whose conclusions are all still locked is **not** parked in a state the
  player cannot leave: it resolves through the ordinary no-choice path and
  commits no ending at all. A locked ending can never be silently resolved.
- The overlay presents the ending options only in the resolution-ready state,
  prefers the resolution-ready quest when several are active, and cannot be
dismissed while the decision is pending (a hidden HUD must not be able to
  strand a quest).
- `_checkTerminalCompletion` no longer treats an **optional** terminal objective
  as a quest conclusion. That defect ended `fading_ward` the moment a player
  talked to Sella at the inn, skipping the wand, the old road, the shrine and the
  elder's final decision. Only required leaves resolve a branching path.

The quest lifecycle logic moved out of the service into two focused pure modules
(`quest_completion.ts` for the required-path/terminal-leaf predicates; the
ending rules stay in `quest_ending_selection.ts`) — the same pattern the first
pass used for `quest_evidence.ts`, and what keeps the service inside its
source-file-size baseline.

**Publisher success semantics re-checked.** `runCatalogPublish` already uploaded
immutable dependencies first and advanced the pointer last. What was wrong was
the *reporting*: the mutable compatibility alias was written through the same
failure accumulator as the immutable index objects, so a failed alias write
would have marked the whole publish failed even though the immutable release was
active. The alias now has its own outcome (`report.legacyAlias`,
`packLock.legacyAliasWritten`), is attempted only after pointer advancement, and
a failure is logged and reported as an alias failure — never conflated with
release activation. The local asset origin was aligned with production: it pins
the **immutable** lock revision and writes the mutable alias alongside it, so a
local run exercises the same graph shape the client now consumes.

**Stale content-audit fixture replaced with a structural gate.** See §3.2.

## 3. Unverified / unexecuted in this session

### 3.1 Blocked on art, budget or credentials (not attempted)

- **Old-road cart and shrine socket bindings (§D).** `waystation_cart` still
  uses `crate.png` and `ward_socket`/`shrine_arch` still use `column.png`. The
  pack's prop sources contain no cart or socket artwork, and the authored
  `shrine_arch.png` is a single 160×160 archway that would overlap the socket
  column at its current coordinate. Rebinding and repositioning are
  level-design changes whose only acceptance evidence is a native-zoom capture,
  which this environment cannot produce — a blind reposition risks the
  readability regressions the C-523 report already records. Left unexecuted
  rather than guessed.
- **`well` frame collision and `prop_alpha` pass-through (§D/§E).** Still
  blocked on the C-523 asset decision: the `well` candidate is `awaiting_review`
  and is not packed, so there is nothing to map yet. The duplicate-frame guard in
  `generate_emberwatch_props_atlas.ts` is intact and was re-run clean (one page,
  ten frames, no duplicates) — verified, not removed.
- **Persistent installed-revision store (§B).** `resolveSaveRevision` and
  `installedPackRevisionStore` still do not exist anywhere in the tree; the
  rebuild plan's claim remains false. The recoverable "install required
  revision" state is not implemented.
- **Section E asset production** (needs GPU/art/budget) and **§F deployment
  verification** (needs credentials/remote branches).
- Five-map native-zoom captures, cold-offline restart and listening evidence.
- Any asset generation, upload, activation, deploy, merge, or PR.

### 3.2 Content-audit fixture: stale expectation replaced with a structural gate

- `frontend-engine:test` → `Emberwatch content audit > pack version bumped to the
  fixture version` failed at HEAD: the fixture pinned `4.2.0` while the shipped
  manifest is `4.4.0`. The fixture's own comment recorded two previous drifts, so
  this was stale fixture data, not a code defect — but this change set touches the
  Emberwatch manifest, map generation, the content audit and the asset hashes, so
  leaving it red was not an option. It had also been **masked**: the audit file
  aborted on a missing generated atlas before reaching the assertion, so running
  the atlas generators (gitignored build output) unmasked it.
- **Fixed structurally, not by re-pinning.** The literal is gone. The test now
  compares the pack manifest's version against the entry in
  `content/packs/index.json` — the registry the client reads, whose
  `PackIndexEntry.version` is documented as "cached from manifest". A one-sided
  bump (manifest or registry) now fails, and the gate cannot go stale on the next
  bump. A semver shape assertion keeps the value a real version.
- `frontend-engine:test` requires the generated atlas. Without
  `generate_emberwatch_atlas.ts` + `generate_emberwatch_props_atlas.ts` having
  been run, the per-pack content audit cannot read `atlas.json`/`props.json` and
  reports missing-artifact failures. Environmental, not a regression — the
  generators were run for the verification in §4.

### 3.3 Pre-existing E2E staleness repaired to make the ending-flow lane runnable

`apps/e2e/tests/client/quest_flow.spec.ts` could not execute at all before this
pass, for two reasons unrelated to the ending work, both confirmed by stashing
every change in this worktree and re-running:

1. **The expanded objective card is OFF by default** (C-527 Directive 7 made the
   compact tracker the exploration default), and the whole spec drives the
   EXPANDED card. The spec now enables it explicitly with an init script instead
   of depending on a default that has already changed once.
2. **Two expectations were stale against the shipped manifest**: the authored
   text uses a typographic apostrophe (U+2019), and the "current step" assertions
   did not account for the authored OPTIONAL objectives (Sella, Mara), which come
   first in the card. Those two tests now assert on the required objective's own
   rendered state instead of on whichever objective happens to be current.

Without this, no executed evidence for the ending flow was possible. The spec's
premise is test-harness only; no product behaviour was changed to satisfy it.

## 4. Verification performed (this worktree)

Every command below was executed. `CI` is set in this shell, and moon skips
tasks with `runInCI: false` when it is — `scripts:test`,
`frontend-engine:test` and the E2E lane were therefore run with `CI` unset, and
the E2E lane additionally needed the dev-only local asset origin
(`bun scripts/src/lib/ops/local_asset_origin.ts --port 8788`), which
`.env.emulator.local` points the client at.

| Command | Result |
|---|---|
| `bun run guard:all` | **pass** — source-file-size, orphaned-capability, type-safety, mvvm, service-conventions, image-component, data-plane, test-boundary, view-model-composition (9 tasks) |
| `bun moon run client:test` | 3701 pass / 7 skip / 2 todo / **0 fail** (282 files) |
| `bun moon run schemas:test` | 883 pass / **0 fail** (55 files) |
| `bun moon run scripts:test` (`--force`, `CI` unset) | 1245 pass / **0 fail** (86 files) |
| `bun moon run frontend-engine:test` (`--force`) | 1522 pass / **0 fail** (91 files) — §3.2 fixed |
| `bun moon run client:typecheck` (`--force`) | pass — svelte-check 0 errors, 0 warnings |
| `bun moon run schemas:typecheck` | pass |
| `bun moon run scripts:typecheck` | pass |
| `bun moon run frontend-engine:typecheck` | pass |
| `bun moon run e2e:typecheck` | pass |
| `bunx biome check` on every changed file | clean |
| Playwright `client` project, `tests/client/quest_flow.spec.ts` | **8 passed** (including the new resolution-point ending flow) |
| Local-origin request log across the game/sandbox boots | 1 request for the mutable `index/v1/pack_lock.json` alias, from a pre-fix dev-server module graph; **0** after the fix |

No publish, deploy, remote write, merge or activation was performed. The atlas
generators and the dev-only local asset origin were run locally (gitignored build
output and dev state).

The changes were committed and pushed to the existing branch
`feat/emberwatch-release-repair-p1` (PR #368); the PR was **not** merged.

Status: **implementation in progress — release NOT verified. C-523 stays
`in_progress`; Emberwatch is not released.**
