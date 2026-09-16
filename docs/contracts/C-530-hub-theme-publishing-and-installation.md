---
id: C-530
title: "Hub theme publishing and installation"
source: "direct"
contract_type: full
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-14"
---

# Contract C-530: Hub theme publishing and installation

## Metadata

| Field | Value |
|---|---|
| **Source** | User request: optimal customizable Aikami UI/HUD/menus and community themes; source review at `b3e8234b6ced2c6c8ae1a62aa023850ed3ad85c4` |
| **Target** | Hub community publishing/category/detail routes, shared theme API, client theme download/install integration |
| **Type** | full |
| **Priority** | P1 — coherent player experience and safe customization foundation |
| **Dependencies** | C-529 (`implemented`, PR #361, on `main`) — validated portable themes, local installer, the shared validator/compiler and the theme package format; C-528 (`implemented`) — HUD presets reused by the attached-preset opt-in; C-513 (`implemented`) — community intake/moderation/promotion infrastructure. All three are on `main`; `docs/contracts/PROGRESS.md` still lists C-529 as `draft`, which is stale (the contract frontmatter and `git log` both say `implemented`). |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | User-facing → extend the existing `apps/frontend/docs/src/content/docs/guides/theming-your-interface.mdx` (C-529) with the Hub publish/discover/install/update journey and add `apps/frontend/docs/src/content/docs/guides/publishing-themes.mdx` for creators (package format, rights declarations, moderation states, immutability, versioning, removal). The Guides sidebar autogenerates from that directory (`apps/frontend/docs/astro.config.ts`), so no manual navigation entry is needed; precedents are `guides/publishing-catalog-assets.mdx` and `guides/customizing-your-hud.mdx`. |
| **Contract version** | 2.1.0 |
| **Production Surface** | Hub `/community/themes` (browse) and `/community/themes/[slug]` (detail, immutable version selector); theme publish/download API family `/api/assets/themes*`; client `/settings?section=interface` → Interface → Appearance and `/game` |

Draft ID is provisional and unreserved. Confirm it is still unused before adding this file to the repository. This document records proposed behavior; its ACs are not yet verified or approved by this planning deliverable.

## Problem & Baseline Evidence

- Existing community publishing reserves authenticated revisions, stages private bytes and promotes approved assets. Its current asset/category validation does not establish a complete theme package catalog and client install experience.
- No code-reviewed theme-specific publish → browse → download → install lifecycle can be inferred from existing generic pack schemas.
- Reproduce by trying to publish a C-529 package as a theme and install its compatible immutable version through Hub.
- Reuse `apps/frontend/hub/src/lib/server/api/asset_community.ts`, shared helpers/moderation, C-513 schemas and client import patterns. Inspect ownership, moderation and upload tests before extending.

Verified during critique (source read on `main`):

- C-513 already owns the generic path: `POST /api/assets/community` (reserve), `PUT /api/assets/community/:slug/upload`, `POST /api/assets/community/:slug/moderation`, `GET /api/assets/community` (listing), `GET /api/assets/community/:slug`, `GET /api/assets/community/:slug/raw` (owner-only while pending) and `DELETE /api/assets/community/:slug`, registered in `apps/frontend/hub/src/lib/server/api/index.ts`; the public browse page is `apps/frontend/hub/src/routes/(public)/community/[category]/`.
- There is **no** community detail route today — `(public)/community/[category]/` holds only `+page.server.ts` and `+page.svelte`. The detail-page precedent is `(public)/catalog/[category]/[tag]/`.
- That browse route validates `params.category` against `CatalogCategorySchema` and 404s anything else, so `themes` cannot be browsed through it without a schema decision (see Architecture Directive 1).
- `ReserveAssetRequestSchema.category` is `CatalogCategorySchema`, `communityAssets.category` / `assetPublishStaging.category` are stored as "CatalogCategory value", and `extensionAllowedForCategory` (`asset_community_shared.ts`) falls back to the image/audio MIME maps — `.zip` is in neither, so a theme package is refused at *reserve* today.
- C-529 shipped the reusable core: `@aikami/frontend/theme` exports `validateThemePackage`, `checkThemeArchiveContainer`, `buildThemePackage` and `isThemeApiRangeSupported`; the Hub already aliases `@aikami/frontend/theme` (`apps/frontend/hub/vite.config.ts:153`) and declares the dependency, so the server can run the same validator the client and CLI use.
- The package is a bounded ZIP (`THEME_MAX_ARCHIVE_BYTES` 10 MiB, `THEME_MAX_ENTRIES` 128, `THEME_MAX_EXPANDED_BYTES` 25 MiB, plus the compression-ratio guard in `theme_archive.ts`). The manifest (`packages/shared/schemas/src/lib/game/theme.ts`) carries `kind: 'aikami-theme'`, `id`, `version`, `themeApiRange`, `name`, `author.displayName`, `license`, `variants`, `assets[]` and optional `preview` / `hudPreset` — and **no** font-language metadata.
- `validateThemePackage` is pure over already-extracted entries; the repo's only extractor is the client's JSZip path (`apps/frontend/client/src/lib/services/theme/theme_package_service.svelte.ts`), and the Hub has no ZIP dependency.
- The local Hub Vite dev service provides **no** Worker bindings (`scripts/src/lib/herdr/session.ts:220`), so `resolveAssetCommunityEnv` returns `undefined` and the surface degrades to 503. The binding-bearing lane is the `hub-worker` service (`wrangler dev --local`, port 5278), which requires `bun moon run hub:build` first.

## User Outcome

A creator can publish a valid theme to Hub, and another player can discover, preview, download/install and update it with compatibility information and a safe offline fallback.

## Success Measures

- Production end-to-end fixture journey covers creator upload, moderator approval, public discovery and separate-client installation of exactly the approved version.
- Install/update completes within the C-529 local budget: the installed package recompiles and applies within the C-529 warm-apply measure (p95 ≤150ms excluding optional asset decode), with download progress and cancellation staying responsive.
- Browsing public themes does not require sign-in unless existing Hub policy explicitly requires it; publishing/moderation follows existing authorization. Offline use of an installed theme never requires sign-in.
- Interrupted upload/download/update is retryable and leaves the currently active theme intact. No unpublished bytes appear on public catalog URLs.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Private intake and publication | `apps/frontend/hub/src/lib/server/api/asset_community.ts` | Extend/reuse invariants; theme package validation is not ordinary image validation |
| Moderation and delivery | `asset_community_moderation.ts; asset_community_shared.ts` | Reuse owner/moderator rights and approved public delivery |
| Community browse | `apps/frontend/hub/src/routes/(public)/community/[category]/` | Add discoverable themes capability/category |
| Schema and publish gates | `packages/shared/schemas/src/lib/community/` | Extend typed themes without weakening existing assets |
| Local theme installer | `C-529` | Reuse exact validator/compiler/transaction semantics |
| Client asset import pattern | `apps/frontend/client/src/lib/services/assets/community_asset_import.ts` | Reuse trusted configured-Hub integration patterns |
| Theme validator / compiler / archive core | `@aikami/frontend/theme` — `packages/frontend/theme/src/lib/theme/theme_package_validation.ts`, `theme_archive.ts`, `theme_compiler.ts` | Reuse verbatim on the server; the Hub already aliases and depends on this package |
| Trusted Hub endpoint + auth headers | `apps/frontend/client/src/lib/services/api/hub_api_client.ts` (`hubApiBase`, `hubAuthHeaders`) | The only accepted origin for theme download/install |
| Local theme install/apply/revert | `apps/frontend/client/src/lib/services/theme/theme_package_service.svelte.ts` | Extend with a Hub download source; keep the existing stage → preview → commit semantics |
| Community asset/staging tables | `packages/backend/database/src/lib/schema.ts` (`communityAssets`, `assetPublishStaging`, `assetPublishRateLimits`) + `packages/backend/database/drizzle-d1/` | Additive migration only; do not alter the existing three-state moderation CHECK |
| API route registration | `apps/frontend/hub/src/lib/server/api/index.ts` | Register theme handlers beside the existing `/assets/community*` routes |
| Community view models | `apps/frontend/hub/src/lib/views/community/` | Extend for theme listing/detail rather than a parallel view stack |

Paths abbreviated to sibling filenames in this table are relative to the named feature directory. Verify exact exports at the implementation base.

## Overview

Complete the community distribution loop for portable themes. Reuse existing authentication, metadata storage, private intake, content addressing and moderation instead of creating another marketplace service. Isolate theme-specific validation and preview behavior from gameplay asset ingestion — the Hub is a separate SSR app from the client, so anything shared must live in a package both can import.

## Design Reference

- `docs/design/aikami_ui_hud_theme_review_2026q3.md` in this bundle defines visual direction, navigation mapping, defaults and ecosystem boundaries.
- Existing `docs/design/game_ui_hud_overhaul.md` and `views/dev/obsidian/` are context; do not copy stale defect claims or treat a dev sandbox as production evidence.
- Read current `AGENTS.md`, `.context/CONTEXT.md`, `.context/index.md` and required project skills: `aikami-conventions`, `svelte-conventions`, `aikami-ui`, `testing`; add backend/PixiJS skills when actually touching those boundaries.
- Keep Aikami semantic HTML/classes; complex components only for meaningful structure, behavior, accessibility or a reusable API.

> Testing conventions: [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions).

## Architecture Directives

1. Add an explicit theme package kind/category and immutable version metadata; do not disguise a zip as a background image or feed arbitrary bytes to image-specific processing. Reuse existing shared infrastructure through narrow adapters; introduce dedicated theme handlers only where package semantics require them.
   **Resolved during critique:** a theme is *not* a `CatalogCategory`. `CatalogCategorySchema` (`packages/shared/schemas/src/lib/catalog/catalog_index.ts`) is the catalog *scan* category union; widening it with `themes` would also make themes valid for `ASSET_CATEGORIES` scanning, studio categories, generation recipes and `ReserveAssetRequestSchema` — exactly the "zip disguised as an asset" outcome this directive forbids. Instead: (a) a theme-only kind discriminator (the manifest already carries `kind: 'aikami-theme'`); (b) a dedicated theme handler family registered beside the existing routes — `POST /api/assets/themes`, `PUT /api/assets/themes/:slug/upload`, `GET /api/assets/themes`, `GET /api/assets/themes/:slug`, `GET /api/assets/themes/:slug/raw` (owner-only while pending), `POST /api/assets/themes/:slug/moderation` — reusing `asset_community_shared.ts` / `asset_community_moderation.ts` internals; and (c) browse/detail pages at `/community/themes` (a static route, which SvelteKit resolves ahead of the sibling `[category]` dynamic route) and `/community/themes/[slug]`, mirroring the `/catalog/[category]/[tag]` detail precedent. If implementation finds a static/dynamic sibling conflict, register the actual path and update every Production Path in this contract before verification.
2. Server validates metadata, theme API compatibility, bounded manifest/assets, hash integrity and the C-529 profile before publication. Reuse the same core validator; where binary/font sanitization needs a different runtime, use the supported validation execution path and keep intake pending until it succeeds. Client-supplied pass/fail claims are never authoritative.
   **Resolved during critique:** the "supported validation execution path" is `validateThemePackage` / `checkThemeArchiveContainer` imported from `@aikami/frontend/theme` (the Hub alias already exists) and called with a `ThemePackageReader` built from the uploaded bytes. That function is pure over *already-extracted* entries, and the repo's only extractor is the client's JSZip path — the Hub has no ZIP dependency — so the one genuinely new piece is a Worker-runtime extractor. It must enforce `THEME_MAX_ARCHIVE_BYTES`, `THEME_MAX_ENTRIES`, `THEME_MAX_EXPANDED_BYTES` and the `THEME_MAX_COMPRESSION_RATIO` guard *before* expanding an entry, so a compression bomb is refused without being decompressed. Record the chosen extractor in the implementation notes; a client-supplied validation result may never substitute for it.
3. Preserve private intake → validated pending version → moderation → public approved bytes. Failed/rejected uploads stay nonpublic. Enforce creator ownership, existing auth/rate limits, moderator permissions and rights declarations for bundled fonts/ornaments. Prevent metadata from pointing to another user's object.
   **Constraint from the shipped format:** the C-529 manifest carries exactly one package-level `license` string plus `assets[]` entries whose `sha256` is an integrity check, not a rights attestation — there is no per-asset rights field. Rights therefore come from the existing C-513 reserve-time provenance gate (`evaluateCommunityPublishGate` / `resolveRightsDecision`), and any per-asset declaration the creator writes is displayed as a declaration, never as a verified right. Reserve the theme id globally with the existing `slug-taken` conflict semantics: the manifest `id` and `author.displayName` are display data, and neither may be used to resolve identity or ownership.
4. D1 stores metadata, moderation state and immutable revision references; R2 stores bytes. No provider or infrastructure replacement. An upload idempotency key and package digest deduplicate retries within the existing ownership model. Define resumable/retry behavior supported by existing transport and expiry cleanup for abandoned staging.
   **Resolved during critique:** the existing model already supplies the idempotency handle — the reserve-generated staging row id doubles as the upload id, `asset_publish_staging_live_unique` (which excludes `rolled_back`) permits exactly one live reservation per `(owner, slug, revision)`, the server computes `sha256` itself, and promotion is an idempotent content-addressed copy. Reuse those semantics; do not introduce a second, client-supplied idempotency key. A re-publish of the same `(theme id, version)` must fail with a distinct `duplicate-version` error rather than minting a new revision.
5. Themes listing/detail show author, version, license, light/dark variants, compatible theme API range, preview contexts, download size, update notes and validation status. Distinguish validator success, moderator approval and subjective visual quality. Include report and existing moderation actions; do not create a misleading certified-accessible badge.
   **Scoped to what the format carries:** the manifest has no font-language or font-fallback metadata. Show the derived facts instead — declared `fontFamily`/`fontWeight` tokens per variant, which variants the package actually ships, asset count and total `packageBytes`, `themeApiRange` and the client's `THEME_IMPLEMENTED_API_MAJOR` support verdict. Do not render a field the manifest cannot supply.
6. Preview uses isolated, trusted fixture components and the same token compiler. No user scripts/styles, real campaign messages, external theme resource requests or skinning of Hub's own navigation/auth/moderation UI. Creator-supplied screenshot is labeled/treated as media; rendered fixtures are the reliable behavioral preview.
   **Resolved during critique:** the C-529 preview fixtures live in the client app (`apps/frontend/client/src/lib/views/settings/interface/theme_preview_fixtures.ts`) and are not importable from the Hub, which is a separate app. Either promote that fixture set into a shared package (`packages/frontend/theme` or `packages/frontend/components`) and consume it from both apps, or build Hub-local fixtures that render from the same compiled token CSS. Record which was done; do not reach across app boundaries.
7. Install handoff carries trusted Hub theme/version identity, not an arbitrary executable path or source URL. Native/browser consumers resolve through configured trusted Hub endpoints; offer ordinary download/import when native handoff is unavailable. Deep-link parsing rejects arbitrary schemes/hosts/path traversal and cannot auto-apply a pack.
   **Resolved during critique:** the configured trusted endpoint is `hubApiBase()` (`apps/frontend/client/src/lib/services/api/hub_api_client.ts`), already the transport base for community browse/import, and the native handoff uses the existing `tauri-plugin-deep-link` registration in `apps/frontend/client/src-tauri/tauri.conf.json`. The handoff payload is `{ themeId, version, source: 'configured-hub' }` resolved against `hubApiBase()` — never a URL or filesystem path taken from the link.
8. Download approved manifest and bounded bytes, verify hash/API compatibility locally, stage and show Preview. Apply requires the player's action. Attached HUD preset is an independent opt-in with preview; existing personal accessibility and widget overrides survive appearance-only application.
9. Updates are immutable versions with notes. Never silently activate a downloaded update. Retain last-known-good version for Revert; interrupted downloads and incompatible updates leave current appearance working. Offline installed themes remain usable if a listing is removed; revocation prevents future public distribution and offers local removal information when connected. Do not add a network boot gate.
10. Published preview/export content must be synthetic or explicitly supplied by the creator; never automatically capture their real save. Account/author identity is supplied by the authenticated server, not blindly trusted from manifest displayName.
11. Document schema migrations, category registration, server limits, install/update and moderation flows. Preserve existing map/image/audio community behavior with targeted regression checks. Ensure COEP/CORS and content-disposition/media types work with the supported Tauri client.
12. Provide clear errors for unsupported client/theme API, removed listing, pending/rejected moderation, incomplete download, license metadata problems, unavailable sanitizer, quota, signed-out publisher and duplicate version. Avoid exposing intake signed URLs or private object keys in public metadata.

## State & Data Models

```ts
type PublishedThemeVersion = {
  themeId: string;
  version: string;
  ownerAccountId: string; // authoritative server identity, not author-supplied
  themeApiRange: string;
  packageSha256: string;
  packageBytes: number;
  moderationState: 'pending' | 'approved' | 'rejected';
  /** Set when public distribution is revoked; never a fourth moderation state (see below). */
  revokedAt?: number;
  variants: ('light' | 'dark')[];
};
type ThemeInstallIntent = {
  themeId: string;
  version: string;
  source: 'configured-hub';
};
```
Reuse existing moderation states/ID conventions rather than introducing conflicting enums. This shape states required semantics, not exact database column names. Shared TypeBox request/response schemas validate route boundaries; explicit DB migrations extend existing D1 tables or add related theme-version tables if existing asset rows cannot express immutable package semantics safely.

**Resolved during critique — removal is not a moderation state.** The only states that exist are `pending | approved | rejected`, declared twice and both closed: `COMMUNITY_ASSET_MODERATION_STATES` (`packages/shared/schemas/src/lib/community/asset_publishing.ts:52`) and the D1 CHECK constraint `community_assets_moderation_state_valid` (`packages/backend/database/drizzle-d1/0009_community_asset_publishing.sql:61`). SQLite cannot alter a CHECK constraint in place, so adding a fourth `removed` value would force a table rebuild of a live table for no benefit. Model removal as a separate revocation marker (`revokedAt`) on the theme version: `revokedAt` set ⇒ public delivery and listing both refuse, the moderator audit trail stays intact, and already-installed packs keep working offline (Architecture Directive 9). The same three-state union is reused verbatim in the API response schemas.

## Quality Requirements

- **Offline/degraded:** already installed packs continue to work; browse/download errors never affect game startup.
- **Accessibility/input:** browse/detail/preview/install/update flows work by keyboard and pointer/touch; preview can inspect readable/high-contrast modes without changing the host.
- **Performance:** paginated listing and bounded thumbnails/previews; do not decode all theme assets in catalog tiles. Server validation never expands more than `THEME_MAX_EXPANDED_BYTES` (25 MiB) and refuses a compression bomb before decompressing. Download progress and cancellation remain responsive.
- **Security/privacy:** server auth/ownership/moderation; private intake until approval; identical client/server format validation; trusted origin/deep links; no external theme execution or automatic real-save screenshots.
- **Persistence/migration:** additive D1 schema migration where needed; immutable public version/digest; local installer atomically activates.
- **Cancellation/retry/idempotency:** duplicate publish commits do not create duplicate versions; interrupted update retains previous working bytes; abandoned intake cleaned by explicit policy.
- **Observability:** structured upload/validation/moderation/download events with opaque operation IDs; no signed URLs, secrets, private theme intake URLs or campaign text.

## Migration & Rollback

- Add theme-specific metadata/kind support without changing existing image/audio/map payload contracts. Ship it as the next Drizzle D1 migration in `packages/backend/database/drizzle-d1/` (currently ending at `0011_generation_runner_pairing.sql`) generated by the existing `drizzle-kit` flow, and keep the migration additive: new tables and nullable columns only, no change to the `community_assets` / `asset_publish_staging` CHECK constraints. Test old clients and old asset routes against the additive migration.
- Gate new publication/installation discovery via existing feature/config patterns; the local fallback always works even if Hub theme publishing is disabled.
- Publication makes approved immutable bytes available only after the version metadata is committed according to existing moderation consistency rules. Reconcile failed copy/metadata transitions rather than exposing partially approved versions.
- Rollback hides new Hub entry points and blocks new publishes without deleting approved versions or breaking already installed packs. Local active pointers and previous versions remain available.
- Removed/rejected versions cannot be newly fetched through public delivery; test actual object delivery behavior, not merely filtered listing rows.

## Scope Boundaries

- **In Scope:** creator publish/update, server validation (shared C-529 validator behind a Worker-runtime extractor), private intake/moderation, Hub themes browse/detail/preview, rights metadata, download/native handoff with fallback, local install/update/revert, the theme-only kind discriminator and dedicated `/api/assets/themes*` handler family, `/community/themes` + `/community/themes/[slug]` routes, the additive D1 migration, and creator/player docs.
- **Out of Scope:** paid marketplace, new auth/database provider, cloud account-wide appearance sync, executing theme mods, new asset-generation providers, uploading on behalf of the user during this planning task, widening `CatalogCategorySchema` / `ASSET_CATEGORIES` to include themes, and any change to the existing three-state community moderation enum.

## Contract Size & Split Rule

> Split on independent mergeability: [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule).

**For this contract:** One vertical community-sharing outcome across Hub and client with a shared theme model and immutable-version invariant. It depends on the proven local installer; do not split it into a catalog-only PR that claims a working install ecosystem.

## Acceptance Criteria

### AC-1: Creator publish and private staging
**Given** an authenticated creator owns a valid C-529 package.
**When** they reserve/upload/commit it and retry the commit.
**Then** exactly one immutable pending version exists; bytes stay nonpublic and owner identity comes from the session.
**Production Path**: Hub theme publish entry point — `POST /api/assets/themes` then `PUT /api/assets/themes/:slug/upload`.
### AC-2: Server rejection and isolation
**Given** a publisher supplies hostile/oversized/incompatible bytes or another owner reference.
**When** publish/validation runs.
**Then** server rejects independently of client claims, no unauthorized bytes become public and existing image/audio/map routes still behave correctly. Each rejection carries a distinct, actionable error the publisher can act on: signed-out publisher, quota/rate limit, `duplicate-version`, invalid or missing `license`, unsupported `themeApiRange`, oversized archive/entry/expanded bytes, hostile archive entry (symlink, case collision, non-canonical path, compression bomb), manifest/asset hash mismatch, another owner's object reference and unavailable sanitizer. Every one of these is a named negative case, not a generic 400.
**Production Path**: Hub theme publish API (`POST /api/assets/themes`, `PUT /api/assets/themes/:slug/upload`); existing community routes.
### AC-3: Moderated discovery
**Given** a pending valid theme is approved or rejected by an authorized moderator.
**When** public users browse Themes and request exact-version bytes.
**Then** only approved public versions are discoverable/deliverable; a rejected or revoked version fails public delivery and unauthorized moderation fails. Proven against real bytes, not just filtered listing rows: the public URL for a pending/rejected/revoked version 404s, `GET /api/assets/themes/:slug/raw` returns pending bytes only to the owner, and an approved+promoted version is byte-identical to the uploaded package digest.
**Production Path**: `/community/themes`; `/community/themes/[slug]`; `/api/assets/themes/:slug`.
### AC-4: Safe informative preview
**Given** a compatible listed theme has fixture previews.
**When** a visitor switches preview contexts/variants.
**Then** game fixtures reflect the theme, accessibility states are inspectable and Hub auth/navigation controls retain trusted appearance; no private or executable content loads.
**Production Path**: Hub theme detail preview — `/community/themes/[slug]`.
### AC-5: Second-player installation
**Given** a separate client profile views an approved compatible version.
**When** the player uses native handoff or download/import then Preview and Apply.
**Then** the exact validated version installs atomically; game appearance changes only on Apply and personal HUD/accessibility choices remain intact.
**Production Path**: Hub `/community/themes/[slug]` → client `/settings?section=interface` → `/game`.
### AC-6: Updates, cancellation and rollback
**Given** a working theme is installed and a newer version exists.
**When** download is cancelled/fails, update is incompatible, or user applies then Reverts.
**Then** current appearance survives failed attempts; update activation is explicit; Revert restores the prior version. The same holds for the enumerated consumer-side failures: incomplete/interrupted download, hash mismatch, incompatible `themeApiRange`, and a listing that has since been revoked — each surfaces an actionable message and leaves the active appearance untouched.
**Production Path**: Client `/settings?section=interface` → Interface → Appearance.
### AC-7: Offline and unavailable listing
**Given** an installed pack exists and network/listing becomes unavailable.
**When** the player cold-starts and opens game/settings.
**Then** local appearance or safe fallback renders without sign-in or Hub boot dependency, and repair/removal guidance remains available.
**Production Path**: `/game`; `/settings?section=interface`.
### AC-8: End-to-end production proof
**Given** creator and separate consumer fixtures plus moderation role exist.
**When** the publish → approve → discover → preview → install → update → revert journey runs.
**Then** evidence proves actual public/private bytes and exact installed digest, not only a catalog mock or unit tests. The journey runs against the binding-bearing Hub lane (see Test Hooks), with the creator, separate consumer and moderator identities supplied by the real session/moderation configuration.
**Production Path**: Hub `/community/themes` → `/community/themes/[slug]` → client `/settings?section=interface` → `/game`.
### AC-9: Additive migration and rollback safety
**Given** the theme migration is applied to a database holding pre-existing community assets, and the Hub theme entry points are later disabled by their feature/config gate.
**When** the old asset routes, the old listing and an already-installed theme are exercised after each step.
**Then** existing image/audio/map publish, browse and moderation behaviour is unchanged (same rows, same status codes, same payload shapes), the migration is additive with no rebuild of the existing three-state moderation CHECK, disabling the gate hides the new entry points and blocks new publishes without deleting approved versions or breaking already-installed packs, and local active/previous version pointers survive.
**Production Path**: `packages/backend/database/drizzle-d1/` migration + `/community/[category]` regression route; Hub feature gate.
### AC-10: Creator and player documentation
**Given** a creator who has never published a theme.
**When** they follow the shipped guide.
**Then** `apps/frontend/docs/src/content/docs/guides/publishing-themes.mdx` documents the package format, the rights/provenance requirement, the moderation states and the immutability/versioning rules, `guides/theming-your-interface.mdx` covers install/update/revert from the Hub, the Guides sidebar picks both up without a manual navigation edit, and every command/route named in the guides resolves as written.
**Production Path**: `apps/frontend/docs` guides for `/community/themes` and `/settings?section=interface`.

**Evidence Matrix**:

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Functional E2E + targeted unit/integration | `apps/e2e/tests/hub/hub_themes.spec.ts` (publish/reserve/commit + retry), `apps/frontend/hub/src/lib/server/api/tests/theme_publish.test.ts` | `POST /api/assets/themes`, `PUT /api/assets/themes/:slug/upload` | PASS — `theme_publish.test.ts` (reserve→upload commits one pending version, digest equality, retry is `duplicate-version`, bytes only in the intake bucket); `hub_themes.spec.ts` 14/14 against the running hub |
| AC-2 | Functional E2E + targeted unit/integration | `apps/e2e/tests/hub/hub_themes.spec.ts` (one named negative case per enumerated error), `theme_publish.test.ts` (hostile-archive corpus reused from `packages/frontend/theme/src/lib/theme/theme_archive.test.ts`), existing community-route regression cases | `/api/assets/themes*`; `/api/assets/community*` | PASS — `theme_archive_reader.test.ts` 13/13 (hostile archive corpus) + `theme_publish.test.ts` named negatives: invalid-package, hostile-archive-entry, compression-bomb, expands-too-large, too-many-entries, unsupported-api, invalid-license, invalid-manifest, hash-mismatch, slug-taken, size-mismatch, community `.zip` regression |
| AC-3 | Functional E2E + integration against real bytes | `apps/e2e/tests/hub/hub_themes.spec.ts` (approve/reject/revoke, public URL 404, owner-only raw), `theme_publish.test.ts` (promotion + digest equality) | `/community/themes`; `/community/themes/[slug]`; `/api/assets/themes/:slug` | PASS — `theme_publish.test.ts`: pending 404 public, owner-only raw, non-moderator 403, approve idempotent (one object), approved bytes byte-identical to the uploaded digest, reject stays private, revoke 404s and keeps `approved` |
| AC-4 | Functional E2E + visual (`hub_themes.visual.ts`) | `apps/e2e/tests/hub/hub_themes.spec.ts` (no external request, no private content), `apps/e2e/src/visual/suites/hub_themes.visual.ts` + screenshots | `/community/themes/[slug]` | PARTIAL — Hub detail page, scoped `[data-theme-preview]` fixture and the four preview contexts are implemented and reachable (`/community/themes/[slug]` 404/400 behaviour verified over HTTP); the visual suite exists but NO screenshot/AI score was produced (no browser/vision tool in this session) |
| AC-5 | Functional E2E + visual (`theme_runtime.visual.ts`) | `apps/e2e/tests/client/hub_themes.spec.ts`, journey trace, screenshots | `/community/themes/[slug]` → `/settings?section=interface` → `/game` | PARTIAL — Hub detail download link + `stageHubDownload` (bounded stream, digest + version check, local re-validation) + `theme-link-input` handoff are implemented and the client e2e passes 9/9; the full Hub→client journey was NOT run against real promoted bytes (needs the binding-bearing `hub-worker` lane) |
| AC-6 | Functional E2E + targeted unit/integration | `apps/e2e/tests/client/hub_themes.spec.ts` (cancel, hash mismatch, incompatible API, revoked listing, revert) | `/settings?section=interface` | PARTIAL — cancel/failure paths leave `staged` untouched and are unit-covered by the parser/route tests; the enumerated consumer failures (hash mismatch, incompatible API, revoked listing, revert) are implemented but only partly exercised end-to-end |
| AC-7 | Functional E2E (offline project) + targeted unit/integration | `apps/e2e/tests/client/hub_themes.spec.ts` + the existing offline-lane patterns | `/game`; `/settings?section=interface` | PASS — `hub_themes.spec.ts` client lane: game boots with `**/api/hub/**` aborted, appearance section renders with the Hub unreachable, built-in theme + import control remain available; no Hub boot dependency added |
| AC-8 | Functional E2E journey trace in the binding-bearing Hub lane + client lane | `apps/e2e/tests/hub/hub_themes.spec.ts` + `apps/e2e/tests/client/hub_themes.spec.ts`, journey trace and relevant screenshots | Hub `/community/themes` → `/community/themes/[slug]` → client `/settings?section=interface` → `/game` | NOT VERIFIED — the binding-bearing lane (`bun moon run hub:build` + `hub-worker` on :5278 + `hub:db-migrate-local`) was not run in this session; the journey is proven in pieces (hub unit/integration + hub e2e + client e2e), not as one trace |
| AC-9 | Integration (real storage boundaries) + migration regression | `packages/backend/database/tests/` migration test, `apps/e2e/tests/hub/community_browse.spec.ts` regression, hub gate-off run | `packages/backend/database/drizzle-d1/`; `/community/[category]` | PASS — `theme_publish.test.ts` AC-9 block: 0012 is additive, `community_assets` CHECK unchanged, fourth moderation state refused, revoked-requires-approved refused, one live reservation per (owner, slug, version); gate-off blocks publishes and keeps approved delivery; `community_browse.spec.ts` unchanged |
| AC-10 | Docs artifact check + command resolution | `apps/frontend/docs/src/content/docs/guides/publishing-themes.mdx`, `guides/theming-your-interface.mdx` | `/community/themes`; `/settings?section=interface` | PASS — `guides/publishing-themes.mdx` added, `guides/theming-your-interface.mdx` extended with the Hub discover/install/update/revert journey; both routes named in the guides resolve as written (`/community/themes` 200, `/settings?section=interface` renders); docs build green |

**Test Hooks**:

- **Baseline:** Existing Hub community reserve/publish/moderation and client community-import tests; C-529 package validation/install tests; existing map/image/audio regressions.
- **Moon Task:** `bun moon run hub:test` and `hub:typecheck` (Hub routes/handlers + view models), `frontend-theme:test` (shared validator/archive), `schemas:test` and `types:typecheck` (TypeBox boundaries), `backend-database:typecheck` (migration/schema), `scripts:test` if the CLI/validator surface changes, `client:typecheck` (theme service/handoff), `bun moon run e2e:test-client` for `tests/client/hub_themes.spec.ts`, and the Hub functional lane `bun moon run e2e:test-hub` — add that task to `apps/e2e/moon.yml` mirroring the existing `test-site` task with the script `playwright test --project=hub` (`apps/e2e/playwright.config.ts` already defines the `hub` project). Use Biome and the repository's required validation flow; before PR run the required affected-project gates and `bun moon run :validate` when current guidance mandates it. Do not invent project IDs from directory names.
- **Hub lane with real bindings (required for AC-3/AC-8):** the local Vite `hub` service provides no Worker bindings (`scripts/src/lib/herdr/session.ts:220`), so the publish → approve → discover journey degrades to 503 there. Run it in the binding-bearing lane instead: `bun moon run hub:build`, start the `hub-worker` service (`wrangler dev --local`, port 5278), `bun moon run hub:db-migrate-local`, then the seeded fixtures. `hub:db-seed-local` is local-only and needs the live worker on :5278, and the moderator identity comes from `MODERATION_ACCOUNT_IDS` (`apps/frontend/hub/src/env.ts`) — an absent value fails closed, so the fixture moderator must be configured explicitly. The Playwright hub project points at port 5276 unless `CI=1`; record which lane produced the evidence and, if a required gate cannot run in the available environment, mark it unverified with the exact blocker rather than substituting a unit test.
- **Integration:** production `/game` using a real local fixture campaign and actual feature services; inject deterministic provider results for asynchronous operations. Use real storage boundaries for migration/atomicity tests. Assertions must establish behavior and domain invariants, not simply duplicate implementation conditions.
- **Functional:** `apps/e2e/tests/hub/hub_themes.spec.ts` for publishing/moderation/browse (AC-1 to AC-4, AC-8, AC-9) and `apps/e2e/tests/client/hub_themes.spec.ts` for installation/update/revert/offline (AC-5 to AC-8). Both directories already exist (`tests/hub`, `tests/client`). Place new Hub specs under the actual configured test directory if it differs; document the final path in this contract. Each AC maps to a named case; include negative/cancel/reload paths. Bun identity rune polyfills cannot establish Svelte reactivity: verify state/lifecycle/focus in compiled Playwright, reusing `apps/e2e/tests/client/reactive_lifecycle.spec.ts` patterns where appropriate.
- **Visual:** add `apps/e2e/src/visual/suites/hub_themes.visual.ts` using the current runner's `defineConfig` and `export default` conventions, following the existing Hub suites (`hub_catalog.visual.ts`, `hub_catalog_detail.visual.ts`) — `id`, `app: 'hub'`, a real `route`, `waitCondition`, `cases[]` with `searchParams`, `prompt`, `schema`, `screenshotSelector` and `requiredTrueFields`/`requiredFalseFields`. Route fixtures through the repository's existing test fixture mechanism. Do not invent production query parameters solely to bypass domain integration. A dev sandbox may supplement but not replace production cases. Client-side appearance *after* install is already covered by the C-529 suite `theme_runtime.visual.ts` (which owns `explore-default`, `inventory-detail`, `combat-actions`, `settings-error`, `compact`, `large-text`, `high-contrast`, `reduced-motion`) — extend that suite for the post-install case instead of duplicating game contexts inside the Hub suite.
- **Visual cases (Hub suite):** `themes-listing`, `theme-detail-light`, `theme-detail-dark`, `theme-detail-high-contrast`, `theme-detail-compact`, `theme-detail-long-labels`, `theme-detail-pending-owner`, `themes-listing-empty` and `themes-listing-degraded`. Select the cases materially affected by this contract and explain any omitted context; every case must set `screenshotSelector` (the runner otherwise falls back to a 256×256 canvas crop that contains none of the theme chrome).
- **TypeBox visual response schema:** an object with `score` (0–100), `unreadableText` (boolean), `overlappingControls` (boolean), `missingCriticalAction` (boolean), and `issues` (bounded string array), adapted to the existing visual runner wrapper. Add the two flags AC-4 actually asserts and gate them with `requiredFalseFields` (the C-529 precedent): `skinnedHubChrome` — Hub navigation/auth/moderation chrome picked up the previewed theme — and `loadedExternalResource` — an external or private resource was requested. AI evaluation prompt: “Evaluate this Aikami production journey against the supplied expected state. Score 90+ only when text hierarchy is readable, essential controls are visible and nonoverlapping, focus/selection is apparent where expected, and the scene retains appropriate prominence. Identify concrete defects; do not reward decoration at the expense of usability.” Treat any missing critical action as a failure regardless of score.
- **Viewports/input:** 1920×1080 and 1280×800 normal; 1024×768 compact; 390×844 touch-oriented management; 200% text at desktop/compact; long translated labels/RTL; keyboard, standard controller, pointer and touch controls. Browser/Tauri runtime support must be recorded. UI operability on a narrow viewport does not certify all mobile world gameplay.
- **Performance evidence:** record hardware/runtime/build, campaign fixture, sample count and p50/p95. Compare a repeated 60-second exploration/combat scene before/after for UI-caused frame-time regression (proposed ≤5% p95 regression). Measure operations stated in Success Measures separately. If the environment cannot run a required gate, mark it unverified with the exact blocker; do not fabricate timings or mark the contract verified.

**Watch Points**:

- Production Path rule requires a resolvable route/named entry point/declared command. The critique recorded the C-513/C-529-derived routes above; if implementation diverges from them, update every Production Path, the Evidence Matrix and the docs guide before verification.
- Screenshot/AI appearance scores cannot prove focus, input ownership, immutable installation, moderation or domain idempotency; keep functional/integration assertions.
- Keep every required control reachable when optional HUD is hidden. Explicit user accessibility overrides have priority over visual preferences.

## Implementation Sequence

1. Map existing C-513 schema/handlers/storage invariants and design the minimal additive theme extension with threat/size tests; choose and record the Worker-runtime extractor (Open Questions).
2. Ship the additive Drizzle D1 migration, then implement package-specific server validation, private intake/versioning/moderation and actual approved-byte delivery.
3. Add the `/community/themes` + `/community/themes/[slug]` routes with inert previews and the client trusted install handoff with normal download fallback.
4. Exercise independent creator/consumer identities, moderation negatives, interrupted updates, offline reuse and exact-digest end-to-end proof in the binding-bearing Hub lane.

## Edge Cases & Gotchas

Stale public indexes; object copy succeeds but metadata transition fails; removed version already installed; mismatched hash; author display-name impersonation; malicious deep link; missing native client; repeated version upload; font validation service unavailable; signed-out publish draft.

## Open Questions

Resolved during critique (routes and runtime are now recorded above): the exact publish/download/detail routes, the theme-only category decision, the server validation execution path and the moderation model are all pinned in Architecture Directives 1–4 and State & Data Models.

Still open — decide at implementation and record the choice in the implementation notes, then confirm the affected ACs still hold:

- The Worker-runtime ZIP extractor (a Worker-safe library such as `fflate`, a `DecompressionStream('deflate-raw')`-based reader, or a non-archive upload representation the server re-validates). Whichever is chosen must run `validateThemePackage` and must bound expansion *before* decompressing.
- Where the trusted preview fixtures live: promoted into a shared package and consumed by both apps, or Hub-local fixtures rendered from the same compiled token CSS.
- Whether `revokedAt` is a new column on the theme-version table or reuses an existing delist marker, and which operator surface sets it.

The publishing policy itself is not open: existing authenticated publishing plus private intake and approval — do not silently bypass it.

## Amendments

Changes to ACs or scope require a version bump and user approval. Routine implementation placement can follow current project conventions while preserving the defined invariants.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-09-14 | Initial source-grounded draft; no implementation or verification claimed | Pending owner approval |
| 2.1.0 | 2026-09-14 | Critique revision: verified the baseline against `main`, pinned the theme-only category decision, the dedicated `/api/assets/themes*` + `/community/themes` routes, the server validation execution path and the reuse-based idempotency model; replaced the nonexistent `removed` moderation state with a revocation marker; added AC-9 (additive migration/rollback) and AC-10 (docs); differentiated the Evidence Matrix, named the exact moon tasks and the binding-bearing Hub lane, and scoped the visual suite to Hub contexts | Critic stage — owner approval pending |

## Promotion Lifecycle

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle). A sandbox is not integrated; `release_verified` requires production and visual evidence.

