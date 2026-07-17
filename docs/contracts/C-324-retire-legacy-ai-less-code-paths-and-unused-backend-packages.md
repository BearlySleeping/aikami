# Contract C-324: Retire Legacy AI-Less Code Paths and Unused Backend Packages

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/TODO.md` § C-324 — Phase 1 — Playable, Polished, Offline-Capable Vertical Slice; TODO_DRAFT.md "Remove all legacy, backwards compatible code" |
| **Target** | `apps/backend/firebase/src/controllers/callable/ai.ts`, `apps/backend/firebase/src/controllers/api/prompt_ai.ts`, `packages/backend/ai` (consumer surface), `packages/backend/chat` (its `createAiService` import), `packages/backend/svelte-kit` (package existence), `packages/backend/image` (zero-importer export surface), `packages/shared/constants/src/lib/degradation.ts` |
| **Priority** | P1 — cleanup that removes the temptation to reintroduce an AI-less mode and reduces the number of AI call surfaces before more contracts build on top of C-320's gateway |
| **Dependencies** | C-320 (status `implemented` — `packages/frontend/ai-gateway` exists with a `service`-mode adapter wrapping the Firebase `ai` callable), C-323 (status `implemented` — zero-AI campaign path removed from the player-facing menu). Neither is `verified`/`completed` yet — see Edge Cases for the risk note. Packages: `@aikami/constants`, `@aikami/types`, `@aikami/schemas`. |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal → none (no player-facing docs page; `docs/architecture/architecture.md` line 171 lists `backend/svelte-kit` and must be updated when the package is deleted) |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**:
  1. `apps/backend/firebase/src/controllers/callable/ai.ts` and
     `apps/backend/firebase/src/controllers/api/prompt_ai.ts` import
     `handleAIEndpoint` directly from `@aikami/backend/ai` — a legacy
     (C-056-era) call surface that predates the C-320 `AiProviderGateway`.
     The gateway's `service`-mode adapter
     (`packages/frontend/ai-gateway/src/lib/text_adapter_service.ts`) wraps
     this callable, so two AI call-surface layers coexist.
  2. `packages/backend/chat/src/lib/api_handler.ts` also imports
     `createAiService` from `@aikami/backend/ai` (application code, not a
     test) — a third direct consumer TODO.md's target list does not name but
     the acceptance gate ("no direct `packages/backend/ai` imports outside
     the gateway package in application code") covers.
  3. Most of `packages/backend/ai`'s export surface has **zero application
     consumers**: `routeTextGeneration`, `createOllamaStream`,
     `createOpenRouterStream`, `SyntheticSseMock`, `CircuitBreaker`,
     `TokenBucketRateLimiter`, and the C-301 agent-router exports
     (`prepareAgentPayload`, `extractTypeFootprint*`, `buildRouterPayload`)
     are imported only by the package's own tests (verified by repo-wide
     grep on 2026-07-10-era tree). Only `handleAIEndpoint` (2 controllers)
     and `createAiService` (`backend/chat` + `handleAIEndpoint` internally)
     are consumed.
  4. `packages/backend/svelte-kit` has an **empty `src/index.ts`**, five
     orphaned `src/lib/` files (`api.ts`, `cookies.ts`, `request.ts`,
     `verify_app_check.ts`, `app.d.ts`), and **zero importers** — repo-wide
     grep for `from '@aikami/backend/svelte-kit` finds no matches; only
     stale alias entries survive in `.moon/workspace.yml`, `biome.json`,
     `apps/backend/firebase/tsconfig.json`,
     `apps/frontend/client/tsconfig.test.json`, and
     `apps/frontend/client/svelte.config.js`.
  5. `packages/backend/image/src/index.ts` exports
     `ImageGenerationOrchestrator`, `ComfyUIRestClient`,
     `ComfyUIWorkflowBuilder`, `ComfyUIWsReceiver`, and types — repo-wide
     grep finds **zero non-test importers** (only
     `packages/backend/image/tests/*` import from `src/`).
  6. `packages/shared/constants/src/lib/degradation.ts` documents an
     `offline` (zero-AI) branch as a first-class supported mode: the
     `PolicyEntry` type has a `readonly offline: DegradationMode` key, and
     doc comments say "when text AI is unavailable" as a steady state. C-323
     removed the zero-AI campaign as a supported product state, so
     `dialogue`, `combatNarration`, and `questDescriptions` must describe
     `authored_fallback`/`template_fallback` as **transient-failure**
     behavior (`onFailure`), not a mode a player can live in.
