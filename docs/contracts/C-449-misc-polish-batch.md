---
id: C-449
title: "Misc polish batch — settings, capability UX, hub, CI/onboarding, device-link, previews"
source: "docs/TODO.md, item 8 (2026-08-29) — 8 independent low-effort bugs bundled by user request as one filler contract"
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-29"
---

# Contract C-449: Misc polish batch — settings, capability UX, hub, CI/onboarding, device-link, previews

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/TODO.md` § "8. Misc small bugs / polish" |
| **Target** | See per-item Target rows under Architecture Directives — spans `apps/frontend/client`, `apps/frontend/hub`, `packages/backend/discord-bot`, `.github/workflows/`, `scripts/` |
| **Priority** | P2 — none of the eight are blockers; several are visible, low-cost user-facing bugs (8a, 8f, 8g). |
| **Dependencies** | 8d overlaps completed work in `C-441` (SOPS) and `C-440` (CI tooling) — reuse, don't re-solve. 8h shares root cause surface with `C-446`/`C-447` (hub catalog/sandbox previews). |
| **Status** | approved |
| **Promotion** | `sandbox` |
| **Docs Impact** | internal — `docs/guides/CI_CD.md` gains the local build-cache section (8c) and the onboarding stage (8d) if new; no user-facing docs page needed for the rest. |
| **Contract version** | 1.0.0 |

**Deliberate scope note**: `SHARED_SECTIONS.md`'s split rule ("split on independent mergeability") would normally put each of these 8 items in its own contract, since none needs another to be useful or verifiable. They are bundled here anyway at explicit user request as one filler-work contract. Each AC below is still independently implementable, testable, and mergeable in isolation — treat them as 8 small PRs against one contract, not one PR touching all 8 areas at once.

## Problem & Baseline Evidence

Eight small, previously-unfiled bugs/polish items accumulated in `docs/TODO.md`. Current behavior and repro per item:

- **8a — Kokoro voice download button**: `settings_audio_view.svelte:213/215/247` calls `viewModel.downloadVoiceModel()` (`settings_audio_view_model.svelte.ts:229`), which calls `voiceModelService.download()`. Reported as non-functional; root cause not yet confirmed (need to reproduce with devtools open — likely a silent promise rejection or a stale `voiceModelService` state check).
- **8b — Capability dialog persistence**: `apps/frontend/client/src/lib/views/capability/capability_view_model.svelte.ts` drives the pre-game capability screen (tabs Text/Image/Voice, `showCloudSetup` guided-connection modal). The modal's state/selection does not persist appropriately, and Voice vs. Image need distinct UX (e.g. voice has a downloadable local model per 8a, image does not) — currently both tabs share one generic connection-setup flow.
- **8c — Build caching**: `.github/workflows/release.yml` already caches the Tauri build (Rust via `Swatinem/rust-cache@v2` scoped to `apps/frontend/client/src-tauri`, Bun deps via `actions/cache@v6` keyed on `bun.lock`). None of this is available to a developer running `moon run client:build` (or `hub`/`site`/`docs` builds) locally — every local build is fully cold.
- **8d — Cloudflare/SOPS/CI onboarding**: `C-441` migrated secrets to SOPS and `C-440` added CI tooling (Renovate, workflow lint, CodeRabbit), both `status: implemented`. Neither produced a first-run onboarding script/doc walking a new contributor through obtaining a Cloudflare API token, an `age` key, and decrypting `secrets/` locally — that stage doesn't exist yet.
- **8e — Discord bot role sync**: `packages/backend/discord-bot/src/index.ts` (+ `lib/ai_chat.ts`, `lib/github_issue.ts`, `lib/constants.ts`, `lib/types.ts`) has no role-sync logic today. Need to add: when a user's channel memberships change, sync which third-party tool integrations (per `lib/constants.ts`'s tool/channel mapping) they're granted access to.
- **8f — Device-link sign-in flow**: `apps/frontend/client/src/lib/views/link/link_view_model.svelte.ts` (route `/link`) persists the `code` query param to `sessionStorage` (`CODE_STORAGE_KEY`, 5 min TTL) specifically so a full OAuth redirect round-trip survives. Reported bug: starting from a signed-out state on `/link`, clicking "Sign In" (shared `LoginView`/`login_view_model.svelte.ts`) completes Google OAuth but lands the browser on the start page (`/`) instead of back on `/link`, forgetting the device-link handoff. Likely cause: the sign-in call made from `/link` doesn't pass a `callbackURL` back to `/link?code=…`, so better-auth's OAuth redirect falls back to its default post-login destination.
- **8g — Hub favicon 404**: `https://hub.bearlysleeping.com/favicon.png` → `HTTP/3 404`. `apps/frontend/hub/src/app.html:5` references `%sveltekit.assets%/favicon.png`, but `apps/frontend/hub/static/` has no `favicon.png` — only `favicon.svg`, `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `site.webmanifest`. `apps/frontend/client/src/app.html` already has the correct multi-icon `<link>` set (svg + ico + apple-touch + manifest) pointing at files that exist in `apps/frontend/client/static/`.
- **8h — LPC/map preview WebGL failures**: Hub catalog LPC preview and map sandbox preview (`packages/frontend/preview/src/lib/lpc/*`, `packages/frontend/preview/src/lib/map/*`, consumed by `apps/frontend/hub/src/lib/views/sandbox/walk_sandbox_view_model.svelte.ts` and the `(public)/sandbox/[mapTag]` route) throw `WebGL context was lost` and `JSON.parse: unexpected character at line 2 column 1 of the JSON data`. The JSON error suggests a fetch for map/manifest data is receiving an HTML error page (e.g. a 404/500 body) instead of JSON — worth checking first, as it may be upstream of and causally related to the WebGL loss (a failed asset load leaving PixiJS in a bad state) rather than two independent bugs.

