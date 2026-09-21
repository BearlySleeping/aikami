# Emberwatch release runbook

**One command publishes Emberwatch.** This document is the operator front door
for the generation-to-release workflow; it replaces the ad-hoc shell transcript
that produced the 4.4.0 release.

```bash
bun run emberwatch:release --mode staging    --plan     # read-only preflight
bun run emberwatch:release --mode staging    --apply    # publish to staging
bun run emberwatch:release --mode production --plan     # compare against staging
bun run emberwatch:release --mode production --apply    # promote the same bytes
```

`--plan` makes **no remote write and no local artifact mutation**. It runs the
read-only checks and prints the steps `--apply` would take. `--apply` refuses to
start when the brief or prop table is stale, when the worktree is dirty (unless
`--allow-dirty`), or when the coverage audit reports a blocker.

## What the orchestrator drives

| Step | Component |
|---|---|
| brief rebase check | `scripts/src/lib/ops/rebase_emberwatch_brief.ts --check` |
| prop table check | `scripts/src/lib/ops/sync_emberwatch_props.ts --check` |
| candidate acceptance | `scripts/src/lib/ops/emberwatch_accept.ts --run <id> --apply` |
| terrain/grid atlas | `scripts/src/lib/ops/generate_emberwatch_atlas.ts` |
| prop atlas pages | `scripts/src/lib/ops/generate_emberwatch_props_atlas.ts` |
| canonical maps | `scripts/src/lib/ops/generate_emberwatch_maps.ts` |
| coverage audit | `scripts/src/lib/ops/emberwatch_coverage_audit.ts` |
| scan manifest + hashes | `scripts/src/lib/ops/scan_assets.ts` |
| validation | `bun moon ci --base=origin/main` |
| publish | `scripts/src/lib/catalog/publish.ts --mode <mode>` |
| verification | this file, through the public origin |

Nothing is reimplemented: the orchestrator is a dispatcher over the shipped
tools, and every step's exit code and command line is recorded in the release
report.

## The full workflow, in order

### 1. Rebase the brief onto the current source revision

```bash
bun run emberwatch:brief          # rewrites baseline + jobs from the pack
```

The brief's `baseline.commit` must name the commit the pack actually ships
from, and its `preparationProfiles` keys must be **shipped profile ids**
(`prop-native-alpha`, `prop-full-alpha-ground`, `portrait-original`,
`lpc-sheet-native`) — not symbolic aliases, which resolve to nothing.

### 2. Generate candidates

```bash
bun run --cwd apps/backend/image generate:batch \
  --manifest docs/plans/emberwatch_asset_brief.json --phase slice --plan

bun run --cwd apps/backend/image generate:batch \
  --manifest docs/plans/emberwatch_asset_brief.json --phase slice --run \
  --provider existing_sdcpp_profile_if_required_capabilities_pass
```

- **Plan first.** Plan mode makes zero generation requests and zero staging writes.
- **Slice before expansion.** The slice proves the whole path end to end.
- Each job's own `preparationProfile` is applied per job. A brief that mixes a
  prop (needs alpha extraction) with a portrait (keeps its own coverage) cannot
  be served by one global `--preparation-profile`.
- Props render with native alpha so `prop-full-alpha-ground` preserves dark object
  pixels. The ground plane must already be detached before preparation.
- Run records are durable. After a failure use `--status <runId>`, then
  `--reconcile <itemId>=no-provider-work`, then `--resume <runId>` — never delete
  job state and regenerate blindly.

### 3. Accept candidates

Acceptance is a separate, explicit decision. A candidate is installable only when
its deterministic preparation passed the machine gate.

```bash
bun run emberwatch:accept --run <runId>          # dry run: what would install
bun run emberwatch:accept --run <runId> --apply  # install + write acceptance.json
```

Rejected candidates are reported with their exact QA codes and never promoted.
The acceptance record (`<runDir>/acceptance.json`) is the lineage: item →
candidate → prepared hash → installed path.