- **Reproduction**:
  - `grep -rn "@aikami/backend/ai" --include="*.ts"` → hits in
    `apps/backend/firebase/src/controllers/callable/ai.ts:3`,
    `apps/backend/firebase/src/controllers/api/prompt_ai.ts:3`,
    `packages/backend/chat/src/lib/api_handler.ts:3`.
  - `ls packages/backend/svelte-kit/src` → `index.ts` (empty) + `lib/`;
    `grep -rn "from '@aikami/backend/svelte-kit"` → no matches.
  - `grep -rn "ImageGenerationOrchestrator\|ComfyUIRestClient"` excluding
    `packages/backend/image/**` and docs → no matches.
  - Read `packages/shared/constants/src/lib/degradation.ts` → `offline:` key
    on every `DEGRADATION_POLICY` entry.
- **Existing implementation to reuse**: `packages/frontend/ai-gateway`
  (C-320) — `createServiceTextAdapter`, `gateway_types.ts`, `errors.ts`;
  `packages/backend/ai/src/lib/api_handler.ts` (`handleAIEndpoint` — the
  logic to fold, not rewrite); `packages/backend/ai/src/lib/factory.ts`,
  `gemini_service.ts`, `openai_service.ts`, `base_ai_service.ts` (the only
  transitively-live server-side pieces).
- **Known gaps**: no server-side "gateway service implementation" module
  exists yet — the gateway is a frontend package and the Firebase callable
  *is* the server side of `service` mode. This contract defines where the
  folded server handler lives (see Architecture Directives).
- **Baseline tests** (run before starting):
  - `packages/backend/ai/tests/` — `ai_service.test.ts`,
    `circuit_breaker.test.ts`, `rate_limiter.test.ts`,
    `text_generation_router.test.ts`, `ollama_adapter.test.ts`,
    `openrouter_adapter.test.ts`, `synthetic_sse_mock.test.ts`.
  - `packages/backend/image/tests/` — `orchestrator.test.ts`,
    `rest_client.test.ts`, `workflow_builder.test.ts`, `ws_receiver.test.ts`.
  - `packages/shared/constants/src/lib/degradation.test.ts`.
  - `packages/frontend/ai-gateway/tests/` (C-320 adapter-contract suite).

## User Outcome

After this contract, a developer can trace every backend AI request through
exactly one call surface — the `AiProviderGateway` `service`-mode path — and
cannot import a legacy AI-less code path by accident: dead packages are gone,
stale aliases are gone, and the shared degradation policy describes authored
fallbacks as transient-failure resilience, not a supported zero-AI product
mode. A player sees no behavior change.

## Success Measures

- **Time/latency target**: N/A — no runtime behavior change; the `ai`
  callable keeps its existing latency profile (512MiB / 120s config
  unchanged).
- **Offline/degraded behavior**: unchanged at runtime; the *documented
  semantics* change — authored/template fallbacks trigger `onFailure`
  (transient AI failure), never as a steady-state "offline mode" a campaign
  can be created in (that state was removed by C-323).
- **Production journey enabled**: contracts C-328/C-330/C-348+ can build on
  a single AI call surface without auditing three legacy entry points first;
  repo-wide grep for `@aikami/backend/ai` in application code returns zero.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Service-mode text adapter (client) | `packages/frontend/ai-gateway/src/lib/text_adapter_service.ts` | reuse — unchanged; keeps calling the Firebase `ai` callable |
