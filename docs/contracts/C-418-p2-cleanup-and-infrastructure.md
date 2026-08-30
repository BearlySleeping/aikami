---
id: C-418
title: "P2 Consistency, Cleanup, and Infrastructure Batch"
source: "docs/contracts/MVP_BACKLOG.md (seeds C-409, C-410, C-411, C-412, C-413, C-414); re-verified against main 2026-08-17"
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-17"
---

# Contract C-418: P2 Consistency, Cleanup, and Infrastructure Batch

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/contracts/MVP_BACKLOG.md` seeds C-409, C-410, C-411, C-412, C-413, C-414 (`mvp-assessment-2026-08-16.md`), re-verified against `main` 2026-08-17 |
| **Target** | `packages/frontend/configs`, four app `app.css` files; `apps/frontend/client/src/routes/(dev)/`; tsconfig/svelte.config alias references; `apps/backend/firebase/`, `apps/frontend/hub/`; `docs/architecture/`, `docs/strategy/deferred.md`; `apps/backend/local-stack/` |
| **Priority** | P2 — consistency, cleanup, infrastructure. **Do not start before the P0 block (C-400/401/402/405) lands.** |
| **Dependencies** | — |
| **Status** | implemented |
| **Promotion** | `—` |
| **Docs Impact** | user-facing → `apps/backend/local-stack/README.md` Quick Start (Feature F only); rest internal |
| **Contract version** | 2.0.0 |

This contract absorbs six originally-separate backlog seeds (C-409, C-410,
C-411, C-412, C-413, C-414) into one file per explicit user direction to
reduce per-file overhead. Each feature below is independently mergeable —
see [Contract Size & Split Rule](#contract-size--split-rule).

**Re-verification note:** a fact-check pass on 2026-08-17 found three of the
six seeds materially stale: C-411's target packages are already deleted
(reframed to dangling alias cleanup only), C-412's target directory has grown
new files the seed didn't know about, and C-414's problem framing overstated
current friction (though the core gap — no one-command installer — still
holds). C-409, C-410, and C-413 hold as written, with minor line-number
drift.

---

## Problem & Baseline Evidence

### Feature A — Shared design tokens across client, hub, site, docs (absorbs seed C-409)

- **Current behavior, confirmed unchanged**: `apps/frontend/client/src/app.css`
  and `apps/frontend/hub/src/app.css` are byte-identical (18 lines each),
  both stock daisyUI:
  ```css
  @plugin "daisyui" {
    themes:
      light --default,
      dark --prefersdark;
  }
  ```
  `packages/frontend/configs` exists but holds env/runtime config
  (`env.d.ts`, `app.ts`, `auth.ts`, `feature_flags.ts`) — no CSS or theme
  file. `apps/frontend/site` and `apps/frontend/docs` have no `daisyui` in
  either `package.json`. Site defines its own `@theme inline` block
  (`src/lib/styles/global.css`, `--color-primary`, `--radius-*`), and docs
  overrides Starlight's `--sl-color-accent*` / `--sl-color-gray-*`
  (`src/styles/docs.css`) to match the site's palette — zero sharing with
  client/hub's daisyUI setup.
- **Explicitly not in scope: removing daisyUI.** 135 of 228 client `.svelte`
  files use daisy classes (~4,700 occurrences).
- **Reproduction**: diff the four apps' theme files; all four render stock
  daisyUI/Tailwind defaults with no brand colour.
- **Existing implementation to reuse**: `apps/frontend/site`'s `@theme
  inline` values are the closest thing to an existing brand palette — use
  them as the seed for the shared token set rather than inventing new colours.

### Feature B — Gate dev routes out of production builds (absorbs seed C-410)

- **Current behavior, confirmed unchanged**:
  `apps/frontend/client/src/routes/(dev)/+layout.svelte` has no guard beyond
  an `isScreenshot` branch (via `BaseDevViewModel.isScreenshot()`). 46
  `+page.svelte` files plus two `+layout.svelte` files (the group root and
  one nested sandbox) — 48 files total — ship under `(dev)/`. Neither
  `svelte.config.js` nor `vite.config.ts` contains any route-exclusion
  mechanism.
- **Reproduction**: build for production, inspect the output for `(dev)`
  routes — they are present and reachable.
- **Existing implementation to reuse**: none — this is a new build-time gate.

### Feature C — Repository cleanup (absorbs seed C-411)

- **Current behavior, materially changed from the seed**:
  `packages/frontend/dataconnect`, `packages/frontend/firestore`, and
  `packages/backend/firestore` **no longer exist on disk** — deleted by
  commits `96d11d00` (C-385) and `f7425f31` (C-386), both of which predate
  even this seed's authoring date. **There is nothing left to delete.**
  However, **dangling path-alias references to them survive**:
  - `apps/frontend/client/tsconfig.test.json:34-37,60-62`
  - `apps/frontend/client/.fast-check/tsconfig.json:55-59,157-161`
  - `apps/frontend/hub/.fast-check/tsconfig.json:61-62,106-110`
  - `packages/frontend/storage/tsconfig.json:14-15`
  - `packages/frontend/services/tsconfig.json:13-14`
  - `apps/frontend/client/svelte.config.js` and
    `apps/frontend/hub/svelte.config.js` still declare an
    `@aikami/frontend/firestore` alias pointing at the deleted directory.
- **The alias inventory is wider than the seed knew — two families, 11
  files.** Repo-wide scan (2026-08-17, excluding generated `.svelte-kit`
  tsconfigs and moon cache) finds dangling aliases in **11 non-generated
  config files**:
  - `@aikami/frontend/firestore` family (8 files):
    `apps/frontend/client/svelte.config.js:93-94`,
    `apps/frontend/hub/svelte.config.js:67-68`,
    `apps/frontend/client/tsconfig.test.json:34-37`,
    `apps/frontend/client/.fast-check/tsconfig.json:157-161`,
    `apps/frontend/hub/.fast-check/tsconfig.json:106-110`,
    `packages/frontend/storage/tsconfig.json:14-15`,
    `packages/frontend/services/tsconfig.json:13-14`,
    `packages/frontend/utils/tsconfig.json:11-12` (**new since the seed**).
  - `@aikami/backend/firestore` family (8 files, pointing at the equally
    deleted `packages/backend/firestore`):
    `apps/frontend/client/svelte.config.js:64-65`,
    `apps/frontend/hub/svelte.config.js:51`,
    `apps/frontend/client/tsconfig.test.json:60-62`,
    `apps/frontend/client/.fast-check/tsconfig.json:55-59`,
    `apps/frontend/hub/.fast-check/tsconfig.json:61-62`,
    `packages/backend/auth/tsconfig.json:9-10` (**new since the seed**),
    `packages/shared/mocks/tsconfig.json:20-21` (**new since the seed**),
    `apps/backend/firebase/tsconfig.json:13-14` (**new since the seed**).
  Verified: **no source file imports either alias family** — they are dead
  config, safe to remove without breaking typecheck.
- **The `appearanceLayers` dedupe item is resolved, not open**: C-417 is
  `implemented` and its OQ-1 settled — the
  `appearanceLayers[2] = 0; appearanceLayers[4] = 0` block is **intentional
  and load-bearing** (equipment owns torso/feet, per the C-374 comment and
  the `_mergeEquipmentRecipes` overlay mechanism). The block lives at
  `game_boot_service.svelte.ts:1296-1297` and
  `game_engine_service.svelte.ts:907-908`. Dedupe must therefore **extract a
  shared helper that both services invoke** — deleting either call site
  erases intentional equipment-overlay behavior.
- **`daily.ts` still a no-op**:
  `apps/backend/firebase/src/controllers/scheduler/daily.ts` is unchanged —
  21 lines, logs a static object, returns. Its deletion overlaps Feature D
  (retiring Functions); fold into whichever contract runs first.
- **`PROGRESS.md` freshness**: last checked 2026-08-16;
  `sync_contracts.ts` was run then. Re-run at implementation time rather
  than trusting this note — it decays fast.
- **Reproduction**: `ls packages/frontend/dataconnect packages/frontend/firestore
  packages/backend/firestore` → not found; `grep -r "frontend/firestore\|frontend/dataconnect"`
  across the tsconfig files above → matches.

### Feature D — Retire Firebase Functions into the hub's Elysia API (absorbs seed C-412)

- **Current behavior, materially changed from the seed**:
  `apps/backend/firebase/src/controllers/` now holds **9 files, 303 lines**,
  not the ~150 lines across 5 files the seed described:
  - `callable/auth.ts` (39 lines) — seed's original target, move to hub.
  - `callable/poll_device_handoff.ts` (63 lines) — seed's original target,
    move to hub.
  - `auth/created.ts` (21 lines, logs only) — seed's original target, delete.
  - `auth/deleted.ts` (logs only) — seed's original target, delete.
  - `scheduler/daily.ts` (21 lines, no-op) — seed's original target, delete
    (overlaps Feature C).
  - `api/discord_interactions.ts` (**115 lines, new since the seed**) — a
    real feature (Discord interactions webhook), not accounted for by the
    original scope. Needs a disposition decision — see OQ-3.
  - `firestore/users/[uid]/created.ts`, `.../deleted.ts`, `.../updated.ts`
    (**7-9 lines each, new since the seed**) — Firestore trigger stubs; not
    yet confirmed logging-only or real. Needs verification — see OQ-4.
- **Hub-as-Elysia confirmed**: `apps/frontend/hub/package.json:51` has
  `"elysia": "^1.4.29"` plus `@elysiajs/eden`; mounted in
  `apps/frontend/hub/src/lib/server/api/index.ts` (184 lines) and exposed via
  `apps/frontend/hub/src/routes/api/[...slugs]/+server.ts`.
- **Reproduction**: N/A — this is an inventory/migration task, not a bug.

### Feature E — Reverse the Cloud Run inference plan, ADR amendment (absorbs seed C-413)

- **Current behavior**: `docs/architecture/data-layer-target-architecture.md:24`
  carries the D-6 Cloud Run / cross-cloud clause the amendment must update.
  `docs/strategy/deferred.md:20-30` already contains scaffolding for this
  exact change:
  ```
  🔴 **Under revision (C-413):** the Cloud Run cold-start optimization ...
  recommended for rejection ... See docs/strategy/mvp-assessment-2026-08-16.md §2.4;
  ```
  **This means the amendment is partially started already** — this feature
  formalizes and resolves that in-place marker rather than writing a fresh
  edit from nothing.
- **Decision to record** (unchanged from the seed): the `service` mode of
  `AiProviderGateway` is a thin metered proxy over Anthropic / OpenAI /
  Gemini, not GCP-hosted GPUs. Cloud Run GPU (L4) is ~$0.71/hr with a 20-30s
  cold start; self-hosting only wins at sustained high utilization, which a
  pre-revenue project does not have.
- **No code changes** — the `service` adapter interface already exists
  (C-320).

### Feature F — Standalone install script for the local stack (absorbs seed C-414)

- **Current behavior, framing corrected from the seed**: `stack init`
  already exists and already handles `.env` generation via a hardware
  wizard (`apps/backend/local-stack/README.md:1-30`, referencing C-390/391).
  The seed's claim that the no-clone path "requires fetching 9 compose files
  and hand-authoring `.env`" **overstates current friction** —
  `docker compose up -d` with a hand-written `.env` copied from
  `.env.example` already works with no git clone (README lines 20-24), and
  `.env` generation via `stack init` is smooth when a clone is used.
- **The actual remaining gap, confirmed live 2026-08-17**: the documented
  **Quick Start still leads with "1. Clone the repo"**
  (`README.md:33-40`), and no `curl -fsSL .../install | sh` one-command
  installer exists anywhere in the repo. The no-clone path is real but
  buried in a prose paragraph above the Quick Start, not promoted as the
  primary path.
- **Reproduction**: read `apps/backend/local-stack/README.md` top to
  bottom as a new user would — the promoted path is clone-first.
- **Existing implementation to reuse**: `stack init`'s hardware-detection
  wizard (C-391) — the install script wraps it, does not replace it.

---

## User Outcome

After this contract:
- All four frontend apps (client, hub, site, docs) render one shared brand
  palette in light and dark.
- A production build ships zero `(dev)` routes; E2E/visual suites still pass
  against a test build with the gate enabled.
- No dangling references to deleted packages (both
  `@aikami/frontend/firestore` and `@aikami/backend/firestore` alias
  families) remain anywhere in the repo; the `appearanceLayers` hard-zero
  logic exists in exactly one shared helper that both services invoke.
- Firebase Functions carries only what cannot move to the hub; auth and
  device handoff work identically through the hub's Elysia API.
- The data-layer ADR and `deferred.md` state, unambiguously, that
  self-hosted inference is rejected for now and why.
- A clean machine with only Docker installed can stand up the local stack
  with one command.

## Success Measures

- **Time/latency target**: N/A for A/C/E; build-time only for B; N/A for D;
  one-command wall-clock for F (record before/after friction, not latency).
- **Offline/degraded behavior**: N/A — none of these features touch runtime
  network/AI behavior.
- **Production journey enabled**: consistent branding across every surface a
  player or contributor sees; a production build that doesn't leak the dev
  workbench; a simpler deploy topology; a documented, final infra decision;
  a genuinely easy local-stack onboarding path.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| daisyUI theme config | `apps/frontend/{client,hub}/src/app.css` | **replace** with shared package import |
| Brand palette seed | `apps/frontend/site/src/lib/styles/global.css` `@theme inline` | **reuse** as the starting palette |
| Dev route host | `routes/(dev)/+layout.svelte` | **modify** — add production guard |
| Deleted-package aliases | 5 tsconfig files + 2 `svelte.config.js` | **remove** |
| `appearanceLayers` zero-out | `game_boot_service.svelte.ts:1296-1297`, `game_engine_service.svelte.ts:907-908` | **dedupe into shared helper** (C-417 OQ-1 resolved: zero-out intentional — preserve both call sites) |
| Firebase auth/handoff controllers | `callable/auth.ts`, `callable/poll_device_handoff.ts` | **move** to hub Elysia routes |
| Firebase logging-only triggers | `auth/created.ts`, `auth/deleted.ts`, `scheduler/daily.ts` | **delete** |
| New Firebase surfaces (undecided) | `api/discord_interactions.ts`, `firestore/users/[uid]/*.ts` | **investigate, then decide** (OQ-3, OQ-4) |
| Hub Elysia server | `apps/frontend/hub/src/lib/server/api/index.ts` | **reuse** — target for moved routes |
| Cloud Run ADR marker | `docs/strategy/deferred.md:20-30` | **resolve** the existing `🔴 Under revision` note |
| Local stack `.env`/hardware wizard | `stack init` (C-390/391) | **reuse** — wrap in the new installer |

## Overview

Six independent P2 items, batched into one contract file. Three (design
tokens, dev-route gating, ADR amendment) proceed close to seed as written.
Repository cleanup narrows from "delete packages" to "delete dangling
aliases" since the packages themselves are already gone. Firebase Functions
retirement gains two new surfaces the seed never saw and needs a disposition
call before scoping is final. The install script's problem statement is
corrected to focus specifically on the missing one-command installer rather
than the setup difficulty broadly, which has already improved.

## Design Reference

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

- **Feature A**: one custom `@plugin "daisyui/theme"` brand palette in a
  shared package (likely a new `packages/frontend/theme` or an addition to
  `packages/frontend/configs`), consumed by client/hub; the same values
  exported as plain `@theme` custom properties for site/docs. Seed the
  palette from `apps/frontend/site`'s existing `@theme inline` block rather
  than choosing new colours.
- **Feature B**: exclude `(dev)` at the SvelteKit route-config or Vite-build
  level, gated by an explicit build flag so test builds can still enable it
  — E2E/visual suites must keep exercising these routes.
- **Feature D**: for the two undecided new surfaces (`discord_interactions.ts`,
  the three `firestore/users/[uid]/*.ts` triggers), read them before
  deciding — do not assume they are logging-only like the older triggers.
- **Feature F**: publish `stack init` as a Bun-compiled single-file binary
  per release; `curl -fsSL https://aikami.sh/install | sh` fetches compose
  files and runs it. Rewrite the README so the one-liner is step 1 and
  cloning is explicitly the contributor path.

## Architecture Directives

- **Feature A**: no app may declare its own theme colours after this lands —
  enforce by deleting the duplicated stanzas, not just adding a new shared
  file alongside them.
- **Feature B**: the gate must be a build flag, not a runtime check — dev
  routes should not ship in the production bundle at all, not merely be
  hidden behind a client-side condition.
- **Feature C**: alias removal must not break any currently-passing
  typecheck or test — run `bun run typecheck` after each file edit, not just
  at the end.
- **Feature D**: routes moved to the hub must live under the existing
  `apps/frontend/hub/src/lib/server/api/index.ts` Elysia app, following its
  existing TypeBox route-definition pattern — no second API surface.
- **Feature E**: documentation-only; no code changes, per the seed's own
  constraint.
- **Feature F**: the installer script itself should be POSIX `sh`, not
  bash-specific, for portability; it must not silently overwrite an existing
  `.env`.

## State & Data Models

No new persisted data shapes. Feature D's controller-to-route migration
preserves existing request/response shapes for `auth` and
`poll_device_handoff` — this is a transport change (Cloud Function →
Elysia route), not a schema change.

## Quality Requirements

- **Offline/degraded mode**: N/A for all six.
- **Accessibility/input**: N/A.
- **Performance budget**: N/A.
- **Security/privacy**: Feature D must preserve existing auth/IAM guarantees
  when moving off Cloud Functions — verify the hub route enforces the same
  authentication the Callable Function did.
- **Persistence/migration**: N/A — no schema changes; Feature D changes
  transport only.
- **Cancellation/retry/idempotency**: N/A.
- **Observability**: Feature F's installer should log each step (download,
  verify, wizard invocation) so a failed run is diagnosable from output alone.

## Migration & Rollback

- **Feature D is the one migration-relevant item**: sign-in and device
  handoff must keep working during the cutover. Roll out the hub routes,
  verify against the existing Functions in parallel if feasible, then remove
  the Functions deploy stage. Rollback: redeploy the Functions stage from
  git history; the hub routes can stay dormant without harm.
- **Feature C**: rollback is trivial (revert the alias-removal commits); no
  data is touched.
- All other features: N/A — no persistent state changes.

## Scope Boundaries

- **In Scope:**
  - Feature A: one shared brand palette, consumed by all four apps, with the
    duplicated theme stanzas deleted.
  - Feature B: production builds contain no `(dev)` route; test builds keep
    the gate enabled for E2E/visual suites.
  - Feature C: remove dangling `dataconnect`/`firestore` path aliases — both
    the `@aikami/frontend/firestore` and `@aikami/backend/firestore` families
    — from the 11 affected config files (six package tsconfigs, the two app
    `tsconfig.test`/`.fast-check` sets, two `svelte.config.js` files, and the
    firebase app tsconfig); dedupe the `appearanceLayers` zero-out into a
    shared helper, preserving both call sites (C-417 OQ-1 resolved — the
    zero-out is intentional); delete `daily.ts` (fold into Feature D if it
    lands first).
  - Feature D: move `auth` and `poll_device_handoff` to hub Elysia routes;
    delete the logging-only triggers and no-op scheduler; decide and act on
    `discord_interactions.ts` and the three Firestore trigger stubs; remove
    the Functions deploy stage from `scripts/src/lib/deploy/firebase.ts` and
    `cloudbuild.yaml`.
  - Feature E: an ADR amendment (or new ADR) recording the decision, cost
    comparison, and revisit conditions; resolve the existing `deferred.md`
    marker.
  - Feature F: a `curl | sh` installer, a compiled `stack init` binary
    published per release, and a rewritten Quick Start leading with it.

- **Out of Scope:**
  - Removing daisyUI itself (Feature A).
  - Any change to E2E/visual test *content*, only their build-time
    reachability of `(dev)` routes (Feature B).
  - Firebase Auth, Storage, FCM, App Check — all stay; only Functions is
    retired (Feature D, per directive D-12).
  - Containerizing the hardware-detection wizard — GPU detection inside a
    container without the NVIDIA toolkit is unreliable (Feature F).
  - Any change to `AiProviderGateway`'s adapter interface itself (Feature E)
    — it already exists from C-320.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** deliberately bundles six independent P2 items — none
shares a data model or invariant with another — per explicit user direction.
Each feature has its own Problem, Scope, and AC block and is independently
mergeable. Feature D (Functions retirement) is the largest and riskiest; if
its scope (including the two newly-discovered surfaces) grows enough to
threaten review quality, split it into its own contract and record that as
an amendment. Features C and D share one line item (`daily.ts`) — whichever
lands first claims it; the other's AC references it rather than duplicating
the deletion.

## Acceptance Criteria

### AC-1: One shared theme, all four apps
**Given** the shared palette package
**When** client, hub, site, and docs each build
**Then** all four render the same brand colours in light and dark, and no
app file declares its own theme colours

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Visual | visual suite per app | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run e2e:run-visual-tests` — the visual runner lives in
  `apps/e2e` (there is no `client:test-visual`/`hub:test-visual` task), or a
  manual screenshot comparison for site/docs.
- Integration: grep all four apps for theme-colour declarations outside the
  shared package — must return nothing.
- E2E / Visual: **Visual**: one snapshot per app in light and dark.

**Watch Points**:
- Site and docs use plain Tailwind `@theme`, not daisyUI — the shared values
  must be exported in both forms.

### AC-2: Production build contains no `(dev)` route
**Given** a production build
**When** the build output is inspected
**Then** no route under `(dev)` is present, while a test build retains them
and the existing E2E/visual suite passes unchanged

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Integration | build output inspection | N/A (build-time) | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:build` (production) vs. test-build variant.
- Integration: `ls build/` (or equivalent) for `(dev)` route chunks/pages.
- E2E / Visual: **Functional**: existing E2E suite re-run against a test
  build with the gate enabled — must pass unchanged.

**Watch Points**:
- 48 files depend on this route group — verify the flag is read at build
  config level, not per-route, so nothing is missed.

### AC-3: No dangling references to deleted packages
**Given** the repo after cleanup
**When** searching for `frontend/dataconnect`, `frontend/firestore`, or
`backend/firestore`
**Then** no tsconfig or `svelte.config.js` reference remains (both the
`@aikami/frontend/firestore` and `@aikami/backend/firestore` alias families
are gone), and `bun run typecheck` passes

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration | `bun run typecheck` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun run typecheck`
- Integration:
  `grep -rE "frontend/firestore|backend/firestore|frontend/dataconnect"`
  across `**/tsconfig*.json` + `**/svelte.config.js` → zero matches outside
  historical docs/changelogs and generated `.svelte-kit` tsconfigs (which
  regenerate from `svelte.config.js`).
- E2E / Visual: N/A.

**Watch Points**:
- Don't confuse this AC with actually deleting packages — they're already
  gone; this is alias cleanup only. Clean both alias families (frontend AND
  backend) — a repo-wide grep found 11 affected files, not 7.

### AC-4: Auth and device handoff work through the hub
**Given** a user signing in or completing device handoff
**When** the flow runs against the hub's Elysia API instead of Firebase
Functions
**Then** the outcome is identical to before, and no Functions deploy stage
remains in the pipeline

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | E2E | existing sign-in/device-handoff E2E specs pass unchanged against hub-hosted routes | hub API routes | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run e2e:test` — there is no dedicated `auth*.spec.ts`
  today; sign-in is exercised by the `session_mgmt`, `game_boot`, and
  `sandboxes` specs. The retarget is the client transport:
  `auth_service.svelte.ts` and its `firebaseFunctionsService` caller
  (`packages/frontend/services/src/lib/firebase/firebase_functions_service.ts`)
  switch from the `auth` / `poll_device_handoff` callables to the hub route.