### 4. Bind portraits

```bash
bun run scripts/src/lib/ops/install_emberwatch_portraits.ts
```

Copies accepted busts from `content/packs/emberwatch/portraits/<npcId>/<variant>.png`
into the runtime game-data plane and binds them at
`manifest.npcs[<npcId>].portraits.variants`. The client resolver
(`npc_avatar_catalog.ts`) prefers a pack portrait over the legacy generic sprite
map, so an NPC the pack has authored art for never renders as a stand-in.

### 5. Rebuild deterministic artifacts

The atlas, the prop pages, the five maps and the compact boot seed are
**outputs**. Never hand-edit the generated JSON — edit the generator and re-run:

```bash
bun scripts/src/lib/ops/generate_emberwatch_atlas.ts
bun scripts/src/lib/ops/generate_emberwatch_props_atlas.ts
bun scripts/src/lib/ops/generate_emberwatch_maps.ts
bun scripts/src/lib/ops/generate_asset_seed.ts --write
```

`asset_seed.json` is generated from the manifest and hash sidecar that
`scan_assets.ts` emits, and it is part of the candidate: the lock has a `seed`
group, so a candidate whose seed differs is a different candidate. It is
**deterministic** — the same scan inputs produce the same bytes — and its `o`
field is an explicit `--origin` argument that defaults to empty, because a
candidate is sealed once and promoted unchanged and must not embed a
mode-specific asset base URL.

### 6. Commit the generated artifacts, then reseal

`bun run emberwatch:build-candidate` runs the whole deterministic build — install
portraits and audio, regenerate the atlas and maps, rescan the manifest,
generate the boot seed — and then seals. It is **idempotent**: on an unchanged
tree it rewrites nothing, so a second run is a no-op and the seal is
reproducible.

When a content change *does* produce new artifacts, the build stops before
sealing and hands the diff back:

```text
❌ candidate source changed during build — refusing to seal.
   Review and commit the generated artifacts, then rerun:
     bun run emberwatch:build-candidate
```

That refusal is the point. Sealing from a tree that differs from the committed
source would name a `sourceCommit` that does not reproduce the sealed bytes.

```bash
bun run emberwatch:build-candidate   # build; refuses to seal if it changed tracked files
git status --short                  # review the generated diff
git add -A && git commit -m '...'   # commit it
bun run emberwatch:build-candidate   # now a no-op build, then seals
```

`scannedAt` in the generated sidecars is **metadata, not identity**: it is
preserved from the committed file when a scan finds nothing new, so an identical
scan cannot dirty the tree by the clock alone.

### 7. Audit, plan, validate, publish

```bash
bun run emberwatch:audit                    # must report 0 blockers
bun run emberwatch:release --mode staging --plan    # read-only; NO credentials needed
bun run emberwatch:release --mode staging --apply   # needs R2 write credentials
```

`--plan` resolves the target, reads the previous release, verifies the candidate
and builds the exact `ReleasePlan` **without write credentials**. Reviewing a
plan must not require the ability to execute it. `--apply` is the only path that
loads write credentials, and it re-proves that they target the same bucket and
origin the plan named — a credential set cannot retarget a publish.

#### `--plan` fails when the plan fails

`--plan` exits **0 only when every mandatory planning phase passed**:

| Phase | What it answers |
|---|---|
| coverage audit | are there blockers in the content? |
| sealed candidate verification | does this checkout still reproduce the sealed candidate? |
| staging approval (production only) | is there a verified staging release of *this* candidate? |
| base-release resolution | is the release this target is built on readable and hash-valid? |
| plan construction + validation | is the plan internally consistent and safe to apply? |

A passing coverage audit alone is **not** a passing plan. Each phase is recorded
in the release report, and any failure exits `2` with the reasons named. Plan
mode still performs no remote write and no local artifact mutation.

The two failure modes are reported distinctly, because they mean different
things:

```text
origin not provisioned    the mode has no public read origin
write credentials absent  the operator or CI cannot write to a valid target
```

#### Production promotes a staging-approved candidate

A production `--plan` and `--apply` both require a genuine staging approval,
checked **before the first production write**:

```bash
bun run emberwatch:release --mode staging --plan
bun run emberwatch:release --mode staging --apply    # writes .local/releases/receipt-staging.json
bun run emberwatch:release --mode production --plan  # refuses without that receipt
bun run emberwatch:release --mode production --apply
```

The receipt must satisfy `ReleaseReceiptSchema` and name `mode: "staging"`, the
canonical staging bucket **and** origin, `activated: true`, `verified: true`, and
the exact candidate being promoted. The staging release it names is then
re-resolved from staging's own origin through the client's hash-verifying
resolver, so a stale or superseded receipt is refused too.

Staging and production catalog **roots** are deliberately not compared: the two
environments legitimately carry different unrelated base inventory, so their
roots differ even when the Emberwatch candidate is byte-identical. Candidate
identity (`candidateLockHash`) is what must match.

#### A retry of an active release is a verified no-op

Verification compares the published pointer's **root**, not whether its digest
changed. If the pointer already names the planned root and the graph behind it
verifies, the run is a verified success — `already-active` — and the publisher
does **not** rewrite the pointer to manufacture a change. The distinguishable
outcomes are:

```text
newly-activated              the pointer now names the planned root
already-active               it already did, and the graph verifies
never-activated              no pointer is published
wrong-root-active            a pointer exists but names another root
active-graph-invalid         the pointer names the planned root; the graph does not verify
alias-degraded               the immutable release is valid; the mutable alias did not move
remote-verification-failure  the origin could not be read
```

## Guarantees the orchestrator enforces

- **The release pointer is the atomic cutover.** The publisher writes immutable
  content-addressed objects first and advances `index/v1/release.json` last. If
  any upload/index/seed/pack-lock step fails, the previous pointer stays valid.
- **Nothing is ever deleted.** Replacing Emberwatch means the pointer now names
  the new pack and assets. Old bytes stay: rollback, installed pack locks and
  existing saves may still need them.
- **The previous release pointer is read and recorded before any write**, so the
  report always names a rollback target.
- **Production promotes the exact staging-approved hashes.** Do not regenerate
  between staging and production.
- **Credentials are never printed.** Only the bucket name and public origin are.

## Release report

`.local/releases/<mode>/<timestamp>.json` records the source commit, pack
version, bucket, origin, dirty-worktree state, the previous and new release
pointer digests, and every step's command line, exit code and duration.

## Rollback

Re-point `index/v1/release.json` at the digest recorded as `previousRelease` in
the report. The immutable objects it references are still present.

## Terrains and atlas headroom

The grid atlas is a fixed **16×8 = 128 cells**. It is exactly full: 48 baked
tiles plus five `corner16` terrains × 16 masks. Adding a sixth `corner16`
terrain requires deliberately growing `ATLAS_ROWS` (and every tileset block,
`ATLAS_*` constant and test that derives from it) in one atomic change — never by
letting the painter overflow. Reuse or re-art an existing semantic terrain first.

## Known follow-ups

- The three authored hostile creatures (`ash_hound`, `cinder_thrall`,
  `ember_warden`) ship accepted source art in
  `content/packs/emberwatch/enemies/`, but the world-sprite runtime binding for a
  non-humanoid enemy is not implemented; they still render through the LPC
  humanoid path. See the release report for the exact seam.
- Ambience and SFX are a separate lane. No shipped local model serves them
  (`stable_audio_open_1_0_profile` is declared but not installed), so those jobs
  are out of scope until a provider exists.

## De-scoped: ending-state visual swaps (Emberwatch 5.0.0)

`ward_renewed`, `ward_without_magic` and `ward_shared` were authored as aligned
edits of the accepted ward-tree base (`ward_large.png`). All three failed QA:
the generation canvas clipped the large tree, so the results were not
pixel-aligned with the base and could not be swapped in without moving the
trunk, the collision footprint and the silhouette.

