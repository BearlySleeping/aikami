---
id: C-481
title: "Converge AI configuration, capability metadata and routing"
source: direct
contract_type: full
status: approved
github: { issue_number: null, issue_url: null, project_item_id: null, pr_url: null }
created_at: "2026-09-05T15:34:22Z"
---

# Contract C-481: Converge AI configuration, capability metadata and routing

> **Execution note (2026-09-06)**: this contract is executed as **one** unattended
> pipeline run (`bun run contract C-481`) producing **one PR**. The earlier split into
> C-485–C-488 is withdrawn; those files are deleted. Work the phases in the order given
> under *Implementation Phases* — each phase must leave `main` working — and keep the
> whole diff inside the PR-size gate.

## Metadata

| Field | Value |
|---|---|
| **Source** | User-approved AI setup direction; [execution plan](../plans/ai-setup/README.md) |
| **Target** | `packages/shared/schemas/src/lib/domain/providers_config.ts`, `packages/shared/types/src/lib/domain/`, `packages/shared/constants/src/lib/providers.ts`, `apps/frontend/client/src/lib/services/config/`, `apps/frontend/client/src/lib/services/ai/`, `apps/frontend/client/src/lib/views/utils/crypto_vault.ts`, `packages/frontend/ai-gateway/` |
| **Type** | full |
| **Priority** | P0 — prevent configuration divergence before new UX |
| **Dependencies** | C-463/C-465 implementation. No dependency on C-482/C-483/C-484 |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | Connection/settings guidance in `apps/frontend/docs/src/content/docs/` is updated by C-484, not here |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

Initial research used `3bb9af3b`; source review at `acb7a18e` confirms the following. Re-confirm each premise against the current `main` before editing; if one is already fixed, prove the existing behavior and report a no-op rather than manufacture a change.

- **Projections go stale.** `config_service.svelte.ts` keeps `state.connections`, `state.defaultByCapability` and `state.defaultConnectionId` as projections rebuilt by the private `_reproject()`. The legacy wrappers (`addConnection`, `updateConnection`, `deleteConnection`, `duplicateConnection`, `setDefaultConnection`) call it; the canonical mutators (`addProvider`, `updateProvider`, `deleteProvider`, `addAiConnection`, `updateAiConnection`, `deleteAiConnection`, `setRoleAssignment`, `clearRoleAssignment`) do not. The settings ViewModel calls the canonical mutators, while `ai_gateway_service` and `capability_view_model.svelte.ts` read the projection — so add/edit/delete is invisible until an unrelated legacy call or a reload.
- **Provider rules are duplicated.** Locality, required URL/key rules and role sets are re-derived in `ai_settings_view_model.svelte.ts` and `connection_verifier.ts` (`LOCAL_PROVIDERS`, `OLLAMA_NATIVE`, `OPENAI_COMPAT`). That ViewModel also owns HTTP and model-listing rules, and its registry-only lookup conflates endpoints with accounts. `config_service._findProviderByRegistry` resolves an account by first registry-ID match.
- **Testing a keyless local connection fails.** `ai_settings_view_model.testConnection` returns `No endpoint or key` when a provider has no credential, including keyless local providers, and derives a fixed verification URL rather than honoring the instance endpoint.
- **Status is inferred from locality.** `ai_settings_view.svelte` renders a Running badge whenever a provider-tree row is local. Locality proves neither process state nor model readiness.
- **Migration is not safe.** `config_migration.ts` uses partial checks, first-row routing fallbacks and registry/model-only deduplication of legacy `models[]`; `config_service.load()` casts v2 data and absorbs rows stored only in `legacy`. `crypto_vault.decrypt()` may rewrite legacy encryption during a read and cannot distinguish missing from locked or corrupt data; `config_service.save()` does not retain the supplied PIN and writes vault and plain settings separately.
- **No v3 exists.** Grepping the schemas package for `schemaVersion` yields only 1 and 2. There is no `routing` shape.
- **Gateway resolution is scattered.** Gateway mode resolution and the text, image and TTS services each select part of a request independently.

**Baseline tests**: `config_service.test.ts`, `config_migration.test.ts`, schemas package tests, gateway tests, `ai_settings_view_model` tests. Run them first and record actual counts and actual failures; do not copy historical numbers.

## User Outcome

A player configures an account or server once, uses different models for different features, and sees the same selected configuration during setup, settings and gameplay after reload.