- Integration: sign in, complete device handoff, against the hub-hosted
  routes in a local/emulated environment; grep the client for remaining
  `httpsCallable` usage of `auth` / `poll_device_handoff` → zero matches.
- E2E / Visual: **Functional**: existing specs exercising sign-in/handoff
  pass unchanged against the new endpoints, not duplicated.

**Watch Points**:
- Verify auth guarantees are preserved (see Quality Requirements) — this is
  the one item in this contract with real security surface.
- `discord_interactions.ts` and the Firestore trigger stubs must be
  explicitly disposed of (moved, kept, or deleted with reason) before this
  AC can close — don't leave them stranded mid-migration.

### AC-5: Cloud Run inference decision is recorded and resolved
**Given** the existing `🔴 Under revision (C-413)` marker in `deferred.md`
**When** the ADR amendment lands
**Then** the marker is resolved, the ADR states the `service` mode is a thin
metered proxy over hosted providers (not GCP GPUs), and the revisit
conditions are written down

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | N/A | `docs/architecture/data-layer-target-architecture.md`, `docs/strategy/deferred.md` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: N/A — documentation only.
- Integration: manual review of both documents for the amendment and the
  resolved marker.
- E2E / Visual: N/A.

**Watch Points**:
- Update the marker's contract reference from C-413 to C-418 (this file) so
  the pointer stays accurate.

