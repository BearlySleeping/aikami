# Local catalog authoring workspace

The repository owns pack/map definitions. R2 owns published, content-addressed binary artifacts. A local workspace connects them without turning a partial checkout into a destructive mirror.

**Command:** `bun run --cwd scripts catalog:workspace --help`

**Implementation:** `scripts/src/lib/catalog/workspace_cli.ts`. Uses Bun's S3 client and the existing catalog configuration/uploader; no new SDK or credentials. Wrangler remains useful for individual administrative object operations; `cf` manages bucket/account configuration. Neither is a bidirectional authoring sync engine.

## Layout and ownership

```text
.local/catalog/production/               # already ignored by the root .gitignore
  current.json                          # last complete observed remote inventory
  checkout.json                         # baseline hashes of checked-out working files
  snapshots/<snapshot-sha>/
    snapshot.json
    remote/index/...                    # exact index/release documents
    remote/seed/...                     # exact seed, credits, audio metadata
  objects/assets/<prefix>/<sha>.<ext>    # verified immutable download cache
  working/
    game-data/...                       # editable asset copies; same runtime path convention
    content-packs/emberwatch/...         # published pack baseline, NOT the Git authoring source
  imports/                              # original ChatGPT PNGs / editable source art
  previews/                             # checkerboard PNGs and alpha reports
  plans/                                # deterministic upload plans + successful receipts
  status.json                           # local three-way diff
```

Staging uses `.local/catalog/staging/`. Every command requires an explicit mode; emulator is not a remote target. Snapshot binds the workspace to a mode, bucket and origin and rejects accidental target changes. Credentials come from `scripts/.env.<mode>` via the existing loader, with process environment taking precedence. Never store credentials in snapshots or plans. Restrict production credentials and use staging for write rehearsals.

Keep `content/packs/emberwatch/` as the Git-reviewed authoring source. Downloaded `working/content-packs/` is a baseline/comparison copy. **Do not copy it over the newer Git definitions.** `imports/` and `objects/` are also distinct: downloaded optimized textures are not substitutes for original editable artwork. Ignored files are not backups; back up accepted source art separately before removing a workspace.

## Snapshot and pull

```bash
# From the monorepo root:
bun run --cwd scripts catalog:workspace snapshot --mode production

# Small, useful baseline: pack manifest/maps, pack listing, terrain atlas and debug tiles.
bun run --cwd scripts catalog:workspace pull --mode production \
  --tag emberwatch --tag index --category tilesets

# Explicit selection; repeatable category/tag selectors are combined with OR.
bun run --cwd scripts catalog:workspace pull --mode production \
  --tag lpc:body --category portraits

# Optional full library hydration (many small R2 GETs, not just 61 MB of bandwidth).
bun run --cwd scripts catalog:workspace pull --mode production --all
```

`--tag emberwatch` matches `emberwatch` and `emberwatch:*`, not `emberwatcher:*`. Unknown selectors fail instead of silently doing nothing. A selection is mandatory: accidental bare `pull` cannot fetch the whole library.

A snapshot collects the **union of compact boot seed and browse shards**. It rejects conflicting tag identities, conflicting physical paths, path traversal and case-colliding paths. Multiple aliases for identical bytes are legal. Raw metadata retains attribution that the compact seed lacks.

If `index/v1/release.json` exists, use its pinned root, shard and seed keys and verify their SHA-256 digests. A malformed release is an error, not permission to fall back. With the legacy catalog, reread metadata to detect concurrent changes and label the result `legacy-observed`: this is a stable observation, **not proof of an atomic release**. Missing metadata/authentication failures abort without advancing `current.json`.

Pulls deduplicate content-addressed objects, use eight bounded workers, verify SHA-256 **and** byte length, and install downloads using temporary files plus rename. Corrupt cached bytes are fetched again. Working copies are independent copies, never hardlinks. Successful cached downloads survive interruption and are reused on retry. Content limits: 32 MiB per metadata document, 512 MiB per asset, 100,000 merged entries. Failed pulls never make unverified bytes a valid cache entry.

The small Emberwatch selection is sufficient to inspect the pack's maps/atlas. It is **not a complete offline playable installation**: LPC animations, portraits, audio and other references require their own selection or `--all`. This command does not install a pack into the player's libSQL database or override the client's installed asset lock.

## Edit, compare, inspect

```bash
bun run --cwd scripts catalog:workspace status --mode production
bun run --cwd scripts catalog:workspace inspect-image --mode production \
  --input game-data/sprites/tilesets/atlas.webp
```

Open the reported `previews/<hash>_checker.png` in an image viewer. The companion JSON reports dimensions, byte size, actual alpha presence, fully transparent pixels and partial-alpha pixels. A checkerboard painted into the artwork will remain opaque; a real transparent area shows the generated checkerboard underneath. Alpha existence alone cannot prove an image is good: inspect contours, halos, shadows and negative spaces visually.

`status` and `inspect-image` are offline. `status.json` distinguishes:

| State | Meaning / action |
|---|---|
| `clean` | Working bytes match the current snapshot |
| `modified` | Local edit; remote snapshot still matches checkout baseline |
| `new` | Local file not present in the remote snapshot/baseline |
| `missing-local` | Downloaded file removed locally; **not a remote deletion request** |
| `remote-changed` | New snapshot changed/removed the remote reference; local file still equals its old baseline |
| `conflict` | Both sides changed, or a pre-existing file collides with a first checkout |

Rerun `snapshot` to observe remote changes. `pull` fast-forwards clean files, never overwrites dirty files, and reports conflicts with a nonzero exit. Preserve your edit under `imports/` or another filename before explicitly replacing it. Deleted local files are restored by selecting them for pull; removed remote references never automatically remove local files.

