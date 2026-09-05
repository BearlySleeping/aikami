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

## Metadata
| Field | Value |
|---|---|
| **Source** | User-approved AI setup direction; [execution plan](../plans/ai-setup/README.md) |
| **Target** | Shared schemas/types/constants, frontend AI gateway and client configuration/setup services |
| **Type** | full |
| **Priority** | P0 — prevent configuration divergence before new UX |
| **Dependencies** | C-463/C-465 implementation; queue P03/P04 repairs; no dependency on C-482 implementation |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | Update `apps/frontend/docs/src/content/docs/` connection/settings guidance at integration |
| **Contract version** | 1.1.0 |

## Problem & Baseline Evidence
Initial research used `3bb9af3b`; source review at `acb7a18e` confirms two live views: `config_service.svelte.ts` provider/connection/role mutators omit projection refreshes, while `capability_view_model.svelte.ts` reads legacy arrays. Reproduce add-second/edit/delete before reload against real state; P04 repairs this without introducing v3.
Provider locality, required URL/key rules and role sets are repeated; `ai_settings_view_model.svelte.ts` owns HTTP/model-listing rules and its registry-only lookup conflates endpoints/accounts. Gateway mode resolution and text/image/TTS services also select parts of a request independently.
Migration is not already safe: `config_migration.ts` uses partial checks, first-row routing fallbacks and registry/model-only deduplication of legacy `models[]`; `config_service.load()` casts v2 data and absorbs rows stored only in `legacy`. `crypto_vault.decrypt()` may rewrite legacy encryption during a read and cannot distinguish missing from locked/corrupt data; `config_service.save()` does not retain the supplied PIN and writes vault/plain settings separately.
Baseline: run current config/capability/settings and gateway tests during P00; record actual failures and recheck the accepted baseline before P05. This approval is source review, not test/implementation verification; historical counts and identity-rune mocks do not prove reactive correctness.

## User Outcome
A player configures an account/server once, uses different models for different features, and sees the same selected configuration during setup, settings and gameplay after reload.

## Success Measures
No AI discovery, verification or inference requests on configuration load or settings mount; no duplicate persisted credential per model. Vault unlock/load may be asynchronous, but configuration reads and route resolution are synchronous and network-free afterward. One resolver determines each generation request's effective configuration; text is required for AI gameplay, not for booting the app shell or opening settings.

## Existing System & Reuse Map
| Existing source | Treatment |
|---|---|
| `packages/shared/schemas/src/lib/domain/providers_config.ts` and inferred types | Versioned schemas and capability-discriminated connections; retain provider/connection identity |
| `packages/shared/constants/src/lib/providers.ts` | Canonical capability/provider metadata, not duplicated ViewModel sets |
| `apps/frontend/client/src/lib/services/config/config_service.svelte.ts` and `config_migration.ts` | Sole validated mutation/persistence boundary; pure migration and read-only legacy projections |
| `apps/frontend/client/src/lib/views/utils/crypto_vault.ts` | Reuse encryption; separate read/decrypt from writes, preserve unlock mode and add recoverable versioned storage |
| `packages/frontend/ai-gateway/` and client AI services | Reuse protocol adapters, cancellation and typed errors; shared setup operations and effective routing |

## Architecture Directives
Definitions describe protocol/auth/model discovery and supported capabilities; instances describe endpoint/account identity. Protocol name must not imply locality or ownership. Select/reuse an account by stable `providerId`, never the first registry-ID match; credential rotation preserves that ID. Distinct endpoints/accounts remain distinct even with the same registry ID. Cross-capability aliases may share an explicitly selected compatible account, never merge automatically by label, model or key alone.
Keep `voice` as the existing TTS key. Required text, optional image/voice and role-to-capability mapping are declarative. STT/music/ambience/video remain unsupported design cases. Registry tests distinguish usable definitions from label-only stubs: every advertised operation needs schema, adapter and host/transport support; unsupported operations return typed unavailability, never default to text.
Local/cloud/LAN location, native/container/browser execution and app/external ownership are independent facts and may be unknown. Unknown legacy ownership defaults to external; discovery never grants lifecycle control. C-481 exposes only optional C-482 runtime references and capability seams, not installation inventories/jobs or process control.
Shared setup services own endpoint validation, credential reuse, model discovery, verification and applying configuration; ViewModels own drafts/presentation only. Keep wire schemas/types/constants in shared packages, protocol operations in the existing gateway layer, and vault/config orchestration in client services; no app imports from shared packages or speculative new framework. Reuse existing injected transports/error types and cancellation.
Resolve once per request into a capability-discriminated provider/connection/model/endpoint/params snapshot, with credentials supplied only to the transport. All generation consumers use it; do not independently look up a key by registry ID or fall back to environment/localStorage/first-row selections. Existing explicit per-agent/request connection overrides remain supported through the same validation boundary without redesigning agent pipelines; absent overrides inherit, invalid explicit overrides fail closed.