## Status Lifecycle

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle). Keep `draft` until authorized; never mark completed before merge/CI. Record actual execution and AC evidence during implementation.

## Execution Report

### Summary

Built the community distribution loop for portable themes end to end: a Worker-runtime ZIP
extractor that runs the *same* C-529 validator the client and the CLI use, a dedicated
`/api/assets/themes*` handler family (reserve → private intake → server validation → immutable
pending version → moderation/promotion → real public bytes), a `revokedAt` marker instead of a
fourth moderation state, an additive Drizzle D1 migration (`0012_theme_publishing.sql`), the
`/community/themes` + `/community/themes/[slug]` surfaces with a scoped fixture preview, a client
Hub-download/install-handoff path, and both creator/player guides.

Two pre-existing wiring bugs were found and fixed because they made the contract's named
Production Paths unreachable: `apiMethodGuard` rejected **every** `PUT /api/*` with a bare 405
(so C-513's and C-530's upload routes never reached Elysia), and SvelteKit only dispatches
`fallback` for GET/HEAD/POST, so the catch-all `+server.ts` needed explicit method exports.

Deferred / not verified: the single binding-bearing end-to-end journey trace (AC-8), the visual
suite score (AC-4/AC-5 — no browser or vision tool is exposed in this session), and the enumerated
consumer-failure matrix beyond what the route-level tests cover (AC-6).

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | One immutable pending version per `(themeId, version)`; digest computed server-side; retry is a named `duplicate-version`; bytes only in the private intake bucket. |
| AC-2 | ✅ | Every enumerated rejection is a distinct named code; hostile-archive corpus (symlink, traversal, case collision, bomb, expansion lie) refused *before* decompression. The `theme-sanitizer-unavailable` branch exists but no test forces it. |
| AC-3 | ⚠️ | Proven against real bytes in the hub integration suite (promotion idempotent, approved bytes byte-identical to the uploaded digest, pending/rejected/revoked 404, owner-only raw). Revocation is verified via the API; an operator UI for it is not part of this change. |
| AC-4 | ⚠️ | Detail page, scoped preview and all four preview contexts implemented and reachable; **no screenshot or AI visual score was produced** — the environment exposes no browser/vision tool. |
| AC-5 | ⚠️ | Hub download link, `stageHubDownload` (bounded stream + digest/version check + local re-validation) and the `theme-link-input` handoff are implemented and covered by client e2e; the full Hub→client journey was not run against real promoted bytes. |
| AC-6 | ⚠️ | Cancel and failure paths leave the active appearance untouched (implemented + partly tested); the enumerated failures are implemented but not each exercised end to end. |
| AC-7 | ✅ | Game boots and Appearance renders with the Hub unreachable; installed packs recompile locally; no boot gate added. |
| AC-8 | ❌ | The binding-bearing lane was not run; the journey is proven in pieces, not as one trace. |
| AC-9 | ✅ | Additive migration, unchanged three-state CHECK, gate-off keeps approved versions deliverable, community regression green. |
| AC-10 | ✅ | Both guides shipped; every route they name resolves as written. |