**Decision: de-scoped from 5.0.0, not shipped as a partial.**

The jobs are removed from `docs/plans/emberwatch_asset_brief.json` rather than
left `planned`, because a planned job is a claim that 5.0.0 ships this art. The
runtime never consumed ending art either: the `fading_ward` endings carry
`title`, `narration`, `reactionDialogueKey` and `worldStateFlag`, and no visual
binding. Removing the jobs therefore removes the only place the pack implied the
art existed.

Ending states are **narrative-only** in 5.0.0. `ward_large.png` renders
identically for every ending, and nothing in the manifest, the runtime or the
tests claims otherwise.

Re-introducing them requires a large-canvas/aligned-edit preparation that
preserves, in one pass: the same source tree, the same pixel origin, the same
trunk/collision footprint, the same overall silhouette and canvas, and only the
authored state change. An ordinary prop regeneration cannot satisfy that — the
canvas must be sized from the base rather than from a fixed tile budget, and the
result must be diffed against the base to prove alignment before acceptance.

## Immutable candidate lock

Sealing is separate from publishing. Generation, acceptance and candidate
creation happen once; staging and production then consume the lock instead of
rebuilding content differently per environment.

```bash
bun scripts/src/lib/ops/emberwatch_candidate.ts --seal     # build + write the lock
bun scripts/src/lib/ops/emberwatch_candidate.ts --verify   # re-derive and compare
```

The lock identifies content-addressed identity for every published group —
manifest, maps, terrain atlas + definition, prop-atlas pages + metadata,
portraits, enemy visuals, audio, pack data, asset seed, credits — plus the
release-plane hashes (catalog root, shards, pack lock) and the rights and
validation gate outcomes, keyed by **logical id** and folded into one
`lockHash`.

Two properties are deliberate:

- `sealedAt` and `sourceDirty` are **excluded** from `lockHash`. Two seals of
  identical content minutes apart are the same candidate, and a promotion must
  not fail because a clock moved or a scratch file was edited.
- `sourceCommit` **is** included. A different commit is a different candidate
  even when the bytes happen to match, because the next rebuild would not be
  reproducible.

The lock carries no bucket, origin or environment, and no release-plane hashes.Those belong to a `ReleasePlan`/`ReleaseReceipt`; putting them here is exactly
what would make the lock environment-specific, which is the thing it exists to
prevent. An earlier revision filled them with `""`/`{}` placeholders, which let
a content object claim to describe a published release it could not.

Promotion compares `lockHash` and, on mismatch, `diffCandidateLocks` names the
members that moved (`props/props.webp`, `maps/village.json`) rather than
reporting a boolean.

### The lock is a release artifact, not a committed file

A lock stored inside the commit it describes is circular — the commit contains
the lock, the lock contains the commit SHA, so editing the lock changes the SHA
it records. The earlier revision "solved" this by committing a lock that pointed
at an older commit, which is permanently stale the instant it is committed and
describes a source tree nobody is promoting.

The lock is therefore written to `.local/releases/candidate-<lockHash>.json`
(gitignored, alongside the existing `.local/catalog/` workspace plane) from a
**clean** committed tree. `source.commit` is then genuinely the commit the bytes
came from, and `source.tree` (`git rev-parse <commit>^{tree}`) lets anyone
re-derive the source set independently.

Sealing refuses a dirty tree. There is deliberately no `--allow-dirty`: a
candidate intended for staging or production must correspond to a committed
source state, or nobody else can reproduce it. The schema has no `sourceDirty`
field for the same reason — a field that can only hold one value is not
information.

## Audio cues: asset-backed, intentional silence, and fallback

A pack authors its music through `pack.audio.v1`. Each binding declares a
`source`, and the distinction is load-bearing:

```jsonc
// Asset-backed: real, publishable bytes. Tag AND hash are both required —
// a tag alone is availability metadata, not proof of the bytes.
{ "cueId": "village.music", "source": { "kind": "asset",
    "tag": "music:exploration:village_ward", "sha256": "22536060…" },
  "resolution": "required", "fallback": "declared_cue", "fallbackCueId": "bed.explore" }

// Intentional silence: no bytes exist and none are claimed.
{ "cueId": "bed.explore", "source": { "kind": "silence" },
  "resolution": "optional", "fallback": "silence" }
```

A SHA-256 is an assertion about immutable bytes, so a binding may only carry one
when those bytes exist. A cue the pack leaves silent has no asset identity; it
must not name a tag or pin a hash for content that was never produced. The
schema makes the dishonest shapes unrepresentable rather than merely
discouraged:

| Shape | Result |
|---|---|
| `required` + real bytes | valid |
| `optional` + real bytes | valid |
| `optional` + silence, no asset identity | valid |
| `required` + silence | **invalid** — nothing could ever satisfy it |
| silence source carrying a `tag` or `sha256` | **invalid** — asserts nonexistent bytes |
| asset source missing its `sha256` | **invalid** |

The two shared fallback beds (`bed.explore`, `bed.combat`) are intentional
silence. They previously pinned hashes for audio that exists nowhere in the
repository or the runtime plane — a claim the content model could not keep.

**Fallback chains still terminate correctly.** `village.music` → `bed.explore`
→ silence: when the primary cue cannot resolve, the declared fallback is
consulted, and a silence fallback resolves to silence without looking for
renditions. A silence binding can never be `required` and can never declare a
`declared_cue` fallback, so a chain cannot be built that promises bytes it does
not have.

The installer proves coverage **before its first write**: every asset-backed
binding must have a corresponding installer source entry, and every cue is
resolved (pin-checked) before any cue is copied. `--check` compares destination
**bytes**, not existence.

## Visual validation: a required HUMAN gate (level C)

The release has two independent gates, and they must not be conflated:

| Gate | What it proves | Who runs it |
|---|---|---|
| Programmatic | every reference resolves, every landing is walkable, the candidate matches the source | CI (`bun moon ci --base=origin/main`, `scripts:automation-unit`, `client:test-browser`) |
| **Visual** | the maps actually *look* right | **a human, on a GPU-capable browser** |

This PR deliberately does **not** claim a programmatic visual gate. The
headless lanes available in CI do not provide working WebGL for the PixiJS
render path — that has been established repeatedly, and re-testing headless
flags is not a productive use of a release pass. So the visual gate is level C
of the three options (existing CI lane / explicit GPU Playwright lane /
documented human acceptance): **documented human acceptance**.

### The human checklist (run before `--apply` on any remote mode)

Boot the client from the candidate commit and walk all five maps. Confirm:

- **Terrain** — grass/dirt/path/water read as distinct surfaces; no
  fallback-grass squares where a terrain should be.
- **Large props and buildings** — the inn, shop, smithy, cottages, ward tree and
  gate render at their authored footprints; nothing floats or sinks.
- **Occlusion** — the ward-tree canopy draws over the player; building roofs
  draw over actors inside them.
- **Water and bridges** — the stream reads as water and is impassable; the stone
  bridge is the only dry crossing.
- **NPC appearance** — every story NPC renders as an authored LPC composition,
  not a generic humanoid stand-in.
- **Portraits** — every dialogue bust resolves, with `neutral` as the fallback
  for an unavailable expression.
- **No missing frames** — no magenta/blank placeholder tiles or sprites.
- **Static hostile visuals** — `ash_hound`, `cinder_thrall` and `ember_warden`
  render as their authored art, not as LPC humanoids.
- **All eight transitions** — walk each of the eight edges; each lands on a
  walkable cell, does not re-trigger, and does not bounce back.

Record the result in the release report. A programmatic green is NOT a visual
green, and this section exists so that distinction cannot be quietly lost.

## First production release: migrating the legacy mutable catalog