## State & Data Models
Retain `AiProvider` (single credential owner) and `AiConnection` (provider reference, model, capability-discriminated params). Enforce the discriminator in the schema, not an unrelated capability enum plus params union. V3 persists `schemaVersion: 3`, `providers`, canonical `connections`, `routing` and preserved user AI options/presets; no writable duplicate legacy payload or standalone voice/image key store.
Canonical `routing: { defaults, overrides }` uses sparse capability defaults and sparse role overrides. An absent override inherits its capability default; a connection ID pins it; `null` explicitly disables that role. A missing default is unavailable. Reset-to-default removes the override; disable writes `null`. Resolve a valid explicit request connection, then the role override/default; an explicit disabled/invalid selection fails closed, never falls through to another account or cloud.
Connection/provider deletion is an explicit atomic operation: remove affected defaults and replace affected pinned role overrides with `null`, unless the user explicitly supplies compatible replacement routes in that same operation. Never delete an override and thereby activate a different default. Changing defaults leaves pinned/disabled overrides intact. Deleting the last connection does not delete its reusable provider/credential; account deletion is separate.
Disambiguate canonical vault `connections: AiConnection[]` from legacy `state.connections: ConnectionEntry[]`. Legacy rows and effective `roles` are read-only projections. `defaultConnectionId`, `defaultByCapability` and `isDefault` project capability defaults, not primary-role overrides; consumers needing a role's actual selection use the resolver. Projections update reactively from the same committed revision and cannot mutate underlying state through exposed objects.
Feature support, reachability, selected-model compatibility and last successful generation remain distinct. Verification results are timestamped, scoped to provider/connection and the tested configuration revision, and invalidated by endpoint/auth/model/relevant-param edits. Persisted historical success is not current readiness; one model's test cannot mark every connection on that provider ready.

## Quality Requirements
Offline/security: no sign-in/cloud boot dependency. Keys remain provider-owned and vault-encrypted at rest, not copied into model records, diagnostics or discovery caches. Validate every request and redirect hop: credential-bearing traffic requires HTTPS and an explicitly approved origin, while HTTP is permitted only for requests with no attached credential. Preserve meaningful paths/ports, reject URL user-info credentials, and never forward API keys or auth headers across an unencrypted or unapproved redirect. Keyless local/LAN endpoints work, while optional auth is supported without deriving requirements from locality. Do not weaken browser CORS/mixed-content/CSP or native permission policies to make a test pass.
Persistence: schema-validate versioned loads and full mutation candidates, including unique IDs, provider references, capability/params/route compatibility. Structurally valid saved definitions whose adapters are unsupported remain stored but resolve unavailable, rather than failing the entire vault load. Stage drafts separately; publish committed state/projections only after successful persistence. Serialize saves and detect stale revisions, including overlapping instances/tabs, so late encryption completions cannot clobber newer edits. Failure retains the last committed state and recoverable draft. Accessibility belongs to consuming contracts.
Setup operations require an explicit action, deadlines and caller cancellation. Stale responses cannot overwrite a newer draft or mark a changed configuration verified. Model discovery failure/unsupported listing still permits a manual model ID when the adapter supports it; saving unverified configuration is allowed and never marked ready. Health/auth checks and model listing are not inference proof; paid tests/previews or private prompt transmission require explicit informed consent. No background scans or generation on mount.
Redacted typed failures distinguish not-configured/unsupported, invalid config, auth, transport/timeout, cancelled, stale result, locked/corrupt/unsupported-version vault and persistence conflict/failure. Redact before logging or building user-visible errors; do not expose raw provider response bodies or full secret-bearing URLs.

