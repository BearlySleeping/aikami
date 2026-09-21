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
    pr_url: "https://github.com/BearlySleeping/aikami/pull/365"
    pr_number: 365
created_at: "2026-09-14"
---

# Contract C-530: Hub theme publishing and installation

## Metadata

| Field                  | Value                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Source**             | User request: optimal customizable Aikami UI/HUD/menus and community themes; source review at `b3e8234b6ced2c6c8ae1a62aa023850ed3ad85c4`                                       |
| **Target**             | Hub community publishing/category/detail routes, shared theme API, client theme download/install integration                                                                   |
| **Type**               | full                                                                                                                                                                           |
| **Priority**           | P1 — coherent player experience and safe customization foundation                                                                                                              |
| **Dependencies**       | C-529 validated portable themes and local installer; C-528 for optional HUD presets; existing C-513 community intake/moderation infrastructure.                                |
| **Status**             | draft                                                                                                                                                                          |
| **Promotion**          | —                                                                                                                                                                              |
| **Docs Impact**        | User-facing → proposed guide under `apps/frontend/docs/src/content/docs/`; add/update the current navigation and actual page in this PR. Theme/HUD author docs where relevant. |
| **Contract version**   | 2.0.0                                                                                                                                                                          |
| **Production Surface** | Hub `/community/themes` and theme detail/download entry points; client `/settings` → Interface → Appearance                                                                    |

Draft ID is provisional and unreserved. Confirm it is still unused before adding this file to the repository. This document records proposed behavior; its ACs are not yet verified or approved by this planning deliverable.

## Problem & Baseline Evidence

- Existing community publishing reserves authenticated revisions, stages private bytes and promotes approved assets. Its current asset/category validation does not establish a complete theme package catalog and client install experience.
- No code-reviewed theme-specific publish → browse → download → install lifecycle can be inferred from existing generic pack schemas.
- Reproduce by trying to publish a C-529 package as a theme and install its compatible immutable version through Hub.
- Reuse `apps/frontend/hub/src/lib/server/api/asset_community.ts`, shared helpers/moderation, C-513 schemas and client import patterns. Inspect ownership, moderation and upload tests before extending.

## User Outcome

A creator can publish a valid theme to Hub, and another player can discover, preview, download/install and update it with compatibility information and a safe offline fallback.

## Success Measures

- Production end-to-end fixture journey covers creator upload, moderator approval, public discovery and separate-client installation of exactly the approved version.
- Browsing public themes does not require sign-in unless existing Hub policy explicitly requires it; publishing/moderation follows existing authorization. Offline use of an installed theme never requires sign-in.
- Interrupted upload/download/update is retryable and leaves the currently active theme intact. No unpublished bytes appear on public catalog URLs.

## Existing System & Reuse Map

| Capability                     | Existing source                                                          | Reuse / modify / replace                                                           |
| ------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Private intake and publication | `apps/frontend/hub/src/lib/server/api/asset_community.ts`                | Extend/reuse invariants; theme package validation is not ordinary image validation |
| Moderation and delivery        | `asset_community_moderation.ts; asset_community_shared.ts`               | Reuse owner/moderator rights and approved public delivery                          |
| Community browse               | `apps/frontend/hub/src/routes/(public)/community/[category]/`            | Add discoverable themes capability/category                                        |
| Schema and publish gates       | `packages/shared/schemas/src/lib/community/`                             | Extend typed themes without weakening existing assets                              |
| Local theme installer          | `C-529`                                                                  | Reuse exact validator/compiler/transaction semantics                               |
| Client asset import pattern    | `apps/frontend/client/src/lib/services/assets/community_asset_import.ts` | Reuse trusted configured-Hub integration patterns                                  |

Paths abbreviated to sibling filenames in this table are relative to the named feature directory. Verify exact exports at the implementation base.

## Overview

Complete the community distribution loop for portable themes. Reuse existing authentication, metadata storage, private intake, content addressing and moderation instead of creating another marketplace service. Isolate theme-specific validation and preview behavior from gameplay asset ingestion.

## Design Reference

- `docs/design/aikami_ui_hud_theme_review_2026q3.md` in this bundle defines visual direction, navigation mapping, defaults and ecosystem boundaries.
- Existing `docs/design/game_ui_hud_overhaul.md` and `views/dev/obsidian/` are context; do not copy stale defect claims or treat a dev sandbox as production evidence.
- Read current `AGENTS.md`, `.context/CONTEXT.md`, `.context/index.md` and required project skills: `aikami-conventions`, `svelte-conventions`, `aikami-ui`, `testing`; add backend/PixiJS skills when actually touching those boundaries.
- Keep Aikami semantic HTML/classes; complex components only for meaningful structure, behavior, accessibility or a reusable API.