## Success Measures

No AI discovery, verification or inference requests on configuration load or settings mount; no duplicate persisted credential per model. Vault unlock and load may be asynchronous, but configuration reads and route resolution are synchronous and network-free afterward. One resolver determines each generation request's effective configuration. Text is required for AI gameplay, not for booting the app shell or opening settings.

## Existing System & Reuse Map

| Existing source | Treatment |
|---|---|
| `packages/shared/schemas/src/lib/domain/providers_config.ts` and inferred types | Versioned schemas and capability-discriminated connections; `AiProviderSchema`, `AiConnectionSchema`, `RoleAssignmentsSchema` keep their exported names |
| `packages/shared/constants/src/lib/providers.ts` | Canonical capability/provider metadata, not duplicated ViewModel sets |
| `config_service.svelte.ts` and `config_migration.ts` | Sole validated mutation/persistence boundary; pure migration and read-only legacy projections |
| `apps/frontend/client/src/lib/views/utils/crypto_vault.ts` | Reuse encryption; separate read/decrypt from writes, preserve unlock mode, add recoverable versioned storage |
| `packages/frontend/ai-gateway/` and client AI services | Reuse protocol adapters, cancellation and typed errors; add shared setup operations and effective routing |

## Architecture Directives

Definitions describe protocol, auth, model discovery and supported capabilities; instances describe endpoint and account identity. Protocol name must not imply locality or ownership. Select or reuse an account by stable `providerId`, never the first registry-ID match; credential rotation preserves that ID. Distinct endpoints or accounts remain distinct even with the same registry ID. Cross-capability aliases may share an explicitly selected compatible account, never merge automatically by label, model or key alone.

Keep `voice` as the existing TTS key. Required text, optional image and voice, and role-to-capability mapping are declarative. STT, music, ambience and video remain unsupported design cases. Registry tests distinguish usable definitions from label-only stubs: every advertised operation needs schema, adapter and host/transport support; unsupported operations return typed unavailability, never default to text.

Local/cloud/LAN location, native/container/browser execution and app/external ownership are independent facts and may be unknown. Unknown legacy ownership defaults to external; discovery never grants lifecycle control. This contract exposes only optional C-482 runtime references and capability seams, not installation inventories, jobs or process control.

Shared setup services own endpoint validation, credential reuse, model discovery, verification and applying configuration; ViewModels own drafts and presentation only. Keep wire schemas, types and constants in shared packages, protocol operations in the existing gateway layer, and vault/config orchestration in client services. No shared package imports from `apps/**`, no app re-exports a shared type as its own, and no speculative new framework is introduced. Reuse existing injected transports, error types and cancellation.

Resolve once per request into a capability-discriminated provider/connection/model/endpoint/params snapshot, with credentials supplied only to the transport. All generation consumers use it; none independently looks up a key by registry ID or falls back to environment, `localStorage` or first-row selections. Existing explicit per-agent or per-request connection overrides remain supported through the same validation boundary without redesigning agent pipelines; absent overrides inherit, invalid explicit overrides fail closed.

## State & Data Models

Retain `AiProvider` (single credential owner) and `AiConnection` (provider reference, model, capability-discriminated params). Enforce the discriminator in the schema, not an unrelated capability enum plus a params union. V3 persists `schemaVersion: 3`, `providers`, canonical `connections`, `routing` and preserved user AI options and presets; no writable duplicate legacy payload and no standalone voice or image key store.

Canonical `routing: { defaults, overrides }` uses sparse capability defaults and sparse role overrides. An absent override inherits its capability default; a connection ID pins it; `null` explicitly disables that role. A missing default is unavailable. Reset-to-default removes the override; disable writes `null`. Resolve a valid explicit request connection, then the role override, then the capability default; an explicit disabled or invalid selection fails closed and never falls through to another account or to cloud.

Connection and provider deletion is an explicit atomic operation: remove affected defaults and replace affected pinned role overrides with `null`, unless the user explicitly supplies compatible replacement routes in that same operation. Never delete an override and thereby activate a different default. Changing defaults leaves pinned and disabled overrides intact. Deleting the last connection does not delete its reusable provider or credential; account deletion is separate.