### AC-6: One-command local-stack install on a clean machine
**Given** a machine with only Docker installed
**When** the user runs `curl -fsSL https://aikami.sh/install | sh`
**Then** the compose files are fetched, the hardware wizard runs, and
`docker compose up -d` produces a running stack, with no `git clone` step

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Integration | CI job exercising the installer on a clean runner | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: new CI job (name TBD) running the installer end-to-end.
- Integration: run on a fresh container/VM, confirm services come up.
- E2E / Visual: N/A.

**Watch Points**:
- The README's Quick Start must lead with the one-liner, with cloning
  demoted to an explicit "contributor path" section, not just an additional
  paragraph.

## Implementation Sequence

1. **Phase 1 (Data/Logic)** — Feature A: extract the shared palette. Feature
   C: remove dangling aliases (independent of everything else, safe to do
   first). Feature E: draft the ADR amendment.
2. **Phase 2 (Integration)** — Feature B: add the build-time dev-route gate.
   Feature D: investigate `discord_interactions.ts` and the Firestore
   triggers (OQ-3, OQ-4), then move/delete controllers into the hub.
   Feature F: build the installer script and publish the `stack init`
   binary.
3. **Phase 3 (Validation)** — Run the six Evidence Matrix checks above,
   `bun run typecheck`, `bun run test`, `moon run e2e:test`. Confirm
   `PROGRESS.md` reflects `main` via `sync_contracts.ts` (Feature C).