| Server AI endpoint dispatch | `packages/backend/ai/src/lib/api_handler.ts` (`handleAIEndpoint`) | modify — fold into the gateway's server-side service module (or a firebase-local module); keep `sendMessage`/`createPersona`/`getProviders` payload contract byte-compatible |
| Server provider factory | `packages/backend/ai/src/lib/factory.ts` + `gemini_service.ts`, `openai_service.ts`, `base_ai_service.ts`, `errors.ts`, `types.ts` | modify — move with the fold; these are the only transitively-live server pieces |
| Unused text-routing exports | `packages/backend/ai/src/lib/text_generation_router.ts`, `ollama_adapter.ts`, `openrouter_adapter.ts`, `synthetic_sse_mock.ts`, `circuit_breaker.ts`, `rate_limiter.ts` | replace — superseded by `packages/frontend/ai-gateway` equivalents (`text_adapter_openai_compatible.ts` already mirrors `OLLAMA_VRAM_EVICTION_PARAMS`); delete with their tests unless the audit finds a live consumer |
| Agent router (C-301) | `packages/backend/ai/src/lib/agent_router.ts` | audit — zero app consumers today; delete or relocate with documented reason (C-348/C-349 may want it — deleting is reversible via git history) |
| DM chat endpoint | `packages/backend/chat/src/lib/api_handler.ts` | modify — replace its `createAiService` import with the folded server module's factory |
| SvelteKit server helpers | `packages/backend/svelte-kit/` (empty `index.ts`, orphaned `lib/`) | replace — delete package + all alias/config references (Pillar 1: the client is a static SPA; server hooks have no home) |
| ComfyUI orchestration | `packages/backend/image/` | audit — zero non-test importers; delete or keep with a documented reason recorded in the package README and this contract's execution report |
| Degradation policy | `packages/shared/constants/src/lib/degradation.ts` + `degradation.test.ts` | modify — `offline` key → `onFailure` semantics; doc comments rewritten; tests updated |

## Overview

Every backend AI code path must be reachable only through the
`AiProviderGateway`'s `service`-mode server implementation. This contract
folds the live parts of `packages/backend/ai` into that single server-side
module, migrates the three application-code importers, deletes dead packages
(`packages/backend/svelte-kit`, and `packages/backend/image` pending audit)
plus their stale workspace/alias entries, and amends `DEGRADATION_POLICY` so
no shared constant documents "no AI" as a supported steady-state mode.

## Design Reference

- `packages/frontend/ai-gateway/` — C-320's gateway package: adapter
  registry, typed `AiGatewayError`, deterministic stub adapters. The folded
  server module mirrors its error-normalization discipline.
- `docs/contracts/C-320-build-the-unified-ai-provider-gateway-offline-byok-service.md`
  — inventory of the three legacy AI stacks; this contract retires stack #3.
- `docs/contracts/C-323-enforce-the-mandatory-text-ai-capability-gate.md` —
  the product-policy change the degradation amendment codifies.
- `apps/backend/firebase/src/controllers/callable/chat.ts` — thin-controller
  pattern (firestack `onCall` wrapper delegating to a package handler) that
  the migrated controllers keep.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Server-side service module**: create the gateway's `service`-mode server
  implementation as a backend package module — preferred placement:
  `packages/backend/ai` is *renamed in role*, not location: strip it down to
  exactly the folded handler (`handleAIEndpoint` contract), the provider
  factory, and the two live provider services, and re-document it as "the
  server half of the C-320 gateway's `service` mode". Alternative (equally
  acceptable if simpler): move those files into
  `apps/backend/firebase/src/services/ai/` and delete
  `packages/backend/ai` entirely — but only if `packages/backend/chat` can
  consume the factory without a cross-`apps/` import (packages must never
  import from `apps/`; if `backend/chat` still needs the factory, the
  stripped-package option is mandatory).
- **Controllers stay thin**: `callable/ai.ts` and (if retained)
  `api/prompt_ai.ts` remain firestack wrappers delegating to the single
  server module; no business logic in controllers (backend-conventions).
- **`prompt_ai` HTTP endpoint**: zero internal callers found (repo-wide grep
  for `prompt_ai` matches only the controller itself and TODO files). Apply
  the same audit rule as packages: delete if no external/deployed consumer
  is documented; otherwise migrate it to the same server module.
- **Dead-package removal**: deleting `packages/backend/svelte-kit` (and
  `packages/backend/image` if the audit confirms) requires cleaning every
  registration point: `.moon/workspace.yml` projects map, `biome.json`
  import-restriction overrides, `bun.lock` (via `bun install`),
  `apps/backend/firebase/tsconfig.json` paths,
  `apps/frontend/client/tsconfig.test.json` paths,
  `apps/frontend/client/svelte.config.js` aliases,
  `scripts/src/lib/ops/pin_dependencies.ts` package list, and
  `docs/architecture/architecture.md`.
- **Degradation policy**: the amended module stays in
  `packages/shared/constants/src/lib/degradation.ts` (Pillar 2 — shared
  constants). No schema change to `DegradationModeSchema` in
  `packages/shared/schemas/src/lib/capability.ts` (the five mode literals
  are unchanged); only the policy-entry key and doc comments change.