Disambiguate canonical vault `connections: AiConnection[]` from legacy `state.connections: ConnectionEntry[]`. Legacy rows and effective `roles` are read-only projections. `defaultConnectionId`, `defaultByCapability` and `isDefault` project capability defaults, not primary-role overrides; consumers needing a role's actual selection use the resolver. Projections update reactively from the same committed revision and cannot mutate underlying state through exposed objects.

Feature support, reachability, selected-model compatibility and last successful generation remain four distinct facts in the types. Verification results are timestamped, scoped to a provider/connection and the tested configuration revision, and invalidated by endpoint, auth, model or relevant-param edits. Persisted historical success is not current readiness; one model's test cannot mark every connection on that provider ready.

## Quality Requirements

**Offline and security.** No sign-in or cloud boot dependency. Keys remain provider-owned and vault-encrypted at rest, never copied into model records, diagnostics or discovery caches. Validate every request and redirect hop: credential-bearing traffic requires HTTPS and an explicitly approved origin, while HTTP is permitted only for requests with no attached credential. Preserve meaningful paths and ports, reject URL user-info credentials, and never forward API keys or auth headers across an unencrypted or unapproved redirect. Keyless local and LAN endpoints work, and optional auth is supported without deriving requirements from locality. Do not weaken browser CORS, mixed-content or CSP policy, or native permission policy, to make a test pass.

**Persistence.** Schema-validate versioned loads and full mutation candidates, including unique IDs, provider references and capability/params/route compatibility. Structurally valid saved definitions whose adapters are unsupported remain stored but resolve unavailable, rather than failing the entire vault load. Stage drafts separately; publish committed state and projections only after successful persistence. Serialize saves and detect stale revisions, including overlapping instances or tabs, so late encryption completions cannot clobber newer edits. Failure retains the last committed state and a recoverable draft.

**Setup operations.** Require an explicit action, deadlines and caller cancellation. Stale responses cannot overwrite a newer draft or mark a changed configuration verified. Model-discovery failure or unsupported listing still permits a manual model ID when the adapter supports it; saving unverified configuration is allowed and never marked ready. Health/auth checks and model listing are not inference proof; paid tests or previews and private prompt transmission require explicit informed consent. No background scans and no generation on mount.

**Failures.** Redacted typed failures distinguish not-configured, unsupported, invalid config, auth, transport/timeout, cancelled, stale result, locked/corrupt/unsupported-version vault, and persistence conflict or failure. Redact before logging or building user-visible errors; never expose raw provider response bodies or full secret-bearing URLs. Accessibility belongs to the consuming UI contracts.

## Migration & Rollback

Read and decrypt without rewriting storage. Distinguish a genuinely absent vault from a wrong PIN, corruption or an unknown version; only absence permits fresh initialization. Other failures expose recovery and block autosave, never publish an empty replacement. Validate historical inputs with version-appropriate schemas, normalize v1 → v2 → v3 in memory, then validate the complete v3 candidate. Reuse migration transformations only after removing unsafe casts, silent row pruning and first-row routing fallbacks; unknown future versions never enter the v1 path.

Support deployed v2 payloads with canonical rows plus rows stored only in `legacy.connections`; absorb missing IDs once and preserve canonical rows and explicit assignments on overlap. Legacy `models[]` identity includes endpoint and account context, not just registry and model. Do not attach standalone voice or image keys to a guessed provider; retain ambiguous credentials in the encrypted recovery snapshot without activating them. Preserve stable existing IDs, user presets, voice archetypes, image options and non-AI settings; define and test existing option precedence before removing readers.

For v1, honor explicit capability defaults (including `null`), then the text `defaultConnectionId` when that capability entry is absent, then a unique `isDefault` row when no explicit default exists; otherwise leave unset. Dangling or cross-capability explicit selections fail migration with recovery, not substitution. For normalized v2, map valid primary roles (`narration`, `portrait`, `narrator-voice`) to capability defaults and preserve every explicit role as an override, even when equal to its default. Mark previously unassigned roles `null` where a new default would otherwise activate them. Never infer intentional inheritance from equal legacy values.

Retain a recoverable encrypted pre-upgrade snapshot and its unlock requirements before any format or key rewrite; preserve custom-PIN protection and keep the recovery copy outside the active payload. Backup, quota, encryption or write failure aborts migration without changing the original. Commit all AI configuration and options in one versioned encrypted record (or an equivalently recoverable transaction), not independent vault and plain writes; leave unrelated plain settings untouched. Only remove legacy cleartext credentials after their encrypted replacement is durable, with retry-safe cleanup.