## Edge Cases & Gotchas

- **Feature A**: site/docs are plain Tailwind, not daisyUI — the shared
  package must export both a daisyUI theme plugin form and plain `@theme`
  custom properties.
- **Feature B**: don't gate at the component level only — a flag that hides
  UI but still ships the route in the JS bundle doesn't satisfy "contains no
  `(dev)` route."
- **Feature C**: C-417's OQ-1 has **resolved** — the `appearanceLayers`
  zero-out is intentional (equipment owns torso/feet). Dedupe by extracting
  a shared helper; do not delete either call site, or the dedupe erases
  intentional equipment-overlay behavior.
- **Feature D**: `discord_interactions.ts` (115 lines) is a real feature
  (Discord `/ask` webhook with signature verification + deferred async
  OpenRouter work) — treat it as requiring its own disposition decision
  (OQ-3), not folded silently into "delete the small stuff."
- **Feature E**: no code changes — resist scope creep into touching the
  `service` adapter itself.
- **Feature F**: GPU detection inside a container without the NVIDIA
  toolkit is unreliable — the installer must run the wizard on the host, not
  containerize it.

## Open Questions

Must be resolved before status becomes `approved`:

- **OQ-1** — Feature A: confirm the site's `@theme inline` palette is the
  desired brand direction, or should a new palette be chosen? (Design call,
  not a code question.)