- **No new types in apps**: any type the folded server module exposes across
  package boundaries already lives in `@aikami/types`
  (`AIApiEvents`, `AIMessageType`, `ChatResponse`, `PersonaData`,
  `UserSessionData`) — reuse, do not redefine.

## State & Data Models

No new persistent state. One shared-constants shape changes:

```typescript
// packages/shared/constants/src/lib/degradation.ts (amended)
// `offline` (steady-state zero-AI mode) → `onFailure` (transient-failure fallback).
type PolicyEntry = {
  /** Fallback mode when the required text AI call fails or is transiently unavailable. */
  readonly onFailure: DegradationMode;
  /** Mode when text AI is available (may still degrade on image/voice). */
  readonly online: DegradationMode;
  /** Optional: secondary capability that overrides the online mode when absent. */
  readonly alsoRequires?: 'imageProvider' | 'voiceProvider';
};
```

`degradationBehavior()` keeps its signature
(`{ feature, capabilityProfile }` → `DegradationMode`) but its doc comment
and the `!capabilityProfile.textProvider` branch are re-documented as "text
AI transiently unresolved/failing", not "offline mode". The per-entry values
for `dialogue` (`authored_fallback`), `combatNarration`
(`template_fallback`), and `questDescriptions` (`authored_fallback`) are
retained as failure fallbacks — only the semantics label changes.

The folded server module keeps the existing wire contract unchanged:

```typescript
// Wire contract of the Firebase `ai` callable — MUST remain byte-compatible
// (the C-320 service adapter in packages/frontend/ai-gateway depends on it).
type AiCallableRequest = {
  type: 'sendMessage' | 'createPersona' | 'getProviders';
  payload: Record<string, unknown>;
};
```

## Quality Requirements

- **Offline/degraded mode**: unchanged at runtime. The contract's whole point
  is documentation/semantics: authored fallbacks are `onFailure` resilience,
  never a supported steady-state. No player-visible behavior change.
- **Accessibility/input**: N/A — no UI change.
- **Performance budget**: N/A — no hot-path change; callable config
  (512MiB / 120s / europe-west1) unchanged.
- **Security/privacy**: preserved — `callable/ai.ts` keeps extracting
  `request.auth` into `UserSessionData`; if `prompt_ai` (unauthenticated
  `onRequest`) is deleted, the unauthenticated surface shrinks — a security
  improvement worth noting in the execution report.
- **Persistence/migration**: N/A — no persistent state changes.
- **Cancellation/retry/idempotency**: unchanged — the gateway's client-side
  `AbortSignal`/typed-error handling (C-320) is untouched; the folded server
  handlers remain stateless request/response.
- **Observability**: controllers keep `$logger` module-level logging
  (`logger.debug('callable/ai', { type })`); folded module preserves existing
  log lines so emulator debugging output is stable.

## Migration & Rollback

- **Old data compatibility**: N/A — no persistent state changes.
- **Migration**: none for data. Deployed-surface note: if `prompt_ai` is
  deleted, the next `firebase` deploy removes the HTTP function; the `ai`
  callable keeps its name and payload contract, so already-shipped clients
  are unaffected.
- **Rollback**: `git revert` + redeploy Firebase functions restores
  `prompt_ai` and the previous imports; deleted packages are recoverable
  from git history.
- **Feature flag or kill switch**: N/A — refactor with an unchanged wire
  contract; no runtime toggle needed.
- **Failure recovery**: N/A — no mid-way data migration exists.

## Scope Boundaries

- **In Scope:**
  - Fold `packages/backend/ai`'s live pieces (`handleAIEndpoint` dispatch,
    `createAiService`, `GeminiService`, `OpenAiService`, `BaseAiService`,
    errors/types) into the single server-side `service`-mode module; delete
    the zero-consumer exports (`routeTextGeneration`, Ollama/OpenRouter
    stream adapters, `SyntheticSseMock`, `CircuitBreaker`,
    `TokenBucketRateLimiter`) and their tests, or document why any survives.
  - Audit + delete-or-justify `agent_router.ts` (C-301 exports, zero app
    consumers).
  - Migrate `apps/backend/firebase/src/controllers/callable/ai.ts`,
    `apps/backend/firebase/src/controllers/api/prompt_ai.ts` (or delete
    `prompt_ai` per audit rule), and
    `packages/backend/chat/src/lib/api_handler.ts` off direct legacy imports.
  - Delete `packages/backend/svelte-kit` and every workspace/alias/config
    reference; update `docs/architecture/architecture.md`.
  - Audit `packages/backend/image` importers; delete the package or record a
    documented reason to remain (e.g. reserved for C-355 media director).
  - Amend `DEGRADATION_POLICY` (`offline` → `onFailure` key + doc comments)
    and `degradation.test.ts`.