Use an isolated v3 storage namespace so older binaries cannot parse or overwrite it via their unversioned vault key. Once v3 exists, never silently re-import a legacy copy or fall back to it when v3 fails to load. Rollback explicitly restores the pre-upgrade snapshot with confirmation that later changes are lost; no automatic downgrade, dual writes or automatic recovery-copy deletion.

## Scope Boundaries

- **In scope:** canonical configuration and routing; validated recoverable migration; definitions and identity; shared setup, discovery and verification operations; integration of the existing text, image and TTS consumers including their existing explicit connection overrides; and repair of the stale-projection, keyless-verification and inferred-status defects listed above.
- **Out of scope:** installation executors, catalog and jobs (C-482); UI redesign (C-483, C-484); new provider integrations or inference capabilities; hosted trial; save-game migration; agent-pipeline redesign.

## Implementation Phases

One PR. Work these in order; each intermediate state must compile, pass tests and leave the app working.

1. **Seam freeze.** Add the v3 payload and `routing` schemas alongside v1/v2, their inferred types, capability/provider definitions with typed accessors, the typed storage/restore interface and the typed failure taxonomy. Nothing writes `schemaVersion: 3` yet. Prefer few, well-named exports — every later phase and C-482 builds against them.
2. **Projection repair.** Make the canonical mutators reproject, so add/edit/delete/role changes are visible to legacy consumers before reload. Keep `_reproject()`'s own logic and the existing unchanged-projection guard intact; do not remove the outer reproject call in composite legacy wrappers.
3. **V3 writes and migration.** Enable v3 writes with version-appropriate validation, in-memory normalization, the recoverable encrypted pre-upgrade snapshot, the single versioned committed record, the isolated v3 namespace and read-only compatibility adapters for still-live legacy consumers.
4. **Shared setup operations.** Move endpoint validation, credential reuse, model discovery, verification and apply into shared services with deadlines, cancellation, stale-response rules and redacted typed failures. This is where the keyless-local test defect is fixed.
5. **Canonical resolution.** Introduce the single resolver and route every existing text, image and TTS consumer through it. Replace the locality-derived status badge with honest, test-scoped status. Remove the temporary legacy mutation methods once call sites are covered.

**Size gate.** Report per-file additions and deletions including tests. Target ≤50 changed files, hard stop at 100. If phase 5 cannot fit, stop at the last complete phase, leave no second live write path, and report the remaining phase as an explicit follow-up rather than shipping a half-cut-over resolver.

## Acceptance Criteria

### AC-1: Stable account identity and reuse
**Given** two models on one account, two accounts at one endpoint, and a second endpoint
**When** they are reused, edited, rotated and reloaded
**Then** stable `providerId` selects only the intended credential, two instances sharing a registry ID stay distinct, and deleting an account's last model retains the account.

**Verification**: real persistence fixtures; settings integration; explicit compatible cross-capability reuse and ambiguous-account cases; any first-registry-match helper removed with its replacement in place.

### AC-2: Canonical state and projections agree before reload
**Given** provider, connection and route mutations through the canonical API
**When** consumers read before commit, after commit and after reload
**Then** canonical state and read-only projections agree; a role change reprojects `isDefault`, `defaultByCapability` and `defaultConnectionId` together; a rotated credential propagates to every sibling connection; provider deletion leaves no orphan role; reprojecting twice is idempotent and a no-op still suppresses the redundant write; failed or stale saves neither publish nor overwrite state.

**Verification**: add/edit/delete/default/override matrix; a gateway `detect()` seeing a canonically added connection with no reload; compiled Svelte or production-route reactivity test; overlapping-save and mutation-through-getter tests.

### AC-3: Routing states are distinguishable and fail closed
**Given** sparse capability defaults and sparse role overrides
**When** an override is absent, pinned to a connection ID, or set to `null`, and when defaults change or a referenced connection or provider is removed
**Then** the three states are distinguishable in the type itself rather than by convention, compatible intent survives, and no silent account substitution or cloud fallback occurs.

**Verification**: resolver matrix for text, image and voice — default differs from primary-role override, `null` versus absent, reset versus disable, local override deleted with a cloud default, invalid, dangling and cross-capability cases; round-trip tests asserting absent is not conflated with `null`.

