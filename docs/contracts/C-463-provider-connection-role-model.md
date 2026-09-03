---
id: C-463
title: "Provider, Connection, and Role — one model for AI configuration"
source: "Settings teardown review, 2026-09-03. Follow-up to PRs #233/#234/#235, which removed the dead provider-configuration surface and fixed the per-capability default bugs. C-462 is claimed by 'Client-Side R2 Save Backup & Restore'; C-463 is the next free ID."
contract_type: full
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-03"
---

# Contract C-463: Provider, Connection, and Role — one model for AI configuration

## Metadata

| Field | Value |
|---|---|
| **Source** | Settings teardown review, 2026-09-03; supersedes the connection model from C-230 |
| **Target** | `packages/shared/types/src/lib/domain/` — the three types; `packages/shared/schemas/` — their TypeBox schemas; `apps/frontend/client/src/lib/services/config/` — migration and resolution |
| **Type** | full |
| **Priority** | P1 — blocks the settings-shell, AI-section, and three-mounts contracts; every one of them needs this shape fixed first |
| **Dependencies** | C-230 (connection model, superseded here), C-318 (capability screen), PRs #233/#234/#235 (already merged) |
| **Status** | approved |
| **Promotion** | `integrated` |
| **Docs Impact** | internal → none. The user-facing AI settings page is a later contract. |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: `Connection` (`packages/shared/types/src/lib/domain/providers_config.ts`,
  `ConnectionEntry`) conflates two unrelated facts — *where the credentials live*
  (`provider`, `apiKey`, `baseUrl`) and *what gets generated* (`model`,
  `generationParams`, `imageOptions`, `voiceOptions`). A user who wants Claude Sonnet
  for narration and Claude Haiku for summarisation must create two connections and
  paste the same OpenRouter key into both. Rotating that key is then two edits, and
  there is nothing in the model that knows the two rows share an account.

- **Reproduction**: Settings → Connections → Add Connection. Create
  `OpenRouter / claude-sonnet-4.5`, then a second `OpenRouter / claude-haiku-4.5`. The
  API key field starts empty the second time; the key must be pasted again. Edit the
  key on one row and the other keeps the stale value.

- **Existing implementation to reuse**:
  - `apps/frontend/client/src/lib/services/config/config_service.svelte.ts` — the
    connection CRUD, `defaultByCapability` bookkeeping and the vault load/save split
    are all correct as of PR #235 and are the scaffolding this contract reshapes.
  - `apps/frontend/client/src/lib/views/utils/crypto_vault.ts` — `encrypt` / `decrypt`.
  - The `load()` connection-pruning filter is the existing precedent for reshaping
    persisted data on read.
  - `apps/frontend/client/src/lib/views/agent/editor/agent_editor_view_model.svelte.ts`
    (`connectionOptions`) — agents already select a connection per agent. That is
    role assignment in miniature and the new model must keep it working.

- **Known gaps**:
  - No object represents a credential, so `connection_manager_view_model` hand-rolls
    one: `_providerCache` caches `{apiKey, model}` per provider id in a transient
    field that `openCreate()` wipes, and `_getFallbackApiKey()` re-derives a key by
    scanning connections. Roughly 120 lines exist only to simulate the missing type.
  - `defaultByCapability` gives exactly **one** default per capability. There is no
    way to say "cheap model for summarisation, good model for narration", which is
    what the removed `auxiliaryModels` field was reaching for before it was left
    unread.
  - `agent_editor_view_model.connectionOptions` lists **every** connection regardless
    of capability, so an agent can be pointed at a Kokoro voice connection for a text
    task.
  - The vault payload has no version field, so any future reshape has to guess at
    what it is reading.

- **Baseline tests** (run before starting; all green on `main`):
  - `apps/frontend/client/src/lib/services/config/config_service.test.ts` — 45 tests.
  - `apps/frontend/client/src/lib/views/capability/capability_view_model.test.ts`.
  - Full client suite: `bun run test:unit` → 1813 pass / 31 fail. Those 31 are
    pre-existing and unrelated (InventoryService, GmPromptService, ImageViewModel,
    GameCanvasViewModel, EndSessionViewModel). Do not attempt to fix them here.