- **OQ-2** — Feature B: build flag name and default (on for `dev`/`test`
  builds, off for `production`) — confirm the existing build-mode
  conventions to hook into.
- **OQ-3** — Feature D: is `api/discord_interactions.ts` (115 lines, new) in
  active use? If yes, does it move to the hub too, or does it have a reason
  to stay on Cloud Functions (e.g., webhook verification requirements)?
- **OQ-4** — Feature D: are the three `firestore/users/[uid]/*.ts` triggers
  logging-only (like the older `auth/created.ts`/`auth/deleted.ts`) or do
  they carry real behavior? Read them before deciding to delete or migrate.
- **OQ-5** — Feature F: confirm `aikami.sh` domain ownership/DNS is
  available for the install-script URL before committing to that exact
  address in documentation.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-08-17 | Initial draft merging seeds C-409, C-410, C-411, C-412, C-413, C-414. Feature C narrowed from package deletion to alias cleanup (packages already deleted by C-385/C-386). Feature D's baseline updated to reflect two new controller files not in the original seed (`discord_interactions.ts`, three Firestore triggers), added OQ-3/OQ-4. Feature F's problem statement corrected — the "9 compose files + hand-authored .env" friction is largely already resolved by `stack init`; the real gap is the missing one-command installer. | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

Target: **`integrated`** for Features B and D (production route/deploy
changes with E2E coverage); **`sandbox`** acceptable for Feature F until CI
exercises the installer; Feature A targets `release_verified` given its
visual nature; Feature E has no promotion state — documentation only.

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---