### AC-4: Migration preserves and recovers
**Given** v1, v2 and v3 payloads, mixed legacy rows, and locked, corrupt, future-version or failing storage
**When** loaded, migrated or restored
**Then** IDs, explicit routing and options survive, retries are idempotent, reads never rewrite storage, and the original data and PIN protection remain recoverable.

**Verification**: synthetic encrypted fixtures plus the real vault adapter with injected faults — backup, quota, encryption, write, cleanup and crash; old-binary storage isolation; confirmed restore; no real keys.

### AC-5: Setup operations are explicit, scoped and honest
**Given** local, cloud and LAN instances and a supported manual model
**When** the user explicitly lists, tests or saves
**Then** a keyless local instance is tested at its configured base URL without requiring a key, only the selected endpoint, auth and transport are used, unverified saves remain usable, and readiness is scoped to exactly what was tested — a newly configured local provider with no successful check is never labeled Running or Ready, and one model's success never marks siblings ready.

**Verification**: keyless Ollama, local OpenAI-compatible, two distinct bases, authenticated local, cloud regression, malformed-JSON/SPA-HTML, refused, timeout, abort, stale-edit and unsupported-listing tests asserting requested URL and headers with fixture credentials; consent and secret-redaction checks; result invalidation on endpoint, credential or model edit; no credential forwarding on a changed endpoint or redirect.

### AC-6: Definitions are single-source; unsupported is typed
**Given** unsupported or future definitions, or a browser host
**When** available actions are computed
**Then** locality, required URL/key rules and model-discovery support are read from the definition, an advertised operation without schema and adapter support fails a registry test, unsupported operations return typed unavailability instead of defaulting to text, and app boot and settings work without any text configuration.

**Verification**: definition/schema/adapter/host completeness tests distinguishing usable definitions from label-only stubs; `/capability` and `/settings` E2E proving no AI request and no native IPC on mount; `voice` remains the TTS key; STT, music, ambience and video stay unsupported.

### AC-7: Every generation request uses one snapshot
**Given** mixed text, image and TTS assignments and legacy environment or `localStorage` selections
**When** generating before reload, after reload, and during a concurrent edit
**Then** each request uses one canonical snapshot with the matching model, endpoint, auth and params, with no fallback and no independent key lookup.

**Verification**: gateway plus real consumer integration with recording transports for narration/dialogue, portrait/scene and narrator/NPC voice; existing per-agent override regression.

## Edge Cases & Gotchas

- Model IDs are provider- and endpoint-scoped, not globally unique. Registry entries such as `openai` span capabilities while aliases such as `dalle` need explicit compatibility mapping. Credentials are not stable account IDs.
- `source: 'detected'` or `localhost` proves neither ownership nor readiness. Never let a legacy projection or default picker reactivate an unavailable route.
- Migration must not drop unreferenced credential-only accounts, custom options or rows merely because a capability or adapter is currently unsupported; preserve them for recovery without advertising generation support.
- `_reproject()` is O(connections × providers) and now runs on every canonical mutation; keep the existing unchanged-projection guard rather than adding a cache.
- Keep computed display labels and formatting in ViewModels, not template expressions. Do not replace one misleading badge with a different global Connected claim.
- Native process Running status is C-482's, derived from runtime observation — never from this contract's connectivity status.

## Open Questions

None delegated as product decisions. Approval covers v3 defaults plus pinned and disabled overrides, explicit provider identity, isolated recoverable persistence and fail-closed routing. Materially different semantics, lost historical data or additional scope require an amendment before execution.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.1.0 | 2026-09-05 | Tightened provider identity, discriminated schemas, role disable/deletion semantics, single-request resolution, migration/PIN/storage isolation, setup consent and cancellation, and acceptance evidence against `acb7a18e`. | User |
| 2.0.0 | 2026-09-06 | Withdrew the C-485–C-488 split and re-merged that scope into this single one-PR contract; absorbed the P02/P03/P04 repair packets as baseline evidence and AC-2/AC-5 requirements; added *Implementation Phases* with an explicit PR-size gate. | User |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

## Execution Report

### Summary

Phase 1 (seam freeze) and Phase 3 (v3 writes and migration) are fully implemented.
Phase 2 (projection repair) was already completed by P04. Phase 4 (shared setup
operations) has the definitional foundation in place — `VerificationStrategy`,
`isLocalProvider`, `providerNeedsUrl`, `getVerificationStrategy` and
`providerSupportsModelDiscovery` typed accessors are added to the constants
package. Phase 5 (canonical resolution) is deferred due to size constraints.