## User Outcome

After this contract, a player can paste one OpenRouter key and use three different
models from it, rotate that key in one place, and have the game use a cheap model for
background work and a strong one for narration — without the settings UI changing
shape yet.

## Success Measures

- **Time/latency target**: no measurable change. Resolution stays a synchronous
  in-memory lookup; `getActiveTextProvider()` must not become async.
- **Offline/degraded behavior**: unchanged. Configuration is local-only; no cloud call
  is introduced. The game must still boot and play with zero providers configured.
- **Production journey enabled**: `/capability` → add a provider → start a campaign
  continues to work identically, and per-role model assignment becomes expressible.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Connection CRUD + default bookkeeping | `config_service.svelte.ts` | modify — same invariant discipline, new shape |
| Encrypted vault | `views/utils/crypto_vault.ts` | reuse unchanged |
| Versioned reshape on read | `config_service.load()` pruning filter | modify — becomes a real versioned migration |
| Text routing | `config_service.getActiveTextProvider()` | modify — resolves through a role |
| Per-capability default | `state.defaultByCapability` | replace — becomes `RoleAssignments` |
| Provider registries | `packages/shared/constants/src/lib/providers.ts` | reuse unchanged |
| Per-agent connection override | `agent_editor_view_model.connectionOptions` | modify — filter by capability |
| Credential caching in the editor | `_providerCache`, `_getFallbackApiKey` | replace — deleted, the model makes them unnecessary |

## Overview

Split today's `Connection` into three objects with one job each: an `AiProvider`
holding a credential and host, an `AiConnection` naming a model on that provider, and
a `RoleAssignments` map saying which connection the game uses for which job. Migrate
existing vaults into the new shape behind a version field, and route
`getActiveTextProvider()` through a role. **No user-visible UI change** beyond what the
rename forces — the settings surface is rebuilt in a later contract.

## Design Reference

- Follow the vault/plain split already in `config_service.save()`: anything holding a
  credential goes through `encrypt()`, everything else into `PLAIN_CONFIG_KEY`.
- Follow `PresetEntry` (`providers_config.ts`) for the shape of a persisted, id-keyed
  record with built-in and user-defined instances.
- Follow the invariant-comment style introduced in PR #235 above the private default
  helpers: state the single source of truth, then say what is derived from it.
- TypeBox schemas belong in `packages/shared/schemas/`, derived types in
  `packages/shared/types/` — never inline in `apps/**` (`.claude/CLAUDE.md`).

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- The three types and their schemas live in `packages/shared/`; the client imports them
  from `@aikami/types` / `@aikami/schemas` package roots, never from `lib/` sub-paths.
- Migration runs exactly once per vault, inside `configService.load()`, keyed off a
  `schemaVersion` field. It is pure with respect to its input: given the same v1
  payload it must produce the same v2 payload.
- Resolution helpers (`resolveRole`, `getActiveTextProvider`) stay synchronous and
  side-effect free. They read state; they never write or heal it. Healing belongs in
  `load()` and in the CRUD methods, as it does today.
- `AiProvider.credential` is the only place an API key is stored. `AiConnection` must
  not carry a credential field — the absence should be enforced by the type, so a
  future contributor cannot reintroduce the copy.
- Keep `ConnectionCapability` (`'text' | 'image' | 'voice'`) as the existing union.
  Roles are a separate, finer-grained union that maps onto it.

## State & Data Models

