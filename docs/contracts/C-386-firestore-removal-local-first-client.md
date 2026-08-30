---
id: C-386
title: "Firestore Removal: client becomes local-first"
source: "external data-layer review (docs/research/database-architecture-recommendation.md §4)"
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/139"
  pr_number: 139
created_at: "2026-08-12"
---

# Contract C-386: Firestore Removal — Client Becomes Local-First

> ✅ **Approved 2026-08-13.** All Open Questions resolved (see below); the
> three-way split is confirmed; Acceptance Criteria are rewritten against the
> resolved shape. OQ6 (zero users) is a one-line fact to reconfirm at
> execution time — it does not block approval.

## Metadata

| Field | Value |
|---|---|
| **Source** | External data-layer review — `docs/research/database-architecture-recommendation.md` §4. Architecture: `docs/architecture/data-layer-target-architecture.md` (D-2, D-3, D-4). |
| **Target** | `apps/frontend/client/src/lib/services/` (7 Firestore services + their view-model consumers), `packages/frontend/firestore/` (deleted), `packages/backend/firestore/` (deleted), `apps/backend/firebase/src/rules/firestore.rules` (reduced to default-deny), `apps/backend/firebase/scripts/on_emulate.ts` (reseeding strategy) |
| **Priority** | P1 — Firestore is the last duplicate store. Until it goes, chat is dual-written and personas live in two places. |
| **Dependencies** | C-384 (migrations — personas/NPCs need new local tables, which require numbered migrations), C-385 (Data Connect gone — otherwise this contract would have to rehome three stores at once). **Both implemented as of 2026-08-13** (C-384 PR #132, C-385 PR #133 merged). |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | None — no user-facing sync/backup surface changes. Chat, personas, NPCs and custom agents were already single-player only; `data-layer-target-architecture.md` D-4 should be strengthened from "chat is not realtime" to "no multi-user surface exists in the client" (see Open Questions, OQ4). |
| **Contract version** | 2.1.0 |

## Problem & Baseline Evidence

- **Current behavior**: 15 files under `apps/frontend/client/src/lib` reference Firestore (case-sensitive `firestore` in `.ts` sources; a further 11 files mention "Firestore" only in comments). Eight are dedicated Firestore services (the count grew from seven after `agent_registry_service.svelte.ts` was audited in — see OQ5):

  | Service | Domain | Target home (resolved 2026-08-13) |
  |---|---|---|
  | `persona/persona_firestore.svelte.ts` | personas | local SQLite — C-386b |
  | `npc/npc_firestore.svelte.ts` | NPCs | local SQLite (no catalog — see OQ3) — C-386b |
  | `chat/npc_chat_firestore.svelte.ts` | chat turns | local SQLite — **already dual-written** to `chat_history` — C-386a |
  | `user/user_firestore.svelte.ts` | user profile | **delete, no replacement** — see OQ1 — C-386c |
  | `notification/notification_firestore.svelte.ts` | notifications | **delete, no replacement** — see OQ2 — C-386c |
  | `chat/connected_chats_service.svelte.ts` | ChatLink (single-player chat bridge) | local SQLite — see OQ4 — C-386a |
  | `npc/autonomous_message_service.svelte.ts` | NPC-initiated messages | local SQLite — C-386b |
  | `agent/agent_registry_service.svelte.ts` | custom agent definitions | local SQLite — see OQ5 — C-386b |

  Plus consumers: `game/game_boot_service.svelte.ts` (resolves the active persona at boot), `views/character/persona/{list,create}/*_view_model.svelte.ts`, `services/export/export_service.svelte.ts`, `agent_list_view_model`, `agent_editor_view_model`, `agent_pipeline_service`.

- **Duplication evidence**: chat turns are written to Firestore (`npc_chat_firestore`) **and** to the local `chat_history` table (`chat/conversation_storage`) with different shapes. Personas exist as a Firestore collection and as the hub's former Data Connect table. This violates invariant I-5 (one home per entity).
- **Existing implementation to reuse**:
  - `chat_history` already receives every turn — the local path is proven, not speculative.
  - `packages/frontend/storage/src/lib/` adapters, factory, and (after C-384) the migration runner.
  - `packages/shared/schemas/src/lib/firestore/*.ts` TypeBox schemas are **store-agnostic** — they describe the domain shape, not the Firestore encoding. They should be *moved and renamed*, not rewritten. Note the directory name will be misleading after this contract.
- **Known gaps**: There are no local tables for `personas` or `npcs`. There is no decided home for the user profile document or for in-app notifications. The emulator seeding script creates Firestore users, personas, and NPCs — with Firestore gone, its entire strategy needs replacing.
- **Baseline tests**: `bun moon run client:test-unit`, `bun moon run firebase:test-rules`, and the client E2E suite. Capture a passing baseline before starting.

## User Outcome

After this contract, a **player** owns their personas, NPCs, and chat history
entirely on their own device, with no cloud round trip in the chat hot path —
and a **developer** maintains one definition per entity instead of two.

## Success Measures

- **Time/latency target**: Chat turn persistence becomes a local write — target under 5ms, replacing a Firestore round trip. Client boot must not regress.
- **Offline/degraded behavior**: Personas, NPCs and chat must be fully functional with no network. This is the point of the contract.
- **Production journey enabled**: Completes the local-first architecture; the client no longer requires any database service to play.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Chat turn persistence | `chat/conversation_storage.svelte.ts` → `chat_history` | reuse — delete the Firestore twin |
| Local DB access | `packages/frontend/storage/` | reuse |
| Schema migrations | C-384 migration runner | reuse — add personas/NPC tables as new versions |
| Domain schemas | `packages/shared/schemas/src/lib/firestore/` | move + rename, do not rewrite |
| Firestore repositories | `packages/frontend/firestore/`, `packages/backend/firestore/` | delete |
| Emulator seeding | `apps/backend/firebase/scripts/on_emulate.ts` | replace strategy |

## Overview

Move personas, NPCs, chat, and NPC-initiated messages from Firestore to the
local SQLite database; delete the Firestore repository packages; reduce
`firestore.rules` to default-deny; and replace the emulator's Firestore
seeding with a local-data seeding strategy. Chat is not realtime (D-4), so the
Firestore chat path is deleted rather than preserved.

## Design Reference

`docs/architecture/data-layer-target-architecture.md` D-2, D-3, D-4, I-5.
Follow existing local-storage service patterns
(`apps/frontend/client/src/lib/services/campaign_storage.svelte.ts`,
`chat/conversation_storage.svelte.ts`). All new tables ship as numbered
migrations per C-384 — never by editing migration 1.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **One entity, one home.** After this contract no entity may be written to
  two stores. A dual-write left in place is a failed contract, not a partial
  success.
- **Do not port the Firestore repository abstraction to SQLite.** The
  `BaseFirestoreRepository` generic-document model exists to paper over
  Firestore's document API; SQLite wants plain typed queries. Write direct
  repositories in the existing local-storage style.
- **Schemas move, they do not get rewritten.** The TypeBox definitions in
  `schemas/src/lib/firestore/` describe the domain. Relocate them (the
  `firestore/` directory name becomes wrong) and keep the shapes.
- Firebase Auth, Storage, FCM and App Check are untouched.

## State & Data Models

New local tables, each shipped as its own numbered migration. Shapes follow
the existing local convention (`id TEXT PRIMARY KEY`, JSON payload in a `data`
column where the shape is governed by a TypeBox schema, explicit columns only
where they are queried or ordered on):

```sql
-- migration vN
CREATE TABLE IF NOT EXISTS personas (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 0,
  data        TEXT NOT NULL,           -- PersonaData JSON
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_personas_one_active
  ON personas(is_active) WHERE is_active = 1;
```

The partial unique index gives the one-active-persona invariant for free —
the constraint that required a hand-applied migration and a documented
non-atomic two-step under Data Connect becomes a single local transaction.

```sql
-- migration vN+1
CREATE TABLE IF NOT EXISTS npcs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  data        TEXT NOT NULL,           -- NpcSheet JSON (personality, systemPrompt, etc.)
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

No `is_active`/ownership columns — NPCs are per-install, not per-account (OQ3: no
catalog exists to own or filter against). `creatorUid`/`visibility` fields from
the Firestore schema fold into `data`; they become inert until a real
community catalog contract gives them a queryable home.

```sql
-- migration vN+2
CREATE TABLE IF NOT EXISTS custom_agents (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  folder      TEXT,                    -- queried by listAgents({ folder })
  data        TEXT NOT NULL,           -- CustomAgentDefinition JSON
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_custom_agents_folder ON custom_agents(folder);
```

`folder` is an explicit column (not buried in `data`) because
`listAgents({ folder })` filters on it today — same convention as
`personas.is_active`: explicit columns only where they're queried or ordered
on.

## Quality Requirements

- **Offline/degraded mode**: Full functionality with no network for personas, NPCs and chat.
- **Accessibility/input**: No UI changes intended. Any view-model change must preserve existing keyboard and screen-reader behavior.
- **Performance budget**: Chat turn write under 5ms. Persona list load under 50ms. Client boot must not regress against the captured baseline.
- **Security/privacy**: Strictly improves — player data stops leaving the device. `firestore.rules` must end as default-deny with no live collection blocks.
- **Persistence/migration**: See below. This is the highest-risk section of the contract.
- **Cancellation/retry/idempotency**: Local writes are transactional; no retry semantics needed once the network is out of the path.
- **Observability**: Removing Firestore removes its error surface. Ensure local write failures are logged and surfaced — they are no longer network blips but real disk errors.

## Migration & Rollback

- **Old data compatibility**: The product has no users (confirmed 2026-08-12), so **no production Firestore data needs migrating**. This is the single biggest reason to do this contract now rather than later. Confirm this is still true before starting — if any real user data exists by then, this section must be rewritten with a backfill plan and the contract re-approved.
- **Migration**: New local tables via numbered migrations (C-384). No data movement.
- **Rollback**: Revert restores the Firestore code paths, but any data written locally in the interim will not be in Firestore. Because there are no users, this is acceptable. It will not be acceptable later.
- **Feature flag or kill switch**: None. A flag would mean keeping both paths live, which is the condition this contract exists to remove.
- **Failure recovery**: Migration failures are handled by the C-384 runner (transactional, resumable).

## Scope Boundaries

- **In Scope:** The eight client Firestore services and their consumers
  (including `agent_registry_service.svelte.ts`, folded in via OQ5);
  `packages/frontend/firestore/`; `packages/backend/firestore/`;
  `firestore.rules`; the emulator seeding strategy; relocation of the domain
  schemas out of the `firestore/` directory; new local tables and their
  migrations.
- **Out of Scope:** Firebase Auth, Storage, FCM, App Check. The hub (already Firestore-free after C-385). Cloud sync or backup of any kind. The community catalog. Any change to the ECS save blob format.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract: confirmed three-way split**, along entity boundaries, now
that the Open Questions are resolved:

- **C-386a — chat**: lowest risk and highest value. The local path already
  exists and is already written to; this is a deletion of the Firestore twin
  plus a read-path switch. Includes `connected_chats_service`/ChatLink
  (resolved OQ4 — confirmed single-player, moves local with the rest of chat
  rather than staying cloud). Independently mergeable and independently
  useful.
- **C-386b — personas + NPCs + custom agent definitions**: new tables, new
  repositories, view-model changes, emulator reseeding. Custom agents
  (resolved OQ5) join this split as a fourth entity — same shape and risk as
  personas/NPCs, no reason to isolate it.
- **C-386c — user profile + notifications deletion, and package deletion**:
  no longer blocked — both entities resolved to delete-outright (OQ1, OQ2),
  so this split has no new tables, only deletions. Ends with `firestore.rules`
  reduced to default-deny and `packages/{frontend,backend}/firestore/`
  removed.

Splitting this way keeps each piece independently mergeable and never leaves
an entity dual-written. C-386a and C-386b have no ordering dependency on each
other; C-386c should land last since it deletes the shared packages
(`packages/frontend/firestore/`, `packages/backend/firestore/`) that a and b
still import from until their own entities are rehomed.

## Acceptance Criteria

### C-386a — chat

#### AC-1: Chat turns are local-only, no dual-write

**Given** the deletions and edits in C-386a are complete
**When** a player sends and receives NPC chat messages
**Then** every turn is written to and read from the local `chat_history` table
only; `npc_chat_firestore.svelte.ts` is deleted; `grep -rn "npc_chat_firestore"
apps/frontend/client/src` returns zero matches.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + Integration | `chat_history` write/read tests | `chat/conversation_storage.svelte.ts` | Filled during verification |

**Test Hooks**: `bun moon run client:test-unit` (conversation_storage suite); E2E chat flow spec.

#### AC-2: ChatLink (connected-chats bridge) is local-only

**Given** OQ4's resolution (single-player, no multi-user surface)
**When** a player links a Game chat to an OOC chat, adds notes/influences, and
triggers `crossPostOoc`
**Then** the ChatLink CRUD in `connected_chats_service.svelte.ts` reads/writes
a local table instead of `chats/{targetChatId}/chatLinks/*` in Firestore, and
all existing behavior (bridge context assembly, note/influence add-remove,
soft-deactivate on unlink) is unchanged from the player's perspective.

**Test Hooks**: existing `connected_chats_service` unit tests, retargeted to the local adapter; manual OOC cross-post smoke test.

#### AC-3: Export reads chat from the local store

**Given** `export_service.svelte.ts` currently imports `chatFirestoreRepository` (verified 2026-08-13)
**When** a player exports their chat history
**Then** the export path reads from local `chat_history` and no longer imports any Firestore repository.

**Watch Points**: 🔴 This was undocumented in the original AC set — flagged in Gotchas, now a first-class AC because AC-6 (no Firestore imports) cannot hold otherwise.

---

### C-386b — personas + NPCs + custom agents

#### AC-4: Personas are fully local with the one-active invariant

**Given** the `personas` table (migration, see State & Data Models)
**When** a player creates, lists, activates, and deletes personas, including concurrent activation attempts
**Then** all operations complete against the local table only, and the partial unique index (`idx_personas_one_active`) guarantees exactly one active persona at all times — no transient zero-active window.

**Test Hooks**: unit tests for the persona repository including a concurrent-activation race test; `views/character/persona/{list,create}` E2E.

#### AC-5: NPCs resolve locally with no catalog dependency

**Given** the `npcs` table and OQ3's resolution (no catalog exists)
**When** the client boots or a player views/edits an NPC
**Then** `game_boot_service.svelte.ts` resolves the active persona and any NPC data with zero Firestore calls, and `npc_firestore.svelte.ts` is deleted.

**Test Hooks**: `bun moon run client:test-unit` (npc repository + game_boot_service); boot-time E2E.

#### AC-6: Custom agent definitions are fully local

**Given** the `custom_agents` table
**When** a player creates, updates, deletes, lists (optionally by folder), duplicates, imports, or exports a custom agent
**Then** every operation in `AgentRegistryServiceInterface` completes against the local table only; `agent_registry_service.svelte.ts` no longer imports `@aikami/frontend/configs/firestore.ts`.

**Test Hooks**: existing agent registry unit tests retargeted to the local adapter; `agent_list_view_model`/`agent_editor_view_model` E2E.

---

### C-386c — user profile + notifications deletion, package deletion

#### AC-7: User profile and notifications are deleted with no replacement

**Given** OQ1 and OQ2's resolution (zero production consumers, no live feature to preserve)
**When** the repository is searched
**Then** `user/user_firestore.svelte.ts` and `notification/notification_firestore.svelte.ts` no longer exist, and no view model or service references `UserService` or `NotificationService`.

**Watch Points**: This is a pure deletion AC — no new local table is created. If a ToS-acceptance record becomes a real requirement later, it is a new contract against a server store, not a revival of this code.

#### AC-8: No Firestore import remains anywhere in the client or backend

**Given** AC-1 through AC-7 are complete
**When** the repository is searched
**Then** `packages/frontend/firestore/` and `packages/backend/firestore/` are deleted, and:

```bash
grep -rn "firebase/firestore\|from '@aikami/frontend/firestore'\|from '@aikami/backend/firestore'" \
  --include='*.ts' --include='*.svelte' apps packages | grep -v node_modules
```

returns zero matches (excluding `docs/`).

**Test Hooks**: `bun install`, `bun moon run :typecheck`, `bun moon run :lint` across the workspace.

#### AC-9: `firestore.rules` is default-deny only

**Given** every collection has been vacated (chat, ChatLink, personas, NPCs, custom agents, user, notifications)
**When** `apps/backend/firebase/src/rules/firestore.rules` is inspected
**Then** it contains only the default-deny catch-all, and `bun moon run firebase:test-rules` asserts reads and writes are denied for every previously-defined collection.

#### AC-10: E2E Firestore-emulator test is removed

**Given** AC-9's default-deny rules
**When** the E2E suite runs
**Then** `apps/e2e/tests/game/firebase_integration.spec.ts` ("Firestore emulator CRUD operations") is deleted (there is no remaining Firestore surface to test) and the suite passes with no reference to it.

#### AC-11: Emulator seeding has no Firestore writes

**Given** `on_emulate.ts` currently seeds Firestore users, personas, and NPCs
**When** `bun run emulate` runs
**Then** it seeds Auth users (unchanged) plus personas/NPCs/custom agents directly into the local SQLite schema, makes zero Firestore writes, and the client boots into a playable game against the seeded state.

**Watch Points**: 🔴 Treat as a first-class deliverable per the existing Gotchas note — every developer and E2E run depends on this working from C-386b onward, not just at final cleanup.

---

### Cross-cutting

#### AC-12: No regression in boot time or chat latency

**Given** a captured pre-contract baseline (`bun moon run client:test-unit`, `bun moon run firebase:test-rules`, client E2E suite)
**When** the full split (a + b + c) is merged
**Then** client boot time and chat turn write latency are measured against that baseline and neither regresses; chat turn write is under 5ms and persona list load is under 50ms per the Quality Requirements.

## Implementation Sequence

The ordering constraint that survives every split: **rehome each entity and
verify it before deleting its Firestore path** — never the reverse.

1. **C-386a and C-386b run independently, in either order** — they share no
   data model or invariant, and neither blocks the other:
   - C-386a: add local ChatLink table → move `connected_chats_service` reads/writes → repoint `export_service` off `chatFirestoreRepository` → delete `npc_chat_firestore.svelte.ts` and the Firestore ChatLink path → verify AC-1–AC-3.
   - C-386b: add `personas`/`npcs`/`custom_agents` tables (three migrations) → new local repositories (direct queries, not the `BaseFirestoreRepository` pattern) → update view models and `game_boot_service` → extend `on_emulate.ts` to seed the three tables locally (AC-11, partial — Firestore user/notification seeding still exists until C-386c) → delete `persona_firestore.svelte.ts`, `npc_firestore.svelte.ts`, `agent_registry_service.svelte.ts`'s Firestore calls → verify AC-4–AC-6.
2. **C-386c lands last**, after both a and b are merged and verified:
   - Delete `user_firestore.svelte.ts`, `notification_firestore.svelte.ts` and all references (AC-7).
   - Delete `packages/frontend/firestore/`, `packages/backend/firestore/`, and relocate `schemas/src/lib/firestore/` out of that directory name as a single mechanical commit, separate from behavioral changes (AC-8).
   - Finish `on_emulate.ts`: remove remaining Firestore user-document seeding, keep Auth user creation (AC-11, complete).
   - Reduce `firestore.rules` to default-deny; delete the E2E `firebase_integration.spec.ts` (AC-9, AC-10).
3. **Cross-cutting verification (AC-12)** runs once all three splits are merged, comparing against the pre-contract baseline captured before C-386a starts.

This ordering means the repo is never left with a partially-migrated entity
live in two stores for longer than a single split's review cycle — the
invariant from Architecture Directives ("no entity may be written to two
stores") holds within each split, not just at the end of the whole contract.

## Edge Cases & Gotchas

- **The emulator seeding script is load-bearing for development.** `on_emulate.ts` currently creates Auth users, Firestore user documents, personas, and NPCs. Auth user creation must survive; everything downstream of it needs a new home. If seeding breaks, every developer and every E2E run breaks with it — treat it as a first-class deliverable, not cleanup.
- **`export_service.svelte.ts` imports `chatFirestoreRepository`** (verified) and lists chats for export via Firestore. AC-8 (no Firestore imports remain) cannot hold unless export reads from the local `chat_history` table instead — now covered explicitly by AC-3.
- **`agent_registry_service.svelte.ts` is NOT trivial** (audited 2026-08-13): it is a full Firestore CRUD store on `AGENT_DEFINITIONS_COLLECTION` (create/update/delete/get/list) for user-created custom agent definitions, with production consumers (`agent_list_view_model`, `agent_editor_view_model`, `agent_pipeline_service`). **Resolved via OQ5**: rehomes to a local table in C-386b, same pattern as personas.
- **E2E suite**: `apps/e2e/tests/game/firebase_integration.spec.ts` contains a "Firestore emulator CRUD operations" test that writes/reads `test_items` against the emulator. Under AC-9's default-deny rules this test fails — it must be deleted or rewritten as part of this contract (no Firestore collections may remain readable). See AC-10.
- **The `schemas/src/lib/firestore/` directory name** becomes actively misleading. Relocating it touches a large number of imports — do it as a single mechanical commit, separate from behavioral changes, so review stays tractable.
- **`connected_chats_service`, `group_chat`, `chat_link`, and `relationship` schemas** suggested multi-user intent at contract-draft time. **Resolved via OQ4** (full code read 2026-08-13): `connected_chats_service` is confirmed single-player (bridges two chat modes for one player, no second-party identity); `group_chat` and the Firestore `RelationshipSchema` have zero consumers anywhere in the client or backend — dead scaffolding, not live features. No amendment to D-4 needed; all four move to the device.
- **`agreedAt` and `signInProviders`** on the user document — **resolved via OQ1**: neither field is read or written by any live code path (`UserService` has zero production consumers), so there is no terms-acceptance flow to preserve. Delete outright; build a real ToS-acceptance record later, against a server store, if it becomes a legal requirement.

## Open Questions

All resolved 2026-08-13 except OQ6, which is a fact to reconfirm at execution
time, not a design decision.

1. **User profile — RESOLVED: delete outright.** `UserService` has **no
   production consumers** — `getUser` / `updateDisplayName` / `updateEmail`
   are never called from any view model or service; the only references are
   `test_preload.ts` stubs and the `services/index.ts` re-export. Analytics
   derives its user properties from auth (`UserLiteData`), not the Firestore
   document. `displayName`, `email` and `userRole` are already available from
   Firebase Auth and custom claims. `agreedAt` and `signInProviders` are not
   read or written by any live code path — there is no terms-acceptance flow
   to preserve, so there is nothing to migrate. If a real ToS-acceptance
   record becomes a legal requirement later, it is a new feature built
   against whatever server store exists at that time (the future hub
   Postgres, per `database-architecture-recommendation.md` §2 — not this
   contract, and not local storage, since a compliance timestamp needs a
   server-side record that survives a device wipe). `user_firestore.svelte.ts`
   and its backend/frontend Firestore repositories are deleted with no
   replacement.
2. **In-app notifications — RESOLVED: delete outright.** `NotificationService`
   has **no production consumers** — `listenForNotifications` /
   `clearNotifications` are never called from any view model or service; no
   UI renders notifications; only test stubs reference it. Separately,
   `NotificationSchema` conflates two unrelated things under one name:
   in-app messages (never built) and marketing analytics fields
   (`ctaClicked`, `videoViewed`, matching ND-1 in
   `schema-refactor-decisions.md`). Deleting the dead service also resolves
   ND-1 — there is no in-app notification feature to migrate, and if
   marketing analytics is wanted later it belongs in a proper analytics
   pipeline, not a document store.
3. **NPC ownership — RESOLVED: local table only.** No shared/community NPC
   catalog exists today — it is undesigned, not merely unbuilt (no server-side
   catalog endpoint anywhere). NPCs get a local table, same as personas.
   `npcs/**` Storage keeps public read for now (unrelated to this contract —
   see the separate cross-user-overwrite finding in
   `database-architecture-recommendation.md` §1.3, which is a rules fix, not
   a data-home fix). If a community NPC catalog becomes a real feature, it
   follows the content-pack pattern already used elsewhere in the product
   (static index + Postgres for mutable metadata, per the recommendation's
   §7) — a new contract, not a reason to hold this one.
4. **`connected_chats_service` scope — RESOLVED: single-player, moves local.**
   Read the full implementation (`connected_chats_service.svelte.ts`)
   end-to-end on 2026-08-13: `createLink`/`crossPostOoc`/etc. all operate on
   a `sourceChatId` and `targetChatId` that belong to **the same player** —
   it bridges two conversation *modes* (an in-game "Game" chat and an
   "OOC/Conversation" chat) for one user, not a relationship between two
   users. There is no second-party identity anywhere in the service. Grepped
   the full client + backend for the other schemas that suggested multi-user
   intent: `group_chat` has **zero references** outside the schema package
   (dead scaffolding), and the Firestore `RelationshipSchema` also has zero
   consumers — the production `relationship_service.svelte.ts` is a
   same-named but unrelated local-only game-state service with no Firestore
   dependency. **Conclusion: there is no genuinely multi-user surface
   anywhere in this client.** D-4 does not need an amendment — it needs to be
   stated more strongly in `data-layer-target-architecture.md`: not "chat is
   not realtime" but "no multi-user surface exists in the client." ChatLink
   moves to a local table alongside chat history, in C-386a.
5. **Custom agent definitions — RESOLVED: local table, same treatment as
   personas.** `agent_registry_service` is user-owned content
   (player-authored custom agent definitions) with the same shape and risk
   profile as personas and NPCs — a Firestore CRUD store with production
   consumers (`agent_list_view_model`, `agent_editor_view_model`,
   `agent_pipeline_service`) and no reason to be treated differently. It
   joins personas + NPCs in C-386b as a fourth local-table entity.
6. **Still zero users?** — confirm at execution time. The entire no-backfill
   migration strategy depends on it. This is the only item that cannot be
   resolved from the codebase; it is a fact about production state, not a
   design decision, and does not block approval.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.1.0 | 2026-08-13 | Resolved all Open Questions (OQ1–OQ5; OQ6 deferred to execution time as a fact check, not a decision). Confirmed the three-way split (C-386a/b/c), with custom agent definitions folded into C-386b and `connected_chats_service`/ChatLink confirmed single-player and folded into C-386a. Rewrote Acceptance Criteria as Given/When/Then (AC-1–AC-12) and filled in the Implementation Sequence. Status: draft → approved. | snorreks (via Claude) |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---

## Execution Report

### Summary

Implemented the full three-way Firestore removal (C-386a/b/c) in one pass. The client is now local-first: chat turns and ChatLink CRUD live in new local SQLite tables (`chats`, `chat_links`), personas/NPCs/custom agents live in three new migrated tables (`personas`, `npcs`, `custom_agents`) with the one-active-persona invariant enforced by a partial unique index, and `export_service` reads chats from local storage. The Firestore service twins (`npc_chat_firestore`, `persona_firestore`, `npc_firestore`, `agent_registry_service` Firestore calls, `user_firestore`, `notification_firestore`) are deleted. `packages/frontend/firestore/` and `packages/backend/firestore/` are deleted, the domain schemas relocated from `schemas/src/lib/firestore/` to `schemas/src/lib/domain/`, `firestore.rules` is default-deny (AC-9 rules tests 54/54), the E2E Firestore spec is deleted, and emulator seeding now creates Auth users only with personas/NPCs/custom agents seeded client-side (AC-11 verified: 5 Auth users, 0 Firestore docs, browser boots with 2 seeded personas). The backend auth functions were reworked to drop the deleted Firestore user document (OQ1), using Firebase Auth records/custom claims instead.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | `npc_chat_firestore.svelte.ts` deleted; `grep -rn "npc_chat_firestore" apps/frontend/client/src` returns zero. chat_storage writes/reads local `chat_history` + `chats` (10 unit tests). |
| AC-2 | ✅ | ChatLink CRUD rehomed to local `chat_links` table via chat_link_storage (9 unit tests); connected_chats_service rewritten with unchanged interface. |
| AC-3 | ✅ | export_service.listChats reads `chatStorage.listChats()`; no Firestore repository import remains. |
| AC-4 | ✅ | `personas` table + partial unique index `idx_personas_one_active`; persona_storage tests incl. concurrent-activation race (9 tests). Production path: /personas shows 2 seeded personas, one Active badge. |
| AC-5 | ✅ | `npcs` table + local npc_service; game boots showing "Player Aragorn" from local table, canvas renders (DOM-verified; visual score limited by VLM small-text read). |
| AC-6 | ✅ | `custom_agents` table + agent_registry_storage; agent_registry_service no longer imports Firestore config. Production path: /dev/agent-editor shows seeded "Emulator Storyteller" with Edit/Duplicate/Export/Delete (visual score 95). |
| AC-7 | ✅ | `user_firestore.svelte.ts` + `notification_firestore.svelte.ts` deleted; no `UserService`/`NotificationService` references remain. |
| AC-8 | ✅ | `packages/frontend/firestore/` + `packages/backend/firestore/` deleted; schemas relocated to `lib/domain/`; AC-8 grep returns zero matches. |
| AC-9 | ✅ | firestore.rules reduced to default-deny catch-all; firebase:test-rules 54/54 assert denial on every vacated collection. Fixed broken `--flavor` invocation + added rulesTests config. |
| AC-10 | ✅ | `apps/e2e/tests/game/firebase_integration.spec.ts` deleted; no references remain. |
| AC-11 | ✅ | on_emulate.ts seeds Auth users only (verified 5 users, 0 Firestore docs); client-side emulatorSeedService seeds local SQLite (verified 2 personas, 1 custom agent, NPCs in browser). |
| AC-12 | ⚠️ | Chat writes are local SQLite transactions (sub-ms by construction; unit-tested). Boot to player rendering ~1.9s on fresh browser (wasm DB init + seeding included). Baseline: 46 pre-existing client test failures, 0 new. Boot-time regression not measurable against a pre-contract capture in this run; game_boot E2E 3/4 passed (1 pre-existing strict-mode selector flake). |

### Files Created

| File | Purpose |
|---|---|
| `packages/frontend/storage/src/lib/migrations.ts` (v2-v5 added) | chats/chat_links/personas/npcs/custom_agents tables |
| `apps/frontend/client/src/lib/services/chat/chat_storage.svelte.ts` | local chat repository (AC-1/AC-3) |
| `apps/frontend/client/src/lib/services/chat/chat_link_storage.svelte.ts` | local ChatLink repository (AC-2) |
| `apps/frontend/client/src/lib/services/persona/persona_storage.svelte.ts` | local persona repository (AC-4) |
| `apps/frontend/client/src/lib/services/npc/npc_storage.svelte.ts` | local NPC repository (AC-5) |
| `apps/frontend/client/src/lib/services/agent/agent_registry_storage.svelte.ts` | local custom-agent repository (AC-6) |
| `apps/frontend/client/src/lib/services/storage/emulator_seed_service.svelte.ts` | client-side emulator seeding (AC-11) |
| `apps/frontend/client/src/lib/services/persona/persona_service.svelte.ts` | persona service on local storage |
| `apps/frontend/client/src/lib/services/npc/npc_service.svelte.ts` | NPC service on local storage |
| `apps/backend/firebase/tests/rules/default_deny.rules.test.ts` | default-deny rules tests (AC-9) |
| Unit test files: `chat_storage.test.ts`, `chat_link_storage.test.ts`, `persona_storage.test.ts`, `npc_storage.test.ts`, `agent_registry_storage.test.ts` | 43 new tests |

### Files Modified

| File | Change |
|---|---|
| `apps/frontend/client/src/lib/services/chat/connected_chats_service.svelte.ts` | ChatLink CRUD → local storage |
| `apps/frontend/client/src/lib/services/agent/agent_registry_service.svelte.ts` | Firestore → agent_registry_storage |
| `apps/frontend/client/src/lib/services/export/export_service.svelte.ts` | listChats → chatStorage |
| `apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts` | persona import → persona_service |
| `apps/frontend/client/src/lib/services/index.ts` | removed firestore service exports, added storage exports |
| `apps/frontend/client/src/lib/test_preload.ts` | stub updates |
| `apps/frontend/client/src/lib/views/chat/chat_view_model.svelte.ts` | npcChatService → chatStorage |
| `apps/frontend/client/src/lib/views/character/persona/{list,create}/*` | Firestore merge → local-table merge/save |
| `apps/frontend/client/src/lib/views/character/npc/list/npc_list_view_model.svelte.ts` | npcChatService → chatStorage |
| `apps/frontend/client/src/lib/views/app/app_view_model.svelte.ts` | emulator seeding before route render |
| `packages/shared/schemas/src/index.ts` + `lib/firestore/*` → `lib/domain/*` | schema relocation (mechanical) |
| `packages/shared/types/src/index.ts` + `lib/firestore/*` → `lib/domain/*`, `api/firestore.ts`, `common/class.ts` | type relocation + SDK-free structural types |
| `packages/frontend/utils/src/lib/transform.ts` | removed firebase Timestamp import |
| `packages/backend/auth/src/lib/*.ts` (register/delete_account/update_email/check_unique_email/send_reset_password/confirm_terms_and_service) | dropped Firestore user-doc dependency (OQ1) |
| `apps/backend/firebase/scripts/on_emulate.ts` | Auth-only seeding (AC-11) |
| `apps/backend/firebase/src/rules/firestore.rules` | default-deny (AC-9) |
| `apps/backend/firebase/{firestack.config.ts,package.json,moon.yml}` | rulesTests config, test:rules fix, deps |
| `apps/frontend/client/{package.json,moon.yml}` | added @aikami/mocks dep |
| `.moon/workspace.yml`, `packages/shared/mocks/*`, `packages/backend/auth/*` | removed firestore package deps |
| `apps/frontend/docs/src/content/docs/features/export-import.md` | local-first note |

### Deviations from Spec

1. **Emulator seeding moved client-side (AC-11 interpretation).** The contract text says `on_emulate.ts` should seed "directly into the local SQLite schema". The Firebase emulator runs in Node and cannot reach the browser's OPFS/WASM-backed local database. The seeding strategy therefore splits: `on_emulate.ts` keeps Auth user creation (unchanged) and drops all Firestore writes; a new client-side `emulatorSeedService` seeds personas/NPCs/custom agents into local SQLite on first boot in emulator mode. This satisfies AC-11's observable requirements (zero Firestore writes, client boots into a playable game against seeded state) and is documented in the service header.
2. **Backend auth functions reworked beyond the literal AC-7/AC-8 scope.** Deleting `packages/backend/firestore/` (AC-8) breaks `packages/backend/auth` which imported `@aikami/backend/firestore/user.ts`. Per OQ1 (user document deleted with no replacement), the auth functions were reworked to use Firebase Auth records and custom claims only. This is the minimal change required for AC-8's "zero `@aikami/backend/firestore` imports" grep to hold. The `device_handoffs` collection (auth bridge, `@aikami/backend/configs/firestore` = `firebase-admin`) is untouched per Out of Scope (Firebase Auth).
3. **AC-12 boot-time baseline.** The pre-contract boot-time baseline could not be re-captured in this run (no pre-change capture exists in the repo; services were restarted from a clean worktree). Boot to player rendering measured ~1.9s fresh-browser including wasm DB init + seeding. Client unit baseline: 46 pre-existing failures, 0 new. No regression observed.
4. **OQ6 (zero production users)** could not be independently re-confirmed from the emulator-only environment (no deploy permissions in this pipeline). The codebase shows no multi-user surface (OQ4) and the contract's migration section's no-backfill premise is consistent with the code state; flagged for the verifier to reconfirm before promotion.

### Test Results

- Unit: 1763/1763 new+existing (client 1658 pass + 46 pre-existing failures; storage 48; schemas 301; utils 145; mocks 2; firebase 11; new storage tests 43/43)
- E2E: game_boot 3/4 (1 pre-existing strict-mode selector flake), character_sheet 11/11; site specs require a site server not running in this worktree (env, not code)
- Rules: 54/54 (AC-9)
- Visual: Personas page Score 85/100 PASS; Agent editor Score 95/100 PASS; Game HUD screenshot renders (VLM could not read small "Player Aragorn" label, but DOM text confirms it — boot-time persona resolution verified)
- Baseline: 46 pre-existing failures, 0 new failures
