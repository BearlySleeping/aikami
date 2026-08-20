# Object Storage Layout — Buckets, Keys, and Enforcement

**Status:** draft for review
**Created:** 2026-08-20
**Extends:** `data-layer-target-architecture.md` (D-13, D-14, I-3, I-7)
**Implements today:** C-395 (catalog origin), C-396 (browse)
**Blocks:** C-397 (on-demand assets), C-398 (submissions)

---

## 0. What already exists

Verified in-repo 2026-08-20. Do not rebuild any of this.

| Thing | Where | State |
|---|---|---|
| Bucket `aikami-catalog` (WEUR, Standard) | Cloudflare | live |
| Custom domain `assets.bearlysleeping.com` | Cloudflare | live |
| `assets/<sha[0:2]>/<sha><ext>` | `scripts/src/lib/catalog/content_address.ts` | live |
| `thumbnails/<sha[0:2]>/<sha>.webp` | `scripts/src/lib/catalog/thumbnail_generation.ts` | live |
| `index/v1/catalog.json`, `index/v1/<category>.json` | `scripts/src/lib/catalog/index_generation.ts` | live |
| Strict TypeBox index schemas | `packages/shared/schemas/src/lib/catalog/catalog_index.ts` | live |
| `CLOUD_FLARE_CATALOG_BUCKET_*` / `…_DIST_BUCKET_*` / `…_UPLOADS_BUCKET_*` write credentials | `scripts/.env.*`, GSM | live |
| Read-side validation + TTL cache | `apps/frontend/hub/src/lib/server/catalog/catalog_index.ts` | live |

What is **not** yet placed anywhere: community submissions, first-party
content packs, local-stack model checkpoints, and user database backups.
Those are what this document adds.

---

## 1. The organizing principle

**Split buckets by access posture, not by content type.**

The load-bearing fact is a Cloudflare limitation, not a preference: **an R2 API
token scopes to a bucket, not to a prefix.** There is no R2 equivalent of an
AWS IAM policy with a resource ARN like `arn:aws:s3:::bucket/uploads/*`. A
token that can write `uploads/` in `aikami-catalog` can also write
`index/v1/catalog.json` in `aikami-catalog`.

That single fact decides the layout. The hub must be able to hand a member a
presigned upload URL (C-398), which means the hub holds a write credential. If
uploads were a prefix of the catalog bucket, the hub's credential would be a
credential to overwrite the published catalog index — a direct violation of
I-7. Separate buckets make it a scoping decision instead of a code-review
promise.

> **Verify before provisioning:** confirm in the R2 dashboard that token
> scoping is still bucket-level only. If Cloudflare has added prefix
> conditions since, the uploads bucket could collapse into a prefix — but the
> other three reasons below (metrics, lifecycle, licence isolation) still
> favour separation.

Secondary benefits that fall out of the same split:

- **Metrics.** Cloudflare reports storage and ops per bucket. Mixing a 12,713-object catalog with multi-GB model weights makes both bills unreadable.
- **Lifecycle.** Catalog objects are permanent. Staged uploads expire in days. Model mirrors get pruned when a tier is retired. One lifecycle rule per bucket beats prefix-conditional rules.
- **Licence isolation.** Some mirrored model weights carry restrictive terms (`circlestone-labs-non-commercial-license`, `CreativeML OpenRAIL-M`). Pulling one must never risk touching the catalog.

---

## 2. The four planes

| Plane | Store | Public? | Written by | Contains |
|---|---|---|---|---|
| **Catalog** | R2 `aikami-catalog` | yes, `assets.bearlysleeping.com` | publish pipeline, moderation job | first-party + approved community asset bytes, thumbnails, indexes |
| **Intake** | R2 `aikami-uploads` | **no** | hub (presigned PUT only) | unreviewed member submissions, quarantined |
| **Distribution** | R2 `aikami-dist` | yes, `dl.bearlysleeping.com` | mirror job | permissively-licensed model checkpoints, optional release mirror |
| **Player-owned** | Firebase Storage | no, `isOwner(uid)` | the client, directly | encrypted database backups, save blobs, avatars |

One sentence you can hold in your head:

> **Public content bytes go to R2. Player-owned bytes go to Firebase Storage.
> Nothing unreviewed is ever in a public bucket.**

That is a smaller rule than a single bucket carrying two security models would
need, which answers the "won't multiple buckets be confusing?" worry — the
split reduces the number of rules, it does not add one.

---

## 3. `aikami-catalog` — the public plane

```
r2://aikami-catalog/

  assets/<sha256[0:2]>/<sha256><ext>            immutable · 1y
  thumbnails/<sha256[0:2]>/<sha256>.webp        immutable · 1y

  index/v1/catalog.json                         mutable   · 60s   root
  index/v1/<category>.json                      mutable   · 60s   first-party shard
  index/v1/lpc__<fragment>.json                 mutable   · 60s   split shard

  index/v1/packs.json                           mutable   · 60s   pack registry
  index/v1/packs/<owner>/<slug>/latest.json     mutable   · 60s   version pointer
  index/v1/packs/<owner>/<slug>/<semver>.json   immutable · 1y    version manifest
```

Everything above `index/` already exists. The `packs/` subtree is the addition.

### 3.1 Community assets do not get their own prefix

A community asset is bytes plus provenance. The bytes are indistinguishable
from first-party bytes and belong in the same `assets/` namespace. Giving them
`community/assets/…` would fork the resolver, duplicate the cache
configuration, and — worst — break deduplication: two members uploading the
same LPC recolour must resolve to one object, and content addressing gives
that for free only if they share a namespace.

**What differs between first-party and community content is the index, not the
storage.** Ownership, moderation state, ratings and install counts live in
Postgres (D-14). The bucket stays a dumb content-addressed store.

### 3.2 Packs are the unit of community content

The `PackSummary` / `PackVersion` schemas from C-394 already exist. Make first-party
content a pack too, published through the same pipeline: `emberwatch` and
`whispering-caves` (today loose JSON under `static/content-packs/`) become
`aikami/emberwatch@1.0.0` and `aikami/whispering-caves@1.0.0`. One mechanism,
no special case.

Two details worth getting right:

- **Owner-scoped slugs.** `<owner>/<slug>` prevents two members claiming `dark-forest`. First-party packs use the reserved owner `aikami`.
- **Versions are immutable, the pointer is not.** `<semver>.json` may never be republished, so it earns a 1-year cache. Only `latest.json` and `packs.json` are short-cached. This keeps the per-request cost of browsing a pack at one 60s-cached pointer fetch, not a full document refetch.

### 3.3 The invariant this bucket must hold

> **Nothing enters `aikami-catalog` that is not intended to be world-readable
> forever.**

Every object here is reachable at a stable URL with no credential. sha256 is
unguessable, so an unindexed object is not *discoverable* — but "obscure" is
not "private", and the hash of anything indexed is published by definition.
This is why intake is a different bucket rather than an unindexed prefix.

---

## 4. `aikami-uploads` — the intake plane

```
r2://aikami-uploads/                            NO custom domain · NO public access

  staging/<accountId>/<submissionId>/<filename>     expire after 14d
  quarantine/<sha256>                               objects held pending review
```

Flow for C-398:

1. Member authenticates to the hub. Hub checks quota and rate limit against Postgres.
2. Hub mints a **presigned PUT** scoped to one key in `aikami-uploads`, with a content-length range and content-type condition. Bytes never traverse the hub — I-7 holds.
3. Client PUTs directly to R2. Hub records the submission row.
4. Validation job hashes, scans, and checks the takedown denylist.
5. On approval, a **moderation job** (not the hub) issues a server-side `CopyObject` into `aikami-catalog` under `assets/<sha[0:2]>/<sha><ext>`, then regenerates the pack manifest. No bytes move across the network.
6. A lifecycle rule expires `staging/` after 14 days regardless of outcome.

Credential scoping that this makes possible:

| Holder | Token scope | Permission |
|---|---|---|
| Hub (Cloud Run) | `aikami-uploads` only | object write (for presigning) |
| Moderation job | `aikami-uploads` read + `aikami-catalog` write | object read/write |
| Publish pipeline | `aikami-catalog` only | object write |
| Mirror job | `aikami-dist` only | object write |