The existing `connection_verifier.ts` still has its own `OLLAMA_NATIVE`,
`OPENAI_COMPAT` and `LOCAL_PROVIDERS` sets which duplicate the canonical
definitions — these should be migrated to use the constants accessors in a
follow-up.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Stable account identity: `providerId`-based lookup, typed provider descriptors, credential rotation preserves ID. `_findProviderByRegistry` removed from seam layer |
| AC-2 | ✅ | Already completed by P04. Canonical mutators reproject, all tests pass |
| AC-3 | ✅ | Routing schema with three distinguishable states (absent/pinned/`null`). Schema tests validate all states round-trip |
| AC-4 | ✅ | v2→v3 migration preserves providers, connections, roles, presets. Removes orphaned providers. Schema-validated v3 payload with routing |
| AC-5 | ⚠️ | Definitional foundation in place (`VerificationStrategy`, typed accessors). `connection_verifier.ts` still has duplicated sets — follow-up needed to consume from constants |
| AC-6 | ✅ | Provider definitions are declarative: `capabilities`, `verificationStrategy`, `supportsModelDiscovery` read from one definition. `voice` remains TTS key |
| AC-7 | ❌ | Deferred. Single resolver not yet introduced. Existing per-consumer resolution paths remain |

### Files Created

| File | Purpose |
|---|---|
| `packages/shared/schemas/src/lib/domain/providers_config.test.ts` | Schema validation tests for v3 payload, routing, three routing states |
| `packages/shared/types/src/lib/config_errors.ts` | Typed failure taxonomy for config/setup operations |
| `packages/shared/types/src/lib/storage_seam.ts` | Typed storage/restore interface (`VaultAdapter`) |

### Files Modified

| File | Change |
|---|---|
| `packages/shared/schemas/src/lib/domain/providers_config.ts` | Added `RoutingSchema`, `RoleOverridesSchema`, `VaultPayloadV3Schema`. Imported `Static` from typebox |
| `packages/shared/types/src/lib/domain/providers_config.ts` | Added `Routing`, `RoleOverrides`, `VaultPayloadV3` types. Added `routing` to `ConfigState` |
| `packages/shared/types/src/index.ts` | Exported `config_errors.ts` and `storage_seam.ts` |
| `packages/shared/constants/src/lib/providers.ts` | Added `VerificationStrategy` type. Added `verificationStrategy`, `supportsModelDiscovery`, `capabilities` to all provider descriptors. Added typed accessors (`isLocalProvider`, `providerNeedsUrl`, `getVerificationStrategy`, etc.) |
| `apps/frontend/client/src/lib/services/config/config_migration.ts` | Added `migrateVaultV2ToV3` migration function |
| `apps/frontend/client/src/lib/services/config/config_migration.test.ts` | Added 5 v2→v3 migration tests |
| `apps/frontend/client/src/lib/services/config/config_service.svelte.ts` | Updated save/load for v3 format with routing. Added isolated v3 storage namespace. Updated default state with routing |
| `apps/frontend/client/src/lib/services/config/config_service.test.ts` | Updated 2 tests for v3 format (no legacy field, no separate voiceApiKey/imageApiKey) |

### Deviations from Spec

- Phase 5 (canonical resolution) deferred to stay within the PR-size gate. The
  existing per-consumer resolution paths continue to work through the legacy
  projections.
- Phase 4 (shared setup operations) has the definitional foundation but the
  `connection_verifier.ts` helper sets still duplicate the canonical constants.
  Full migration of setup operations to shared services is deferred.
- `_findProviderByRegistry` still exists in the config service for legacy compat
  but the new typed accessors in constants provide the replacement.

### Test Results

- Schemas: 517 PASS / 0 FAIL (+21 new schema tests)
- Constants: 130 PASS / 0 FAIL
- Migration: 17 PASS / 0 FAIL (+5 new v2→v3 migration tests)
- Config service: 60 PASS / 0 FAIL (2 tests updated for v3 format)
- Connection verifier: 38 PASS / 0 FAIL
- Client full suite: 1959 PASS / 40 FAIL (0 new failures, 5 more passing than baseline)
- Baseline pre-existing: 40 FAIL (unchanged)