## Execution Report

### Summary
All six P2 features implemented. A shared brand palette package (`packages/frontend/theme`) now serves client, hub, site, and docs; production builds exclude the `(dev)` route group via a build flag; dangling firestore/dataconnect aliases were removed from 10 config files and the `appearanceLayers` zero-out was deduped into a shared engine helper; `auth` and `poll_device_handoff` moved from Firebase Callables to the hub's Elysia API with the client transport switched and verified end-to-end; the Cloud Run inference decision was recorded in the ADR and the `deferred.md` marker resolved; and a one-command installer (`install.sh`) plus compiled `stack-init` bundle replaces the clone-first Quick Start. The one open item is the documented disposition of `discord_interactions.ts`, which stays on Firebase Functions (see Deviations).

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Shared theme package consumed by all four apps; grep confirms no theme-colour declarations remain in app files; visual validation client dark 85 / light 90, site dark 90; hub + docs verified via computed styles and built CSS. |
| AC-2 | ✅ | Build-time gate (`AIKAMI_INCLUDE_DEV_ROUTES`) + filtered routes copy; production build output has zero `(dev)` routes (no dev page nodes/chunks); emulator/test build retains them; e2e sandbox + release-gate specs pass. |
| AC-3 | ✅ | 10 existing config files cleaned (`client/.fast-check/tsconfig.json` no longer exists — the 11th file is gone); `appearanceLayers` dedupe into `zeroEquipmentOwnedAppearanceSlots` (both call sites preserved); `daily.ts` deleted (folded into D); typecheck green across all edited projects. |
| AC-4 | ⚠️ | `auth` + `poll_device_handoff` moved to hub Elysia routes; client transport switched; full device-handoff loop verified live (completeDeviceHandoff 200 + poll returns token; bad token → 401). Logging-only auth/firestore triggers + scheduler deleted; `httpsCallable` usage of auth/poll in the client → zero. **`discord_interactions.ts` kept on Functions with reason (OQ-3 disposition) — the Functions deploy stage remains for that single function; `getProjectId` offset bug in backend-configs fixed to make hub token verification work in shifted emulator runs.** |
| AC-5 | ✅ | ADR D-16 + amendment A-11 added; `deferred.md` marker resolved and re-pointed C-413 → C-418 with cost comparison + revisit conditions. |
| AC-6 | ✅ | `install.sh` (POSIX sh, step-logged, never overwrites `.env`), `scripts/bundle_stack.sh` (compiles `stack-init` + tarball), `scripts/install.test.sh` self-test, moon tasks `local-stack:bundle` / `test-install`, publish workflow step; README Quick Start leads with the one-liner and demotes cloning to the contributor path. `aikami.sh` DNS pending (OQ-5) — documented GitHub-releases fallback. |