- **Out of Scope:**
  - Any change to `packages/frontend/ai-gateway` behavior, mode resolution,
    or the client `ai_gateway_service.svelte.ts` wiring (C-320/C-322).
  - The capability gate UX and start-menu flow (C-323).
  - `apps/backend/image|text|voice` microservice apps (Docker services —
    unrelated to the `packages/backend/image` TS package).
  - Billing/metering or `service`-mode activation (Phase 5).
  - Renaming `DegradationModeSchema` literals or `CapabilityProfile` shape.
  - `packages/backend/chat`'s DM prompt content and chat flow logic.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** 4 ACs, touching `apps/backend/firebase`,
`packages/backend/*` (ai, chat, svelte-kit, image), and
`packages/shared/constants`. Although more than two moon projects are
touched, the work is one atomic cleanup — deleting a package without
cleaning its aliases, or migrating one importer of three, would leave the
repo in a worse intermediate state than not starting. No independently
releasable sub-system exists. **No split.**

## Acceptance Criteria

### AC-1: Single AI call surface — no direct legacy imports in application code
**Given** the completed contract tree
**When** a repository-wide search runs for `@aikami/backend/ai` (and any
relative import reaching `packages/backend/ai/src/lib/` from outside that
package)
**Then** zero matches remain in application code — `callable/ai.ts`,
`prompt_ai.ts` (if retained), and `packages/backend/chat` all consume the
gateway's server-side `service`-mode module; only that module's own files
and tests reference the folded adapters, **and** the Firebase `ai` callable
still answers `sendMessage` / `createPersona` / `getProviders` with the
same response shapes (the C-320 service-adapter contract tests still pass).

### AC-2: Dead packages deleted or justified, workspace left consistent
**Given** the audit results for `packages/backend/svelte-kit` (zero
importers, empty `index.ts`) and `packages/backend/image` (zero non-test
importers)
**When** this contract completes
**Then** `packages/backend/svelte-kit` is deleted along with its entries in
`.moon/workspace.yml`, `biome.json`, `bun.lock`,
`apps/backend/firebase/tsconfig.json`,
`apps/frontend/client/tsconfig.test.json`,
`apps/frontend/client/svelte.config.js`,
`scripts/src/lib/ops/pin_dependencies.ts`, and
`docs/architecture/architecture.md`; and `packages/backend/image` is either
deleted with the same cleanup or retained with a documented reason written
into its README and this contract's execution report. `bun install` and
`bun moon run :typecheck` succeed afterwards.

### AC-3: Degradation policy no longer documents a zero-AI steady state
**Given** `packages/shared/constants/src/lib/degradation.ts`
**When** the amendment lands
**Then** the `PolicyEntry` key `offline` is renamed to `onFailure`, module
and entry doc comments describe authored/template fallbacks for `dialogue`,
`combatNarration`, and `questDescriptions` exclusively as transient-failure
behavior, `degradationBehavior()` keeps its public signature, and a
repo-wide search shows all compile-time consumers (currently only
`degradation.test.ts`) updated — `constants:test` passes.