## Migration & Rollback
Read/decrypt without rewriting storage. Distinguish a genuinely absent vault from wrong PIN/corruption/unknown version; only absence permits fresh initialization. Other failures expose recovery and block autosave, never publish an empty replacement. Validate historical inputs with version-appropriate schemas, normalize v1 -> v2 -> v3 in memory, then validate the complete v3 candidate. Reuse migration transformations only after removing unsafe casts, silent row pruning and first-row routing fallbacks; unknown future versions never enter the v1 path.
Support deployed v2 payloads with canonical rows plus rows stored only in `legacy.connections`; absorb missing IDs once and preserve canonical rows/explicit assignments on overlap. Legacy `models[]` identity includes endpoint/account context, not just registry/model. Do not attach standalone voice/image keys to a guessed provider; retain ambiguous credentials in the encrypted recovery snapshot without activating them. Preserve stable existing IDs, user presets, voice archetypes, image options and non-AI settings; define/test existing option precedence before removing readers.
For v1, honor explicit capability defaults (including null), then the text `defaultConnectionId` when that capability entry is absent, then a unique `isDefault` row when no explicit default exists; otherwise leave unset. Dangling/cross-capability explicit selections fail migration with recovery, not substitution. For normalized v2, map valid primary roles (`narration`, `portrait`, `narrator-voice`) to capability defaults and preserve every explicit role as an override, even when equal to its default. Mark previously unassigned roles `null` where a new default would otherwise activate them. Never infer intentional inheritance from equal legacy values.
Retain a recoverable encrypted pre-upgrade snapshot and its unlock requirements before any format/key rewrite; preserve custom-PIN protection and keep the recovery copy outside the active payload. Backup/quota/encryption/write failure aborts migration without changing the original. Commit all AI configuration/options in one versioned encrypted record (or an equivalently recoverable transaction), not independent vault/plain writes; leave unrelated plain settings untouched. Only remove legacy cleartext credentials after their encrypted replacement is durable, with retry-safe cleanup.
Use an isolated v3 storage namespace so older binaries cannot parse/overwrite it via their unversioned vault key. Once v3 exists, never silently re-import a legacy copy or fall back to it when v3 fails to load. Rollback explicitly restores the pre-upgrade snapshot with confirmation that later changes are lost; no automatic downgrade, dual writes or automatic recovery-copy deletion. A UI rollback may use read-only projections. P05 must freeze storage/restore seams, including PIN/key handling and crash/retry behavior, before P06 activates writes.

## Scope Boundaries
In scope: canonical configuration/routing, validated recoverable migration, definitions/identity, shared setup/verification operations and integration of existing text/image/TTS consumers, including their existing explicit connection overrides. Out: installation executors/catalog jobs, full UI redesign, new provider integrations or inference capabilities, cloud trial, save-game migration or agent-pipeline redesign. P05 freezes only C-481-owned seams needed by C-482, not C-482's implementation.

