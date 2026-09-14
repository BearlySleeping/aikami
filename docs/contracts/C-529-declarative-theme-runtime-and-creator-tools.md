---
id: C-529
title: "Declarative theme runtime and creator tools"
source: "direct"
contract_type: full
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-14"
---

# Contract C-529: Declarative theme runtime and creator tools

## Metadata

| Field | Value |
|---|---|
| **Source** | User request: optimal customizable Aikami UI/HUD/menus and community themes; source review at `b3e8234b6ced2c6c8ae1a62aa023850ed3ad85c4` |
| **Target** | Shared theme/schemas/types; client Interface appearance editor; local theme package storage and validation tooling |
| **Type** | full |
| **Priority** | P1 — coherent player experience and safe customization foundation |
| **Dependencies** | C-527 game theme scope. Reuse C-528 schema for optional attached HUD presets when that contract is merged. |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | User-facing → proposed guide under `apps/frontend/docs/src/content/docs/`; add/update the current navigation and actual page in this PR. Theme/HUD author docs where relevant. |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/settings` → Interface → Appearance and `/game` |

Draft ID is provisional and unreserved. Confirm it is still unused before adding this file to the repository. This document records proposed behavior; its ACs are not yet verified or approved by this planning deliverable.

## Problem & Baseline Evidence

- Shared appearance is CSS-owned with semantic variables and no runtime TS token authority; preferences distinguish light/dark/system rather than a complete creator theme package.
- Current styling permits theme tokens but does not itself establish import/export, bounded assets, validation, local installation, preview/cancel or safe recovery.
- Reproduce by looking for a way to duplicate a built-in appearance, export it, import on another offline client and safely preview it across production UI states.
- Reuse theme package classes and C-527 scoping. Preserve the explicit prohibition on hand-synchronized TS palette copies in `packages/frontend/theme/src/index.ts`.

## User Outcome

A player or creator can make a theme through a friendly editor, export/import a portable package, preview it safely, apply it locally and revert without changing gameplay or their HUD layout.

## Success Measures

- A new creator can duplicate a built-in, change accent/surface/border roles, validate and export without writing code; document a timed formative walkthrough with at least three participants when available, without claiming a statistical usability result.
- Warm valid-theme application p95 ≤150ms excluding optional asset decode; font/image dimensions are reserved to avoid disruptive layout shifts.
- Offline cold boot immediately uses the installed theme or safe built-in fallback; no Hub call can delay game startup.
- Production journey: create → preview Explore/Dialogue/Inventory/Combat → export → fresh local import → apply → cancel/revert → reload offline.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Token/class source | `packages/frontend/theme/src/` | Preserve semantic API; generate CSS from one token source after migration |
| Type validation | `packages/shared/schemas/ and packages/shared/types/` | Add versioned exchanged shapes with TypeBox |
| Preference storage | `existing preference adapters and C-528 state` | Separate appearance from HUD and accessibility |
| Production preview surfaces | `C-527 trusted UI components; existing Obsidian fixtures` | Reuse presentations with inert fixture data |
| Image behavior | `packages/frontend/components/src/lib/image/image.svelte` | Use shared Image and local asset resolver, respecting Tauri policies |

Paths abbreviated to sibling filenames in this table are relative to the named feature directory. Verify exact exports at the implementation base.

## Overview

Create a restricted declarative theme API and local authoring/installation lifecycle. Move built-in token authorship into the same validated data format used by creators and generate CSS deterministically. Keep behavior and executable components entirely application-owned.

## Design Reference

- `docs/design/aikami_ui_hud_theme_review_2026q3.md` in this bundle defines visual direction, navigation mapping, defaults and ecosystem boundaries.
- Existing `docs/design/game_ui_hud_overhaul.md` and `views/dev/obsidian/` are context; do not copy stale defect claims or treat a dev sandbox as production evidence.
- Read current `AGENTS.md`, `.context/CONTEXT.md`, `.context/index.md` and required project skills: `aikami-conventions`, `svelte-conventions`, `aikami-ui`, `testing`; add backend/PixiJS skills when actually touching those boundaries.
- Keep Aikami semantic HTML/classes; complex components only for meaningful structure, behavior, accessibility or a reusable API.

> Testing conventions: [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions).

## Architecture Directives

1. Document an Aikami profile of DTCG 2025.10: initially support explicit typed color, dimension, duration, font-family role and bounded font-weight tokens plus local aliases. Resolve aliases with cycle/depth/node limits; reject unsupported constructs with actionable diagnostics. Do not claim full DTCG conformance for a subset.
2. Define an explicit allowlist of semantic tokens and asset slots. Values are validated typed data; never interpolate arbitrary CSS values, selectors, `url()`, `calc()`, `@import`, expressions or markup. Colors compile through a trusted serializer. No community JS, CSS, HTML or SVG. Arbitrary font-family strings are not a way to request a remote URL.
3. Built-in token JSON becomes the only authoritative palette source in this contract; generate CSS, fallback variants and token reference documentation. Preserve the current semantic variable/class API, including `--ui-*` compatibility. Delete hand-maintained duplicates atomically and add a generated-output drift check. Site/docs brand tokens remain a distinct vocabulary unless explicitly derived; do not broaden a game-theme change into branding migration.
4. Separate appearance mode (`system`, `light`, `dark`) from theme ID/version. A theme contains declared variants; a missing variant falls back to a documented built-in variant while retaining selected theme identity. Do not treat a custom ID as an OS appearance mode.
5. Appearance precedence: baseline → selected variant → explicit personal appearance overrides → accessibility policy. Layout remains unchanged unless the user separately applies an attached preset. Always permit built-in font override and high-contrast/opaque/reduced-motion settings.
6. Token coverage includes normal/hover/active/disabled/focus/error/loading states, overlays and semantic resources. Theme controls palette, approved typography/metrics and ornament slots only; no action availability, hidden controls, z-index, positions or pointer behavior. Bounds preserve readable text/hit targets. A theme's chosen danger hue still requires label/icon distinction.
7. Scoping: apply only to the game/personal appearance preview root, including owned portal containers. Recovery controls and top-level host/Hub controls retain trusted styles. Test a theme switch using actual Tailwind utilities and portaled dialogs; descendant token aliases must resolve to the selected scope.
8. Creator UI groups Surface/Text/Accent/Focus, Type, Borders/Corners and Ornament. Live validation names the exact bad role and affected surface. Provide starter presets, Duplicate, Preview, Cancel, Apply, Export and Reset. Advanced JSON uses the same schema/compiler. Use deterministic synthetic campaign fixtures; preview never runs a gameplay command or external request.
9. Package envelope: schema/API compatibility, immutable ID/version, author/license metadata, tokens/variants, declared assets and optional HUD preset. All paths relative/canonical; every included asset is manifest-listed with media type, bytes and SHA-256. Hashes are integrity checks, not trust/rights attestations. Package export omits private preferences, save data, IDs/tokens/secrets and live screenshots.
10. Proposed v1 limits: 10MiB compressed archive, 25MiB expanded total, 128 entries, 256KiB manifest, 512KiB aggregate token JSON, JSON/alias depth ≤16, 512 resolved tokens, two WOFF2 font files ≤2MiB each, raster ornament/preview ≤2048×2048 each and 8 million decoded pixels total. Use named shared constants; tighten where runtime constraints require. Reject traversal, symlinks, duplicate/case-colliding paths, MIME mismatch, archive bombs, invalid numbers and missing assets before rendering. Text preview is escaped. No arbitrary network resources.
11. Provide a tested custom-font validation/sanitization path and licensing metadata checks for supported WOFF2 assets, or keep custom font assets rejected and split custom-font support into a separately approved contract before claiming it shipped. Built-in font choices must work regardless. Font validation must respect browser/Tauri decoding and memory limits; do not parse hostile complex files synchronously on the UI thread.
12. Install lifecycle: stage → validate → verify assets → preview → commit active pointer. Preserve last-known-good version. In-progress install/apply operation has an ID; stale completion cannot replace a newer selection. Cancel cleans staging and unneeded object URLs. Missing/corrupt active theme boots with trusted fallback and repair notice.
13. Expose a declared local validator/build command using repository scripts/Moon conventions and document it. It accepts local packages/token source, emits machine-readable diagnostics, never evaluates author code and shares validation logic with client/Hub. Document version compatibility and a deprecation policy; refuse unsupported major versions instead of best-effort rendering.
14. Preview rendered text/surface contrast, including transparency over worst-case light/dark backgrounds. Target ≥4.5:1 essential normal text, ≥3:1 relevant large text/control boundaries and disabled explanatory text; provide a higher-contrast override with ≥7:1 primary text. These product gates do not constitute a claim of full WCAG or XAG certification. Invalid community-required token pairs cannot be applied without safe correction/fallback; show what changes rather than silently overriding creator intent.

## State & Data Models

```ts
type ThemePackageManifest = {
  schemaVersion: 1;
  kind: 'aikami-theme';
  id: string;
  version: string;
  themeApiRange: string;
  name: string;
  author: { displayName: string };
  license: string;
  variants: { light?: string; dark?: string }; // paths to validated token files
  assets: { path: string; mediaType: string; bytes: number; sha256: string }[];
  preview?: string;
  hudPreset?: string; // optional, applies only with separate user action
};
type ThemeSelection = {
  schemaVersion: 1;
  themeId: string;
  version: string;
  mode: 'system' | 'light' | 'dark';
};
```
This is a schema design, not a claim that these exports already exist. TypeBox schemas live in shared schemas; project-conventional derived types in shared types. Complete implementation must define ID/version/path/size constraints and manifests for built-ins. DTCG tokens and Aikami envelope are separately validated. Personal overrides/accessibility and actual installation file locations are not part of the public manifest.

## Quality Requirements

- **Offline/degraded:** installed bytes and built-ins local; no background remote fonts. Unsupported or corrupt packs cannot block launch.
- **Accessibility/input:** editor/preview operable by keyboard/controller/touch; 200% text, readable sans override, consistent focus; accessibility preferences win.
- **Performance:** bounded assets/parse work, work off the main thread where needed; cached compilation; application budget above; clean object URLs/font registrations on unload.
- **Security/privacy:** strict allowlists, validated archive/paths/assets, escaped labels; no executable community content, network URLs or save export.
- **Persistence/migration:** versioned immutable installed packs, atomic selection and last-good recovery; preserve light/dark/system selection independently.
- **Cancellation/retry/idempotency:** duplicate imports share identical content where safe; cancellation cannot activate a partial theme; older async completion cannot overwrite a newer Apply.
- **Observability:** structured validation error code and affected token/path; omit signed URLs, credentials and private data.

## Migration & Rollback

- Preserve existing light/dark/system preference exactly; absent selection defaults to refined Obsidian Chronicle with OS appearance mode.
- Generate built-in CSS from validated token files in the same change that removes manual palette duplication. Verify old classes and outside-game theme behavior before merging.
- Installation writes to staging, then atomically swaps an active pointer only after full validation. Power loss or rejected bytes leave last-good selection intact.
- Restore default appearance is always available in trusted Settings; active-pack uninstall reverts safely. Keep unsupported future-version bytes inert for later compatible client versions.
- Rollback uses generated built-in CSS and ignores custom selection; local campaign data and HUD preferences stay untouched. No online kill switch is required to boot.

## Scope Boundaries

- **In Scope:** declarative v1 theme profile/compiler; generated built-in CSS; local editor; CLI validator; local import/export; valid asset handling; preview/apply/cancel/revert; compatibility and recovery; creator docs.
- **Out of Scope:** Hub upload/auth/moderation; executable widget mods; arbitrary HTML/CSS; custom sound themes; marketplace monetization; a full DTCG toolchain; new gameplay features. Custom fonts require the explicit validated path in Directive 11.

## Contract Size & Split Rule

> Split on independent mergeability: [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule).

**For this contract:** One local theme-creation/install outcome. Hub delivery is independently mergeable C-530. Optional unrestricted art/sound/mod systems must not be added. If custom-font validation cannot be safely completed, record an approved scope split rather than silently claiming all ACs passed.

## Acceptance Criteria

### AC-1: One token authority
**Given** built-in token source and generated CSS exist.
**When** the validator/generator runs twice.
**Then** output is deterministic, class/semantic compatibility is preserved and manual token divergence fails the declared drift check.
**Production Path**: tooling: declared theme validate/build command; /game.
### AC-2: Safe no-code creation
**Given** a creator duplicates a built-in theme.
**When** they edit surface/accent/border/type roles and preview four game contexts.
**Then** the friendly and JSON editors use the same validation; preview is readable, scoped and incapable of issuing gameplay/network commands.
**Production Path**: /settings → Interface → Appearance.
### AC-3: Package round trip
**Given** a valid theme with permitted local assets exists.
**When** it exports and imports on a fresh offline profile.
**Then** the same semantic appearance and asset manifest restore; no private preferences/campaign data are included; attached layout stays unapplied unless separately chosen.
**Production Path**: /settings; /game.
### AC-4: Adversarial package rejection
**Given** packages contain forbidden code/URLs, traversal, MIME mismatch, excessive expansion, invalid fonts, alias cycles or unsupported major API.
**When** validation/import runs.
**Then** each fails before rendering/activation with a clear diagnostic and bounded work; previous theme remains active.
**Production Path**: /settings; tooling: declared theme validate command.
### AC-5: Explicit mode and accessibility precedence
**Given** OS mode/motion conflicts with explicit preferences.
**When** a theme applies to game and owned dialogs.
**Then** appearance selection is honored, readable font/text/contrast/opacity/motion overrides win, unrelated Hub/app controls remain trusted and layout is unchanged.
**Production Path**: /game; /settings.
### AC-6: Atomic apply and recovery
**Given** an install is interrupted or two theme operations race.
**When** the user cancels/reloads/reverts/uninstalls the active pack.
**Then** no partial or stale result activates; last-good or built-in theme renders immediately; Settings recovery remains reachable offline.
**Production Path**: /settings; /game.
### AC-7: Creator documentation and fixtures
**Given** a developer follows the shipped theme guide.
**When** they validate the included starter, intentionally break a role and export.
**Then** the documented command works, diagnostics identify the problem and the corrected package imports into production.
**Production Path**: tooling: declared theme validate/build command; /settings.
### AC-8: Rendered coverage and budgets
**Given** light/dark/high-contrast variants with long content and 200% text are used.
**When** production game, inventory, dialogue, combat and errors render on browser/Tauri.
**Then** token states meet stated contrast gates, assets/fonts are proven local, essential controls remain usable and recorded timing stays within agreed budgets.
**Production Path**: /game; /settings.

**Evidence Matrix**:

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `theme_runtime.spec.ts`, journey trace and relevant screenshots | tooling: declared theme validate/build command; /game | Not run — fill during implementation verification |
| AC-2 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `theme_runtime.spec.ts`, journey trace and relevant screenshots | /settings → Interface → Appearance | Not run — fill during implementation verification |
| AC-3 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `theme_runtime.spec.ts`, journey trace and relevant screenshots | /settings; /game | Not run — fill during implementation verification |
| AC-4 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `theme_runtime.spec.ts`, journey trace and relevant screenshots | /settings; tooling: declared theme validate command | Not run — fill during implementation verification |
| AC-5 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `theme_runtime.spec.ts`, journey trace and relevant screenshots | /game; /settings | Not run — fill during implementation verification |
| AC-6 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `theme_runtime.spec.ts`, journey trace and relevant screenshots | /settings; /game | Not run — fill during implementation verification |
| AC-7 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `theme_runtime.spec.ts`, journey trace and relevant screenshots | tooling: declared theme validate/build command; /settings | Not run — fill during implementation verification |
| AC-8 | Functional E2E + targeted unit/integration; visual where appearance is asserted | `theme_runtime.spec.ts`, journey trace and relevant screenshots | /game; /settings | Not run — fill during implementation verification |

**Test Hooks**:

- **Baseline:** Shared theme tests, relevant preference tests and C-527 production style/input journeys; record actual runtime font sources before claiming a font-delivery defect.
- **Moon Task:** `bun moon run client:typecheck`, `bun moon run client:test`, `bun moon run e2e:test-client`, plus affected shared-project checks resolved from current Moon config. Use Biome and the repository's required validation flow; before PR run required affected-project gates and `bun moon run :validate` when mandated by current guidance. Do not invent project IDs from directory names.
- **Integration:** production `/game` using a real local fixture campaign and actual feature services; inject deterministic provider results for asynchronous operations. Use real storage boundaries for migration/atomicity tests. Assertions must establish behavior and domain invariants, not simply duplicate implementation conditions.
- **Functional:** `apps/e2e/tests/client/theme_runtime.spec.ts` with existing Page Objects and deterministic feature fixtures. Each AC maps to a named case; include negative/cancel/reload paths. Bun identity rune polyfills cannot establish Svelte reactivity: verify state/lifecycle/focus in compiled Playwright, reusing `apps/e2e/tests/client/reactive_lifecycle.spec.ts` patterns where appropriate.
- **Visual:** add `apps/e2e/src/visual/suites/theme_runtime.visual.ts` using the current runner's `defineConfig` and `export default` conventions. Declare cases with `name`, real `route` and `searchParams`; route fixtures through the repository's existing test fixture mechanism. Do not invent production query parameters solely to bypass domain integration. A dev sandbox may supplement but not replace production cases.
- **Visual cases:** `explore-default`, `dialogue-long`, `inventory-detail`, `combat-actions`, `settings-error`, `compact`, `large-text`, `high-contrast`, `reduced-motion`. Select the cases materially affected by this contract and explain any omitted context.
- **TypeBox visual response schema:** an object with `score` (0–100), `unreadableText` (boolean), `overlappingControls` (boolean), `missingCriticalAction` (boolean), and `issues` (bounded string array), adapted to the existing visual runner wrapper. AI evaluation prompt: “Evaluate this Aikami production journey against the supplied expected state. Score 90+ only when text hierarchy is readable, essential controls are visible and nonoverlapping, focus/selection is apparent where expected, and the scene retains appropriate prominence. Identify concrete defects; do not reward decoration at the expense of usability.” Treat any missing critical action as a failure regardless of score.
- **Viewports/input:** 1920×1080 and 1280×800 normal; 1024×768 compact; 390×844 touch-oriented management; 200% text at desktop/compact; long translated labels/RTL; keyboard, standard controller, pointer and touch controls. Browser/Tauri runtime support must be recorded. UI operability on a narrow viewport does not certify all mobile world gameplay.
- **Performance evidence:** record hardware/runtime/build, campaign fixture, sample count and p50/p95. Compare a repeated 60-second exploration/combat scene before/after for UI-caused frame-time regression (proposed ≤5% p95 regression). Measure operations stated in Success Measures separately. If the environment cannot run a required gate, mark it unverified with the exact blocker; do not fabricate timings or mark the contract verified.

**Watch Points**:

- Production Path rule requires a resolvable route/named entry point/declared command. Replace proposed feature routes and tooling command descriptions with exact implemented routes/commands before approval/verification.
- Screenshot/AI appearance scores cannot prove focus, input ownership, immutable installation, moderation or domain idempotency; keep functional/integration assertions.
- Keep every required control reachable when optional HUD is hidden. Explicit user accessibility overrides have priority over visual preferences.

## Implementation Sequence

1. Define v1 profile/limits/compatibility and fixtures, including hostile packages; declare and test the shared compiler/validator.
2. Migrate built-in authoring to token data with generated CSS, scoped utility/portal verification and drift gate.
3. Implement editor and inert previews, local assets/install snapshots and recovery, then import/export and documented command.
4. Exercise fresh-profile offline round trip, adverse inputs, cancellation/races, text/contrast states, performance and creator walkthrough.

## Edge Cases & Gotchas

Invalid token dependency cycles; absent light/dark variant; failed font decode; rapid Apply/Cancel; font has incomplete glyphs; asset path case collisions; system theme changes mid-preview; portaled dialog escapes scoped root; corrupted active pointer; mixed old/new client versions.

## Open Questions

Must be resolved before status becomes `approved`:

Before approval, record the supported custom-font validation implementation or explicitly split that feature, finalize the theme API v1 allowlist/limits and declare the real validator command. These are engineering compatibility decisions; no requirement to choose a new visual direction.

## Amendments

Changes to ACs or scope require a version bump and user approval. Routine implementation placement can follow current project conventions while preserving the defined invariants.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-09-14 | Initial source-grounded draft; no implementation or verification claimed | Pending owner approval |

## Promotion Lifecycle

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle). A sandbox is not integrated; `release_verified` requires production and visual evidence.

## Status Lifecycle

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle). Keep `draft` until authorized; never mark completed before merge/CI. Record actual execution and AC evidence during implementation.