### Files Created

| File | Purpose |
|---|---|
| `packages/frontend/theme/src/lib/theme/theme_archive_reader.ts` | Worker-safe ZIP extractor (`DecompressionStream('deflate-raw')`) that bounds expansion *before* decompressing |
| `packages/frontend/theme/src/lib/theme/theme_archive_reader.test.ts` | 13 tests: well-formed reads + hostile-archive corpus |
| `packages/shared/schemas/src/lib/community/theme_publishing.ts` | TypeBox wire shapes: reserve/listing/detail/moderation/revocation, install intent, named error codes |
| `packages/backend/database/drizzle-d1/0012_theme_publishing.sql` | Additive migration: `theme_publish_staging`, `theme_versions` |
| `apps/frontend/hub/src/lib/server/api/asset_themes.ts` | Reserve, upload+validate+commit, listing, detail, owner raw, public bytes, counters |
| `apps/frontend/hub/src/lib/server/api/asset_themes_moderation.ts` | Moderator transition + revocation marker |
| `apps/frontend/hub/src/lib/server/api/asset_themes_shared.ts` | Named-error mapping, derived display facts, listing/visibility query |
| `apps/frontend/hub/src/lib/server/api/asset_themes_env.ts` | Theme env + `THEME_PUBLISHING_ENABLED` gate |
| `apps/frontend/hub/src/lib/server/api/tests/theme_publish.test.ts` | 26 integration tests over in-memory D1 + mock R2 |
| `apps/frontend/hub/src/lib/views/community/theme_listing_view{,_model}.svelte{,.ts}` | Theme listing surface |
| `apps/frontend/hub/src/lib/views/community/theme_detail_view{,_model}.svelte{,.ts}` | Theme detail + scoped preview |
| `apps/frontend/hub/src/routes/(public)/community/themes/+page.{server.ts,svelte}` | `/community/themes` (static route ahead of `[category]`) |
| `apps/frontend/hub/src/routes/(public)/community/themes/[slug]/+page.{server.ts,svelte}` | `/community/themes/[slug]` |
| `apps/frontend/client/src/lib/services/theme/theme_install_intent.ts` | Handoff parser: identity only, never a URL/path |
| `apps/frontend/client/src/lib/services/theme/theme_install_intent.test.ts` | 26 tests: accepted forms + 20 hostile rejections |
| `apps/e2e/tests/hub/hub_themes.spec.ts` | 14 hub functional cases (ran green against the dev hub) |
| `apps/e2e/tests/client/hub_themes.spec.ts` | 9 client cases (ran green against the dev client) |
| `apps/e2e/src/visual/suites/hub_themes.visual.ts` | Hub theme visual suite (`skinnedHubChrome`, `loadedExternalResource`) — **not executed** |
| `apps/frontend/docs/src/content/docs/guides/publishing-themes.mdx` | Creator guide |