### Files Created
| File | Purpose |
|---|---|
| `packages/frontend/theme/` (package.json, moon.yml, tsconfig.json, src/index.ts, src/lib/brand_tokens.css, src/lib/brand_daisy.css) | Shared brand palette: daisyUI tokens (client/hub) + plain CSS custom properties (site/docs) + TS constants |
| `packages/frontend/engine/src/core/appearance_layers.ts` + `.test.ts` | Shared `zeroEquipmentOwnedAppearanceSlots` helper (C-374/C-417 OQ-1) |
| `apps/frontend/client/scripts/gate_dev_routes.ts` | Build-time `(dev)` route gate (filtered routes copy) |
| `apps/frontend/client/src/lib/services/api/hub_api_client.ts` | Client transport to hub Elysia auth endpoints |
| `apps/backend/local-stack/install.sh` | One-command installer (POSIX sh) |
| `apps/backend/local-stack/scripts/bundle_stack.sh` | Release bundle builder (compiled `stack-init` + compose files) |
| `apps/backend/local-stack/scripts/install.test.sh` | Installer self-test |

### Files Modified
| File | Change |
|---|---|
| `packages/frontend/configs/src/index.ts` | Export `app_check.ts` (getAppCheckToken) |
| `packages/backend/configs/src/lib/environment.ts` | `getProjectId()` applies `withProjectIdOffset` in emulator mode (Admin SDK aud match) |
| `apps/frontend/hub/src/lib/server/api/index.ts` | Added `/api/auth/action` + `/api/auth/poll-device-handoff` Elysia routes |
| `apps/frontend/hub/src/hooks.server.ts` | Narrow first-party CORS for the two client-facing auth routes |
| `apps/frontend/client/src/lib/services/auth/auth_service.svelte.ts` | `auth`/`poll_device_handoff` calls → hub client; removed `firebaseFunctionsService` |
| `apps/frontend/client/src/lib/services/analytics/analytics_service.svelte.ts` | Stale httpsCallable doc comment |
| `apps/frontend/client/src/lib/test_preload.ts` | Dropped dead `firebaseFunctionsService` mock |
| `packages/frontend/services/src/…` | Deleted `firebase_functions_service.ts` + exports |
| `apps/frontend/client/svelte.config.js`, `apps/frontend/hub/svelte.config.js` | Removed dangling firestore aliases; added theme + backend-auth aliases; `$appCss` alias |
| 8 × tsconfig.json | Removed dangling `@aikami/*/firestore` aliases |
| `apps/frontend/client/vite.config.ts` | Expose build mode to svelte.config; `/api/hub` dev proxy |
| `apps/frontend/{client,hub}/src/app.css`, `site/src/lib/styles/global.css`, `docs/src/styles/docs.css` | Consume shared theme; delete duplicated stanzas |
| `apps/frontend/{client,hub,site,docs}/package.json`, `moon.yml`, `tsconfig.json`, `astro.config.ts` | Theme package wiring |
| `apps/backend/firebase/src/controllers/…` | Deleted 8 controllers (auth/poll callables, auth + firestore triggers, scheduler/daily); kept `api/discord_interactions.ts` |
| `scripts/src/lib/deploy/firebase.ts` | Documented trimmed Functions scope (only discord remains) |
| `docs/architecture/data-layer-target-architecture.md`, `docs/strategy/deferred.md` | D-16/A-11 ADR amendment + resolved marker |
| `apps/backend/local-stack/README.md`, `moon.yml`, `stack/init.ts`, `tsconfig.json` | One-liner Quick Start, bundle/test-install tasks, embedded manifest for compiled binary |
| `.moon/workspace.yml`, `bun.lock`, `.github/workflows/publish-local-stack.yml` | New `frontend-theme` project + installer bundle publish step |

### Deviations from Spec
- **OQ-3 disposition — `discord_interactions.ts` kept on Firebase Functions (not moved/deleted).** It is a live Discord webhook with signature verification, Firestore-backed cross-instance rate limiting, and a deferred-interaction timing contract; moving it would change security/timing semantics and depends on Firestore infra that is itself scheduled for teardown. Consequently the **"remove the Functions deploy stage"** In-Scope line is only partially met: the stage now deploys exactly the one remaining function. **Proposed Amendment:** record the keep-with-reason disposition and trim (rather than remove) the Functions stage until the Firestore teardown lands.
- **OQ-5 unresolved:** `aikami.sh` DNS not confirmed; installer defaults to the GitHub release asset URL with `AIKAMI_INSTALL_BASE_URL` override, and the README documents both.
- **Extra scope (justified):** backend-configs `getProjectId()` emulator offset fix — without it the hub cannot verify emulator-issued ID tokens in contract-shifted runs (the old callable ran inside the emulator where the project matched; the hub is a separate process).
- **Feature C file count:** `apps/frontend/client/.fast-check/tsconfig.json` no longer exists on disk, so 10 of the contract's 11 files were cleaned.
- **No docs-site page written:** per Docs Impact, Feature F's documentation impact is the local-stack README Quick Start (done); other features are internal.

### Test Results
- Unit: engine 4/4, local-stack 96/96 + installer self-test 5/5 checks, scripts:test pass, all affected-project typechecks pass (backend-auth, backend-configs, client, docs, firebase, frontend-configs, frontend-engine, frontend-services, frontend-storage, frontend-theme, frontend-utils, hub, local-stack, mocks, scripts, site).
- E2E: session_mgmt 9/9, release_gate + sandboxes + game_boot 5 passed (client project). Site e2e specs failed environmentally (`ERR_CONNECTION_REFUSED` at :11418 — site dev server not running in this contract session; site content verified via build + screenshot instead).
- Visual: client dark 85/100, client light 90/100, site dark 90/100 (ai_validate_image PASS); hub verified via computed styles (html bg `oklch(0.13 0.015 260)`, primary `oklch(0.65 0.22 285)`).
- Baseline: 0 pre-existing failures in affected projects; 0 new failures. (`validate` fix+typecheck phases green; `:test` phase only fails on the environmentally-unavailable site e2e project.)

