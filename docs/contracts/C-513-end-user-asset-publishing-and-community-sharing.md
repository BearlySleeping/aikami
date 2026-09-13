---
id: C-513
title: "End-User Asset Publishing and Community Sharing"
source: "direct — user request to streamline and publish locally created assets for end users"
contract_type: full
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-12T00:00:00Z"
---

# Contract C-513: End-User Asset Publishing and Community Sharing

## Metadata

| Field | Value |
|---|---|
| **Source** | Direct request — "streamline and publish it for end user that wants to create their own assets." Modeled on the C-508 community-map publish flow. |
| **Target** | `packages/backend/database/src/lib/schema.ts` (D1 drafts/assets/moderation), `apps/frontend/hub/src/lib/server/api/` (asset publish/browse routes), `apps/frontend/hub/src/lib/client/services/` (publish client), `apps/frontend/client/src/lib/views/studio/` (publish action + community browse) |
| **Type** | full |
| **Priority** | P2 — unlocks community asset sharing; depends on creation (C-512) and provenance (C-510) |
| **Dependencies** | C-510 (`implemented` — provenance + generated assets), C-512 (`implemented` in PR #341 — creator studio; residual fixes folded into this contract), C-518 (`draft` — scoped rights/acceptance record; required for the publication gate), C-508 (`completed` — the publish pattern to mirror), C-432 (`implemented` — content-addressed R2 client sources), C-395 (`implemented` — R2 publish pipeline + attribution preflight), C-396 (`implemented` — hub catalog browse), C-454 (`implemented` — D1/R2 infra + storage package), C-426 (identity + R2 buckets) |
| **Status** | draft |
| **Promotion** | `—` |
| **Docs Impact** | user-facing → `apps/frontend/docs/src/content/docs/guides/publishing-assets.mdx` |
| **Contract version** | 2.1.0 |
| **Production Surface** | route `/studio/assets` publish action + hub API `POST /api/assets/community` + public browse under `/catalog/...` |

## Problem & Baseline Evidence

- **Current behavior — no endpoint accepts user-authored asset bytes into the community.** The hub exposes session-gated `/storage/upload` (generic avatar bytes → `SAVES_BUCKET`), `/saves/*`, and `/maps/community` (scene JSON only). `apps/frontend/hub/src/lib/server/api/index.ts:240-268` shows the full route surface; none accepts an image/audio asset for sharing. The catalog is operator-published: `scripts/src/lib/catalog/pipeline.ts` (`runCatalogPublish`) runs in CI, not for users.

- **Current behavior — `packs`/`packVersions` exist but no user writes them.** `packages/backend/database/src/lib/schema.ts:152-213` defines owned packs and versions with `manifestHash`, but publish is CI-only. There is no submission, moderation, or community-asset table.

- **Current behavior — created assets cannot leave the device.** C-510/C-512 make generated assets local-first; without a publish path they can never be shared, and provenance (already modeled as `generated:<provider>` in `packages/shared/schemas/src/lib/game/asset_provenance.ts:50-56`) has no consumer.

- **Reproduction**:
  1. `rg 'assets/community|asset_submissions|communityAssets' apps/frontend/hub packages/backend` → no results.
  2. `rg 'CATALOG_BUCKET.put' apps/frontend/hub/src/lib/server/api` → only map documents and seed/index paths, no user asset bytes.
  3. Attempting to share a generated image has no UI and no API.

- **Existing implementation to reuse**:

  | What | Where |
  |---|---|
  | Community publish pattern (reserve → R2 PUT → rollback) | `hub/src/lib/server/api/map_studio.ts:344-468` (C-508) |
  | Immutable revision + ownership schema pattern | `packages/backend/database/src/lib/schema.ts:252-312` (`mapDrafts`, `communityMaps`) |
  | Session gate + unconfigured 503 | `hub/src/lib/server/api/index.ts` map routes, `mapStudioUnconfigured()` |
  | Content-addressed R2 keying | `packages/shared/constants/src/lib/game_assets.ts:295` (`r2AssetKey`) |
  | Attribution/licence preflight | `scripts/src/lib/catalog/pipeline.ts:198-242` |
  | Catalog index/shard/release schemas | `packages/shared/schemas/src/lib/catalog/catalog_index.ts`, C-395 |
  | Provenance schema | `packages/shared/schemas/src/lib/game/asset_provenance.ts` |
  | Client source model | `packages/shared/types/src/lib/game/game_assets.ts` (`AssetSource`, `AssetRecord`, C-373/C-432) |
  | Hub browse + CDN resolver | `hub/src/lib/server/catalog/catalog_index.ts`, `hub/src/lib/client/services/cdn_asset_resolver.ts` (C-396) |
  | Moderation/count placeholders | `hub/.../api/catalog_stats.ts` (notes counts pending) |

- **Known gaps**:
  1. No D1 tables for asset drafts, published community assets, or moderation state.
  2. No hub routes to publish/list/get/delete a community asset.
  3. No content-addressed PUT of user asset bytes (only map JSON).
  4. No licence/provenance gate on user publication.
  5. No client publish action or community browse/import.

- **Baseline tests** (run before starting):
  - `apps/frontend/hub/src/lib/server/api/*.test.ts` (map publish tests as the template).
  - `packages/backend/database` schema/conformance tests.
  - `scripts/src/lib/catalog/*.test.ts`.
  - `bun moon run hub:test`, `bun moon run backend-database:test`.

## User Outcome

After this contract, a creator can publish an asset they made locally to the community, where it is content-addressed, attributed to them, licence-gated, moderated, and browsable by others; another player can import a community asset into their local registry and use it in-game.

## Success Measures

- **Time/latency target**: publish returns after the R2 PUT completes; uploads stream and reject oversized payloads before buffering fully.
- **Offline/degraded behavior**: publishing requires the hub and sign-in; when unavailable, the local asset remains fully usable and the studio shows the publish action as disabled. Local-first is never compromised.
- **Production journey enabled**: creator publishes → moderator approves → another player browses and imports → the asset renders in their game.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Community publish flow | `map_studio.ts` + C-508 | reuse pattern — reserve, PUT, rollback |
| Draft/revision/ownership schema | `schema.ts` `mapDrafts`/`communityMaps` | reuse pattern — new asset tables |
| Content addressing | `r2AssetKey`, C-432 | reuse — hash is the R2 key |
| Attribution preflight | `catalog/pipeline.ts` | reuse — extract a shared licence/provenance validator |
| Catalog index/shard | C-395, `catalog_index.ts` | modify — add community asset entries or a parallel community index |
| Hub browse | C-396 | modify — browse community assets |
| Client publish/import | `hub/src/lib/client/services/map_studio_client.ts` | reuse pattern — new `asset_publish_client` |
| Studio publish action | `views/studio/` (C-512) | modify — add publish + import |
| Identity/session | Better Auth, C-426 | reuse |
| Stats/moderation counts | `catalog_stats.ts` | modify — populate from real tables |

## Overview

Community map publishing (C-508) proved the pattern: session-gated reserve → immutable revision in R2 → rollback. This contract applies it to assets. It adds D1 tables for an owner's asset drafts, published community assets (immutable revisions keyed by content hash), and moderation state; hub routes to publish/list/get/delete; a scoped rights-and-provenance gate that reuses the catalog attribution preflight; and a client flow to publish from the Creator Studio and import community assets into the local registry. Generated assets reach publication with `generated:<provider>` provenance and a scoped rights decision (C-518), so attribution is preserved end to end without copying a model licence onto output by default.

## Design Reference

- **Publish pattern**: `hub/src/lib/server/api/map_studio.ts:344-468` — validate → session gate → reserve `(slug/identity, revision)` in D1 → PUT to `CATALOG_BUCKET` → rollback the row on R2 failure. Follow it exactly, including the unconfigured 503 (`index.ts` map routes).
- **Schema pattern**: `packages/backend/database/src/lib/schema.ts:252-312` — one draft table (`ownerAccountId` CASCADE) and one published table (`ownerAccountId` RESTRICT, immutable revision, `documentHash`, `r2Key`, `sizeBytes`), with a unique index on the immutable key and URL-safe checks.
- **Content addressing**: `r2AssetKey` (`constants/game_assets.ts:295`) — the hash is the address, so publishing the same bytes twice dedupes.
- **Attribution/licence**: `catalog/pipeline.ts:198-242` — extract the preflight into a shared validator rather than duplicating it.
- **Client**: `hub/src/lib/client/services/map_studio_client.ts` — mirror for assets.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Local-first is sacred.** Publishing is an explicit, online, signed-in action; nothing about creating or using an asset may depend on it.
- **Hash is identity; revisions are immutable.** Never overwrite a published object. Re-publishing changed bytes creates a new revision; identical bytes reuse the object.
- **Scoped rights are gated, not inherited.** Replace "generated assets inherit the model licence" with C-518's rights record. Evaluate inference/deployment permission, reference/LoRA obligations, game inclusion and standalone/community distribution **separately**. A model's code license is not sufficient output-rights evidence, and a generated marker is not an exemption.
- **Server-side policy, not client assertion.** The hub re-validates category, size, hash and provenance against known policy/version evidence; it never trusts a client-claimed hash or licence. Where it cannot substantiate a claim it fails closed and records unresolved/manual review. An automated validator cannot establish legal rights from a URL alone.
- **Community namespace separate from the curated catalog.** User submissions use their own namespace/tags; operator-curated catalog tags are never shadowed. All submissions default to `pending`; there is no first-N auto-approval.
- **Pending bytes are private at delivery, not just delisted.** Keep pending/rejected blobs in private R2 staging or behind an authenticated delivery path. Hiding a D1 row does not make an object private in a public catalog bucket — a direct unauthenticated GET of pending bytes must fail even when the caller knows the hash. Publish immutable approved revisions only.
- **Approve via idempotent staged→published transitions.** There is no atomic transaction across D1 and R2. Use reserve/upload/finalize states, CAS transitions, retry reconciliation and reference-aware orphan cleanup. A failed upload must leave no visible published row; a DB failure after a successful PUT leaves an explicit recoverable staged object, never deletion of another owner's deduplicated blob.
- **Publish a redacted provenance projection only.** Never upload raw prompts, local filesystem paths, secrets or private reference art by default. Required credits and transformation lineage are included; a private generation preview does not imply consent to publish.
- **Moderation before visibility.** Nothing is publicly listed until its state is approved; the owner can always see their own submissions and no other user's pending rows.
- **One identity model.** Use the existing session/account; ownership FKs follow C-508 (CASCADE for drafts, RESTRICT for published rows).
- **Deletion removes visibility; it does not promise universal erasure.** Follow ownership/moderation rules and never delete blobs still referenced by approved revisions or other owners. Retain locally accepted/imported copies and pinned packs — server availability cannot revoke offline gameplay. State whether delisting retains immutable references.

## Folded C-512 residuals (from the integration addendum)

The 2026-09-13 C-512/C-513 integration addendum was created before C-512 shipped. Its C-512 items that C-512's own execution report still lists as open are folded here so the C-513 execution closes them; the addendum file itself has been merged into this contract. Do not create a second Studio contract.

1. **Multi-emotion expression packs.** C-512 registers a single NPC-bound emotion (`neutral`) under `expressionAssetTag({ npcId, emotion })`. The dev expression-pack loop (`views/dev/image/image_view_model.svelte.ts#generateExpressions`) still holds object URLs and has no NPC id. Complete the multi-emotion path: require an NPC ID and an accepted appearance/reference, queue each emotion as its own candidate under the resolver tag, allow partial success and resume, and never guess the NPC from a prompt slug. The accepted neutral portrait in the manifest brief is the reference for its expression edits.
2. **Studio audio is truly usable.** Audio recipes are currently listed but permanently disabled in the Studio; an entry that can never run is not integration. C-521 supplies the engine/adapter and finishing path — wire image and audio recipes through the shared modality-neutral runner when their profile capabilities are available, and capability-gate (not hard-disable) the UI.
3. **Executed production evidence.** C-512's E2E and visual suites were authored but not executed. Run real compiled Svelte E2E against `/studio/assets`: generate, cancel, review, save, reload, rename, delete, quota failure and unavailable engine; show a saved generated portrait in actual NPC dialogue; audition a saved audio result. Use the current visual runner convention. C-512 cannot be considered complete on unexecuted mandatory production evidence.

Already satisfied by C-512 and not repeated here: one production route `/studio/assets` with a shared VM/composition dev sandbox; registry-based recipe selection; generation → review → acceptance/save through the registry write seam; contextual opt-in default-off, dedup-after-accept and bounded queue; generated library list/rename/delete with eviction protection; and registry-first NPC portrait/expression resolution with an explicit tag override.

## State & Data Models

TypeBox schemas in `packages/shared/schemas/`; D1 via Drizzle in `packages/backend/database`.

```ts
// D1 (Drizzle) — mirrors the C-508 map tables.
// asset_drafts: owner's unpublished work.
type AssetDraftRow = {
  id: string;                 // uuid
  ownerAccountId: string;     // FK users.id, CASCADE
  category: string;           // catalog category
  tag: string;
  provenanceJson: string;     // AssetProvenance
  updatedAt: number;
};

// community_assets: immutable published revisions, content-addressed.
type CommunityAssetRow = {
  id: string;                 // uuid
  ownerAccountId: string;     // FK users.id, RESTRICT
  slug: string;               // url-safe public id
  revision: number;           // monotonic, >= 1
  category: string;
  tag: string;
  sha256: string;             // content address
  r2Key: string;              // community/assets/<hash[0:2]>/<hash><ext>
  sizeBytes: number;
  ext: string;
  licenses: string;           // verbatim
  authors: string;            // verbatim
  sourceUrls: string;         // verbatim
  provenanceJson: string;
  moderationState: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  updatedAt: number;
};
```

```ts
// Wire shapes (hub API).
type PublishAssetRequest = {
  category: CatalogCategory;
  tag: string;
  /** Base64 or a pre-uploaded staging reference; bounded by MAX_UPLOAD_SIZE. */
  data: string;
  provenance: AssetProvenance;
  title: string;
  slug?: string;
};

type PublishAssetResult = {
  slug: string;
  revision: number;
  sha256: string;
  moderationState: 'pending' | 'approved' | 'rejected';
  url: string;
};
```

## Quality Requirements

- **Offline/degraded mode**: publish/import are the only online operations; every local generation/use path is unaffected. Hub-unavailable returns the C-508 unconfigured 503, not an error.
- **Accessibility/input**: publish and browse use labelled native controls; moderation status is communicated textually, not by colour alone.
- **Performance budget**: bounded upload size (`MAX_UPLOAD_SIZE`); list endpoints paginate; content-addressed dedup avoids re-uploading identical bytes.
- **Security/privacy**: session-gated writes; validate category/tag/size/hash server-side; strip local paths and EXIF; never publish prompts or model ids unless the user chooses; moderation prevents arbitrary content hosting abuse.
- **Persistence/migration**: new D1 tables (additive); no change to existing map/save/pack tables. Existing local assets are unaffected.
- **Cancellation/retry/idempotency**: a retried publish of identical bytes dedupes by hash; a failed R2 PUT rolls back the reserved row (C-508 pattern).
- **Observability**: log publish outcome (hash, size, category, moderation) without payloads; expose moderation counts via `catalog_stats`.

## Migration & Rollback

- **Old data compatibility**: all new tables are additive; existing hub routes, packs, maps, and saves are untouched. Clients without this contract simply cannot publish/import.
- **Migration**: D1 migration adds `asset_drafts` and `community_assets`; no backfill.
- **Rollback**: remove routes and gate the UI; rows can be left inert or deleted. Published objects in `CATALOG_BUCKET` can be left (unreferenced) or removed.
- **Feature flag or kill switch**: `PUBLIC_ASSET_PUBLISHING` (frontend) + the hub route returning 503 when the env binding is absent.
- **Failure recovery**: reserve/upload/finalize with CAS transitions — an R2 failure rolls back the D1 reservation, and a crash between PUT and commit leaves an explicit recoverable **staged** object keyed by hash (dedupe-safe) and no dangling visible row. Reference-aware cleanup removes only unreferenced staged objects; never delete a blob still referenced by another owner's revision or a locally accepted copy.

## Scope Boundaries

- **In Scope:**
  - D1 `asset_drafts` + `community_assets` (immutable, content-addressed, moderated).
  - Private pending/rejected blob staging and authenticated delivery; immutable approved revisions.
  - Hub routes: publish, list, get, delete (owner), moderation transition (operator).
  - Server-side validation + scoped rights/provenance gate (shared with the catalog preflight).
  - Client publish action in the Creator Studio and community browse/import into the local registry.
  - Community asset browse surface (extends C-396).
  - Population of moderation/count stats.
  - Folded C-512 residuals: multi-emotion expression packs, Studio audio path via C-521, and executed production E2E/visual evidence for `/studio/assets`.
- **Out of Scope:**
  - Generating assets (C-510/C-511) and the creator studio feature itself (C-512), beyond the folded residuals above.
  - Ratings, comments, or recommendations (separate, historically C-398/C-399).
  - Paid/monetized content or revenue sharing.
  - Automatically publishing into the operator-curated catalog index (users publish to a community namespace; promotion into the curated catalog stays a separate operator action).
  - Changing the save/data planes or campaign sharing.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** one outcome — *a user-created asset can be published, moderated, discovered, and imported*. The D1 schema, hub routes, and client flow share one model (content-addressed community asset + provenance) and one invariant (immutable revisions, local-first). Discovery without a publish path, or a publish path with no browse/import, is not independently useful. Ratings/recommendations and curated-catalog promotion are separate systems and separate contracts.

## Acceptance Criteria

### AC-1: Publish reserves, uploads, and records
**Given** a signed-in account and a locally generated asset with valid provenance
**When** the user publishes it from `/studio/assets`
**Then** the hub validates and content-addresses the bytes, PUTs them to `CATALOG_BUCKET`, inserts a `community_assets` row with an immutable revision and `moderationState: pending`, and returns the slug/revision/hash; a failed PUT rolls back the row.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | `hub/src/lib/server/api/asset_publish.test.ts` (mirrors `map_studio` tests) | hub API `POST /api/assets/community` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run hub:test`
- Integration: publish a fixture asset; assert D1 row + R2 object + rollback on forced R2 failure
- E2E / Visual: N/A — reason: covered by integration + the studio E2E

**Watch Points**:
- The hub must recompute the hash; never trust the client's claimed sha256.
- Identical bytes must dedupe to one R2 object while still recording the owner's revision.

### AC-2: Licence/provenance gate fails closed
**Given** an asset whose provenance/licence is missing or forbids sharing
**When** the user attempts to publish
**Then** the request is rejected with a specific error and nothing is uploaded.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + Integration | shared preflight tests + `asset_publish.test.ts` | hub API `POST /api/assets/community` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run hub:test`, `bun moon run scripts:test`
- Integration: publish with a share-prohibited licence
- E2E / Visual: N/A — reason: covered by unit/integration

**Watch Points**:
- A generated asset does **not** inherit the model licence. The gate must read C-518's scoped rights decision; unknown publication rights fail closed (AC-7).

### AC-3: Moderation controls visibility
**Given** a published asset in `pending`
**When** it has not been approved
**Then** it is not in public listings, but the owner sees it in their submissions; an operator can transition it to approved/rejected.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration | `asset_publish.test.ts` + list/moderation handler tests | hub API `GET /api/assets/community` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run hub:test`
- Integration: publish pending → list public (absent) → approve → list public (present)
- E2E / Visual: functional browse test

**Watch Points**:
- Owner visibility must not leak other users' pending rows.

### AC-4: Community assets browse and import
**Given** an approved community asset
**When** another player browses the community and imports it
**Then** the asset is added to their local registry as an R2 source with matching hash/category/tag and resolves in-game.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | E2E | `tests/client/community_asset_import.spec.ts` + resolver test | public browse `/catalog/...` + local registry | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`, `bun moon run hub:test`
- Integration: import a community asset offline-after-cache and resolve
- E2E / Visual:
    - **Functional**: `tests/client/community_asset_import.spec.ts`
    - **Visual**: `suites/community_assets.visual.ts` — browse grid shows approved assets with attribution

**Watch Points**:
- Import must not shadow an existing locally generated asset with the same tag silently; version or prompt.

### AC-5: Owner delete and local unaffected
**Given** a published asset owned by the user
**When** the user deletes it
**Then** it is removed from public listings (moderation-safe) and the user's local copy remains fully usable; hub-unavailable never blocks local use.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Integration + Unit | `asset_publish.test.ts` + studio VM test | hub API `DELETE /api/assets/community/:slug` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run hub:test`, `bun moon run client:test`
- Integration: delete published → local library intact
- E2E / Visual: N/A — reason: covered by integration + VM unit

**Watch Points**:
- Published rows use RESTRICT ownership (C-508); account deletion must be handled deliberately, not by cascade.

### AC-6: Pending bytes are private at delivery
**Given** a known pending-asset hash and a second or anonymous account
**When** the account lists the community and directly fetches the object by hash
**Then** neither the metadata nor the bytes are public — the bucket URL or authenticated delivery path denies access, and only the owner can retrieve pending bytes.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Integration | `hub/src/lib/server/api/asset_publish.test.ts` (direct pending-blob GET denial) | hub API `GET /api/assets/community` + blob delivery | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run hub:test`
- Integration: publish pending, then attempt a direct unauthenticated and cross-account fetch by hash; both fail
- E2E / Visual: N/A — reason: covered by integration

**Watch Points**:
- A public `CATALOG_BUCKET` object obscured only by a listing filter does **not** satisfy this AC. Use private staging or authenticated reads.

### AC-7: Scoped rights gate distinguishes game use from standalone distribution
**Given** a generated asset whose C-518 rights decision permits in-game use but forbids standalone/community distribution
**When** the owner attempts to publish a downloadable community asset
**Then** the gate rejects the request and identifies the unmet standalone-distribution requirement, and no bytes are uploaded.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-7 | Unit + Integration | shared preflight tests + `asset_publish.test.ts` | hub API `POST /api/assets/community` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run hub:test`, `bun moon run scripts:test`
- Integration: publish with a game-use-only rights decision; assert rejection and zero R2 writes
- E2E / Visual: N/A — reason: covered by unit/integration

**Watch Points**:
- The gate must read the scoped decision from C-518 evidence — never infer output rights from the base model's code license.

### AC-8: Reserve/upload/finalize is idempotent across D1 and R2 failures
**Given** injected D1 and R2 failures at each publish transition
**When** the publish is retried
**Then** exactly one immutable revision becomes public, no shared/deduplicated object is deleted, and a DB failure after a successful PUT leaves a recoverable staged object rather than a visible row.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-8 | Failure-injection integration | `asset_publish.test.ts` transition matrix | hub API `POST /api/assets/community` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run hub:test`
- Integration: fail before PUT, after PUT before commit, and at finalize; retry each
- E2E / Visual: N/A — reason: covered by integration

**Watch Points**:
- There is no cross-store transaction. "Exactly one public revision" is a CAS/idempotency invariant, not a database transaction.

### AC-9: Private Hub generation is not publication
**Given** a private Hub generation result (C-522)
**When** the job finishes
**Then** no community publish occurs until a distinct, explicit publish action succeeds.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-9 | Integration | Hub job/publication separation test | Hub `/studio/assets` + hub API `POST /api/assets/community` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run hub:test`
- Integration: complete a generation job with auto-publish off; assert zero `community_assets` rows
- E2E / Visual: N/A — reason: covered by integration

**Watch Points**:
- Job completion, candidate acceptance and community publication are three separate decisions; never collapse them.

### AC-10: Imported visual and audio assets resolve offline after reload
**Given** an imported community visual and audio asset
**When** the client reloads with networking blocked
**Then** the local registry resolves the accepted hash and the runtime actually renders/plays it, without re-fetching.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-10 | E2E | `tests/client/community_asset_import.spec.ts` + resolver/audio tests | local registry + runtime resolution | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`, `bun moon run hub:test`
- Integration: import, cache, reload offline, assert runtime use (not just a registry row)
- E2E / Visual: `tests/client/community_asset_import.spec.ts` for visual; audio via audition evidence

**Watch Points**:
- A freshly imported row must enter the actual selection/index used by the music and asset resolvers — not merely exist in a table.

### AC-11: Import collisions are explicit
**Given** an imported asset whose category/tag collides with a curated catalog entry or a local accepted asset
**When** the import runs
**Then** the collision is surfaced and resolved explicitly (version or prompt); a curated or local accepted tag is never silently replaced.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-11 | Unit + Integration | import resolver tests + `asset_publish.test.ts` | local registry import path | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: import a colliding tag and assert an explicit resolution
- E2E / Visual: N/A — reason: covered by unit/integration

**Watch Points**:
- Reuse the C-510 catalog-tag collision guard; do not author a second collision policy.

## Implementation Sequence

1. **Phase 1 (Schema)**: D1 `asset_drafts` + `community_assets` + migration + row types.
2. **Phase 2 (Preflight)**: extract the licence/provenance validator from the catalog pipeline into a shared module; use it in the hub.
3. **Phase 3 (Hub routes)**: publish/list/get/delete + moderation; content-addressed PUT; rollback.
4. **Phase 4 (Client)**: publish action in the studio; community browse + import into the local registry.
5. **Phase 5 (Validation)**: `bun moon run hub:test`, `backend-database:test`, `client:test`; E2E import; visual browse.

## Edge Cases & Gotchas

- **Content-address dedup vs ownership**: two users publishing identical bytes share the object but need distinct rows/revisions and attribution.
- **Moderation bypass**: never list pending/rejected assets publicly, and never let a direct object URL or known hash bypass delivery privacy (AC-6).
- **Rights scopes**: a generated asset does not inherit the model licence. Inference permission, game inclusion and standalone/community redistribution are separate decisions resolved from C-518 evidence — never default to permissive.
- **Oversized/abusive uploads**: bound size and category server-side; rate-limit publish.
- **EXIF/local paths**: strip metadata that leaks the creator's machine.
- **RESTRICT ownership**: account deletion with published assets needs an explicit policy (C-508 precedent), not an accidental cascade.
- **Local-first regression**: any code path that makes asset use depend on the hub is a bug in this contract.

## Open Questions

Resolved by the integration addendum adopted in v2.1.0:

- **Q1 — community namespace vs curated catalog?** Resolved: separate community namespace, browsable like C-396, with operator promotion into the curated catalog as a later action. Never shadow curated tags.
- **Q2 — auto-approve a creator's first N assets?** Resolved: all submissions `pending` by default; no auto-approval.
- **Q3 — imports are per-asset or per-pack?** Resolved: per-asset in this contract; content packs remain a separate concern (pack pipeline, not this route).

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-09-12 | Initial draft. | pending user approval |
| 2.1.0 | 2026-09-13 | Adopted the C-512/C-513 integration addendum: scoped rights gate (C-518), server-side policy validation, separate community namespace, private-at-delivery staging, idempotent reserve/upload/finalize with reference-aware cleanup, redacted provenance projection, deletion semantics, collision handling; added AC-6–AC-11; resolved Q1–Q3; folded open C-512 residuals (multi-emotion expression packs, Studio audio path, executed production E2E/visual evidence) into this contract's execution scope. | pending user approval |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