**Existing implementation to reuse**:
- 8c: `Swatinem/rust-cache@v2` + `actions/cache@v6` patterns already proven in `release.yml` lines ~400-448.
- 8d: `scripts/src/lib/ops/decrypt_secrets.ts` / `encrypt_secrets.ts` (SOPS tooling from C-441) — the onboarding stage should call into these, not reimplement secret handling.
- 8f: The `sessionStorage` round-trip mechanism in `link_view_model.svelte.ts` is correct and should NOT be reworked — the fix is scoped to the sign-in call's redirect target.
- 8g: Copy `apps/frontend/client/src/app.html`'s `<link rel="icon">` block verbatim (paths already resolve identically via `%sveltekit.assets%`, and hub's `static/` already has the matching files).

**Known gaps**: Root cause is unconfirmed for 8a, 8b, and 8h — each AC below requires reproducing and diagnosing before implementing, not just applying a guessed fix.

**Baseline tests**: `bun test apps/frontend/client/src/lib/views/settings/audio/`, `bun test apps/frontend/client/src/lib/views/capability/`, `bun test apps/frontend/client/src/lib/views/link/` (none currently exist for link — check), `apps/e2e/src/visual/suites/hub_lpc_preview.visual.ts`, `apps/e2e/tests/hub/catalog_preview.spec.ts`.

## User Outcome

After this contract, a player can download the Kokoro voice model from Settings and have it work; a player setting up capabilities sees UX suited to whether they're configuring voice or image; a developer gets cached local builds across all frontend apps; a new contributor has a scripted path to Cloudflare + SOPS access; a Discord community member's third-party tool access tracks their channel membership automatically; a Tauri user signing in via the device-link browser tab lands back on the link page and completes linking; the hub's favicon renders instead of 404ing; and the hub's LPC/map previews render instead of crashing.

## Success Measures

- **Time/latency target**: N/A — bug fixes and tooling, not new latency-sensitive paths. 8c's success measure is a materially faster warm local build (no fixed target — directionally "cache hit, not full rebuild").
- **Offline/degraded behavior**: 8a's voice model download must fail with a visible error message when offline, not fail silently (which is closer to the reported symptom).
- **Production journey enabled**: player onboarding through capability setup (8b) and voice TTS (8a); desktop sign-in (8f); community hub browsing (8g, 8h).

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Voice model download | `apps/frontend/client/src/lib/services/audio/voice_model_service.svelte.ts` | modify (fix bug) |
| Capability detection screen | `apps/frontend/client/src/lib/views/capability/capability_view_model.svelte.ts` | modify (per-capability UX branch) |
| CI Tauri build cache | `.github/workflows/release.yml` (Swatinem/rust-cache, actions/cache) | reuse pattern locally |
| SOPS secret tooling | `scripts/src/lib/ops/download_secrets.ts`, `upload_secrets.ts` | reuse (wrap in onboarding script) |
| Discord bot | `packages/backend/discord-bot/src/index.ts`, `lib/constants.ts` | modify (add role-sync) |
| Device-link handoff | `apps/frontend/client/src/lib/views/link/link_view_model.svelte.ts`, `login_view_model.svelte.ts` | modify (fix callback target) |
| App favicon setup | `apps/frontend/client/src/app.html` | reuse (copy pattern to hub) |
| LPC/map preview rendering | `packages/frontend/preview/src/lib/lpc/*`, `packages/frontend/preview/src/lib/map/*` | modify (fix bug) |