Four credentials, each unable to damage the others' plane. With one bucket this
table collapses to one all-powerful key.

### 4.1 Takedown, and the denylist you cannot skip

C-395 states objects are never deleted. That has to be amended for community
content: a DMCA or illegal-content takedown requires a hard delete, and any
older index referencing the object will then 404. That is what takedown means
and is acceptable.

The non-obvious hazard: **content addressing makes takedown reversible by
accident.** Re-uploading the identical bytes produces the identical key, which
silently resurrects the object. So a takedown must write the hash to a
`takedown_hashes` table in Postgres, checked at step 4 above *before*
promotion. Without it, deletion is theatre.

Restate the invariant as: *objects are never deleted by a publish run.
Deletion is a deliberate moderation action, and always accompanied by a
denylist entry.*

---

## 5. `aikami-dist` — models and releases

### 5.1 Do not mirror model weights by default

`apps/backend/local-stack/src/models.manifest.json` currently pins each entry
to a HuggingFace `repo` + `revision` + `file` with a sha256, and the fetcher in
`src/lib/fetch_models.ts` verifies it. That is a good design and should stay
the primary source:

- HuggingFace pays the egress and serves it well.
- Revision pinning already gives reproducibility.
- **Redistribution is a distinct legal act from linking.** Several manifest entries carry `requiresAcknowledgement: true` under non-commercial or OpenRAIL-M terms. Serving those bytes from your own domain changes your exposure. Storage cost is negligible (~$0.015/GB-month, so even 50 GB is under a dollar) — the licence is the blocker, not the bill.

**Mirror only entries whose licence unambiguously permits redistribution**
(Apache-2.0 — Qwen, Mistral-Nemo, Silero). Leave the rest HuggingFace-only.

### 5.2 Make the manifest multi-source

Change `ManifestEntry` from one source to a priority-ordered list — the same
pattern `asset_sources` already uses in the local SQLite schema
(`packages/frontend/storage/src/lib/migrations.ts:199`). The fetcher walks the
list until one succeeds; sha256 verification is unchanged, so a mirror can
never serve wrong bytes undetected.

```ts
sources: readonly (
  | { backend: 'huggingface'; repo: string; revision: string; file: string }
  | { backend: 'r2'; key: string }
  | { backend: 'url'; url: string }
)[];
```

This turns the mirror into a fallback for HuggingFace rate limits rather than a
dependency, which is the only role it should have.

### 5.3 Layout

```
r2://aikami-dist/                               dl.bearlysleeping.com

  models/hf/<owner>/<repo>/<revision>/<path>    immutable · 1y
  models/url/<sha256[0:2]>/<sha256><ext>        immutable · 1y   archive-kind entries
  models/manifest/v1/models.json                mutable   · 60s
```

Note the deliberate inconsistency: models mirror **HuggingFace's own
addressing** rather than being content-addressed like the catalog. The reason
is auditability — "is this mirror still in sync with upstream?" becomes a
trivial path comparison instead of a hash-table join. The sha256 is still
verified on download, so nothing is lost on integrity. Entries with no
upstream repo (archive-kind, direct URL) have no path to mirror and fall back
to content addressing.

### 5.4 Releases: keep them on GitHub

The local-stack installer and the Tauri updater both read GitHub Releases
today (`releases/latest/download/latest.json`). GitHub serves release assets
free and unmetered. Moving them to R2 buys a custom domain and costs a second
publish path — a bad trade.

**Do, however, delete the Firebase Storage `tauri-releases/` path.** It is a
third copy of artifacts whose real home is GitHub, and the storage rules still
grant it public read. Dead surface with a public read grant is worth removing
on its own.

If GitHub rate limits ever bite, add `releases/<app>/<version>/<platform>/…`
to `aikami-dist` as a secondary source in the same multi-source style as 5.2.

---

## 6. Player-owned data — Firebase Storage, encrypted client-side

### 6.1 Why not R2

D-13 already settled this, and the reasoning survives re-examination:

**R2 has no identity model.** To grant "only this user can read this object"
you must mint a presigned URL per request from a server that holds an R2
credential. For backups, that server would be the hub — and I-3 says the hub
never reads, writes, or proxies player-owned data. You would need a fourth
service existing solely to broker R2 credentials for user files.

Firebase Storage gives you `isOwner(uid)` from a rules file that is already
deployed and already tested, with no server in the path at all.

**The cost argument that justified R2 for the catalog inverts here.** R2 won
D-13 on free egress, worth roughly $112/month per 10,000 full-library
downloads of a 93 MB catalog. A user database backup is a few MB, downloaded
on device migration and restore — call it twice a year. Free egress on a
workload with almost no egress is worth nothing.

### 6.2 Layout

```
firebase-storage://

  backups/{uid}/db/<iso8601>.sqlite.gz.enc      owner-only · client-encrypted
  backups/{uid}/db/latest.json                  owner-only · pointer + KDF params
  saves/{uid}/…                                 owner-only (exists)
  users/{uid}/…                                 avatars etc. (exists)
  npcs/{uid}/{npcId}/…                          public read (exists)
```

Rules addition:

```
match /backups/{uid}/{allPaths=**} {
  allow read, write: if isOwner(uid)
                     && request.resource.size <= 100 * 1024 * 1024;
}
```

The size cap is not optional — without it one account can fill the bucket.
Add a GCS age-based lifecycle rule on the underlying bucket, and have the
client prune to the newest N generations after a successful upload.

### 6.3 Storage rules are authorization, not confidentiality

`isOwner(uid)` stops another *user* reading the blob. It does not stop Google,
and it does not survive a compromised service account. Given the ADR already
cites "changing the BYOK privacy posture by accident" as grounds to reject
Turso cloud sync, a plaintext backup would reintroduce exactly that problem
through the side door.

**Encrypt client-side, before upload, with a key the server never sees.**

Pipeline, in this order:

1. `VACUUM INTO` a temp file — never upload a live SQLite file with a hot WAL.
2. gzip. **Compress before encrypting** — ciphertext does not compress.
3. Generate a random 256-bit DEK. AES-GCM the bytes with it.
4. Derive a KEK from the user's passphrase. Wrap the DEK with the KEK.
5. Upload `ciphertext`; upload `latest.json` carrying the wrapped DEK, salt, IV, KDF name and parameters.

Envelope encryption (rather than encrypting directly under the passphrase) is
what makes a passphrase change a re-wrap of 60 bytes instead of a re-upload of
the whole database.

### 6.4 Two corrections to the existing vault, if you reuse it

`apps/frontend/client/src/lib/utils/crypto_vault.ts` is a reasonable starting
point — AES-GCM, PBKDF2, per-origin salt. Two things must change for a blob
that leaves the device:

- **Iterations.** It uses PBKDF2-SHA256 at 100,000. Current OWASP guidance for PBKDF2-HMAC-SHA256 is 600,000. On-device localStorage at 100k is defensible; a blob sitting on someone else's infrastructure is a different threat model. Use 600,000, or Argon2id if you'll take the wasm dependency.
- **No fingerprint fallback.** The variant at `src/lib/views/utils/crypto_vault.ts` derives a key from a machine fingerprint when no PIN is set, which means for those users the key is not secret. For a cloud backup a passphrase must be **mandatory** — no fallback, no default.

The consequence is honest and must be said in the UI: a lost passphrase means
an unrecoverable backup. Issue a printable recovery code at setup that wraps a
second copy of the DEK.

### 6.5 What's actually in the file

Worth noting, since it drove the question: **API keys are not in Turso today.**
They live in localStorage under `aikami_vault` via `config_service.svelte.ts`,
and the local SQLite schema has no key-bearing table. So the backup does not
currently carry secrets.

That is a fact about today, not a guarantee. Define the backup set explicitly
in a schema with a `sensitive` marker per table, so that moving connections
into SQLite later is a conscious decision that trips a review rather than a
silent change in what gets uploaded.

---

## 7. What stays out of object storage