### AC-4: Full workspace validation passes with no behavioral regression
**Given** all deletions, migrations, and the degradation amendment
**When** `bun moon run :validate` runs (fix + typecheck + build + test)
**Then** it passes across the workspace, the `firebase` project builds with
the migrated controllers, `frontend-ai-gateway` tests (including the
service-adapter suite) pass unchanged, and no test anywhere imports a
deleted module.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | grep transcript (zero app-code matches) + `packages/frontend/ai-gateway/tests/` service-adapter suite + folded-module unit tests (relocated from `packages/backend/ai/tests/ai_service.test.ts`) | N/A (server surface) | Filled during verification |
| AC-2 | Integration | deletion diff + `bun install` / `bun moon run :typecheck` transcript; README justification if `packages/backend/image` remains | N/A | Filled during verification |
| AC-3 | Unit | `packages/shared/constants/src/lib/degradation.test.ts` (updated) | N/A | Filled during verification |
| AC-4 | Integration | `bun moon run :validate` transcript | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon_run_task` → `constants:test`, `firebase:typecheck`,
  `frontend-ai-gateway:test`, then `:validate` for AC-4; if
  `packages/backend/ai` survives as the stripped server module, its
  remaining tests run via its moon `test` task.
- Integration: with `AIKAMI_MODE=emulator`, exercise the `ai` callable via
  the existing client `ai_service.svelte.ts` path (persona creation flow)
  and confirm identical response shape before/after.
- E2E / Visual:
    - **Functional**: N/A — no UI change; existing E2E suites must simply
      keep passing (covered by AC-4's `:validate`).
    - **Visual**: N/A.

**Watch Points**:
- AC-1: `packages/backend/chat` must not import from `apps/` — if the folded
  module lands inside `apps/backend/firebase`, `backend/chat` has no legal
  import path; the stripped-`packages/backend/ai` option is then mandatory.
- AC-2: `apps/frontend/client/svelte.config.js` line 52 and
  `tsconfig.test.json` alias blocks silently break the client build if left
  pointing at a deleted path — clean both.
- AC-3: `degradationBehavior` currently has **zero production consumers**
  (only its own tests and C-318 prose) — do not add new consumers; this is a
  semantics amendment, not a feature.
- AC-4: `bun.lock` regeneration must be committed; a stale lockfile fails CI.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: amend `degradation.ts` + tests (isolated, no
   dependents). Strip `packages/backend/ai` to the folded server module
   (keep `handleAIEndpoint` wire contract byte-compatible); delete
   zero-consumer adapters/tests; decide `agent_router.ts` fate with a
   written justification.
2. **Phase 2 (Integration)**: migrate `callable/ai.ts`, `prompt_ai.ts`
   (delete if the external-caller audit is negative), and
   `packages/backend/chat`; delete `packages/backend/svelte-kit` (and
   `packages/backend/image` per audit) with full alias/workspace/config
   cleanup; run `bun install`; update `docs/architecture/architecture.md`.
3. **Phase 3 (Validation)**: `validate()` (fix + typecheck + build + test),
   plus targeted `constants:test`, `frontend-ai-gateway:test`,
   `firebase:typecheck`; capture the AC-1 grep transcript and the AC-2
   deletion evidence for the execution report.

## Edge Cases & Gotchas

- **Dependency status risk**: C-320 and C-323 are `implemented`, not yet
  `verified`/`completed`. The service adapter this contract routes through
  exists and has tests, so the risk is low — but if C-320 verification
  forces a wire-contract change to the `ai` callable, this contract's fold
  must follow it. Sequence verification of C-320 first if possible.
- **`prompt_ai` external callers**: the HTTP endpoint has no internal
  caller, but it is a deployed public URL. Decision rule: delete unless a
  documented external/deployed consumer is identified during the audit;
  record the decision + evidence in the execution report.
- **`TODO.md` staleness**: TODO.md claims `packages/backend/svelte-kit` has
  "zero source files, only a package.json" — it actually contains five
  orphaned `src/lib/` files and an empty `index.ts`. Zero importers still
  holds; delete the whole tree, not just the manifest.
- **`OLLAMA_VRAM_EVICTION_PARAMS` duplication**:
  `packages/frontend/ai-gateway/src/lib/text_adapter_openai_compatible.ts`
  documents that it mirrors the constant in `@aikami/backend/ai`. When the
  backend copy is deleted, update that comment (and consider promoting the
  constant to `@aikami/constants` if both sides still need it).
- **`backend/chat` transitive break**: forgetting the `createAiService`
  import in `packages/backend/chat/src/lib/api_handler.ts` breaks
  `firebase:build` only at deploy/typecheck time — it is the easiest of the
  three importers to miss because TODO.md's target list omits it.
- **Biome restricted-import entries**: `biome.json` maps
  `@aikami/backend-svelte-kit` / `@aikami/backend-image` to "use
  `@aikami/backend/...` instead" — remove entries for deleted packages or
  Biome config validation may warn about unknown targets.

## Open Questions

Must be resolved before status becomes `approved`:

- None — audit decisions (delete vs. retain for `packages/backend/image`,
  `agent_router.ts`, `prompt_ai`) are governed by the explicit decision
  rules above (zero-consumer ⇒ delete; any retention requires written
  justification in the execution report), so no user input is required
  pre-approval.

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