Production has never published an immutable release — `index/v1/release.json` is
a legitimate 404. What it serves is the pre-C-496 mutable surface:

| Legacy object | Contents |
|---|---|
| `index/v1/catalog.json` | root index, 108 entries across 6 categories |
| `index/v1/<category>.json` | one mutable shard per category |
| `seed/asset_seed.json` | the compact boot seed — **12,729 rows** |
| `seed/offline_core.json` | the prefetch/pin tag set |
| `index/v1/pack_lock.json` | the mutable installed-lock alias |

The boot seed carries the complete asset inventory; the root index carries only
the 108 entries the publishing checkout happened to hold. This checkout holds
fewer still (C-435 de-bundled the raw library).

So the **first** immutable production release is a migration, not an ordinary
publish. Rebuilding the graph from the local scan alone would replace a
12,729-row boot seed and a 108-entry index with the local subset — every LPC
sheet, legacy portrait and audio bed an existing installation resolves would
vanish, and the publish log would read "74 uploaded, 0 failed".

### Review it before it runs

```bash
bun run emberwatch:legacy-bootstrap --mode production
```

Read-only. It prints what would be carried, replaced, dropped or rejected, and
writes nothing. The target goes through the same fail-closed release-target gate
the publisher uses.

### What it does

1. Reads the legacy root and **every shard it declares**, validating each against
   `CatalogIndexRootSchema` / `CatalogIndexShardSchema`. A shard whose entry
   count disagrees with the root's declaration is a refusal.
2. Reads the legacy boot seed and validates it as a compact seed document.
3. **Fails closed on an identity conflict**: if the legacy index and the legacy
   seed disagree about a tag's hash, the legacy state has no single answer and
   picking one would be a guess about which bytes an installation resolves.
4. Converts the legacy entries and seed into the SAME `CatalogAssetEntry[]` and
   carried-dependency map the ordinary verified-release carry-forward produces.
   Everything downstream — merge, shard, root, pointer — is the normal pipeline.
   There is no second catalog architecture.
5. Unions the legacy seed rows with the candidate's, exactly as the index unions
   the legacy entries. A local row wins for its own tag.

A legacy object that cannot be read, parsed or schema-validated is a refusal,
not a skip. Optional objects (`offline_core.json`, `pack_lock.json`) that fail
validation are reported as `rejected` and named, never silently used.

### It is not permanent

It runs **only** when the target publishes no release pointer. The moment a
verified immutable release exists, `resolvePreviousRelease` answers and the
ordinary carry-forward path takes over. A test asserts that a legacy-only tag
does not appear in a release published over an existing verified release.

## Staging is blocked on a HUMAN infrastructure action

The code correctly refuses the current staging environment. It is not
provisionable from this repository:

```
❌ release target refused — nothing was written.
   CATALOG_BUCKET="aikami-catalog" disagrees with the bucket declared for mode
   "staging" ("aikami-staging-catalog").
```

`CATALOG_ORIGINS.staging.originUrl` is `null` **on purpose**: there is no public
read origin for `aikami-staging-catalog`, and inventing one — or pointing
staging at production to unblock testing — would make every staging
verification a lie. A null origin fails closed with a message naming the bucket
to provision; it is never a fallback.

To unblock staging, a human must:

1. Create a public R2 custom domain (or Worker route) for the
   `aikami-staging-catalog` bucket. This needs Cloudflare DNS/API credentials;
   the available token is bucket-scoped R2 only.
2. Record the resulting URL in `CATALOG_ORIGINS.staging.originUrl`
   (`packages/shared/constants/src/lib/infrastructure.ts`).
3. Correct `CATALOG_BUCKET` to `aikami-staging-catalog` and set
   `CATALOG_ORIGIN_URL` to the new origin, in `secrets/staging.enc.env` and the
   generated `scripts/.env.staging`.

Do not edit the encrypted secrets bundle by hand — use the repository's
canonical secret-editing workflow once the real value is known.