For map debug, review `working/content-packs/emberwatch/maps/` against the Git source, then use the existing canonical importer/shared preview for integration. This workspace does **not** add a second map interpreter, a public file server, or an automatic replacement for the game's local asset repository. A new revision still needs real preview/game parity and offline-install testing before publication.

## Import and optimize generated images

Place the original PNG under `imports/`, then:

```bash
bun run --cwd scripts catalog:workspace optimize --mode production \
  --input emberwatch/ew_p01_oak.png \
  --output game-data/props/emberwatch/oak_01.webp --kind prop

bun run --cwd scripts catalog:workspace inspect-image --mode production \
  --input game-data/props/emberwatch/oak_01.webp
```

- `prop` requires genuine non-opaque alpha. Opaque green backgrounds are rejected, not automatically chroma-keyed.
- `terrain` permits opaque material tiles; `portrait` permits opaque portraits.
- Single-frame PNG/WebP only, maximum 64 MiB input and 16,777,216 decoded pixels.
- Lossless WebP, effort 6; preserve dimensions, visible RGB and all alpha values. Verify decoded pixels before writing. Hidden RGB under fully transparent pixels may be discarded.
- No automatic resize, trim, grid slicing, background removal, anchor inference or collision inference. These need deliberate art/metadata choices.
- Existing different output is never silently overwritten. Choose a new candidate name or move the previous candidate aside.
- Lossless WebP is a safe default for pixel art, **not a promise of smaller bytes for every input**. Compare the reported sizes; retain a smaller PNG when appropriate. Portrait/background lossy encoding needs its own visual-quality review.

See [Emberwatch redesign and prompts](../plans/emberwatch_rebuild.md).

## Sync means upload unpublished bytes—not release

```bash
# Offline dry run. Inspect the returned plans/<hash>.json.
bun run --cwd scripts catalog:workspace sync --mode production

# Only when you explicitly intend remote writes:
bun run --cwd scripts catalog:workspace sync --mode production \
  --apply --confirm-bucket aikami-catalog
```

`sync` plans only `new`/`modified` working files. Unsupported file types, symlinks and unsafe paths fail closed. Conflicts/remote changes block apply. Files outside `working/game-data/` or `working/content-packs/` cannot be uploaded. Do not put private data inside the working tree: allowed JSON is still arbitrary content and must be reviewed before upload.

Apply verifies local hashes, uploads under the existing `assets/<sha-prefix>/<sha>.<ext>` layout with immutable cache headers, and verifies the remote bytes afterward. Existing identical objects are verified and skipped; corrupt existing content addresses are errors, never overwritten. A failed apply may leave harmless unpublished objects; rerun to resume. No successful receipt is written until the whole plan finishes.

**There is no delete command and no publishing operation.** Neither index, seed nor release pointers are written. Upload does not advance the checkout baseline: these bytes are still local changes until a separately published catalog references them. Dry-run plans describe current bytes; apply regenerates/rechecks the plan rather than executing a stale plan file. Keep the workspace unchanged between review and apply.

The existing full publisher still expects complete scan manifests/hashes/credits and seed inputs. **Do not run it against this partial workspace.** This tooling deliberately does not manufacture a publishable catalog from 9 downloaded files or the 108-entry browse index. Before the Emberwatch release, reconcile all live seed coverage, credits, Git pack definitions and client release-pointer compatibility; build a complete candidate index/seed and pin the installed pack lock. Uploading an atlas by itself cannot repair pack references or game caches.

## Retire assets before considering R2 deletion

1. Preserve old pack/scene/asset-lock revisions for rollback and existing saves.
2. Build and test replacements with new hashes and stable logical frame/placement IDs.
3. Publish a complete candidate release only after all referenced assets/definitions exist.
4. Verify the release and retained old revisions through real client loading, previews and offline saves.
5. Stop referencing old artwork in the **new** revision.
6. Separately inventory every retained release/seed/pack lock and aliases before proposing garbage collection. If old installed saves can still need a revision, retain it. A local snapshot is not sufficient justification for deleting a remotely referenced object.

Never use `rclone sync --delete`, an empty-directory mirror, or “not in this browse shard” as a deletion policy. Hash aliases mean one atlas can have several tags. Prop frames embedded in an atlas are not separate R2 objects that can be individually deleted.

## Operational recovery

A local `.lock/` prevents concurrent workspace writers. After a killed process, confirm no command still owns the workspace before manually removing that lock. Do not remove it just because a download is slow. Partial temporary files are never treated as cached objects; retry failed operations. Network errors are bounded/retried, authentication errors propagate, and presigned GET URLs are not logged. Symlinks, including symlinked workspace ancestors, are unsupported.

## Baseline verified on 2026-09-11

- Production bucket: `aikami-catalog`; no remote writes performed during this setup.
- Browse index: 108 entries; compact boot seed: 12,732 entries, 61,330,132 aggregate referenced bytes before deduplication.
- `release.json` absent; legacy metadata retained verbatim and consistency warning emitted.
- Pack listing 2.1.0; published Emberwatch manifest 3.2.0; Git manifest 4.1.0.
- Old atlas: 544×272, 25,918 bytes, no alpha channel. Two seed aliases reference the same WebP hash.
- Initial pull: nine unique files (pack listing, manifest, three maps, four tileset artifacts). Status clean; dry-run plan contains no uploads/deletions.

These are observations, not hardcoded assumptions in the tool. Run a new snapshot before planning a release.