### Round 2 — verifier-requested fixes (all applied and re-verified)

**H1 — Tauri → hub CORS (fixed).** `isTauriWebviewOrigin` added to
`packages/backend/svelte-kit/src/lib/hooks_helpers.ts` and applied on exactly
the two client-auth paths in `apps/frontend/hub/src/hooks.server.ts`
(`tauri://localhost`, `http(s)://tauri.localhost`); non-auth `/api` routes
still deny Tauri origins. Tauri CSP `connect-src` in
`apps/frontend/client/src-tauri/tauri.conf.json` now includes
`https://hub.stg.bearlysleeping.com`. **Verified live**: OPTIONS preflight for
all three Tauri origins → 204 + Access-Control-Allow-Origin on
`/api/auth/action`; `/api/catalog/stats` with a Tauri origin → 204 with NO
ACAO header (narrowly scoped); first-party browser origin still allowed.
AC-4 device-handoff loop re-run through the client proxy: completeDeviceHandoff
200 + custom token, poll 200 + token returned, invalid token 401.

**H2 — installer .env location (fixed).** The wizard now writes `.env` into
`BUNDLE_DIR` (the compose project dir that holds `compose.yaml`), so
`docker compose up -d` reads it. An existing `.env` is preserved across
re-installs (copied to a temp location before the bundle dir is replaced) and
never overwritten. **Verified**: install.test.sh now asserts the .env lands in
the project dir AND runs `docker compose config` there, proving
COMPOSE_PROFILES from the wizard .env is honored.

**H3 — installer URL/asset naming (fixed).** Single naming contract: release
tag `local-stack-<version>`, asset `local-stack-<version>.tar.gz`, checksums
`SHA256SUMS`. install.sh resolves `latest` through the GitHub releases API
(full-tag form tolerated) instead of the 404'ing `releases/download/latest/…`.
The publish workflow now creates the release if missing and uploads on every
run (ref_type gate dropped — the only trigger is workflow_dispatch).

**M1 — platform detection (fixed).** install.sh detects OS/arch (Linux
x64/arm64, macOS x64/arm64) and fails fast with a clear message on unsupported
platforms; bundle_stack.sh supports cross-compiling a matrix via
`AIKAMI_BUNDLE_TARGETS`.

**M2 — checksum verification (fixed).** bundle_stack.sh emits `SHA256SUMS`;
install.sh downloads and verifies the tarball SHA-256 BEFORE extraction and
refuses to run from an unverified download. **Verified**: install.test.sh
serves SHA256SUMS and proves a tampered tarball is rejected with nothing
extracted.

**M3 — gate guard (fixed).** svelte.config.js keeps the gate DECISION (vite
build mode is the single source of truth; NODE_ENV is deliberately ignored so
moon's NODE_ENV=production cannot strip sandbox routes from test builds) and
guards with a clear error when the filtered routes copy is missing;
`scripts/gate_dev_routes.ts` was restored as the pre-build materializer in all
package build scripts. **Verified**: prod → emulator → prod → emulator build
sequence all succeed; production output has zero (dev) routes, emulator/test
output retains them, and explicit `AIKAMI_INCLUDE_DEV_ROUTES=true|false`
overrides work in both directions.

**M4 — explicit test-build flag (fixed).** `AIKAMI_INCLUDE_DEV_ROUTES=true`
set on the client moon `dev`/`test`/`test-unit` tasks and on
`build:emulator`.

**M5 — staging decision (documented).** moon.yml `build` task comment records
the decision: staging intentionally ships the (dev) sandbox routes (AC-2
excludes only production); `AIKAMI_INCLUDE_DEV_ROUTES=false` strips them.

**M6 — theme constants (fixed).** Deleted the unused `brandPaletteLight`/
`brandPaletteDark` TS copies from `packages/frontend/theme/src/index.ts`; the
palette now exists only in the two CSS source-of-truth files.

**L1 — brand_daisy comment (fixed).** Header now documents the intentional
daisy-role mapping (daisy `--color-primary` = brand accent vs tokens
`--primary` = text-adjacent slate) instead of claiming identical values.

**L2 — backend-configs comment (fixed).** `getProjectId` documents why it
reads PUBLIC_EMULATOR_PORT_OFFSET and that `withProjectIdOffset` no-ops at 0.

**L3 — dark selector parity (fixed).** brand_daisy.css dark block now also
matches `:root[data-theme='dark']`.

**App Check coordination (fixed).** The two client-auth paths are excluded
from App Check enforcement in the hub hooks (they carry their own ID-token
auth + single-use codes + per-instance token bucket), preventing asymmetric
enablement from silently breaking desktop/browser auth; the carried-over rate
limiter is kept.

**Round-2 verification summary:** all affected typechecks green
(client, hub, backend-svelte-kit, backend-configs, frontend-theme,
local-stack); client visual gate re-passed (light 90/100, dark 90/100 with
exact token match); e2e session_mgmt 9/9; backend-svelte-kit unit tests
31/31; local-stack installer self-test all checks incl. docker compose reads
wizard .env + tamper rejection; local-stack unit tests pass; bundle + SHA256SUMS
generated; AC-3 dangling-alias grep still zero.
