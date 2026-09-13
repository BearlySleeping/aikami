---
id: C-513
title: "End-User Asset Publishing and Community Sharing"
source: "direct — user request to streamline and publish locally created assets for end users"
contract_type: full
status: approved
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
| **Target** | `packages/backend/database/src/lib/schema.ts` + `packages/backend/database/drizzle-d1/0009_*.sql` (D1 community-asset tables); `packages/shared/constants/src/lib/infrastructure.ts` (`R2_BUCKETS.uploads`) + `apps/backend/cloudflare/src/lib/config_gen.ts` + `apps/frontend/hub/src/app.d.ts` (private intake bucket binding); `packages/shared/schemas/src/lib/storage/keys.ts` (intake key specs); `apps/frontend/hub/src/lib/server/api/asset_community.ts` + `index.ts` (publish/list/get/delete/moderation/promote routes); `apps/frontend/hub/src/lib/client/services/asset_publish_client.ts`; `apps/frontend/hub/src/routes/(public)/community/` (public browse); `apps/frontend/client/src/lib/views/studio/` + `apps/frontend/client/src/routes/studio/community/+page.svelte` (publish action + community browse/import) |
| **Type** | full |
| **Priority** | P2 — unlocks community asset sharing; depends on creation (C-512) and provenance (C-510) |
| **Dependencies** | **Verified/ready:** C-510 (`implemented`), C-512 (`implemented` in PR #341 — creator studio), C-508 (`implemented` — the publish pattern to mirror), C-432 (`implemented`), C-395 (`implemented`), C-396 (`implemented`), C-454 (`implemented` — D1/R2 infra + storage key specs), C-426 (`implemented` — identity, `SAVES_BUCKET`/`CATALOG_BUCKET` bindings). **Draft — stubbed, not blocking:** C-518 (`draft` — scoped rights record; the gate fails closed until it lands and consumes the `RightsDecision` seam, see Open Questions Q4), C-521 (`draft` — audio engine; only the modality-neutral runner wiring ships here), C-522 (`draft` — hub generation runner; AC-9 asserts job/publication separation against a stubbed runner). **Reconciled:** C-398/C-399 (`not_started`) — see Out of Scope. |
| **Status** | approved |
| **Promotion** | `—` |
| **Docs Impact** | user-facing → `apps/frontend/docs/src/content/docs/guides/publishing-assets.mdx`; architecture amendment → `docs/architecture/object-storage-layout.md` §3.1/§3.2 (community assets are per-asset submissions promoted into the shared `assets/` namespace; the `aikami-uploads` intake plane becomes real with this contract) |
| **Contract version** | 2.2.0 |
| **Production Surface** | client `/studio/assets` publish action + `/studio/community` browse/import; hub API `POST /api/assets/community` (reserve), `PUT /api/assets/community/:slug/upload` (bytes), `GET /api/assets/community`, `GET|DELETE /api/assets/community/:slug`, `POST /api/assets/community/:slug/moderation`, `GET /api/assets/community/:slug/raw` (owner-only pending bytes); public browse `https://hub.bearlysleeping.com/community/{category}`; approved bytes at `https://assets.bearlysleeping.com/assets/<hash[0:2]>/<hash><ext>` |

## Problem & Baseline Evidence

- **Current behavior — no endpoint accepts user-authored asset bytes into the community.** The hub exposes session-gated `/storage/upload` (generic avatar bytes → `SAVES_BUCKET`), `/saves/*`, and `/maps/community` (scene JSON only). `apps/frontend/hub/src/lib/server/api/index.ts:240-268` shows the full route surface; none accepts an image/audio asset for sharing. The catalog is operator-published: `scripts/src/lib/catalog/pipeline.ts` (`runCatalogPublish`) runs in CI, not for users.

- **Current behavior — there is no private landing zone for unreviewed bytes, and the public bucket is a folder, not a filter.** `R2_BUCKETS` declares exactly two planes (`packages/shared/constants/src/lib/infrastructure.ts:87-96`: `saves`, `catalog`), and `CATALOG_BUCKET` is published whole at `assets.bearlysleeping.com` (`apps/frontend/hub/.env.emulator:15`, `docs/architecture/object-storage-layout.md` §3). Any key written there is world-readable, so pending bytes cannot live in it (`object-storage-layout.md` §3.3: "Nothing enters `aikami-catalog` that is not intended to be world-readable forever"). §4/§9 already design the fix — a private `aikami-uploads` intake plane — and this contract is the one that makes it real.

- **Current behavior — the hub already mediates player-owned bytes, so the transport precedent exists but the policy is unstated.** `/storage/upload` (`apps/frontend/hub/src/lib/server/api/storage.ts:85-105`) checks `content-length` against a 16 MiB cap *before* `request.arrayBuffer()` and then writes through the `SAVES_BUCKET` binding. That is the C-426 pattern; `I-7` (`docs/architecture/data-layer-target-architecture.md:90`) says no asset bytes pass through a hub request handler. This contract keeps the C-426 pattern for the intake hop and states the deviation explicitly rather than leaving the implementer to guess (see Architecture Directives).

- **Current behavior — `packs`/`packVersions` exist but no user writes them.** `packages/backend/database/src/lib/schema.ts:152-213` defines owned packs and versions with `manifestHash`, but publish is CI-only. There is no submission, moderation, or community-asset table.

- **Current behavior — created assets cannot leave the device.** C-510/C-512 make generated assets local-first; without a publish path they can never be shared, and provenance (already modeled as `generated:<provider>` in `packages/shared/schemas/src/lib/game/asset_provenance.ts:50-56`) has no consumer.

- **Reproduction**:
  1. `rg 'assets/community|asset_submissions|communityAssets' apps/frontend/hub packages/backend` → no results.
  2. `rg 'CATALOG_BUCKET.put' apps/frontend/hub/src/lib/server/api` → only the C-508 map document path, no user asset bytes.
  3. `rg 'uploads|UPLOADS_BUCKET' packages/shared/constants apps/frontend/hub` → no private intake plane declared.
  4. Attempting to share a generated image has no UI and no API (`rg 'asset_publish|community_assets' apps/frontend/client/src` → no results).

- **Existing implementation to reuse**:

  | What | Where |
  |---|---|
  | Community publish pattern (reserve → R2 PUT → rollback) | `apps/frontend/hub/src/lib/server/api/map_studio.ts:344-468` (C-508) |
  | Immutable revision + ownership schema pattern | `packages/backend/database/src/lib/schema.ts:252-312` (`mapDrafts`, `communityMaps`) |
  | Session gate + unconfigured 503 | `apps/frontend/hub/src/lib/server/api/index.ts` map routes, `mapStudioUnconfigured()` |
  | Raw-body upload with a pre-buffer size check | `apps/frontend/hub/src/lib/server/api/storage.ts:85-105` (`MAX_STORAGE_BYTES`, C-426) |
  | Content-addressed R2 keying (public promotion key) | `packages/shared/constants/src/lib/game_assets.ts:306` (`r2AssetKey`) |
  | Typed R2 key specs + bucket binding union | `packages/shared/schemas/src/lib/storage/keys.ts` (`userObjectKey`, `KeySpec['bucket']`, C-454) |
  | Attribution/licence preflight | `scripts/src/lib/catalog/preflight.ts:54` (`runAttributionPreflight`, called from `pipeline.ts:198-242`) |
  | Catalog index/shard/release schemas | `packages/shared/schemas/src/lib/catalog/catalog_index.ts`, C-395 |
  | Provenance schema | `packages/shared/schemas/src/lib/game/asset_provenance.ts` |
  | Client source model | `packages/shared/types/src/lib/game/game_assets.ts` (`AssetSource`, `AssetRecord`, C-373/C-432); `asset_sources.backend = 'r2'` |
  | Client → hub transport (session/bearer, mode-aware base) | `apps/frontend/client/src/lib/services/api/hub_api_client.ts` (`hubApiBase()`, `hubAuthHeaders()`) |
  | Hub browse + CDN resolver | `apps/frontend/hub/src/lib/server/catalog/catalog_index.ts`, `apps/frontend/hub/src/lib/client/services/cdn_asset_resolver.ts` (C-396) |
  | Community counters | new route — do **not** extend `catalog_stats.ts`, whose shapes are frozen to C-396 and extendable only by C-399 (`packages/shared/schemas/src/lib/catalog/catalog_stats.ts:9-11`) |

- **Known gaps**:
  1. No D1 tables for community assets, publish staging, or moderation state.
  2. No hub routes to reserve/upload/list/get/delete a community asset.
  3. No private intake plane and no content-addressed promotion of user asset bytes (the only R2 write path is C-508's map document and C-426's private avatar objects).
  4. No licence/provenance gate on user publication.
  5. No client publish action or community browse/import.

- **Baseline tests** (run before starting):
  - `apps/frontend/hub/src/lib/server/api/tests/*.test.ts` (`map_studio.test.ts` as the template).
  - `packages/backend/database` schema/conformance tests.
  - `scripts/src/lib/catalog/*.test.ts`.
  - `bun moon run hub:test`, `bun moon run backend-database:test`.

## User Outcome

After this contract, a creator can publish an asset they made locally to the community, where it is content-addressed, attributed to them, licence-gated, moderated, and browsable by others; another player can import a community asset into their local registry and use it in-game.

## Success Measures

- **Time/latency target**: the reserve call returns immediately; the upload call returns once the private-intake PUT completes, rejecting oversized payloads from `Content-Length` before the body is buffered.
- **Offline/degraded behavior**: publishing requires the hub and sign-in; when unavailable, the local asset remains fully usable and the studio shows the publish action as disabled. Local-first is never compromised.
- **Production journey enabled**: creator publishes → bytes stage privately → moderator approves and they are promoted → another player browses and imports → the asset renders in their game.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Community publish flow | `map_studio.ts` + C-508 | reuse pattern — reserve → upload → commit, rollback, unconfigured 503 |
| Revision/ownership schema | `schema.ts` `communityMaps` (`:276-312`) | reuse pattern — RESTRICT owner, unique `(slug, revision)`, URL-safe/positive checks. C-508's `mapDrafts` CASCADE table is **not** mirrored: asset authoring is local-first and needs no server draft table |
| Private staging transport | `storage.ts` (`:85-105`) | reuse — raw-body upload with a `Content-Length` cap checked before buffering |
| Content addressing | `r2AssetKey` (`constants/game_assets.ts:306`), C-432 | reuse — the *promoted* key is the hash in the shared `assets/` namespace (`object-storage-layout.md` §3.1: no `community/` prefix, dedup shared with the curated catalog). Staging keys are per-upload, not hash-keyed |
| Intake bucket | `R2_BUCKETS` + `storage/keys.ts` (C-454) | extend — add the `uploads` plane + `stagingObjectKey` spec; generated into `wrangler.jsonc` |
| Attribution preflight | `scripts/src/lib/catalog/preflight.ts:54` (`runAttributionPreflight`) | extract into a shared package — the hub imports only `@aikami/*` and cannot reach `scripts/` |
| Catalog index/shard | C-395, `catalog_index.ts` | modify — community entries get their own index namespace/route; curated tags are never shadowed |
| Hub browse | C-396 | modify — new `/community/{category}` browse over approved+promoted rows |
| Client publish/import | `hub/src/lib/client/services/map_studio_client.ts` + `client/.../services/api/hub_api_client.ts` | reuse pattern — new `asset_publish_client` over the existing `hubApiBase()`/`hubAuthHeaders()` transport |
| Studio publish action | `views/studio/` (C-512) | modify — add publish + import |
| Identity/session | Better Auth, C-426 | reuse |
| Community counters | new community route | **replace the plan** — C-396's `catalog_stats` shapes are frozen and extendable only by C-399 (`packages/shared/schemas/src/lib/catalog/catalog_stats.ts:9-11`); do not reopen them |

## Overview

Community map publishing (C-508) proved the pattern: session-gated reserve → immutable revision in R2 → rollback. This contract applies it to assets, with one deliberate difference: **bytes are not public on upload.** Map documents are public the moment they are published; asset bytes must stay private until a moderator approves them, and the catalog bucket publishes every key it holds. So the publish path gains a plane the repo does not have yet:

1. **Reserve** — the hub validates metadata, licence/rights and size, and reserves `(slug, revision)` in D1 with `moderationState: 'staged'`.
2. **Upload** — the signed-in owner PUTs the raw bytes; the hub checks `content-length` before buffering, computes the sha256 itself, and lands the object in the private intake bucket (`UPLOADS_BUCKET` / `aikami-uploads`, no custom domain) at `staging/<accountId>/<uploadId>`. The row flips `staged` → `pending`.
3. **Promote** — a moderation transition to `approved` copies the object into `CATALOG_BUCKET` at the content-addressed key `assets/<hash[0:2]>/<hash><ext>` (`r2AssetKey`) and records `promotedAt`. Community bytes therefore share the curated catalog's namespace — one resolver, one cache config, and dedup across curated and community uploads (`docs/architecture/object-storage-layout.md` §3.1).

Client-side, the Creator Studio gains a publish action and a community browse/import view that writes an approved asset into the local registry as an `r2` source. Generated assets reach publication with `generated:<provider>` provenance and a scoped rights decision (C-518), so attribution is preserved end to end without copying a model licence onto output by default.

## Design Reference

- **Publish pattern**: `apps/frontend/hub/src/lib/server/api/map_studio.ts:344-468` — validate → session gate → reserve `(slug, revision)` in D1 → PUT to R2 → rollback the row on R2 failure. Follow it exactly, including the unconfigured 503 (`index.ts` map routes). The only intentional divergence is the private intake bucket and the approval-time promotion (Overview).
- **Schema pattern**: `packages/backend/database/src/lib/schema.ts:252-312` — published table with `ownerAccountId` RESTRICT, immutable `(slug, revision)`, content hash, `r2Key`, `sizeBytes`, unique index on the immutable key and URL-safe checks. C-508's separate draft table exists because the map *document* is authored server-side; C-513 has no such table because asset authoring is local-first (Studio) — the server only ever sees a publish attempt (see the `asset_publish_staging` note in State & Data Models).
- **Transport**: `apps/frontend/hub/src/lib/server/api/storage.ts:85-105` — `content-length` checked against a cap **before** `request.arrayBuffer()`; mirror that shape for the upload hop, and read `MAX_UPLOAD_SIZE` from `@aikami/constants` rather than restating a literal.
- **Content addressing**: `r2AssetKey` (`packages/shared/constants/src/lib/game_assets.ts:306`) — the hash is the address, so the same bytes dedupe across curated and community content. Private staging keys are *not* content-addressed (a hash-keyed staging object would be shared mutable state between uploaders); the hash is applied at promotion.
- **Attribution/licence**: `scripts/src/lib/catalog/preflight.ts:54` (`runAttributionPreflight`) — extract into a shared package first: the hub imports only `@aikami/*` and cannot reach `scripts/`.
- **Client**: `apps/frontend/hub/src/lib/client/services/map_studio_client.ts` mirrors the hub client; `apps/frontend/client/src/lib/services/api/hub_api_client.ts` (`hubApiBase()`, `hubAuthHeaders()`) is the client → hub transport for session/bearer auth on both surfaces.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Local-first is sacred.** Publishing is an explicit, online, signed-in action; nothing about creating or using an asset may depend on it. Importing is local: after an import the bytes live in the on-device cache and resolve with no network.
- **Private intake, public on approval only.** Unreviewed bytes land in a bucket with no public domain. A direct unauthenticated GET of a pending object must be impossible, not merely unlisted. Promotion into `CATALOG_BUCKET` happens at the moderation transition, and only once.
- **One documented I-7 deviation.** `I-7` forbids asset bytes in a hub request handler; C-426's `/storage/upload` already violates it for player-owned objects, and a presigned-PUT design would require long-lived R2 API secrets in the Worker. This contract keeps the binding-only, hub-mediated hop for intake and promotion and records the deviation here rather than leaving it implicit. Bytes still never touch D1/Postgres, and reads (browse, download, delivery) never proxy bytes.
- **Hash is identity; revisions are immutable.** Never overwrite a published object. Re-publishing changed bytes creates a new revision; identical bytes reuse the object.
- **Scoped rights are gated, not inherited.** Replace "generated assets inherit the model licence" with C-518's rights record. Evaluate inference/deployment permission, reference/LoRA obligations, game inclusion and standalone/community distribution **separately**. A model's code license is not sufficient output-rights evidence, and a generated marker is not an exemption.
- **Server-side policy, not client assertion.** The hub re-validates category, size, hash and provenance against known policy/version evidence; it never trusts a client-claimed hash or licence. Where it cannot substantiate a claim it fails closed and records unresolved/manual review. An automated validator cannot establish legal rights from a URL alone.
- **Community namespace separate from the curated catalog.** User submissions use their own namespace/tags; operator-curated catalog tags are never shadowed. All submissions default to `pending`; there is no first-N auto-approval.
- **Pending bytes are private at delivery, not just delisted.** Keep pending/rejected blobs in private R2 staging or behind an authenticated delivery path. Hiding a D1 row does not make an object private in a public catalog bucket — a direct unauthenticated GET of pending bytes must fail even when the caller knows the hash. Publish immutable approved revisions only.
- **Approve via idempotent staged→pending→promoted transitions.** There is no atomic transaction across D1 and R2. Use reserve/upload/commit/promote states, CAS transitions on `asset_publish_staging`, retry reconciliation and reference-aware orphan cleanup. A failed upload must leave no visible row; a DB failure after a successful PUT leaves a recoverable `uploaded` staging row, never deletion of another owner's deduplicated or promoted blob.
- **Publish a redacted provenance projection only.** Never upload raw prompts, local filesystem paths, secrets or private reference art by default. Required credits and transformation lineage are included; a private generation preview does not imply consent to publish.
- **Moderation before visibility.** Nothing is publicly listed until its state is approved; the owner can always see their own submissions and no other user's pending rows.
- **One identity model.** Use the existing session/account; ownership FKs follow C-508's split (CASCADE for the abandoned-attempt staging row, RESTRICT for published rows).
- **Deletion removes visibility; it does not promise universal erasure.** Delisting (owner delete) retains the promoted immutable object while it is referenced; a moderator *takedown* would additionally need a hard delete plus a denylist entry, or re-uploading the same bytes resurrects the object at the same key (`object-storage-layout.md` §4.1) — this contract implements delisting only. Never delete blobs still referenced by approved revisions or other owners. Retain locally accepted/imported copies and pinned packs — server availability cannot revoke offline gameplay.

## Folded C-512 residuals (from the integration addendum)

The 2026-09-13 C-512/C-513 integration addendum was created before C-512 shipped. Its C-512 items that C-512's own execution report still lists as open are folded here so the C-513 execution closes them; the addendum file itself has been merged into this contract. Do not create a second Studio contract.

1. **Multi-emotion expression packs — verified already satisfied, do not rebuild.** The residual was written against the *dev sandbox* loop, not the Studio. `apps/frontend/client/src/lib/views/studio/studio_view_model.svelte.ts:560-621` (`generatePack()`) already requires an NPC-bound recipe (refusing otherwise), iterates `STUDIO_EXPRESSION_PACK_EMOTIONS`, registers each emotion under `expressionAssetTag({ npcId, emotion })` with explicit `npcId`/`emotion` options, records per-emotion partial failure without aborting the run, and never derives the NPC from the prompt slug — and `apps/e2e/tests/client/expression_pack_save.spec.ts` asserts persistence across reload. **In scope for C-513: nothing new here**; the residual reduces to confirming that path in the executed run (item 3). The dev-only `views/dev/image/image_view_model.svelte.ts#generateExpressions` loop still holds object URLs with no NPC id and **stays as-is** — it is a `(dev)` sandbox surface (Pillar 3/4) with no production exposure, and rewiring it is not integration work.
2. **Studio audio is truly usable.** Verified: `apps/frontend/client/src/lib/views/studio/studio_composition.ts:81` hard-codes `engineAvailable: recipe.modality === 'image' && engine !== undefined`, so an audio recipe can never run. Wire every recipe through the shared modality-neutral generation runner keyed by `recipe.modality` and capability-gate (not hard-disable) the UI, so an audio recipe becomes available as soon as an audio engine is registered. The engine/adapter and finishing path are C-521's (`draft`); the runner wiring and the capability gate are this contract's, and are verifiable with a stubbed audio engine (AC-12).
3. **Executed production evidence.** C-512's E2E and visual suites exist (`apps/e2e/tests/client/creator_studio.spec.ts`, `apps/e2e/tests/client/expression_pack_save.spec.ts`, `apps/e2e/src/visual/suites/creator_studio.visual.ts`) but were never executed — C-512 is nonetheless marked `implemented` in `PROGRESS.md`. Run real compiled Svelte E2E against `/studio/assets`: generate, cancel, review, save, reload, rename, delete, quota failure and unavailable engine; show a saved generated portrait in actual NPC dialogue. Record the executed run in the Evidence Matrix (AC-13). The audio-audition case is conditional on C-521 and is recorded as skipped-with-reason until it lands.

Already satisfied by C-512 and not repeated here: one production route `/studio/assets` with a shared VM/composition dev sandbox; registry-based recipe selection; generation → review → acceptance/save through the registry write seam; contextual opt-in default-off, dedup-after-accept and bounded queue; generated library list/rename/delete with eviction protection; registry-first NPC portrait/expression resolution with an explicit tag override; and the multi-emotion pack loop itself (residual 1).

## State & Data Models

TypeBox schemas in `packages/shared/schemas/`; D1 via Drizzle in `packages/backend/database`.

```ts
// D1 (Drizzle) — mirrors the C-508 map tables, minus the server-side draft
// document: asset authoring is local-first, so the only thing the hub needs
// from an owner is a *publish attempt* (upload + moderation) and a *revision*.
// No `asset_drafts` table: the Studio's drafts live in the local registry
// (C-512 `StudioDraft`), and a server-side draft of metadata alone would have
// no reader and no writer.

// asset_publish_staging: one row per in-flight publish attempt. This is the
// AC-8 recovery point — the thing that makes reserve/upload/commit
// representable across two stores that cannot share a transaction.
type AssetPublishStagingRow = {
  id: string;                 // uuid, server-generated (== uploadId)
  ownerAccountId: string;     // FK users.id, CASCADE (an abandoned attempt is not a published row)
  slug: string;               // reserved public id
  revision: number;           // reserved, >= 1
  title: string;
  category: string;           // CatalogCategory
  tag: string;                // resolver tag, url-safe
  ext: string;                // lowercase, includes the dot
  sizeBytes: number;          // declared at reservation; must equal the upload's Content-Length
  sha256?: string;            // filled by the upload hop (hub-computed); absent while 'reserved'
  stagingKey: string;         // staging/<accountId>/<uploadId> in the private intake bucket
  state: 'reserved' | 'uploaded' | 'committed' | 'rolled_back' | 'orphaned';
  provenanceJson: string;     // redacted projection (never prompts or local paths)
  createdAt: number;
  updatedAt: number;
};

// community_assets: immutable committed revisions, content-addressed.
// Only 'pending' | 'approved' | 'rejected' ever exist here — a staging row is
// never visible to any listing (AC-3, AC-6).
type CommunityAssetRow = {
  id: string;                 // uuid
  ownerAccountId: string;     // FK users.id, RESTRICT
  slug: string;               // url-safe public id
  revision: number;           // monotonic, >= 1
  title: string;
  category: string;           // CatalogCategory
  tag: string;                // resolver tag
  sha256: string;             // content address (hub-computed)
  r2Key: string;              // assets/<hash[0:2]>/<hash><ext> — written at promotion, NOT at publish
  sizeBytes: number;
  ext: string;
  provenanceJson: string;     // redacted projection of AssetProvenance (single source of truth)
  license?: string;           // derived from provenanceJson for gate/index queries (SPDX or 'proprietary')
  moderationState: 'pending' | 'approved' | 'rejected';
  moderationNote?: string;    // operator reason for a rejection
  moderatedByAccountId?: string;
  moderatedAt?: number;
  promotedAt?: number;        // set by the approval-time copy into CATALOG_BUCKET; absent ⇒ not public
  createdAt: number;
  updatedAt: number;
};
```

Schema constraints to carry over from C-508 (`schema.ts:297-311`): unique index on `(slug, revision)`; `slug` URL-safe `NOT GLOB '*[^a-z0-9-]*'`; `revision >= 1`; owner and updated-at indexes. Slugs follow C-508: derived from the title/tag with a short suffix on another owner's collision, an explicit slug taken by another owner is a `409`, and a re-publish by the same owner appends the next revision.

```ts
// Wire shapes (hub API). Two steps, so bytes never travel in a JSON body:
//   1. POST /api/assets/community           — reserve (JSON metadata)
//   2. PUT  /api/assets/community/:slug/upload — raw application/octet-stream
// (the second step never precedes a successful first one, so AC-2/AC-7 can
// reject with zero bytes written).
type ReserveAssetRequest = {
  category: CatalogCategory;
  tag: string;
  title: string;
  slug?: string;
  ext: string;                // lowercase, includes the dot
  sizeBytes: number;          // declared; must match the upload's Content-Length
  provenance: AssetProvenance; // redacted projection — never prompts or local paths
  /**
   * C-518's scoped rights record. C-513 must NOT invent this shape; it is a
   * declared seam — see Open Questions Q4. Absent ⇒ the gate fails closed.
   */
  rights?: RightsDecision;
};

type ReserveAssetResult = {
  slug: string;
  revision: number;
  uploadPath: string;         // path the bytes must be PUT to
  stagingState: 'reserved';
};

type PublishAssetResult = {   // returned once the upload hop commits
  slug: string;
  revision: number;
  sha256: string;
  moderationState: 'pending'; // publish always yields pending; other states come from moderation
  deliveryUrl: string;        // owner-only while pending; the CDN URL once approved+promoted
};
```

TypeBox schemas for both wire shapes and `CommunityAssetProvenanceProjection` live in `packages/shared/schemas/` (new `community/` module) and are re-exported as static types from `@aikami/types` — no hand-written duplicate shapes, per the Schema-First law.

## Quality Requirements

- **Offline/degraded mode**: publish/import are the only online operations; every local generation/use path is unaffected. Hub-unavailable returns the C-508 unconfigured 503, not a 500 — and the publish action is disabled, not broken, when the session or the hub is missing.
- **Accessibility/input**: publish and browse use labelled native controls; moderation status is communicated textually, not by colour alone.
- **Performance budget**: the upload hop rejects on `content-length` **before** buffering (the `storage.ts:85-93` shape), capped by `MAX_UPLOAD_SIZE` (`packages/shared/constants/src/lib/game_assets.ts:396`, 50 MiB) — the base64-in-JSON shape this contract previously specified would have buffered ~66 MiB for a capped asset and is explicitly rejected. List endpoints paginate; content-addressed dedup avoids re-uploading identical bytes once a revision is approved.
- **Security/privacy**: session-gated writes; validate category/tag/size/ext/hash server-side; the hub computes the hash, never trusts a client claim; strip EXIF and any embedded metadata that leaks local paths; never publish prompts, model ids or reference art unless the user explicitly elects to; rate-limit publish per account; the intake bucket has no public domain and pending reads go through an owner-checked route.
- **Persistence/migration**: new D1 tables (additive); the new private intake bucket is declared once in `R2_BUCKETS`/`config_gen`; no change to existing map/save/pack tables. Existing local assets are unaffected.
- **Cancellation/retry/idempotency**: a retried publish of identical bytes dedupes by hash; a failed upload rolls the reservation back; retrying an `orphaned`/`uploaded` staging row resumes rather than duplicating.
- **Observability**: log publish outcome (hash, size, category, moderation state) without payloads or provenance contents; expose community counters from the new route, not from C-396's frozen `catalog_stats` shapes.

## Migration & Rollback

- **Old data compatibility**: all new tables are additive; existing hub routes, packs, maps, and saves are untouched. Clients without this contract simply cannot publish/import. Existing catalog objects are unaffected — community promotions write the same content-addressed namespace, and an identical hash already present is a no-op copy.
- **Migration**: one numbered D1 migration (`packages/backend/database/drizzle-d1/0009_*.sql`) adds `asset_publish_staging` and `community_assets`; no backfill. The migration is a hub project input (`@group(migrations)` in `apps/frontend/hub/moon.yml`), so a broken migration fails `hub:test` rather than shipping green.
- **Rollback**: remove routes and gate the UI; rows can be left inert or deleted. Published objects in `CATALOG_BUCKET` can be left (unreferenced) or removed; staged objects in the intake bucket are covered by the 14-day lifecycle rule.
- **Feature flag or kill switch**: `PUBLIC_ASSET_PUBLISHING` (client, read through a `$app/env/public` accessor like `asset_generation_flag.ts`) + the hub route returning 503 when the `UPLOADS_BUCKET`/DB binding is absent.
- **Failure recovery**: reserve (`state: 'reserved'`) → upload (`state: 'uploaded'`) → commit (`community_assets.moderationState: 'pending'`, staging `state: 'committed'`) with CAS transitions on the staging row. An upload/R2 failure rolls the reservation back; a crash between the R2 PUT and the commit leaves a recoverable `uploaded`/`orphaned` staging row and no visible public row. Reference-aware cleanup removes only staging objects with no `uploaded`/`committed` row, and never deletes a promoted object still referenced by a revision or by another owner's dedup.

## Scope Boundaries

- **In Scope:**
  - D1 `asset_publish_staging` + `community_assets` (immutable, content-addressed, moderated).
  - A private intake plane: `R2_BUCKETS.uploads` / `aikami-uploads` (`UPLOADS_BUCKET`), declared once and generated into `wrangler.jsonc`; provisioning the bucket is an ops prerequisite.
  - Approval-time promotion into the shared `assets/<hash[0:2]>/<hash><ext>` namespace; pending/rejected bytes remain private and are delivered only through the owner-checked route.
  - Hub routes: reserve, upload, list, get, delete (owner), moderation transition + promotion (operator).
  - Server-side validation + scoped rights/provenance gate (shared with the catalog preflight).
  - Client publish action in the Creator Studio and community browse/import into the local registry, plus the community browse surface.
  - Community counters for the new surface (a community-scoped route; C-396's `catalog_stats` shapes stay frozen).
  - Folded C-512 residuals: Studio audio capability gating (AC-12) and the executed production E2E/visual evidence for `/studio/assets` (AC-13). Residual 1 (multi-emotion packs) is verified already satisfied by C-512 and requires no new work.
- **Out of Scope:**
  - Generating assets (C-510/C-511) and the creator studio feature itself (C-512), beyond the folded residuals above.
  - Ratings, install counts, comments and recommendations — C-399 (`not_started`) owns social metadata. C-513 adds the community-asset moderation *state machine* it needs, not a social layer.
  - C-398 (`not_started`, "Member Submissions — Signed Upload, Validation, and Moderation") — **reconciliation required**: its asset half is subsumed here (this contract is the one that ships community asset submissions), while its pack half stays with C-398. If C-398 is later written for *packs*, it must reuse this contract's intake plane and moderation states rather than inventing a second one. `docs/contracts/INDEX.md` still lists C-398 as reserved and needs a one-line reconciliation note.
  - Automatically publishing into the operator-curated catalog index (users publish to a community namespace; an approved submission is reachable at its content-addressed URL and listed under `/community/...`, and promotion into the curated index stays a separate operator action).
  - Rewiring the `(dev)` sandbox expression loop (`views/dev/image`) — dev-only surface, no production exposure.
  - Paid/monetized content or revenue sharing.
  - Changing the save/data planes or campaign sharing.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** one outcome — *a user-created asset can be published, privately staged, moderated, promoted, discovered, and imported*. The D1 schema, intake bucket, hub routes, and client flow share one model (content-addressed community asset + provenance) and one invariant (immutable revisions, local-first, nothing public before approval). Discovery without a publish path, or a publish path with no browse/import, is not independently useful. Ratings/recommendations and curated-catalog promotion are separate systems and separate contracts.

**Split note (critic):** the two folded C-512 residuals are independent of the publish outcome and would each merge on their own. They are kept here because the adoption of the C-512/C-513 integration addendum folded them deliberately; if delivery is staged, land Phases 1–4 (publishing) first — AC-12/AC-13 add no schema and no invariant to it.

## Acceptance Criteria

### AC-1: Publish reserves, uploads privately, and records
**Given** a signed-in account and a local asset whose provenance and rights decision permit community distribution
**When** the user publishes it from `/studio/assets`
**Then** the hub validates the metadata, category/tag/ext and declared size, reserves `(slug, revision)` in `asset_publish_staging` with `state: 'reserved'`, the owner's byte PUT checks `Content-Length` before buffering, the hub computes the sha256 itself and writes the object to the **private intake bucket** (`UPLOADS_BUCKET`, key `staging/<accountId>/<uploadId>`), the attempt commits (`state: 'committed'`) to a `community_assets` row with `moderationState: 'pending'`, and the response carries slug/revision/hash plus an owner-only delivery URL. **Nothing is written to `CATALOG_BUCKET` and no public URL exists at this point.** A failed PUT rolls the reservation back (`state: 'rolled_back'`) with no visible row.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | `apps/frontend/hub/src/lib/server/api/tests/asset_publish.test.ts` (mirrors `map_studio.test.ts`) | hub API `POST /api/assets/community` + `PUT /api/assets/community/:slug/upload` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run hub:test`
- Integration: reserve → upload a fixture asset with a stub bucket; assert the staging row, the intake object key, the `pending` row, zero `CATALOG_BUCKET` writes, and rollback on a forced R2 failure; assert an oversized `Content-Length` is rejected before any body read.
- E2E / Visual: N/A — reason: covered by integration + the studio E2E

**Watch Points**:
- The hub recomputes the hash; a client-claimed `sha256` is never trusted (none is even accepted on the wire).
- The declared `sizeBytes` must equal the upload's `Content-Length`; a mismatch fails closed.
- Identical bytes must dedupe to one *promoted* object while still recording each owner's revision.

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
- Integration: reject at the reserve step with a share-prohibited licence / missing provenance; assert the response is a specific error code and **zero** intake and catalog writes
- E2E / Visual: N/A — reason: covered by unit/integration

**Watch Points**:
- A generated asset does **not** inherit the model licence. The gate reads C-518's scoped rights decision; unknown publication rights fail closed (AC-7) with a distinct `rights-unresolved` error.
- The gate runs at *reserve*, so a rejected publish never uploads a byte.

### AC-3: Moderation controls visibility and gates promotion
**Given** a published asset in `pending` whose bytes are still only in the intake bucket
**When** it has not been approved
**Then** it is not in public listings, it has no public URL, and the owner still sees it in their submissions; when an operator transitions it to `approved` the hub copies the object to `CATALOG_BUCKET` at `assets/<hash[0:2]>/<hash><ext>` and records `promotedAt`, and only then does it appear in public listings with a working CDN URL. A `rejected` transition leaves the bytes private and records the operator's reason.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration + E2E | `apps/frontend/hub/src/lib/server/api/tests/asset_publish.test.ts` (list/moderation/promote handlers) + `apps/e2e/tests/client/community_asset_import.spec.ts` (browse appears only after promotion) | hub API `GET /api/assets/community`, `POST /api/assets/community/:slug/moderation` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run hub:test`, `bun moon run e2e:test`
- Integration: reserve+upload → list public (absent, and no object at `assets/<hash…>`) → approve → assert the catalog object exists and the row carries `promotedAt` → list public (present)
- E2E / Visual: functional browse test (`apps/e2e/tests/client/community_asset_import.spec.ts`)

**Watch Points**:
- Owner visibility must not leak other users' pending rows.
- Promotion is the *only* writer to `CATALOG_BUCKET` on this path, and it must be idempotent — approving twice must not create a second copy or a second revision.

### AC-4: Community assets browse and import
**Given** an approved community asset
**When** another player browses the community and imports it
**Then** the asset is added to their local registry as an R2 source with matching hash/category/tag and resolves in-game.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | E2E + Integration | `apps/e2e/tests/client/community_asset_import.spec.ts` + `apps/frontend/client/src/lib/services/assets/*.test.ts` (registry import) | hub `/community/{category}` (public browse) + client `/studio/community` → local registry | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`, `bun moon run hub:test`, `bun moon run e2e:test`
- Integration: import an approved asset and assert an `r2` source row with matching hash/category/tag resolves
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/community_asset_import.spec.ts`
    - **Visual**: `apps/e2e/src/visual/suites/community_assets.visual.ts` — browse grid shows approved assets with attribution

**Watch Points**:
- Import must not shadow an existing locally generated asset with the same tag silently; version or prompt.

### AC-5: Owner delete and local unaffected
**Given** a published asset owned by the user
**When** the user deletes it
**Then** it is removed from public listings (moderation-safe) and the user's local copy remains fully usable; hub-unavailable never blocks local use.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Integration + Unit | `apps/frontend/hub/src/lib/server/api/tests/asset_publish.test.ts` + `apps/frontend/client/src/lib/views/studio/studio_view_model.test.ts` | hub API `DELETE /api/assets/community/:slug` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run hub:test`, `bun moon run client:test`
- Integration: delete published → delisted, the promoted object is not deleted while another revision/owner references its hash, local library intact
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
| AC-6 | Integration | `apps/frontend/hub/src/lib/server/api/tests/asset_publish.test.ts` (direct pending-blob GET denial) | hub API `GET /api/assets/community` + `GET /api/assets/community/:slug/raw` (owner-only) | Filled during verification |

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
| AC-7 | Unit + Integration | shared preflight tests (`packages/shared/utils/src/lib/...` or wherever the extracted validator lands) + `apps/frontend/hub/src/lib/server/api/tests/asset_publish.test.ts` | hub API `POST /api/assets/community` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run hub:test`, `bun moon run scripts:test`
- Integration: publish with a game-use-only rights decision; assert rejection and zero R2 writes
- E2E / Visual: N/A — reason: covered by unit/integration

**Watch Points**:
- The gate must read the scoped decision from C-518 evidence — never infer output rights from the base model's code license.

### AC-8: Reserve/upload/finalize is idempotent across D1 and R2 failures
**Given** injected D1 and R2 failures at each publish transition (reserve, upload, commit, promote)
**When** the publish is retried
**Then** exactly one immutable revision is committed, promotion happens at most once, no shared/deduplicated or promoted object is deleted, and a DB failure after a successful PUT leaves a recoverable `uploaded` staging row rather than a visible public row.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-8 | Failure-injection integration | `apps/frontend/hub/src/lib/server/api/tests/asset_publish.test.ts` transition matrix | hub API `POST /api/assets/community` + `PUT /api/assets/community/:slug/upload` + `POST /api/assets/community/:slug/moderation` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run hub:test`
- Integration: fail before the PUT, after the PUT before the commit, and during promotion; retry each and assert the staging row's CAS state
- E2E / Visual: N/A — reason: covered by integration

**Watch Points**:
- There is no cross-store transaction. "Exactly one committed revision" is a CAS/idempotency invariant, not a database transaction.

### AC-9: Private Hub generation is not publication
**Given** a private Hub generation result (C-522, stubbed runner until it lands)
**When** the job finishes
**Then** no community publish occurs until a distinct, explicit publish action succeeds.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-9 | Integration | Hub job/publication separation test | client `/studio/assets` + hub API `POST /api/assets/community` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run hub:test`
- Integration: complete a generation job with auto-publish off; assert zero `community_assets` and zero `asset_publish_staging` rows
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
| AC-10 | E2E | `apps/e2e/tests/client/community_asset_import.spec.ts` + `apps/frontend/client/src/lib/services/audio/audio_asset_resolver.test.ts` | client `/studio/community` import → local registry + runtime resolution | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`, `bun moon run e2e:test`
- Integration: import, cache, reload offline, assert runtime use (not just a registry row)
- E2E / Visual: `apps/e2e/tests/client/community_asset_import.spec.ts` for the visual case; audio asserted through `audio_asset_resolver` (the saved-audio *audition* half is conditional on C-521 — record as skipped-with-reason until it lands)

**Watch Points**:
- A freshly imported row must enter the actual selection/index used by the music and asset resolvers — not merely exist in a table.

### AC-11: Import collisions are explicit
**Given** an imported asset whose category/tag collides with a curated catalog entry or a local accepted asset
**When** the import runs
**Then** the collision is surfaced and resolved explicitly (version or prompt); a curated or local accepted tag is never silently replaced.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-11 | Unit + Integration | `apps/frontend/client/src/lib/services/assets/*.test.ts` (import collision) + `apps/frontend/hub/src/lib/server/api/tests/asset_publish.test.ts` | client `/studio/community` import path | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: import a colliding tag and assert an explicit resolution
- E2E / Visual: N/A — reason: covered by unit/integration

**Watch Points**:
- Reuse the C-510 seed-tag collision guard (`assets_generated.ts#isSeedTagRow` / `GeneratedTagCollisionError`, `generated_asset_registration.ts:106-111`); do not author a second collision policy.

### AC-12: Studio recipes are capability-gated through the modality-neutral runner
**Given** the Studio recipe list at `/studio/assets`
**When** the composition resolves engine availability per modality
**Then** every recipe is dispatched through the shared modality-neutral generation runner keyed by `recipe.modality` (replacing `studio_composition.ts:81`'s `modality === 'image'` hard check), so an audio recipe becomes available the moment an audio engine is registered — and while none is registered, the UI states why it is unavailable instead of silently disabling it.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-12 | Integration + E2E | `apps/frontend/client/src/lib/views/studio/studio_view_model.test.ts` + `apps/frontend/client/src/lib/views/studio/studio_composition.ts` test + `apps/e2e/tests/client/creator_studio.spec.ts` (audio-gated case) | client `/studio/assets` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`, `bun moon run e2e:test`
- Integration: with a stubbed audio engine registered, an audio recipe reports `engineAvailable: true` and dispatches through the runner; with none registered it is *gated* with a stated reason, not hard-disabled
- E2E / Visual: `apps/e2e/tests/client/creator_studio.spec.ts` audio-gated case

**Watch Points**:
- C-521 supplies the audio engine/adapter; this AC covers wiring and gating only, and must stay verifiable with a stub. Do not hard-code a modality switch in the view.

### AC-13: The C-512 production evidence is executed, not merely authored
**Given** the compiled Svelte client with the generation engine stubbed at the C-510 sd-server transport boundary
**When** the E2E and visual suites run
**Then** `apps/e2e/tests/client/creator_studio.spec.ts` exercises generate, cancel, review, save, reload, rename, delete, quota failure and unavailable engine against the production `/studio/assets` route; `apps/e2e/tests/client/expression_pack_save.spec.ts` shows a saved generated portrait resolving in NPC dialogue after reload; and `apps/e2e/src/visual/suites/creator_studio.visual.ts` passes — with the executed run (date, command, result) recorded in the Evidence column below.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-13 | E2E + Visual | `apps/e2e/tests/client/creator_studio.spec.ts`, `apps/e2e/tests/client/expression_pack_save.spec.ts`, `apps/e2e/src/visual/suites/creator_studio.visual.ts` | client `/studio/assets` + NPC dialogue overlay | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run e2e:test`, plus the visual runner's documented entry point
- E2E / Visual: the three artifacts above, executed (not skipped); the audio-audition case is recorded as skipped-with-reason until C-521 lands

**Watch Points**:
- "Authored" is not evidence. Paste the executed result; a skipped suite is a failure of this AC.
- C-512 is marked `implemented` in `PROGRESS.md` while this evidence was unexecuted — state the discrepancy in the execution report.

### AC-14: The D1 migration is additive and its failures are caught
**Given** a hub database at migration `0008_community_map_revisions`
**When** `0009_*` is applied
**Then** `asset_publish_staging` and `community_assets` are created with their unique/check indexes, no existing table or row changes (accounts, packs, maps, saves unaffected), and the migration applies cleanly on both a fresh and an already-populated database.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-14 | Schema/Integration | `packages/backend/database/tests/*` conformance test + the existing hub suites, which apply `drizzle-d1/*.sql` to in-memory libsql | D1 `aikami-hub` at deploy | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run backend-database:test`, `bun moon run hub:test`
- Integration: apply `0008` then `0009` to a populated fixture; assert prior rows survive and the new constraints reject a duplicate `(slug, revision)` and a non-URL-safe slug

**Watch Points**:
- `@group(migrations)` must appear in `apps/frontend/hub/moon.yml`'s test inputs so a broken migration cannot ship green; assert it while implementing.

## Implementation Sequence

1. **Phase 1 (Infra + Schema)**: declare the private intake plane — `R2_BUCKETS.uploads` (`packages/shared/constants/src/lib/infrastructure.ts`), `uploads` added to `KeySpec['bucket']` with a `stagingObjectKey` spec (`packages/shared/schemas/src/lib/storage/keys.ts`), `apps/backend/cloudflare/src/lib/config_gen.ts` + regenerated `wrangler.jsonc`, `apps/frontend/hub/src/app.d.ts` binding — then D1 `asset_publish_staging` + `community_assets` + `drizzle-d1/0009_*.sql` + row types. Provisioning `aikami-uploads` in Cloudflare is an ops prerequisite; until the binding exists the routes 503.
2. **Phase 2 (Preflight)**: extract the licence/provenance validator from `scripts/src/lib/catalog/preflight.ts` into a shared package (the hub cannot import `scripts/`); add the C-518 rights seam and the fail-closed default.
3. **Phase 3 (Hub routes)**: reserve, upload (content-length pre-check + hub-computed hash → private intake), list, get, owner delete, moderation transition + promotion, owner-only `raw` delivery; CAS transitions and rollback.
4. **Phase 4 (Client)**: publish action in the studio via `hub_api_client.ts`; `/studio/community` browse + import into the local registry; collision handling.
5. **Phase 5 (Folded C-512 residuals)**: route recipe dispatch through the modality-neutral runner with capability gating (AC-12), then execute the studio E2E/visual evidence (AC-13).
6. **Phase 6 (Validation)**: `bun moon run hub:test`, `bun moon run backend-database:test`, `bun moon run client:test`, `bun moon run e2e:test`; executed studio E2E + visual evidence (AC-13), community import E2E, visual browse suite, migration conformance (AC-14).

## Edge Cases & Gotchas

- **Content-address dedup vs ownership**: two users publishing identical bytes share the promoted object but need distinct rows/revisions and attribution.
- **Takedown vs delist is not the same operation, and content addressing makes deletion reversible.** An owner delete (AC-5) is a *delist*. A moderator removing illegal content needs a hard delete **plus** a denylist entry, or re-uploading the same bytes silently resurrects the object at the same key (`docs/architecture/object-storage-layout.md` §4.1). This contract implements delist; if a takedown path is added it must carry the denylist. State the distinction in the UI copy rather than promising erasure.
- **Moderation bypass**: never list pending/rejected assets publicly, and never let a direct object URL or known hash bypass delivery privacy (AC-6). A pending object must not be reachable at `assets.bearlysleeping.com` at all.
- **Promotion is the only public writer**: it must be idempotent and must not overwrite an existing object at the same content-addressed key (an identical hash is already the same bytes, so promotion is a no-op copy).
- **Rights scopes**: a generated asset does not inherit the model licence. Inference permission, game inclusion and standalone/community redistribution are separate decisions resolved from C-518 evidence — never default to permissive, and never treat a missing rights record as permission.
- **Oversized/abusive uploads**: bound size and category server-side *before* reading the body (`Content-Length` first, `storage.ts:85-93` shape); rate-limit publish per account.
- **EXIF/local paths**: strip metadata that leaks the creator's machine, and keep prompts, seeds and local paths out of the stored provenance projection.
- **RESTRICT ownership**: account deletion with published assets needs an explicit policy (C-508 precedent), not an accidental cascade; `asset_publish_staging` is CASCADE because a staging row is an abandoned attempt, not a published record.
- **Local-first regression**: any code path that makes asset use depend on the hub is a bug in this contract.

## Open Questions

Resolved by the integration addendum adopted in v2.1.0:

- **Q1 — community namespace vs curated catalog?** Resolved: separate community namespace, browsable like C-396, with operator promotion into the curated catalog as a later action. Never shadow curated tags. Storage-wise the bytes *do* share one content-addressed namespace (`docs/architecture/object-storage-layout.md` §3.1) — only the index is separate.
- **Q2 — auto-approve a creator's first N assets?** Resolved: all submissions `pending` by default; no auto-approval.
- **Q3 — imports are per-asset or per-pack?** Resolved: per-asset in this contract; content packs remain a separate concern (pack pipeline, not this route). Note this diverges from `object-storage-layout.md` §3.2 ("packs are the unit of community content") — the docs amendment in Docs Impact records the decision.

Opened by the v2.2.0 critic pass, with a decided stub so implementation is not blocked:

- **Q4 — what exactly does C-518's scoped rights record look like?** C-513 must not invent the shape. Decided stub: the reserve request carries an optional `rights: RightsDecision` (type owned by C-518, added to the shared schema package when C-518 lands) and the gate fails **closed** with a distinct `rights-unresolved` error when it is absent or when any required scope (inference, game inclusion, standalone/community distribution) is unproven. Consequence to accept consciously: until C-518 lands, only assets the creator owns outright (`source: 'original'` with a declared SPDX licence) can publish — generated assets are blocked by design, not by accident. C-518's implementation must not need a C-513 change to activate; only the schema arrives.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-09-12 | Initial draft. | pending user approval |
| 2.1.0 | 2026-09-13 | Adopted the C-512/C-513 integration addendum: scoped rights gate (C-518), server-side policy validation, separate community namespace, private-at-delivery staging, idempotent reserve/upload/finalize with reference-aware cleanup, redacted provenance projection, deletion semantics, collision handling; added AC-6–AC-11; resolved Q1–Q3; folded open C-512 residuals (multi-emotion expression packs, Studio audio path, executed production E2E/visual evidence) into this contract's execution scope. | pending user approval |
| 2.2.0 | 2026-09-13 | Critic pass (adversarial review against the codebase and the architecture docs), no scope change: (a) the publish transport was a base64 JSON body into a hub handler and wrote straight to the public `CATALOG_BUCKET` — replaced with reserve → private-intake upload → approval-time promotion, which is what made AC-6 satisfiable and what `object-storage-layout.md` §3/§4 already prescribed; (b) dropped the unused `asset_drafts` table (local-first authoring has no server draft) and added `asset_publish_staging` so AC-8's staged/finalize states are representable; (c) removed the `community/assets/` key and the duplicated `licenses`/`authors`/`sourceUrls` columns (shared `assets/<hash…>` namespace, `provenanceJson` as the single projection); (d) community counters no longer extend C-396's frozen `catalog_stats` shapes (C-399 owns them); (e) corrected paths/tasks (hub tests live in `api/tests/`, e2e specs in `apps/e2e/…`, visual suites in `src/visual/suites/`, `r2AssetKey` at `game_assets.ts:306`, preflight at `catalog/preflight.ts`); (f) recorded the I-7 deviation and the C-398/C-399 reconciliation; (g) verified folded residual 1 already satisfied by C-512 and narrowed it accordingly; (h) added AC-12 (modality-neutral runner + capability gating), AC-13 (executed C-512 production evidence) and AC-14 (additive migration); opened Q4 with the C-518 rights seam. | critic |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