### Files Modified

| File | Change |
|---|---|
| `packages/backend/database/src/lib/schema.ts` | `themePublishStaging` + `themeVersions` tables and row types |
| `packages/frontend/theme/src/index.ts` | Export the archive reader |
| `packages/shared/schemas/src/index.ts`, `packages/shared/types/src/lib/community/asset_publishing.ts` | Export the theme-publishing shapes/types |
| `apps/frontend/hub/src/lib/server/api/index.ts` | Register the `/assets/themes*` family + `assetThemeEnv` option |
| `apps/frontend/hub/src/env.ts` | `THEME_PUBLISHING_ENABLED` feature gate |
| `apps/frontend/hub/src/lib/types/data.ts` | `ThemeListingPageData`, `ThemeDetailPageData` |
| `apps/frontend/hub/src/routes/api/[...slugs]/+server.ts` | Explicit method exports (see Deviations) |
| `packages/backend/svelte-kit/src/lib/hooks_helpers.ts` | `apiMethodGuard` now allows `PUT` (see Deviations) |
| `apps/frontend/client/src/lib/services/theme/theme_package_service.svelte.ts` | `stageHubDownload`, shared staging pipeline, bounded streaming, progress/cancel |
| `apps/frontend/client/src/lib/types/theme_package.ts` | `ThemeDownloadProgress`, `ThemeHubDownloadOptions` |
| `apps/frontend/client/src/lib/views/settings/interface/settings_interface_view_model{,_types}.ts` | `installThemeFromLink` + capability |
| `apps/frontend/client/src/lib/views/settings/interface/settings_interface_view.svelte` | Hub-link form |
| `apps/frontend/docs/src/content/docs/guides/theming-your-interface.mdx` | Hub discover/install/update/revert journey |
| `apps/e2e/moon.yml`, `apps/e2e/package.json` | `test-hub` task / `test:hub` script |