> Testing conventions: [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions).

## Architecture Directives

1. Add an explicit theme package kind/category and immutable version metadata; do not disguise a zip as a background image or feed arbitrary bytes to image-specific processing. Reuse existing shared infrastructure through narrow adapters; introduce dedicated theme handlers only where package semantics require them.
2. Server validates metadata, theme API compatibility, bounded manifest/assets, hash integrity and the C-529 profile before publication. Reuse the same core validator; where binary/font sanitization needs a different runtime, use the supported validation execution path and keep intake pending until it succeeds. Client-supplied pass/fail claims are never authoritative.
3. Preserve private intake → validated pending version → moderation → public approved bytes. Failed/rejected uploads stay nonpublic. Enforce creator ownership, existing auth/rate limits, moderator permissions and rights declarations for bundled fonts/ornaments. Prevent metadata from pointing to another user's object.
4. D1 stores metadata, moderation state and immutable revision references; R2 stores bytes. No provider or infrastructure replacement. An upload idempotency key and package digest deduplicate retries within the existing ownership model. Define resumable/retry behavior supported by existing transport and expiry cleanup for abandoned staging.
5. Themes listing/detail show author, version, license, light/dark variants, font languages/fallback information, compatible theme API range, preview contexts, download size, update notes and validation status. Distinguish validator success, moderator approval and subjective visual quality. Include report and existing moderation actions; do not create a misleading certified-accessible badge.
6. Preview uses isolated, trusted fixture components and the same token compiler. No user scripts/styles, real campaign messages, external theme resource requests or skinning of Hub's own navigation/auth/moderation UI. Creator-supplied screenshot is labeled/treated as media; rendered fixtures are the reliable behavioral preview.
7. Install handoff carries trusted Hub theme/version identity, not an arbitrary executable path or source URL. Native/browser consumers resolve through configured trusted Hub endpoints; offer ordinary download/import when native handoff is unavailable. Deep-link parsing rejects arbitrary schemes/hosts/path traversal and cannot auto-apply a pack.
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
	moderationState: "pending" | "approved" | "rejected" | "removed";
	variants: ("light" | "dark")[];
};
type ThemeInstallIntent = {
	themeId: string;
	version: string;
	source: "configured-hub";
};
```

Reuse existing moderation states/ID conventions rather than introducing conflicting enums. This shape states required semantics, not exact database column names. Shared TypeBox request/response schemas validate route boundaries; explicit DB migrations extend existing D1 tables or add related theme-version tables if existing asset rows cannot express immutable package semantics safely.

## Quality Requirements

- **Offline/degraded:** already installed packs continue to work; browse/download errors never affect game startup.
- **Accessibility/input:** browse/detail/preview/install/update flows work by keyboard and pointer/touch; preview can inspect readable/high-contrast modes without changing the host.
- **Performance:** paginated listing and bounded thumbnails/previews; do not decode all theme assets in catalog tiles. Download progress and cancellation remain responsive.
- **Security/privacy:** server auth/ownership/moderation; private intake until approval; identical client/server format validation; trusted origin/deep links; no external theme execution or automatic real-save screenshots.
- **Persistence/migration:** additive D1 schema migration where needed; immutable public version/digest; local installer atomically activates.
- **Cancellation/retry/idempotency:** duplicate publish commits do not create duplicate versions; interrupted update retains previous working bytes; abandoned intake cleaned by explicit policy.
- **Observability:** structured upload/validation/moderation/download events with opaque operation IDs; no signed URLs, secrets, private theme intake URLs or campaign text.

## Migration & Rollback

- Add theme-specific metadata/category support without changing existing image/audio/map payload contracts. Test old clients and old asset routes against additive migrations.
- Gate new publication/installation discovery via existing feature/config patterns; the local fallback always works even if Hub theme publishing is disabled.
- Publication makes approved immutable bytes available only after the version metadata is committed according to existing moderation consistency rules. Reconcile failed copy/metadata transitions rather than exposing partially approved versions.
- Rollback hides new Hub entry points and blocks new publishes without deleting approved versions or breaking already installed packs. Local active pointers and previous versions remain available.
- Removed/rejected versions cannot be newly fetched through public delivery; test actual object delivery behavior, not merely filtered listing rows.

## Scope Boundaries

- **In Scope:** creator publish/update, server validation, private intake/moderation, Hub themes browse/detail/preview, rights metadata, download/native handoff with fallback, local install/update/revert and creator docs.
- **Out of Scope:** paid marketplace, new auth/database provider, cloud account-wide appearance sync, executing theme mods, new asset-generation providers, uploading on behalf of the user during this planning task.

## Contract Size & Split Rule

> Split on independent mergeability: [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule).

**For this contract:** One vertical community-sharing outcome across Hub and client with a shared theme model and immutable-version invariant. It depends on the proven local installer; do not split it into a catalog-only PR that claims a working install ecosystem.

## Acceptance Criteria

### AC-1: Creator publish and private staging

**Given** an authenticated creator owns a valid C-529 package.
**When** they reserve/upload/commit it and retry the commit.
**Then** exactly one immutable pending version exists; bytes stay nonpublic and owner identity comes from the session.
**Production Path**: Hub theme publish entry point.

### AC-2: Server rejection and isolation

**Given** a publisher supplies hostile/oversized/incompatible bytes or another owner reference.
**When** publish/validation runs.
**Then** server rejects independently of client claims, no unauthorized bytes become public and existing image/audio/map routes still behave correctly.
**Production Path**: Hub theme publish API; existing community routes.

### AC-3: Moderated discovery

**Given** a pending valid theme is approved or rejected by an authorized moderator.
**When** public users browse Themes and request exact-version bytes.
**Then** only approved public versions are discoverable/deliverable; rejected/removed versions fail public delivery and unauthorized moderation fails.
**Production Path**: /community/themes; theme detail/download entry points.

### AC-4: Safe informative preview

**Given** a compatible listed theme has fixture previews.
**When** a visitor switches preview contexts/variants.
**Then** game fixtures reflect the theme, accessibility states are inspectable and Hub auth/navigation controls retain trusted appearance; no private or executable content loads.
**Production Path**: Hub theme detail preview.

### AC-5: Second-player installation

**Given** a separate client profile views an approved compatible version.
**When** the player uses native handoff or download/import then Preview and Apply.
**Then** the exact validated version installs atomically; game appearance changes only on Apply and personal HUD/accessibility choices remain intact.
**Production Path**: Hub theme detail → client /settings → /game.

### AC-6: Updates, cancellation and rollback

**Given** a working theme is installed and a newer version exists.
**When** download is cancelled/fails, update is incompatible, or user applies then Reverts.
**Then** current appearance survives failed attempts; update activation is explicit; Revert restores the prior version.
**Production Path**: Client /settings → Interface → Appearance.

### AC-7: Offline and unavailable listing

**Given** an installed pack exists and network/listing becomes unavailable.
**When** the player cold-starts and opens game/settings.
**Then** local appearance or safe fallback renders without sign-in or Hub boot dependency, and repair/removal guidance remains available.
**Production Path**: /game; /settings.

### AC-8: End-to-end production proof

**Given** creator and separate consumer fixtures plus moderation role exist.
**When** the publish → approve → discover → preview → install → update → revert journey runs.
**Then** evidence proves actual public/private bytes and exact installed digest, not only a catalog mock or unit tests.
**Production Path**: Hub production entry points; client /game.

**Evidence Matrix**:

| AC   | Test Level                                                                      | Required Artifact                                            | Production Path                                       | Evidence                                          |
| ---- | ------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------- |
| AC-1 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `hub_themes.spec.ts`, journey trace and relevant screenshots | Hub theme publish entry point                         | Not run — fill during implementation verification |
| AC-2 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `hub_themes.spec.ts`, journey trace and relevant screenshots | Hub theme publish API; existing community routes      | Not run — fill during implementation verification |
| AC-3 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `hub_themes.spec.ts`, journey trace and relevant screenshots | /community/themes; theme detail/download entry points | Not run — fill during implementation verification |
| AC-4 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `hub_themes.spec.ts`, journey trace and relevant screenshots | Hub theme detail preview                              | Not run — fill during implementation verification |
| AC-5 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `hub_themes.spec.ts`, journey trace and relevant screenshots | Hub theme detail → client /settings → /game           | Not run — fill during implementation verification |
| AC-6 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `hub_themes.spec.ts`, journey trace and relevant screenshots | Client /settings → Interface → Appearance             | Not run — fill during implementation verification |
| AC-7 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `hub_themes.spec.ts`, journey trace and relevant screenshots | /game; /settings                                      | Not run — fill during implementation verification |
| AC-8 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `hub_themes.spec.ts`, journey trace and relevant screenshots | Hub production entry points; client /game             | Not run — fill during implementation verification |

**Test Hooks**:

- **Baseline:** Existing Hub community reserve/publish/moderation and client community-import tests; C-529 package validation/install tests; existing map/image/audio regressions.
- **Moon Task:** `bun moon run client:typecheck`, the affected Hub/schema/type/theme project validation tasks resolved from current Moon config, and `bun moon run e2e:test-client`; run the configured Hub functional lane as well. Use Biome and the repository's required validation flow; before PR run required affected-project gates and `bun moon run :validate` when mandated by current guidance. Do not invent project IDs from directory names.
- **Integration:** production `/game` using a real local fixture campaign and actual feature services; inject deterministic provider results for asynchronous operations. Use real storage boundaries for migration/atomicity tests. Assertions must establish behavior and domain invariants, not simply duplicate implementation conditions.
- **Functional:** `apps/e2e/tests/hub/hub_themes.spec.ts` for publishing/moderation/browse and `apps/e2e/tests/client/hub_themes.spec.ts` for installation. Place new Hub specs under the actual configured test directory if it differs; document the final path in this contract. Each AC maps to a named case; include negative/cancel/reload paths. Bun identity rune polyfills cannot establish Svelte reactivity: verify state/lifecycle/focus in compiled Playwright, reusing `apps/e2e/tests/client/reactive_lifecycle.spec.ts` patterns where appropriate.
- **Visual:** add `apps/e2e/src/visual/suites/hub_themes.visual.ts` using the current runner's `defineConfig` and `export default` conventions. Declare cases with `name`, real `route` and `searchParams`; route fixtures through the repository's existing test fixture mechanism. Do not invent production query parameters solely to bypass domain integration. A dev sandbox may supplement but not replace production cases.
- **Visual cases:** `explore-default`, `dialogue-long`, `inventory-detail`, `combat-actions`, `settings-error`, `compact`, `large-text`, `high-contrast`, `reduced-motion`. Select the cases materially affected by this contract and explain any omitted context.
- **TypeBox visual response schema:** an object with `score` (0–100), `unreadableText` (boolean), `overlappingControls` (boolean), `missingCriticalAction` (boolean), and `issues` (bounded string array), adapted to the existing visual runner wrapper. AI evaluation prompt: “Evaluate this Aikami production journey against the supplied expected state. Score 90+ only when text hierarchy is readable, essential controls are visible and nonoverlapping, focus/selection is apparent where expected, and the scene retains appropriate prominence. Identify concrete defects; do not reward decoration at the expense of usability.” Treat any missing critical action as a failure regardless of score.
- **Viewports/input:** 1920×1080 and 1280×800 normal; 1024×768 compact; 390×844 touch-oriented management; 200% text at desktop/compact; long translated labels/RTL; keyboard, standard controller, pointer and touch controls. Browser/Tauri runtime support must be recorded. UI operability on a narrow viewport does not certify all mobile world gameplay.
- **Performance evidence:** record hardware/runtime/build, campaign fixture, sample count and p50/p95. Compare a repeated 60-second exploration/combat scene before/after for UI-caused frame-time regression (proposed ≤5% p95 regression). Measure operations stated in Success Measures separately. If the environment cannot run a required gate, mark it unverified with the exact blocker; do not fabricate timings or mark the contract verified.

**Watch Points**:

- Production Path rule requires a resolvable route/named entry point/declared command. Replace proposed feature routes and tooling command descriptions with exact implemented routes/commands before approval/verification.
- Screenshot/AI appearance scores cannot prove focus, input ownership, immutable installation, moderation or domain idempotency; keep functional/integration assertions.
- Keep every required control reachable when optional HUD is hidden. Explicit user accessibility overrides have priority over visual preferences.

## Implementation Sequence

1. Map existing C-513 schema/handlers/storage invariants and design the minimal additive theme extension with threat/size tests.
2. Implement package-specific server validation, private intake/versioning/moderation and actual approved-byte delivery.
3. Add category/detail/inert previews and client trusted install handoff with normal download fallback.
4. Exercise independent creator/consumer identities, moderation negatives, interrupted updates, offline reuse and exact-digest end-to-end proof.

## Edge Cases & Gotchas

Stale public indexes; object copy succeeds but metadata transition fails; removed version already installed; mismatched hash; author display-name impersonation; malicious deep link; missing native client; repeated version upload; font validation service unavailable; signed-out publish draft.

## Open Questions

Must be resolved before status becomes `approved`:

Before approval, map the exact theme detail/publish/download routes to existing Hub conventions and record the moderation/validation runtime. The recommended policy is existing authenticated publishing plus private intake and approval; do not silently bypass it.

## Amendments

Changes to ACs or scope require a version bump and user approval. Routine implementation placement can follow current project conventions while preserving the defined invariants.

| Version | Date       | Change                                                                   | Approved by            |
| ------- | ---------- | ------------------------------------------------------------------------ | ---------------------- |
| 2.0.0   | 2026-09-14 | Initial source-grounded draft; no implementation or verification claimed | Pending owner approval |

## Promotion Lifecycle

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle). A sandbox is not integrated; `release_verified` requires production and visual evidence.

## Status Lifecycle

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle). Keep `draft` until authorized; never mark completed before merge/CI. Record actual execution and AC evidence during implementation.
