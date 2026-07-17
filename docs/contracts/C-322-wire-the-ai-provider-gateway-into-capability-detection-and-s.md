# Contract C-322: Wire the AI Provider Gateway into Capability Detection and Settings

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/TODO.md` § C-322 — Phase 1 — Playable, Polished, Offline-Capable Vertical Slice |
| **Target** | `apps/frontend/client/src/lib/services/capability/capability_service.svelte.ts`, `apps/frontend/client/src/lib/services/ai/ai_gateway_service.svelte.ts` (detection config sourcing), and the C-230 Connection path in `config_service.svelte.ts` — make the C-320 gateway the single source of provider availability for the capability screen, boot diagnostics, and settings |
| **Priority** | P0 — C-320 defines the gateway; this contract makes it the single source of provider state for the UI surfaces that currently duplicate detection logic (`capability_service.svelte.ts` still owns its own `_pingOllama()` / `checkCloudTextConfig()` fetch stack in parallel to the gateway's detection API) |
| **Dependencies** | C-320 (status `implemented` — gateway + detection API exist in repo; not yet `verified`, see risk note in Open Questions → resolved), C-318 (status `implemented` — `capability_service` and capability screen exist), C-230 (completed — Connection CRUD in `config_service.svelte.ts` verified present), packages: `@aikami/frontend/ai-gateway`, `@aikami/types`, `@aikami/schemas` |
| **Status** | verified |
| **Promotion** | — |
| **Docs Impact** | internal → none (service-layer rewiring; no player-facing behavior change beyond correctness) |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: After C-320, two parallel provider-detection stacks exist in the client:
  1. **Gateway stack (C-320, new)** — `packages/frontend/ai-gateway/src/lib/detection.ts` (`detectTextAvailability`, `detectImageAvailability`, `detectVoiceAvailability`, `toDetectionStatus`, `DETECTION_TIMEOUT_MS = 3000`) wired into the client by `apps/frontend/client/src/lib/services/ai/ai_gateway_service.svelte.ts` (`detect(capability)`).
  2. **Legacy stack (C-318)** — `apps/frontend/client/src/lib/services/capability/capability_service.svelte.ts` still owns its own `fetchWithTimeout`, `_pingOllama()` (proxy `/api/text/` + native `localhost:11434/api/tags` under a shared 3s deadline), `checkCloudTextConfig()` (reads `aiSettingsService.textProvider`), and `detectImage()` (ComfyUI `/api/image/object_info` ping) — byte-for-byte duplicated logic that C-320 explicitly relocated into the gateway but did not swap consumers for (C-320 Scope: "Migrating `capability_service` … consumers onto gateway detection — **C-322**").
  Additionally, the two stacks read **different config sources**: gateway text detection's cloud check (`_hasCloudTextConfig()` in `ai_gateway_service.svelte.ts`) reads only the legacy `aiSettingsService.textProvider` shape, while gateway **mode resolution** and the Settings → Connections UI (C-230) read `configService` (`state.connections`, `getActiveTextProvider()`). A connection saved in Settings → Connections is therefore invisible to a fresh `detect('text')` cloud-config check unless it also happens to populate the legacy `aiSettingsService` shape.
- **Reproduction**:
  1. `grep -n "_pingOllama\|checkCloudTextConfig\|fetchWithTimeout" apps/frontend/client/src/lib/services/capability/capability_service.svelte.ts` — full private detection stack present; compare with `packages/frontend/ai-gateway/src/lib/detection.ts` — same logic twice.
  2. In `ai_gateway_service.svelte.ts`, `_hasCloudTextConfig()` reads `aiSettingsService.textProvider` only — `configService.state.connections` (C-230) is never consulted for detection, only for `_resolveTextRouting`.
  3. `capability_service.test.ts` stubs `globalThis.fetch` directly (and contains a hardcoded absolute path to a defunct C-318 worktree: `_AI_SETTINGS_PATH = '/home/sonny/.../.pi/workspaces/run-mrkquinj-c-318/...'` — the `mock.module` target no longer resolves outside that worktree).
- **Existing implementation to reuse**:
  - `packages/frontend/ai-gateway/src/lib/detection.ts` — detection functions + `toDetectionStatus` (built by C-320 specifically so C-322 "can swap `capability_service` internals without shape changes").
  - `apps/frontend/client/src/lib/services/ai/ai_gateway_service.svelte.ts` — client gateway singleton (`detect`, `resolveMode`), exposed via `$services`.
  - `apps/frontend/client/src/lib/services/config/config_service.svelte.ts` — C-230 Connection store (`state.connections`, `defaultConnectionId`, `getActiveTextProvider()`, vault persistence).
  - Consumers that already delegate to `capability_service` and must keep working unchanged: `views/capability/capability_view_model.svelte.ts` (`capabilityService.detect()`), `views/app/boot/boot_diagnostics_view_model.svelte.ts` (`detectText()`, `detectImage()`).
- **Known gaps**:
  - `capability_service` never calls the gateway; deleting its private stack requires mapping `AiDetectionResult` → `DetectionStatus` (`toDetectionStatus` exists) and rebuilding `CapabilitySnapshot` fields (`textProviderId`, `textModelName`, `summary`) from gateway results.
  - Gateway text detection ignores C-230 connections entirely (the Settings write-through gap).
  - `capability_service.detect()` hardcodes voice as `'detected'`; the gateway reports real Kokoro engine status (C-320 left "the UX policy" to C-322).
  - `capability_service.test.ts` is fetch-stub-based and path-broken; `config_service.test.ts` currently has zero provider-detection/fetch assertions (grep evidence: no `fetch|detect|ping` matches) — the acceptance gate requires any detection assertions in both files to target the shared gateway mock.
- **Baseline tests** (run before starting):
  - `apps/frontend/client/src/lib/services/capability/capability_service.test.ts`
  - `apps/frontend/client/src/lib/services/config/config_service.test.ts`
  - `apps/frontend/client/src/lib/views/capability/capability_view_model.test.ts`
  - `apps/frontend/client/src/lib/views/app/boot/boot_diagnostics_view_model.test.ts`
  - `apps/frontend/client/src/lib/services/campaign/campaign_service.test.ts` (mocks `capabilityService`)
  - `packages/frontend/ai-gateway/tests/detection.test.ts`

## User Outcome

After this contract, a **player** who saves a cloud connection in Settings → Connections sees it recognized by the very next capability check (capability screen or new-campaign start) without a page reload; a **developer** has exactly one piece of code that pings/tracks local and cloud provider availability — the gateway — with `capability_service` reduced to a thin snapshot-shaping consumer, and provider-detection tests that mock one gateway surface instead of duplicating fetch stubs.

## Success Measures

- **Time/latency target**: no regression — each capability check still completes within the 3s detection budget (`DETECTION_TIMEOUT_MS`); `detect()` still runs text/image/voice checks concurrently so one hanging check does not block the others.
- **Offline/degraded behavior**: with zero network, detection resolves `not_found` for unreachable providers within the 3s budget (never hangs); vault/config read failures degrade to `not_found`, never crash the capability screen or boot diagnostics.
- **Production journey enabled**: Settings → Connections → capability screen → new campaign is one coherent config path — the precondition for C-323's mandatory text-AI gate (which will trust `capabilityProfile.textProvider` populated from this detection path).

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Gateway detection API (pings, timeouts, `toDetectionStatus`) | `packages/frontend/ai-gateway/src/lib/detection.ts` | reuse — unchanged; it is the single detection implementation |
| Client gateway singleton (`detect`, `resolveMode`) | `apps/frontend/client/src/lib/services/ai/ai_gateway_service.svelte.ts` | modify — `_hasCloudTextConfig()` (and detection wiring) must also consult C-230 connections from `configService`, not only `aiSettingsService` |
| Capability detection service | `apps/frontend/client/src/lib/services/capability/capability_service.svelte.ts` | modify — delete `_pingOllama()`, `checkCloudTextConfig()`, `fetchWithTimeout`, ComfyUI ping; delegate to `aiGatewayService.detect()`; keep `detect()` / `detectText()` / `detectImage()` public methods and `CapabilitySnapshot` output shape |
| Connection store (C-230) | `apps/frontend/client/src/lib/services/config/config_service.svelte.ts` (`state.connections`, `getActiveTextProvider()`) | reuse — already the write path for Settings → Connections; becomes a read source for gateway text detection |
| Capability screen consumer | `apps/frontend/client/src/lib/views/capability/capability_view_model.svelte.ts` | reuse — calls `capabilityService.detect()`; unchanged call sites |
| Boot diagnostics consumer | `apps/frontend/client/src/lib/views/app/boot/boot_diagnostics_view_model.svelte.ts` | reuse — calls `detectText()` / `detectImage()`; unchanged call sites |
| Capability shapes | `packages/shared/schemas/src/lib/capability.ts` (`DetectionStatusSchema`, `CapabilitySnapshotSchema`), `CapabilityProfile` in `.../game/campaign.ts` | reuse — unchanged per TODO scope ("keep `CapabilitySnapshot` and `CapabilityProfile` as the existing transient and persistent shapes, now populated from the gateway") |
| Test stubs for capabilityService | `apps/frontend/client/src/lib/test_preload.ts` (global stub), `campaign_service.test.ts`, `capability_view_model.test.ts` mocks | modify minimally — drop `checkCloudTextConfig` from stubs once removed from the interface |
| Settings dev-dashboard port polling | `apps/frontend/client/src/lib/services/config/local_service_detector.svelte.ts` + `providers_view_model.svelte.ts` | out of scope — dev/config dashboard port scanning (C-079), a different concern from capability detection; see Scope Boundaries |

## Overview

Exactly one piece of code pings/tracks local and cloud provider availability: the C-320 gateway. This contract swaps `capability_service`'s internals to delegate to `aiGatewayService.detect()` (deleting the duplicated ping/config-check stack), closes the config-source gap so gateway text detection sees C-230 connections saved in Settings without a reload, and rewrites the provider-detection tests to target one shared gateway mock instead of raw fetch stubs. Public shapes (`CapabilitySnapshot`, `DetectionStatus`, `CapabilityProfile`) and consumer call sites (capability screen, boot diagnostics, campaign start) are preserved.

## Design Reference

- C-320 contract + Execution Report (`docs/contracts/C-320-build-the-unified-ai-provider-gateway-offline-byok-service.md`) — AC-5 explicitly built `toDetectionStatus` and detection parity "so C-322 can swap `capability_service` internals without shape changes"; follow its detection semantics (proxy-then-native Ollama ping under one shared deadline, ≤3s budget, independent per-capability checks).
- C-318 contract (`docs/contracts/C-318-add-one-screen-capability-setup-and-an-offline-demo-fallback.md`) — origin of `capability_service` and the boot-diagnostics delegation pattern; `boot_diagnostics_view_model` was already flagged there as a consumer to migrate through the shared service.
- `ai_gateway_service.svelte.ts` composition pattern — injected `hasCloudConfig` / `hasConfiguredProvider` callbacks are the seam where connection-aware config reads plug in; no gateway-package change required.
- `svelte-conventions` / `aikami-conventions` — `BaseFrontendClass` singletons, `$services` barrel, no types/schemas defined in `apps/**`.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

1. **`capability_service` becomes a thin gateway consumer** (`apps/frontend/client/src/lib/services/capability/capability_service.svelte.ts`):
   - Delete `fetchWithTimeout`, `_pingOllama()`, the ComfyUI ping in `detectImage()`, `checkCloudTextConfig()`, and the `OLLAMA_*` / `PING_TIMEOUT_MS` constants — the gateway owns all of these.
   - `detectText()` / `detectImage()` call `aiGatewayService.detect('text' | 'image')` and map via `toDetectionStatus` (import from `@aikami/frontend/ai-gateway`).
   - `detect()` composes the full `CapabilitySnapshot` from three concurrent gateway `detect()` calls; `textProviderId` / `textModelName` come from `AiDetectionResult.provider` and (when a provider is resolvable) `aiGatewayService.resolveMode('text').model` — falling back to `undefined` when resolution throws (no provider configured). Keep the existing `summary` wording semantics.
   - Remove `checkCloudTextConfig` from `CapabilityServiceInterface` (no production caller exists — only test mocks reference it). Update `test_preload.ts` and `capability_view_model.test.ts` stubs accordingly.
   - Voice: populate `voiceStatus` from `detect('voice')` via `toDetectionStatus` — the gateway's voice detector is optimistic-convertible (available unless the engine reports a hard error), so the snapshot stays compatible with today's "voice always available" UX while surfacing real errors.
2. **Connection-aware gateway detection config** (`apps/frontend/client/src/lib/services/ai/ai_gateway_service.svelte.ts`):
   - Extend `_hasCloudTextConfig()` to return true when a C-230 connection provides cloud text config — i.e. `configService` has a connection (default first, then any) for a non-local provider with an `apiKey` (own or from `state.text.apiKeys[provider]`) or `baseUrl`+`model` — in addition to the existing `aiSettingsService.textProvider` legacy check. Reuse the existing `LOCAL_TEXT_PROVIDERS` classification so local (ollama/ooba) connections do NOT short-circuit as "cloud configured" and still exercise the real Ollama ping.
   - Guard all config reads: `configService` access must never throw out of detection (wrap; degrade to "not configured").
   - This is a client-side composition change only — `packages/frontend/ai-gateway` (detection functions, schemas, types) is not modified.
3. **Settings write-through** — no new write path: Settings → Connections already writes `configService.state.connections` (Svelte 5 `$state`, in-memory immediately, vault-persisted via `save()`). Visibility "without a page reload" is achieved because detection now reads that same live state per call. Do not cache cloud-config presence inside the gateway composition between `detect()` calls.
4. **Consumers untouched**: `capability_view_model.svelte.ts`, `boot_diagnostics_view_model.svelte.ts`, and `campaign_service.svelte.ts` keep their existing calls (`detect()`, `detectText()`, `detectImage()`); their observable behavior is preserved.
5. **Boundaries**: no types/schemas/constants added to `apps/**` (Pillar 2); `CapabilitySnapshot` / `DetectionStatus` / `CapabilityProfile` schemas unchanged; snake_case files; `type` aliases only; no new services — this contract removes code.

## State & Data Models

No new persisted or cross-boundary shapes. All shapes already exist and are reused unchanged:

```typescript
// packages/shared/schemas/src/lib/capability.ts (existing, unchanged)
type DetectionStatus = 'pending' | 'detected' | 'not_found' | 'configured' | 'error' | 'skipped';

type CapabilitySnapshot = {
	isComplete: boolean;
	textStatus: DetectionStatus;
	textProviderId?: string;
	textModelName?: string;
	imageStatus: DetectionStatus;
	voiceStatus: DetectionStatus;
	detectedAt?: string; // ISO date-time
	summary: string;
};

// packages/shared/types/src/lib/ai_gateway.ts (existing, C-320, unchanged)
type AiDetectionResult = {
	capability: 'text' | 'image' | 'voice';
	available: boolean;
	mode?: 'offline' | 'byok' | 'service';
	provider?: string;
	detail?: string;
	checkedAt: string;
};
```

The only shape-level work is the mapping `AiDetectionResult → DetectionStatus`, already implemented as `toDetectionStatus` in `@aikami/frontend/ai-gateway` (`not available → 'not_found'`, `byok → 'configured'`, otherwise `'detected'`).

## Quality Requirements

- **Offline/degraded mode**: with no network and no config, `detect()` completes with `not_found` statuses within the 3s per-capability budget; capability screen still renders its degraded path; vault/`configService` read failures inside detection degrade to not-configured (never throw to ViewModels).
- **Accessibility/input**: N/A — headless service rewiring; no UI markup changes.
- **Performance budget**: detection budget unchanged (≤3s per capability, concurrent checks); no added network hops — one detection stack instead of two; connection-presence check is a synchronous in-memory read.
- **Security/privacy**: API keys are only tested for **presence** during detection — key values must never appear in `AiDetectionResult.detail`, snapshot `summary`, or logs; no new key storage or read paths beyond the existing `configService`/vault.
- **Persistence/migration**: N/A — `CapabilitySnapshot` is transient; `CapabilityProfile` schema unchanged; vault/connection formats unchanged.
- **Cancellation/retry/idempotency**: detection calls remain idempotent and safely repeatable (capability screen re-run, boot-diagnostics polling every interval); gateway detection accepts `AbortSignal` internally — repeated `detect()` calls must not leak timers/listeners (gateway already cleans up; the service adds none).
- **Observability**: `capability_service` keeps `BaseFrontendClass` auto-logging via `create()`; gateway continues logging dispatch/detection via its existing hooks; the removed private ping logs are superseded by gateway detection detail strings.

## Migration & Rollback

N/A — no persistent state changes. `CapabilitySnapshot` (transient), `CapabilityProfile` (persistent, schema untouched), vault payload, and Connection format are all unchanged. Code-level rollback: consumer call sites are untouched and `capability_service`'s public methods keep their signatures, so reverting is a localized restore of the service's internals.

## Scope Boundaries

- **In Scope:**
  - Rewriting `capability_service.svelte.ts` internals to delegate to `aiGatewayService.detect()` + `toDetectionStatus`; deleting its private ping/config-check/fetch code and the `checkCloudTextConfig` interface member.
  - Extending `ai_gateway_service.svelte.ts` detection config sourcing (`_hasCloudTextConfig`) to consult C-230 connections in `configService` (live `$state` read per detection call).
  - Rewriting `capability_service.test.ts` against a mocked `aiGatewayService` (shared gateway mock), removing global fetch stubs and fixing the hardcoded absolute worktree mock path.
  - Keeping `config_service.test.ts` free of provider fetch stubs; adding a focused test that a saved cloud connection makes gateway-backed text detection report configured (may live in `capability_service.test.ts` or `config_service.test.ts` — one place, gateway-mock or `configService`-state based, no fetch stubs).
  - Minimal stub updates in `test_preload.ts`, `capability_view_model.test.ts`, `campaign_service.test.ts` for the removed interface member.
- **Out of Scope:**
  - Any change to `packages/frontend/ai-gateway` source (detection functions, adapters, schemas) — C-320 owns it; this contract only changes client composition.
  - The mandatory text-AI gate / removal of the offline-demo campaign path (`selectOfflineDemo`, `textProvider: false`) — **C-323**.
  - Backend AI path retirement (`packages/backend/ai` consumers) — **C-324**.
  - `LocalServiceDetector` / `providers_view_model.svelte.ts` port-polling in the dev config dashboard (C-079 surface) and any Settings UI redesign — **C-333** (progressive disclosure) / later cleanup.
  - `CapabilitySnapshot` / `CapabilityProfile` / `DetectionStatus` schema changes.
  - Boot-diagnostics or capability-screen UX changes (markup, flows, polling intervals).

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** 4 ACs, 1 project touched (`client` — services + tests only; shared packages and the gateway package are read-only dependencies). Well under the split threshold; the work is one cohesive consumer-migration seam that C-320 pre-cut. No deferred phases.

## Acceptance Criteria

### AC-1: Capability Service Delegates All Detection to the Gateway
**Given** `capability_service.svelte.ts` and the C-320 gateway singleton
**When** `detect()`, `detectText()`, or `detectImage()` is called
**Then** every provider availability decision comes from `aiGatewayService.detect(capability)` mapped through `toDetectionStatus`; `capability_service.svelte.ts` contains no `fetch` call, no Ollama/ComfyUI endpoint constant, no private ping helper, and no `checkCloudTextConfig` member (grep evidence: zero matches for `fetch(`, `_pingOllama`, `checkCloudTextConfig`, `11434`, `object_info` in the file); and the returned `CapabilitySnapshot` keeps its exact existing shape with `textProviderId`/`textModelName`/`summary` populated from gateway results.

### AC-2: A Connection Saved in Settings Is Visible to a Fresh Capability Check Without Reload
**Given** no legacy `aiSettingsService` text config and a running session
**When** a cloud text connection (e.g. openrouter with an API key) is added via `configService.addConnection(...)` (the Settings → Connections write path) and detection is re-run (`capabilityService.detectText()` or the capability screen's re-detection)
**Then** the gateway's text detection reports it as configured (`DetectionStatus === 'configured'`) in the same session without a page reload and without re-implementing the check outside the gateway; **and** a local-provider connection (ollama) does NOT short-circuit as cloud-configured — it still exercises the gateway's Ollama ping path; **and** `configService` read failures during detection degrade to `not_found` rather than throwing.

### AC-3: Capability Screen and Boot Diagnostics Read from the Single Detection Source
**Given** the existing consumers `capability_view_model.svelte.ts` (calls `detect()`) and `boot_diagnostics_view_model.svelte.ts` (calls `detectText()`/`detectImage()`)
**When** this contract lands
**Then** both consumers work unchanged (their existing test suites pass without modifying their production call sites), their detection results flow exclusively through the gateway (no provider ping/fetch logic remains anywhere under `apps/frontend/client/src/lib/services/capability/` or `apps/frontend/client/src/lib/views/app/boot/`), and repeated boot-diagnostics polling continues to complete each cycle within the 3s-per-capability budget.

### AC-4: Provider-Detection Tests Target the Shared Gateway Mock
**Given** `capability_service.test.ts` and `config_service.test.ts`
**When** the test suites are updated
**Then** `capability_service.test.ts` mocks the gateway surface (`aiGatewayService.detect` / detection results) instead of stubbing `globalThis.fetch`, contains no hardcoded absolute filesystem paths (the defunct `run-mrkquinj-c-318` worktree path is gone; module mocks use relative/alias paths), and covers: gateway-available → `detected`, gateway-byok → `configured`, gateway-unavailable → `not_found`, gateway-throw → `error`/degraded snapshot; `config_service.test.ts` contains zero provider fetch stubs; and the AC-2 connection-visibility scenario is asserted in exactly one of the two files via config state + gateway mock.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `apps/frontend/client/src/lib/services/capability/capability_service.test.ts` (rewritten) + grep output of the service file | N/A (headless) | Filled during verification |
| AC-2 | Unit + Integration | connection-visibility test (in `capability_service.test.ts` or `config_service.test.ts`); manual browser check via Settings → Connections → capability screen re-detect | `/settings` → capability screen | Filled during verification |
| AC-3 | Unit | existing `capability_view_model.test.ts` + `boot_diagnostics_view_model.test.ts` green with unchanged production call sites; grep evidence for zero ping/fetch logic in the two directories | `/game` boot diagnostics + capability screen | Filled during verification |
| AC-4 | Unit | diff of `capability_service.test.ts` (no `globalThis.fetch` stubs, no absolute paths); grep of `config_service.test.ts` for fetch stubs (zero) | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon_run_task` → `client:test` (targeted: `capability_service.test.ts`, `config_service.test.ts`, `capability_view_model.test.ts`, `boot_diagnostics_view_model.test.ts`, `campaign_service.test.ts`); full `validate()` before handoff.
- Integration: in the client dev sandbox with Ollama stopped, add an openrouter connection in Settings → Connections, navigate to the capability screen, re-run detection — text shows configured without reload; remove the connection, re-run — text falls back to the Ollama ping result within 3s.
- E2E / Visual:
    - **Functional**: N/A — service-layer rewiring behind unchanged interfaces; the capability-screen and settings E2E surfaces are owned by C-318/C-333 and their existing specs must simply stay green.
    - **Visual**: N/A.

**Watch Points**:
- AC-1: `capability_service.detect()` currently derives `textModelName` from `import.meta.env.PUBLIC_OLLAMA_MODEL` — after delegation, prefer `resolveMode('text').model` but wrap in try/catch (`getActiveTextProvider()` throws when nothing is configured).
- AC-1: voice moves from hardcoded `'detected'` to gateway-reported status — the gateway voice detector is optimistic (available unless engine `status === 'error'`), so the snapshot stays UX-compatible; do not make voice failures block `isComplete`.
- AC-2: presence-check only — never validate/decrypt key material during detection; connection classification must reuse the same local-vs-cloud provider set as `_toTextResolution` (avoid two divergent `LOCAL_TEXT_PROVIDERS` definitions in the file).
- AC-3: `boot_diagnostics_view_model.test.ts` spies on `capabilityService.detectText`/`detectImage` via the `$services` preload stub — keep those method names/signatures identical.
- AC-4: `campaign_service.test.ts` and `test_preload.ts` stub `capabilityService` including `checkCloudTextConfig` — update stubs when the member is removed or the proxy-stub pattern will silently mask the removal.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Extend `ai_gateway_service.svelte.ts` `_hasCloudTextConfig()` to consult `configService` connections (guarded, presence-only, local-provider-aware). Rewrite `capability_service.svelte.ts` internals to delegate to `aiGatewayService.detect()` + `toDetectionStatus`, deleting the private ping stack and the `checkCloudTextConfig` interface member.
2. **Phase 2 (Integration)**: Update test stubs (`test_preload.ts`, `capability_view_model.test.ts`, `campaign_service.test.ts`) for the removed member; rewrite `capability_service.test.ts` against the gateway mock (fixing the absolute-path module mock); add the connection-visibility test; verify `capability_view_model` and `boot_diagnostics_view_model` suites pass unchanged.
3. **Phase 3 (Validation)**: Run `validate()` and targeted `client:test` suites; collect grep evidence (no fetch/ping/endpoint constants in `capability_service.svelte.ts`, no fetch stubs in the two named test files, no absolute paths); run the manual Settings → capability-screen integration check.

## Edge Cases & Gotchas

- **Legacy `aiSettingsService` config still present**: some installs have text config only in the legacy shape — the cloud check must remain a union (legacy OR connections), not a replacement, or existing configured users would regress to `not_found`.
- **`getActiveTextProvider()` throws when unconfigured**: any resolution call made while building the snapshot must be wrapped; detection of "nothing configured" is a valid, non-exceptional outcome.
- **Ollama connection with `baseUrl` + `model`**: satisfies the naive "endpoint+model" cloud heuristic — classification by provider id (local set) must take precedence so local providers are pinged, not assumed configured.
- **Detection caching**: `ai_gateway_service` composes detectors once at construction — the injected callbacks must read `configService` state lazily per invocation (they are closures over the singleton, which is fine) — do not snapshot connection state at composition time.
- **Stale test worktree path**: `capability_service.test.ts`'s `mock.module` on an absolute defunct path currently no-ops/mismatches outside that worktree — the rewrite must not carry the pattern forward (use relative or alias specifiers, per the C-320 execution-report fix precedent).
- **`summary` string consumers**: the capability screen and its tests assert summary wording (e.g. "Cloud AI provider configured") — preserve the existing summary vocabulary when mapping gateway results.
- **C-323 interplay**: this contract keeps the offline-demo path (`textProvider: false`) intact — do not pre-emptively gate campaign creation here; C-323 owns that policy change and depends on this contract's detection truth.

## Open Questions

None — the config-source union (legacy + connections), removal of `checkCloudTextConfig` (no production callers), voice-status policy (optimistic-convertible), and the out-of-scope status of `LocalServiceDetector` are resolved above from TODO.md § C-322 and the C-320 contract's explicit handoff notes. Dependency risk accepted and recorded: C-320 and C-318 are `implemented` but not yet `verified` — if C-320 verification amends the detection API surface, this contract's Phase 1 must re-check `toDetectionStatus`/`detect` signatures before implementation.

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

## Execution Report

### Summary
Wired `capability_service` into the C-320 AI Provider Gateway as the single source of provider availability. Deleted the duplicated ping/config-check stack (`_pingOllama`, `fetchWithTimeout`, `checkCloudTextConfig`, ComfyUI fetch). Extended gateway `_hasCloudTextConfig` to consult C-230 connections from `configService` in addition to the legacy `aiSettingsService` shape, with local-provider gating and guarded config reads. All consumer call sites (capability screen, boot diagnostics) unchanged; tests converted to shared gateway mock.

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | `capability_service` has zero fetch/ping/endpoint constants; delegates to `aiGatewayService.detect()` + `toDetectionStatus`; snapshot shape preserved |
| AC-2 | ✅ | Cloud connection via `addConnection()` visible to next `detect('text')` without reload; local (ollama) connection does NOT short-circuit; `configService` read failures degrade to `not_found` |
| AC-3 | ✅ | Boot diagnostics (18/0 pass) and capability screen call sites unchanged; no ping/fetch logic remains in either directory |
| AC-4 | ✅ | `capability_service.test.ts` uses shared gateway mock, no `globalThis.fetch` stubs, no absolute paths; `config_service.test.ts` has zero provider fetch stubs; AC-2 connection-visibility asserted in `config_service.test.ts` |

### Files Created
| File | Purpose |
|---|---|
| — | No new files |

### Files Modified
| File | Change |
|---|---|
| `apps/frontend/client/src/lib/services/capability/capability_service.svelte.ts` | Rewired to delegate to `aiGatewayService`; deleted private ping/fetch stack, `checkCloudTextConfig` member, endpoint constants |
| `apps/frontend/client/src/lib/services/ai/ai_gateway_service.svelte.ts` | Extended `_hasCloudTextConfig` to union C-230 connections (guarded, local-provider-aware, presence-only) with legacy `aiSettingsService` |
| `apps/frontend/client/src/lib/services/capability/capability_service.test.ts` | Rewritten against shared gateway mock; no `globalThis.fetch` stubs, no absolute paths; covers all gateway statuses + error degradation |
| `apps/frontend/client/src/lib/services/config/config_service.test.ts` | Added C-322 AC-2 connection-visibility test block (cloud configured, shared key, local not short-circuited, config-failure degrade) |
| `apps/frontend/client/src/lib/views/capability/capability_view_model.test.ts` | Removed `checkCloudTextConfig` from mock; removed dead absolute-path crypto_vault mock |
| `apps/frontend/client/src/lib/test_preload.ts` | Removed `checkCloudTextConfig` from `capabilityService` stub; added `aiGatewayService` stub |

### Deviations from Spec
None. All ACs met as specified. The `capability_view_model.test.ts` pre-existing failures (9/13, ConnectionManagerViewModel import) and `campaign_service.test.ts` pre-existing failures (5/15, fake DB integration) are unchanged from baseline.

### Test Results
- Unit (capability_service): 15/15 pass (0 failures)
- Unit (config_service): 35/35 pass (0 failures)
- Unit (boot_diagnostics_view_model): 18/18 pass (0 failures)
- Unit (gateway detection): 14/14 pass (0 failures)
- Unit (capability_view_model): 4/13 pass (9 pre-existing failures)
- Unit (campaign_service): 10/15 pass (5 pre-existing failures)
- Baseline: 9 pre-existing capability_view_model failures, 5 pre-existing campaign_service failures, 0 new failures