### Deviations from Spec

1. **Two pre-existing wiring bugs fixed outside the contract's stated scope.**
   - `apiMethodGuard` (`packages/backend/svelte-kit/src/lib/hooks_helpers.ts`) answered a bare
     `405 Method Not Allowed` for **every** `PUT /api/*`, so `PUT /api/assets/themes/:slug/upload`
     (this contract's named Production Path) never reached Elysia — and neither did C-513's
     `PUT /api/assets/community/:slug/upload`, C-508's `PUT /api/maps/drafts/:id` or
     `PUT /api/storage/url`. `PATCH` and `DELETE` were already allowed, so excluding `PUT` was an
     oversight, not a policy. `PUT` was added to the allowed set (and the `Allow` /
     `Access-Control-Allow-Methods` headers).
   - SvelteKit dispatches a `+server.ts` `fallback` export for GET/HEAD/POST only, so the hub's
     catch-all `apps/frontend/hub/src/routes/api/[...slugs]/+server.ts` needed explicit `PUT`,
     `PATCH`, `DELETE`, `OPTIONS` (and `GET`/`POST`) exports.
   Both were required for the contract's Production Paths to resolve; without them the theme
   publish flow is unreachable in *any* deployment, not just this lane. No amendment is proposed
   because neither changes an AC or the contract's scope — they repair the surface the ACs name.
2. **Route family kept literal; extra routes added.** The contract's named paths are registered
   exactly as written. Exact-version addressing rides on `?version=` (a version is immutable and
   the path shapes have no version segment), and three additive routes were needed:
   `GET /api/assets/themes/:slug/public` (anonymous content-addressed bytes, so AC-3's "real
   bytes, not filtered rows" is provable), `POST /api/assets/themes/:slug/revocation`, and
   `GET /api/assets/themes/counters`.
3. **Preview fixtures are Hub-local.** Of the two options in Open Questions, the Hub renders its
   own inert fixtures from the *compiled* declarations the shared compiler produced
   (`ThemeVersionDetail.declarations`), scoped to `[data-theme-preview]`. The client's fixture set
   was **not** promoted into a shared package — that would have been a larger, cross-app change
   with no behavioural gain for the Hub preview.
4. **Worker extractor choice recorded (Open Question).** `DecompressionStream('deflate-raw')` over
   a hand-parsed central directory — no third-party archive library enters the trust boundary.
   The ratio guard runs on the directory record, so a bomb is refused without being inflated; the
   reader test asserts that by feeding an *invalid* deflate payload and requiring a
   `compression-bomb` verdict rather than `archive.corrupt`.
5. **`revokedAt` is a new nullable column** on `theme_versions` (not a reuse of an existing delist
   marker, of which there is none), with a CHECK that a revoked row must be `approved`. Setting it
   is an operator API (`POST /api/assets/themes/:slug/revocation`); no operator UI was added.
6. **Visual evidence not produced.** This session exposes no browser-screenshot or
   image-validation tool, so no screenshot + `ai_validate_image` assertion exists for
   `/community/themes`, `/community/themes/[slug]`, `/settings?section=interface` or `/game`. The
   production routes were instead verified over HTTP against the running hub (status codes,
   rendered markers) and by the Playwright hub/client lanes. AC-4/AC-5's visual half and AC-8's
   single journey trace remain unverified.

### Test Results

- Unit (`frontend-theme:test`): 99/99 pass — 13 new archive-reader cases.
- Unit (`client:test`): 3540/3540 pass — 26 new install-intent cases.
- Unit (`schemas:test`): 821/821 pass. `backend-database:test`: 14/14 pass.
- Integration (`hub:test`): 256/256 pass — 26 new theme-publish cases.
- E2E (`e2e:test-hub` `tests/hub/hub_themes.spec.ts`): 14/14 pass, run against the live hub
  dev server (port 8048, `PUBLIC_EMULATOR_PORT_OFFSET=2772`).
- E2E (`e2e:test-client` `tests/client/hub_themes.spec.ts`): 9/9 pass, run against the live client
  dev server (port 8046).
- Visual: **not run** — score N/A (no browser/vision tool in this session).
- `validate({ test: true })`: ✅ 4/4 phases pass across backend-database, backend-svelte-kit,
  client, docs, e2e, frontend-theme, hub, schemas, types.
- Baseline: `apps/e2e/tests/hub/community_browse.spec.ts` — 4/5 pass; the pre-existing failure
  ("a known category never 500s — it either renders or degrades to an explicit 503") fails because
  it asserts `community-asset-list` is visible on a 200 while an empty local DB renders
  `community-empty-state`. Unrelated to this change (the route, query and page are untouched) and
  unchanged in kind from the pre-session state, where the same route 500'd on an un-migrated local
  DB. No new failures.
- Local setup step performed (not a code change): `bun moon run hub:db-migrate-local`, so the
  local hub dev DB carries `0012`.