## Overview

Eight small, independent fixes and small features bundled into one contract per user request: a broken settings button, a capability-setup UX gap, missing local build caching, a missing CI/Cloudflare onboarding stage, a Discord bot enhancement, a device-link sign-in redirect bug, a missing hub favicon file, and a hub preview rendering crash. Each is scoped to its own AC and touches a disjoint set of files, so they can land as 8 separate small PRs referencing this one contract.

## Design Reference

- `apps/frontend/client/src/app.html` — correct favicon `<link>` pattern for 8g.
- `.github/workflows/release.yml` (lines ~400-448) — cache action patterns for 8c.
- `scripts/src/lib/ops/decrypt_secrets.ts` / `encrypt_secrets.ts` — SOPS flow for 8d.
- `apps/frontend/client/src/lib/views/link/link_view_model.svelte.ts` header comment — documents the intended handoff flow for 8f.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **8a**: Fix in `apps/frontend/client/src/lib/services/audio/voice_model_service.svelte.ts` and/or `settings_audio_view_model.svelte.ts`. Root-cause first (add temporary logging or reproduce via `moon run client:dev`), then fix.
- **8b**: Branch `CapabilityViewModelInterface`'s cloud-setup flow by `activeTab` capability. Voice tab surfaces the local-download path (8a) as a first-class option alongside cloud; Image tab keeps the existing cloud-only guided setup. Persist the modal's in-progress state (e.g. across tab switches or a route re-entry) using the same `$state` pattern already used elsewhere in the ViewModel.
- **8c**: Add a Moon task (or a shared script under `scripts/`) that wraps `moon run <app>:build` with the same cache directories the CI workflow uses (Bun install cache, Rust target dir for Tauri) — read from local paths (`~/.bun/install/cache`, `src-tauri/target`) rather than GitHub Actions cache API, since there's no cache service locally; the goal is warm-rebuild speed via persistent local directories, not cross-machine cache sharing.
- **8d**: New onboarding script/doc (`scripts/src/lib/ops/` or `CONTRIBUTING.md` section) that: (1) walks through creating a Cloudflare API token with the right scopes, (2) walks through generating/obtaining an `age` key for SOPS, (3) calls the existing `decrypt_secrets.ts` to decrypt `secrets/` locally. Do not reimplement secret decryption — call the existing script.
- **8e**: Add role-sync logic to `packages/backend/discord-bot/src/index.ts` (or a new `lib/role_sync.ts`), triggered on Discord `guildMemberUpdate`/channel-permission-change events, mapping channel membership → third-party tool grants per a config table in `lib/constants.ts`.
- **8f**: In `login_view_model.svelte.ts`'s `signIn()`, when invoked from the `/link` route, pass an explicit `callbackURL` (or equivalent better-auth option) pointing back to `/link?code=<code>` so the OAuth redirect returns to the link page with the code intact, instead of falling to the default callback.
- **8g**: Copy the `<link rel="icon">`/`<link rel="apple-touch-icon">`/`<link rel="manifest">` block from `apps/frontend/client/src/app.html` into `apps/frontend/hub/src/app.html`, verified against files already present in `apps/frontend/hub/static/`.
- **8h**: Root-cause first — check whether the `JSON.parse` failure (fetch returning an HTML error page) is causally upstream of the WebGL context loss in `packages/frontend/preview/src/lib/lpc/lpc_preview_view_model.svelte.ts` / `map_preview_view_model.svelte.ts`, then fix the actual failure (likely a wrong/missing asset URL) rather than only guarding against the WebGL symptom.

## State & Data Models

No new persistent schemas. 8e adds an in-memory or D1-backed role↔tool-access mapping if one doesn't already exist in `packages/backend/discord-bot` — check `lib/types.ts` first before adding a new shape.

## Quality Requirements