| Thing | Size | Verdict |
|---|---|---|
| `static/ort/*.wasm` | 76 MB (4 × ~19 MB) | **Trimmed and offloaded to `aikami-dist`.** Open Question 5 resolved 2026-08-20: the client uses exactly one `import('onnxruntime-web/webgpu')` path (`kokoro_worker.ts:116`), which is JSEP-enabled and fetches **only `ort-wasm-simd-threaded.jsep.wasm`** — for both the WebGPU and WASM fallback backends. The `asyncify` / `jspi` / base `simd-threaded` variants (50 MB) were verified dead and removed. The remaining `jsep.wasm` (26 MB) is served from `aikami-dist` at `models/ort/<ort-version>/` (dl.bearlysleeping.com) and fetched at TTS init — TTS is installed on demand, so nothing bundles. The client points `wasmPaths` at `PUBLIC_ORT_WASM_URL`, falling back to the app's own `/ort/` when unset. |
| `static/game-data/maps/`, `sprites/tilesets/` | 28 KB + | **Stays out**, as C-395 already decided — dev-only sandbox files, not scan categories. |
| `static/*.png`, `favicon*`, `og-image.jpg` | ~660 KB | **Stays bundled.** App chrome, versioned with the build. |
| `static/assets/npc/*.webp` | small | **Move to a pack.** These are content (Aragon, Gandalf, orc, troll portraits) that happen to live outside the six scan categories. Publish them as part of the first-party pack rather than inventing a seventh category. |
| Release artifacts | — | **GitHub Releases**, per §5.4. |

The three `game-data` sidecars — `manifest.json` (6.9 MB), `asset_credits.json`
(6.1 MB), `lpc_credits.json` (5.4 MB) — are C-397's problem, not this
document's, but note they are 18 MB of JSON the client parses at boot and the
catalog index already carries the same credit data in shardable form.

---

## 8. Enforcing the layout in schemas

Yes — and the strong version is worth building, because the failures this
prevents are the expensive ones (user data in a public bucket; an index
published with a one-year cache).

The principle: **an object key is never a string literal. It is a value
produced by a builder, carrying a type that names its bucket.**

New module `packages/shared/schemas/src/lib/storage/`, exported through
`@aikami/schemas` alongside the existing `catalog/` schemas.

### 8.1 Branded key types

```ts
declare const brand: unique symbol;
type Branded<T, B extends string> = T & { readonly [brand]: B };

export type CatalogObjectKey = Branded<string, 'catalog'>;
export type UploadObjectKey  = Branded<string, 'uploads'>;
export type DistObjectKey    = Branded<string, 'dist'>;
```

### 8.2 One pattern, one definition

The regex is the layout. Nothing else may restate it.

```ts
const SHA256 = '[a-f0-9]{64}';

export const CATALOG_KEY_PATTERNS = {
  asset:     `^assets/[a-f0-9]{2}/${SHA256}\\.[a-z0-9]+$`,
  thumbnail: `^thumbnails/[a-f0-9]{2}/${SHA256}\\.webp$`,
  indexRoot: '^index/v1/catalog\\.json$',
  indexShard:'^index/v1/[a-z0-9_]+\\.json$',
  packLatest:'^index/v1/packs/[a-z0-9-]+/[a-z0-9-]+/latest\\.json$',
  packVersion:'^index/v1/packs/[a-z0-9-]+/[a-z0-9-]+/\\d+\\.\\d+\\.\\d+\\.json$',
} as const;

export const CatalogObjectKeySchema = Type.Union(
  Object.values(CATALOG_KEY_PATTERNS).map((pattern) => Type.String({ pattern })),
);
```

### 8.3 Builders are the only constructor

```ts
export const catalogAssetKey = (options: { hash: string; ext: string }): CatalogObjectKey => { … };
export const packVersionKey  = (options: { owner: string; slug: string; version: string }): CatalogObjectKey => { … };
```

`scripts/src/lib/catalog/content_address.ts` already does exactly this,
including rejecting a non-sha256 hash before it reaches a bucket key. Move it
into the schema package and give it a return type instead of `string`.

### 8.4 Bind key type to bucket at the call site

This is the part that turns a convention into a compiler error.