```ts
// packages/shared/types — one credential + host. Created once per account.
type AiProvider = {
  id: ProviderId;
  /** Key into TEXT_PROVIDERS / VOICE_PROVIDERS / IMAGE_PROVIDERS. */
  registryId: string;
  /** User-facing name, defaulted from the registry label. */
  label: string;
  /** Vault-encrypted. Absent for keyless local providers. */
  credential?: string;
  /** Required iff the registry entry sets needsUrl. */
  baseUrl?: string;
  /** How this provider was sourced — drives the badge, as ConnectionSource does today. */
  source: 'env' | 'stored' | 'detected';
  /** Result of the last explicit Test, for the health dot. Never auto-probed. */
  lastVerifiedAt?: string;
};

// A usable configuration. MANY per provider.
type AiConnection = {
  id: ConnectionId;
  providerId: ProviderId;
  capability: ConnectionCapability; // 'text' | 'image' | 'voice'
  label: string;
  model: string;
  /** Discriminated on capability. No credential field — that lives on the provider. */
  params: TextParams | ImageParams | VoiceParams;
  createdAt: string;
  updatedAt: string;
};

// What the game uses a connection FOR. Replaces defaultByCapability.
type AiRole =
  | 'narration' | 'dialogue' | 'summarization' | 'structured'  // text
  | 'portrait' | 'scene'                                        // image
  | 'narrator-voice' | 'npc-voice';                             // voice

type RoleAssignments = Partial<Record<AiRole, ConnectionId>>;
```

Assignments are **global**, not per-campaign (OQ-2, decided). `RoleAssignments` is a
plain map, so scoping it to a campaign later is an additive change rather than a
reshape.

`TextParams` carries the existing `generationParams` fields; `ImageParams` and
`VoiceParams` carry today's `imageOptions` / `voiceOptions` fields. They are moved,
not redesigned — wiring them to the runtime is a later contract.

Persisted vault payload:

```jsonc
{
  "schemaVersion": 2,
  "providers": [ /* AiProvider[], credentials included */ ],
  "connections": [ /* AiConnection[] */ ],
  "roles": { "narration": "conn-id", "npc-voice": "conn-id" },
  "userPresets": [ /* unchanged */ ],
  "legacy": { /* verbatim v1 payload, one release only — see Migration */ }
}
```

## Quality Requirements

- **Offline/degraded mode**: unchanged. No network call is added. With zero providers,
  `getActiveTextProvider()` throws the same typed error it does today and the
  capability gate behaves identically.
- **Accessibility/input**: N/A — no UI in this contract.
- **Performance budget**: resolution stays O(n) over a list that is realistically under
  20 entries, synchronous, on the existing hot path. No added allocation per request.
- **Security/privacy**: credentials appear in the vault payload only. A grep of the
  plain `aikami_config` blob after `save()` must not contain any credential — assert
  it, as PR #235 does for the voice/image keys. Credentials must never be logged, and
  `debug()` calls that echo a provider must redact them.
- **Persistence/migration**: the whole point. See below.
- **Cancellation/retry/idempotency**: migration must be idempotent — running `load()`
  twice, or loading an already-v2 vault, is a no-op.
- **Observability**: log one line on migration with counts only
  (`{ providersCreated, connectionsMigrated, modelRowsConverted, rolesSeeded }`) —
  never contents.
- **Honest staleness**: `lastVerifiedAt` persists across reloads (OQ-3, decided), so
  any surface rendering it must phrase it as "last checked {time}" and never as
  current truth — a key revoked an hour ago still has a recent timestamp.

## Migration & Rollback

- **Old data compatibility**: a vault with no `schemaVersion` is v1. Read it with the
  current shape, migrate in memory, and serve the session from the v2 shape. The user
  must not be asked anything.