- **Offline/degraded mode**: 8a must show a clear error, not hang, when offline.
- **Accessibility/input**: N/A — no new interactive surfaces beyond existing settings/capability UI conventions.
- **Performance budget**: 8c should measurably reduce local warm-build time; no other item has a performance dimension.
- **Security/privacy**: 8d must never print decrypted secret values to stdout/logs; 8e must not grant tool access beyond what channel membership actually authorizes.
- **Persistence/migration**: N/A for all 8 items — no schema or save-format changes.
- **Cancellation/retry/idempotency**: 8a's download should remain cancellable per existing `cancelVoiceModelDownload()`; verify the fix doesn't regress that.
- **Observability**: 8h's fix should leave a clear log/error surface if the preview asset fetch fails again, rather than surfacing only the generic WebGL loss.

## Migration & Rollback

N/A — no persistent state changes in any of the 8 items.

## Scope Boundaries

- **In Scope:**
  - Exactly the 8 items enumerated above, each independently.
  - Root-cause diagnosis where the bug report doesn't already name a cause (8a, 8b, 8h).
- **Out of Scope:**
  - Any redesign of the capability screen beyond the voice/image UX branch needed for 8b.
  - Reworking the SOPS/secrets architecture itself (already done in C-441) — 8d only adds the onboarding wrapper.
  - Broader Discord bot feature work beyond the role-sync described in 8e.
  - The `#`-prefixed subpath import migration, Tauri OPFS persistence, or other unrelated `docs/TODO.md` items.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Deliberately bundled against the split rule (see Metadata note above) — implement and land each AC as its own PR/commit against this one contract rather than one combined PR.

## Acceptance Criteria

### AC-1: Kokoro voice model download works (8a)
**Given** a user on the Settings → Audio tab with no voice model downloaded
**When** they click "Download voice model"
**Then** the model downloads with visible progress, completes, and TTS becomes usable — or, if offline/failed, a clear error message is shown instead of a silent no-op.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + Manual | `apps/frontend/client/src/lib/services/audio/voice_model_service.test.ts` (add/extend) | `/settings` → Audio tab | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: Manual browser check at Settings → Audio with devtools network tab open, once online and once with network throttled offline.
- E2E / Visual: N/A

**Watch Points**:
- Confirm whether the reported "does not work" is a UI issue (button not wired), a service issue (`voiceModelService.download()` throwing/rejecting silently), or an environment issue (CORS/asset URL) before fixing.

### AC-2: Capability dialog UX differs correctly for voice vs. image (8b)
**Given** the capability detection screen
**When** the user is on the Voice tab vs. the Image tab
**Then** each tab presents setup options appropriate to that capability (voice: local Kokoro download + cloud; image: cloud/local per existing providers), and the guided-setup modal's state persists sensibly across tab switches instead of resetting or leaking state from the other tab.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `apps/frontend/client/src/lib/views/capability/capability_view_model.test.ts` | `/capability` (or current route) | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: Manual browser check switching Voice ↔ Image tabs mid-setup.
- E2E / Visual: N/A

**Watch Points**:
- Don't regress the existing Text tab flow, which is out of scope for the UX change.

### AC-3: Local `build` tasks reuse CI-equivalent caching (8c)
**Given** a developer running a Moon build task for `client`, `hub`, `site`, or `docs` on a clean-ish local machine (cold caches cleared)
**When** they run the build a second time without changing dependencies
**Then** the second build is measurably faster, using the same cache directories/mechanics (Bun install cache, Rust target dir for the Tauri build) that `release.yml` uses in CI.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Manual | timed before/after build runs | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:build`, `moon run hub:build`, `moon run site:build`, `moon run docs:build`
- Integration: Time a cold build vs. a warm rebuild for each app; confirm cache directories match those named in `release.yml`.
- E2E / Visual: N/A

**Watch Points**:
- Don't introduce a GitHub Actions cache dependency for local builds — local caching must work with no network/CI service.

### AC-4: Cloudflare + SOPS onboarding stage exists (8d)
**Given** a new contributor with repo access but no Cloudflare token or `age` key
**When** they follow the new onboarding script/doc
**Then** they end up with a working local `secrets/` decryption via the existing `decrypt_secrets.ts` tooling, without needing to ask a teammate for undocumented steps.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Manual | new onboarding doc/script + a dry run by someone unfamiliar with the current process | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: N/A
- Integration: Manual walkthrough of the new onboarding steps end-to-end.
- E2E / Visual: N/A

**Watch Points**:
- Reuse `C-441`'s SOPS tooling as-is; this AC is documentation/scripting glue, not new secret-handling logic.

### AC-5: Discord bot role-syncs third-party tool access (8e)
**Given** a Discord community member who joins or leaves a channel that maps to a third-party tool integration
**When** their channel membership changes
**Then** the bot updates their tool access grant to match, without requiring manual admin intervention.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit + Manual | `packages/backend/discord-bot/src/lib/role_sync.test.ts` (new) | Discord guild (staging/test server) | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run backend-discord-bot:test`
- Integration: Manual test in a Discord test server — join/leave a mapped channel and confirm the grant changes.
- E2E / Visual: N/A

