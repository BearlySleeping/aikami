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
- Props render on a flat dark ground so `prop-full-alpha-ground` can derive true
  alpha by luminance. An opaque light-ground render cannot be separated without a
  colour key, which is not an approved removal.
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

The atlas, the prop pages and the five maps are **outputs**. Never hand-edit the
generated JSON — edit the generator and re-run:

```bash
bun scripts/src/lib/ops/generate_emberwatch_atlas.ts
bun scripts/src/lib/ops/generate_emberwatch_props_atlas.ts
bun scripts/src/lib/ops/generate_emberwatch_maps.ts
```

### 6. Audit, scan, validate, publish

```bash
bun run emberwatch:audit                 # must report 0 blockers
bun scripts/src/lib/ops/scan_assets.ts   # refresh manifest/hashes/credits
bun run emberwatch:release --mode staging --apply
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