- **Migration** — group and seed:
  1. Group v1 `connections[]` by `(provider, baseUrl ?? '', apiKey ?? '')`. Each
     distinct triple becomes one `AiProvider`. Two rows with the same provider id but
     different keys are two accounts and must **not** be merged.
  2. Every v1 connection becomes one `AiConnection` pointing at its group's provider,
     carrying `model` and its params.
  3. Seed `roles` from `defaultByCapability` — the text default fills `narration`,
     `dialogue`, `summarization` and `structured`; the image default fills `portrait`
     and `scene`; the voice default fills `narrator-voice` and `npc-voice`. Where
     `defaultByCapability` is empty, fall back to the first connection of that
     capability, matching what `load()` already backfills today.
  4. Carry `source` from the v1 connection onto the provider. Where rows in one group
     disagree, prefer `stored` over `env` over `detected`.
  5. Move the standalone `voiceApiKey` / `imageApiKey` (added in PR #235) onto the
     matching voice/image provider, or into a new provider if none matches.
  6. Convert each `models[]` row into a text `AiConnection`. Attach it to the provider
     matching `(row.provider, row.endpoint, '')`, creating a keyless one if none
     exists. Skip rows whose `(provider, model)` pair a migrated connection already
     covers — those are duplicates of the same choice, not a second configuration.

- **Rollback**: write the untouched v1 payload under `legacy` in the v2 vault, and keep
  writing it for **exactly one tagged release** (OQ-4, decided) — record that tag in
  the Amendments table when it ships, so the follow-up removal is unambiguous. Rolling back the app then finds a vault whose top level
  it cannot parse but whose `legacy` key it can — so the pre-C-463 build must be able
  to fall back to `legacy` when the top-level shape is unrecognised. **That fallback
  read is part of this contract** and must be added even though it only benefits a
  build that predates it: ship it, tag a release, then the next contract may drop it.

- **Feature flag or kill switch**: none. A half-applied model is worse than either
  side of it, and the `legacy` payload is the recovery path.

- **Failure recovery**: if migration throws, log, leave the vault **unwritten**, and
  fall back to an empty in-memory v2 state so the app still boots. Never write a
  partially-migrated vault — a truncated write is how keys get lost.

## Scope Boundaries

- **In Scope:**
  - The three types + TypeBox schemas in `packages/shared/`.
  - Versioned vault payload, migration, `legacy` rollback key, and the fallback read.
  - `configService` CRUD reshaped onto providers/connections/roles, preserving the
    invariant discipline from PR #235.
  - `getActiveTextProvider()` resolving through the `narration` role.
  - Compile-level updates to the 11 existing consumers, and deleting
    `_providerCache` / `_getFallbackApiKey` from `connection_manager_view_model`.
  - Capability-filtering `agent_editor_view_model.connectionOptions`.
  - **Retiring `models` / `ModelConfigEntry`** (OQ-1, decided): migrate its rows into
    `AiConnection`s and delete the field, replacing the `_resolveTextRouting()` lookup
    with a lookup over text connections.

- **Out of Scope:**
  - **Any settings UI redesign.** The provider tree, status board and role drawer are
    a later contract. `connections_list_view` and `connection_editor_panel` change only
    as much as compiling requires.
  - Wiring `params` to the runtime. Generation parameters, voice archetypes and image
    sizes are still not read by the gateway; making them live is a later contract and
    doing it here would hide a behaviour change inside a migration.
  - `VOICE_PROVIDERS` / `IMAGE_PROVIDERS` registry corrections.
  - Anything under `src-tauri/`, `apps/backend/**`, or `scripts/**`.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** one contract, deliberately. The types, the migration and the
resolution path share a single invariant — that a credential lives in exactly one
place — and none of the three is independently useful. Splitting "add the types" from
"migrate onto them" is precisely the second split-rule failure mode: it leaves two
competing models live in a repo that already suffered from exactly that (three
config planes, of which the settings UI wrote to two and the runtime read a third).
The UI rebuild *is* split out, because it is independently mergeable once this lands.

## Acceptance Criteria

### AC-1: One credential, many models
**Given** a provider with a stored credential and two connections referencing it
**When** the connections are read back
**Then** neither `AiConnection` carries a credential field, both resolve to the same
`AiProvider`, and the credential appears exactly once in the persisted vault.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `config_service.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: N/A
- E2E / Visual: N/A

**Watch Points**:
- The absence of a credential on `AiConnection` should be a type-level guarantee, not
  a convention — a contributor must not be able to add one back without changing the
  shared type.

### AC-2: Rotating a credential updates every connection that uses it
**Given** one provider with three connections
**When** the provider's credential is changed
**Then** all three connections issue requests with the new credential, and no stale
copy of the old one remains anywhere in the persisted state.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `config_service.test.ts` | N/A | Filled during verification |

**Watch Points**:
- Assert on the serialised vault string, not just in-memory state — the old bug was a
  copy that only showed up after a round trip.

### AC-3: Text routing resolves through a role
**Given** a `narration` role assigned to a specific text connection, and other text
connections present
**When** `getActiveTextProvider()` is called
**Then** it returns that connection's provider, model, endpoint and credential —
regardless of insertion order and regardless of which image/voice roles are assigned.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `config_service.test.ts` | `/game` | Filled during verification |

**Watch Points**:
- The per-capability regression tests added in PR #235 must be ported to roles, not
  deleted. They encode the bug this shape is meant to make unrepresentable.

### AC-4: Migration from a v1 vault is lossless
**Given** a v1 vault fixture containing two OpenRouter connections sharing a key, one
with a different key, one keyless Ollama connection, a voice connection, and a
populated `defaultByCapability`
**When** `load()` runs
**Then** three providers exist (two OpenRouter accounts, one Ollama), every model and
param value survives, every credential survives, and the seeded roles resolve to the
same connections the v1 defaults did.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `config_service_migration.test.ts` (new) | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: one fixture file per prior shape, committed under a `__fixtures__`
  directory next to the test.

**Watch Points**:
- Two connections with the same provider id and *different* keys must produce two
  providers. Merging them silently re-keys one of the user's accounts.
- A v1 connection with `source: 'detected'` is still subject to the existing pruning
  filter. Prune first, then migrate, or a pruned row resurrects as a provider.

### AC-5: Migration is versioned and idempotent
**Given** an already-migrated v2 vault
**When** `load()` runs twice
**Then** no migration is attempted, no provider is duplicated, and the second load
produces state deep-equal to the first.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | `config_service_migration.test.ts` | N/A | Filled during verification |

### AC-6: A failed migration never writes a partial vault
**Given** a v1 vault whose payload is malformed part-way through
**When** `load()` runs
**Then** the app boots with empty in-memory configuration, the stored vault is left
byte-identical, and one warning is logged with no credential in it.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Unit | `config_service_migration.test.ts` | N/A | Filled during verification |

**Watch Points**:
- This is the AC that protects against data loss. Write it before the happy path.

### AC-7: Credentials never reach plain storage
**Given** providers with credentials and voice/image keys
**When** `save()` completes
**Then** the `aikami_config` localStorage value contains none of them, and the vault
payload contains each exactly once.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-7 | Unit | `config_service.test.ts` | N/A | Filled during verification |

### AC-8: An agent can only be pointed at a compatible connection
**Given** text, image and voice connections all exist
**When** the agent editor's connection picker is opened
**Then** only text connections are offered.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-8 | Unit | `agent_editor_view_model.test.ts` | N/A | Filled during verification |

### AC-9: No behavioural regression in the existing surfaces
**Given** the capability screen and the connections list, unchanged in appearance
**When** the existing client suite runs
**Then** 1813+ tests pass and the failing set is exactly the 31 pre-existing failures
named in Baseline Evidence — no additions.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-9 | Unit + E2E | `bun run test:unit`; `apps/e2e/tests/client/settings.spec.ts` | `/capability` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun run fix && bun moon run :validate && bun run test`
- E2E / Visual:
    - **Functional**: `tests/client/settings.spec.ts` unchanged and still green.
    - **Visual**: N/A — no visual change in this contract.

### AC-10: The `models` override path resolves through connections
**Given** a v1 vault holding a `models[]` row for `anthropic/claude-opus-4` on an
endpoint, and a text connection for a different model on the same provider
**When** the vault is migrated and `streamChat({ model: 'anthropic/claude-opus-4' })`
is issued
**Then** `models` no longer exists on `ConfigState`, the row has become a text
`AiConnection` attached to that provider, and routing returns that connection's
provider, endpoint and credential — the same resolution the `models[]` lookup gave
before.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-10 | Unit | `config_service_migration.test.ts`; `ai_gateway_service.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: assert the explicit-model branch of `_resolveTextRouting()` against a
  migrated fixture, not a hand-built state object.

**Watch Points**:
- An unknown explicit model must still fall through to the active provider with the
  model passed verbatim — that branch exists today and callers depend on it.
- A `models[]` row duplicating a connection's `(provider, model)` pair must not create
  a second connection.

## Implementation Sequence

1. **Phase 1 (Types)**: `AiProvider`, `AiConnection`, `AiRole`, `RoleAssignments` and
   the params union in `packages/shared/types`, with TypeBox schemas in
   `packages/shared/schemas`. No client changes yet; `moon run types:build` green.
2. **Phase 2 (Migration, test-first)**: write AC-6 then AC-4 and AC-5 against committed
   v1 fixtures, then implement `migrateVaultV1ToV2` as a pure function. It must be
   unit-testable without `configService`.
3. **Phase 3 (Service)**: reshape `configService` state, CRUD and persistence onto the
   new model; port the PR #235 default-invariant tests to roles; add the `legacy`
   write and the unrecognised-shape fallback read.
4. **Phase 4 (Consumers)**: update the 11 consumers; delete `_providerCache` and
   `_getFallbackApiKey`; filter the agent picker; replace the `state.models` lookup
   in `ai_gateway_service._resolveTextRouting()` with a text-connection lookup and
   drop the field from `ConfigState`.
5. **Phase 5 (Validation)**: `bun run fix && bun moon run :validate && bun run test`;
   confirm the 31-failure baseline is unchanged and the type-safety guard baseline
   still holds at T1=14 T2=4 T3=1.

## Edge Cases & Gotchas

- **Keyless local providers**: Ollama, llama.cpp, ComfyUI and Kokoro have no
  credential. `credential` must be optional, and "no credential" must not be conflated
  with "not configured" — the `_isUsableConnection` logic in `capability_view_model`
  already makes this distinction and must keep working.
- **The same registry id across capabilities**: `openai` appears in both
  `TEXT_PROVIDERS` and `VOICE_PROVIDERS`. Grouping is by `(registryId, baseUrl, key)`
  and providers are capability-agnostic, so one OpenAI provider may legitimately serve
  a text connection and a voice connection. Do not key providers by capability.
- **`novelai`** appears in `IMAGE_PROVIDERS` only, since PR #234 removed the text
  entry. A v1 vault may still hold a text connection on a now-removed provider id;
  migrate it faithfully rather than dropping it, and let it stay visibly broken.
- **Svelte reactivity**: `capability_view_model` runs an `$effect` over
  `configService.state.connections`. PR #235 made `_syncDefaultFlags()` skip the array
  reassignment when nothing changed, specifically to avoid waking it on a no-op. Any
  new reconcile helper must preserve that property or the effect loops.
- **`crypto.randomUUID()` in migration** makes the output non-deterministic, which
  fights AC-5's deep-equal assertion. Inject the id factory so tests can pin it.

## Resolved Decisions

All open questions were resolved by the author on 2026-09-03; the contract is
`approved`. Recorded here rather than deleted, because each one shaped a scope
boundary above.

1. **`models` / `ModelConfigEntry` is retired.** Its rows migrate into text
   `AiConnection`s and the field is deleted. `_resolveTextRouting()`'s explicit-model
   override now looks up a text connection by model, so the override path and the
   connection list stop being two answers to the same question. See Migration step 6
   and AC-10.
2. **Role assignments are global.** No per-campaign override in this contract. The
   type is a plain map, so campaign scoping later is additive.
3. **`lastVerifiedAt` persists.** Rendered as "last checked {time}", never as current
   truth — see Quality Requirements.
4. **`legacy` survives exactly one tagged release.** The tag goes in the Amendments
   table when it ships; a follow-up contract removes the key.

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