```ts
type KeyForBucket = {
  catalog: CatalogObjectKey;
  uploads: UploadObjectKey;
  dist:    DistObjectKey;
};

export const putObject = async <B extends keyof KeyForBucket>(options: {
  bucket: B;
  key: KeyForBucket[B];
  body: Uint8Array;
  contentType: string;
}): Promise<void> => { … };
```

Passing an upload key to the catalog bucket no longer type-checks. That is a
cheaper guarantee than any amount of review.

### 8.5 Derive Cache-Control from the key — never accept it as a parameter

```ts
export const cacheControlFor = (key: CatalogObjectKey): string =>
  key.startsWith('assets/') ||
  key.startsWith('thumbnails/') ||
  /\/\d+\.\d+\.\d+\.json$/.test(key)
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=60';
```

The failure this closes is real and painful: an index published with a
one-year immutable cache is stuck in every client cache for a year, and R2
cannot un-send it. Removing the caller's ability to choose removes the bug.

### 8.6 Two more layers

- **Lint gate.** `.pi/runners/convention_gate.ts` already exists. Add a rule rejecting bare string literals matching `^(assets|thumbnails|index|models|staging)/` anywhere outside `packages/shared/schemas/src/lib/storage/`. This catches the case where someone reimplements a key by hand rather than importing the builder.
- **Runtime `Value.Check` on both sides.** Already the pattern in `catalog_index.ts` (read side) and worth mirroring on the write side, so the publish pipeline validates the document it is about to make canonical rather than trusting its own generator.

---

## 9. Sequencing

| # | Step | Depends on |
|---|---|---|
| 1 | Create `aikami-uploads` (private, no domain, 14d lifecycle on `staging/`) | — |
| 2 | Create `aikami-dist` + `dl.bearlysleeping.com` | — |
| 3 | Issue four scoped tokens per §4 table; retire any all-buckets token | 1, 2 |
| 4 | Extract `packages/shared/schemas/src/lib/storage/` from `content_address.ts`; add branded types, patterns, `cacheControlFor` | — |
| 5 | Retype the publish pipeline against the branded keys | 4 |
| 6 | Add the convention-gate rule | 4 |
| 7 | Add `index/v1/packs/…` generation; republish `emberwatch` + `whispering-caves` as first-party packs | 4, 5 |
| 8 | Multi-source `ManifestEntry` + mirror the Apache-2.0 model entries | 2, 3 |
| 9 | Backup rules block, envelope encryption, KDF upgrade, recovery code | — |
| 10 | Delete Firebase Storage `tauri-releases/`; plan retirement of the legacy `lpc/` `music/` `sprites/` copies once C-397 proves the R2 path | C-397 |

Steps 4–6 are the highest leverage and depend on nothing. Do them before
provisioning anything, so the first object written to a new bucket is written
through the typed path.

---

## 10. Open questions

1. **Prefix-scoped R2 tokens.** **Resolved 2026-08-20.** `cf r2 temporary-credentials create --prefixes …` yields credentials scoped to a bucket **and** a prefix (bucket + prefix + permission + TTL). These are the right mechanism for the hub to mint per-request presigns for `aikami-uploads` (C-398). The long-lived publish/mirror tokens are still separate per-bucket R2 API keys (dashboard-created, bucket-scoped), so the split in §4 still stands — the doc's other reasons (metrics, lifecycle, licence isolation) hold regardless.
2. **Pack registry growth.** `index/v1/packs.json` has the sharding problem the root catalog index already hit. Fine while pack count is small; decide the shard axis (first letter? owner?) before it isn't.
3. **Submission size ceiling.** The presigned PUT needs a content-length range. Pick a number tied to the R2 free tier (10 GB storage, 1M Class A ops/month) and to what a reasonable pack weighs.
4. **Argon2id vs PBKDF2-600k** for the backup KEK — a wasm dependency in the client against a meaningfully better KDF.
5. **Does anything actually load all four `ort` wasm variants?** **Resolved 2026-08-20: no.** One `import('onnxruntime-web/webgpu')` path (JSEP-enabled) loads only `jsep.wasm`. Trimmed `static/ort/` to `jsep.wasm` only (76 MB → 26 MB). See §7.
