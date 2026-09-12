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
| **Dependencies** | C-510 (provenance + generated assets — prerequisite), C-512 (creator studio — prerequisite), C-508 (`completed` — the publish pattern to mirror), C-432 (`implemented` — content-addressed R2 client sources), C-395 (`implemented` — R2 publish pipeline + attribution preflight), C-396 (`implemented` — hub catalog browse), C-454 (`implemented` — D1/R2 infra + storage package), C-426 (identity + R2 buckets) |
| **Status** | draft |
| **Promotion** | `—` |
| **Docs Impact** | user-facing → `apps/frontend/docs/src/content/docs/guides/publishing-assets.mdx` |
| **Contract version** | 2.0.0 |
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

Community map publishing (C-508) proved the pattern: session-gated reserve → immutable revision in R2 → rollback. This contract applies it to assets. It adds D1 tables for an owner's asset drafts, published community assets (immutable revisions keyed by content hash), and moderation state; hub routes to publish/list/get/delete; a licence-and-provenance gate that reuses the catalog attribution preflight; and a client flow to publish from the Creator Studio and import community assets into the local registry. Generated assets reach publication with `generated:<provider>` provenance and their model licence, so attribution is preserved end to end.

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
- **Licence and provenance are gated, not optional.** A publish fails closed when attribution/provenance is missing or the licence forbids sharing. Reuse the catalog preflight; do not invent a second one.
- **Moderation before visibility.** Nothing is publicly listed until its state is approved; the owner can always see their own submissions.
- **One identity model.** Use the existing session/account; ownership FKs follow C-508 (CASCADE for drafts, RESTRICT for published rows).
- **No client-side trust.** The hub re-validates category, size, hash, and provenance; it never trusts client-claimed hashes or licences.

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
- **Failure recovery**: R2 failure rolls back the D1 reservation; a crash between PUT and commit leaves an orphan object keyed by hash (harmless, dedupe-safe) and no dangling row.

## Scope Boundaries

- **In Scope:**
  - D1 `asset_drafts` + `community_assets` (immutable, content-addressed, moderated).
  - Hub routes: publish, list, get, delete (owner), moderation transition (operator).
  - Server-side validation + licence/provenance gate (shared with the catalog preflight).
  - Client publish action in the Creator Studio and community browse/import into the local registry.
  - Community asset browse surface (extends C-396).
  - Population of moderation/count stats.
- **Out of Scope:**
  - Generating assets (C-510/C-511), the creator studio itself (C-512).
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
- Generated assets inherit the model licence; the gate must see it via provenance.

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

## Implementation Sequence

1. **Phase 1 (Schema)**: D1 `asset_drafts` + `community_assets` + migration + row types.
2. **Phase 2 (Preflight)**: extract the licence/provenance validator from the catalog pipeline into a shared module; use it in the hub.
3. **Phase 3 (Hub routes)**: publish/list/get/delete + moderation; content-addressed PUT; rollback.
4. **Phase 4 (Client)**: publish action in the studio; community browse + import into the local registry.
5. **Phase 5 (Validation)**: `bun moon run hub:test`, `backend-database:test`, `client:test`; E2E import; visual browse.

## Edge Cases & Gotchas

- **Content-address dedup vs ownership**: two users publishing identical bytes share the object but need distinct rows/revisions and attribution.
- **Moderation bypass**: never list pending/rejected assets publicly, including via direct object URL enumeration.
- **Licence inheritance**: a generated asset's licence comes from its model; the gate must resolve it from provenance, not default to permissive.
- **Oversized/abusive uploads**: bound size and category server-side; rate-limit publish.
- **EXIF/local paths**: strip metadata that leaks the creator's machine.
- **RESTRICT ownership**: account deletion with published assets needs an explicit policy (C-508 precedent), not an accidental cascade.
- **Local-first regression**: any code path that makes asset use depend on the hub is a bug in this contract.

## Open Questions

Must be resolved before status becomes `approved`:

- **Q1 — community namespace vs curated catalog?** Proposed: separate community namespace, browsable like C-396, with operator promotion into the curated catalog as a later action. Confirm.
- **Q2 — auto-approve a creator's first N assets?** Proposed: all submissions `pending` by default; no auto-approval. Confirm.
- **Q3 — imports are per-asset or per-pack?** Proposed: per-asset in this contract; content packs are a separate concern. Confirm.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