## Contract Size & Split Rule
Use queue P05–P08, splitting review-sized slices as necessary. Each intermediate main must work. P05 adds tested schema/API seams without activating v3; P06 may enable v3 only with complete validated writes and read-only compatibility adapters for all still-live consumers. Temporary legacy mutation methods must translate into the canonical transaction, never write a second store; P08 removes them after call-site coverage. See [split rule](SHARED_SECTIONS.md#contract-size--split-rule).

## Acceptance Criteria
| AC | Given / When / Then | Required evidence |
|---|---|---|
| AC-1 | Given two models on one account, two accounts at one endpoint and a second endpoint, when reused/edited/rotated/reloaded, then stable provider identity selects only the intended credential and deleting its last model retains the account. | Real persistence fixtures; settings integration; explicit compatible cross-capability reuse and ambiguous-account cases |
| AC-2 | Given provider/connection/route mutations, when consumers read before/after commit and reload, then canonical state and read-only projections agree; failed/stale saves do not publish or overwrite state. | Add/edit/delete/default/override matrix; compiled Svelte or production-route reactivity test; overlapping-save/instance conflict and mutation-through-getter tests |
| AC-3 | Given v1/v2/v3, mixed legacy rows, locked/corrupt/future vaults and failing storage, when loaded/migrated/restored, then IDs and explicit routing/options survive, retries are idempotent and original data/PIN protection remain recoverable. | Synthetic encrypted fixtures, real vault adapter plus injected fault tests: backup/quota/encryption/write/cleanup/crash; old-binary storage isolation and confirmed restore; no real keys |
| AC-4 | Given defaults, inherited/pinned/disabled roles and explicit request overrides, when defaults change or a referenced connection/provider is removed, then compatible intent survives and no silent account substitution occurs. | Resolver matrix for text/image/voice: default differs from primary-role override, null vs absent, reset vs disable, local override deleted with cloud default, invalid/dangling/cross-capability cases |
| AC-5 | Given local/cloud/LAN instances and a supported manual model, when explicitly listing/testing/saving, then only the selected endpoint/auth/transport is used, unverified saves remain usable and readiness is scoped to what was tested. | Keyless/optional-auth/unsupported-listing/auth-error/deadline/abort/stale-edit tests; consent and secret-redaction checks; no credential forwarding on changed endpoint/redirect |
| AC-6 | Given unsupported/future definitions or a browser host, when computing actions, then unsupported jobs/native controls are absent while compatible browser/server paths remain and app boot/settings work without text configuration. | Definition/schema/adapter/host completeness tests; `/capability` and `/settings` E2E; no AI requests or native IPC on mount |
| AC-7 | Given mixed text/image/TTS assignments and legacy environment/localStorage selections, when generating before/after reload or a concurrent edit, then each request uses one canonical snapshot with the matching model, endpoint, auth and params, without fallback. | Gateway plus real consumer integration with recording transports for narration/dialogue, portrait/scene and narrator/NPC voice; existing per-agent override regression |

## Implementation Sequence
P05 freezes definitions, resolver semantics, migration fixture/precedence table and transaction/restore/runtime-reference seams; P06 implements migration plus complete canonical writes; P07 shares setup operations; P08 cuts generation consumers over and removes writable compatibility paths. Queue P03/P04 and the P05 seam review remain execution gates despite contract approval. Confirm task IDs, run `client:test` and affected shared/gateway tests via Moon, then detect affected projects and run `validate({ test: true })`; use POM E2E and visual evidence for changed production surfaces. Test storage faults against the vault boundary, not only mocked encrypt/decrypt, and use recording/mock inference transports unless a real/paid test is separately authorized.

## Edge Cases & Gotchas
Model IDs are provider/endpoint-scoped, not globally unique. Registry entries such as `openai` span capabilities while aliases such as `dalle` need explicit compatibility mapping. Credentials are not stable account IDs. `source: detected` or `localhost` proves neither ownership nor readiness. Never let a legacy projection/default picker reactivate an unavailable route. Migration must not drop unreferenced credential-only accounts, custom options or rows merely because a capability/adapter is currently unsupported; preserve them for recovery without advertising generation support.

## Open Questions
None delegated as product decisions. Approval covers v3 defaults plus pinned/disabled overrides, explicit provider identity, isolated recoverable persistence and fail-closed routing. P05 reviews the concrete schemas/APIs and fixture evidence within these constraints; materially different semantics, lost historical data or additional scope require an amendment before execution.

## Amendments
- **1.1.0 — review and approval:** At the user's request, tightened provider identity, discriminated schemas, role disable/deletion semantics, single-request resolution, migration/PIN/storage isolation, setup consent/cancellation and acceptance evidence against `acb7a18e`; set frontmatter and metadata to `approved`. Approval authorizes this specification, not implementation completion, paid inference, commits, PRs or deployment. Future scope/AC changes require a version bump and user approval.

## Promotion Lifecycle
See [shared promotion rules](SHARED_SECTIONS.md#promotion-lifecycle).
## Status Lifecycle
See [shared status rules](SHARED_SECTIONS.md#status-lifecycle). Append an execution report only after implementation; partial PRs do not complete this contract.