**Watch Points**:
- Confirm the channel→tool mapping table's source of truth (config file vs. hardcoded) before implementing; don't grant access beyond what membership authorizes.

### AC-6: Device-link sign-in returns to the link page (8f)
**Given** the Tauri desktop client opens the browser to `/link?code=<code>` while the user is signed out
**When** the user completes Google sign-in from that page
**Then** the browser redirects back to `/link?code=<code>` (or restores the code from `sessionStorage` on the returned page) and reaches the `confirm` state, not the start page.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | E2E | `apps/e2e/tests/client/` (new or extended device-link spec) | `/link` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: Manual full OAuth round-trip from `/link` in a real browser, signed out.
- E2E / Visual:
    - **Functional**: New Playwright spec exercising sign-in from `/link` and asserting the final URL/state is `confirm` on `/link`, not `/`.
    - **Visual**: N/A

**Watch Points**:
- Do not touch the `sessionStorage` round-trip mechanism itself — it already works; the bug is in the OAuth redirect target only.

### AC-7: Hub favicon resolves (8g)
**Given** a browser requesting `https://hub.bearlysleeping.com/favicon.png` or any icon link declared in `app.html`
**When** the page loads
**Then** every declared icon URL returns 200, matching the client app's icon setup.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-7 | Manual | N/A | `https://hub.bearlysleeping.com/` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run hub:build`
- Integration: `curl -I` each icon URL against a local preview build; confirm no 404s.
- E2E / Visual: N/A

**Watch Points**:
- Confirm hub's `static/` files (already present per baseline evidence) match the paths referenced in the new `app.html` block exactly.

### AC-8: LPC and map previews render without crashing (8h)
**Given** the hub catalog LPC preview or the map sandbox preview
**When** a user opens either preview
**Then** it renders successfully with no `WebGL context was lost` or `JSON.parse` errors in the console, for the tested assets.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-8 | E2E + Visual | `apps/e2e/tests/hub/catalog_preview.spec.ts`, `apps/e2e/src/visual/suites/hub_lpc_preview.visual.ts` | `hub.bearlysleeping.com/sandbox/[mapTag]`, catalog LPC preview | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run e2e:test`
- Integration: Manual browser check with devtools console open on both preview types.
- E2E / Visual:
    - **Functional**: Re-run `apps/e2e/tests/hub/catalog_preview.spec.ts`; confirm no console errors.
    - **Visual**: Re-run `hub_lpc_preview.visual.ts`; confirm rendered LPC sprite/tilemap visible.

**Watch Points**:
- Diagnose whether the `JSON.parse` error (likely an HTML error body from a failed fetch) is the root cause of the WebGL loss before treating them as two separate fixes.

## Implementation Sequence

1. **Phase 1 (Diagnosis)**: Reproduce 8a, 8b, and 8h locally with devtools open to confirm root cause before writing fixes; confirm 8f's redirect-target hypothesis by tracing `login_view_model.svelte.ts`'s `signIn()` call chain.
2. **Phase 2 (Independent fixes)**: Implement AC-1 through AC-8 as separate commits/PRs in any order — none depends on another.
3. **Phase 3 (Validation)**: Run `moon check` + `bun test` for each touched app/package; run the relevant E2E/visual suites for AC-6 and AC-8.

## Edge Cases & Gotchas

- **8b/8a interaction**: the Voice tab's capability UX (8b) surfaces the download button fixed in 8a — sequence 8a before relying on it in 8b's manual verification.
- **8f**: better-auth's OAuth callback behavior may differ between the popup flow (used elsewhere) and the full-page redirect flow `/link` relies on (Tauri can't use a popup) — verify the fix against the full-page redirect path specifically.
- **8h**: don't assume the WebGL loss and the JSON.parse error share a root cause without confirming — they may be two separate defects that happen to fire together.

## Open Questions

Must be resolved before status becomes `approved`:

- 8e: what is the intended channel→tool mapping (a hardcoded table, a config file, or an admin UI)? Not specified in the source TODO item.
- 8d: does "CI onboarding/setup stage" mean a CI job (automated check that a new contributor's env is valid) in addition to a manual onboarding doc, or documentation only?

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
