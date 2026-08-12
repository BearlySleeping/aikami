---
id: C-386
title: "Firestore Removal: client becomes local-first"
source: "external data-layer review (docs/research/database-architecture-recommendation.md §4)"
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-12"
---

# Contract C-386: Firestore Removal — Client Becomes Local-First

> 🔴 **NOT READY FOR EXECUTION.** This contract has unresolved Open Questions
> that change its shape. Do not hand it to an implementer while `status:
> draft`. It exists now to hold its place in the sequence and to capture the
> inventory while it is fresh. Resolve the Open Questions, then rewrite the
> Acceptance Criteria against the answers.

## Metadata

| Field | Value |
|---|---|
| **Source** | External data-layer review — `docs/research/database-architecture-recommendation.md` §4. Architecture: `docs/architecture/data-layer-target-architecture.md` (D-2, D-3, D-4). |
| **Target** | `apps/frontend/client/src/lib/services/` (7 Firestore services + their view-model consumers), `packages/frontend/firestore/` (deleted), `packages/backend/firestore/` (deleted), `apps/backend/firebase/src/rules/firestore.rules` (reduced to default-deny), `apps/backend/firebase/scripts/on_emulate.ts` (reseeding strategy) |
| **Priority** | P1 — Firestore is the last duplicate store. Until it goes, chat is dual-written and personas live in two places. |
| **Dependencies** | C-384 (migrations — personas/NPCs need new local tables, which require numbered migrations), C-385 (Data Connect gone — otherwise this contract would have to rehome three stores at once). |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | TBD — depends on whether any user-facing sync/backup surface changes |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: 16 files under `apps/frontend/client/src/lib` reference Firestore. Seven are dedicated Firestore services:

  | Service | Domain | Target home (per D-3) |
  |---|---|---|
  | `persona/persona_firestore.svelte.ts` | personas | local SQLite |
  | `npc/npc_firestore.svelte.ts` | NPCs | local SQLite (+ public catalog later) |
  | `chat/npc_chat_firestore.svelte.ts` | chat turns | local SQLite — **already dual-written** to `chat_history` |
  | `user/user_firestore.svelte.ts` | user profile | **undecided — see Open Questions** |
  | `notification/notification_firestore.svelte.ts` | notifications | **undecided — see Open Questions** |
  | `chat/connected_chats_service.svelte.ts` | multi-chat surface | depends on D-4 scope |
  | `npc/autonomous_message_service.svelte.ts` | NPC-initiated messages | local SQLite |

  Plus consumers: `game/game_boot_service.svelte.ts` (resolves the active persona at boot), `views/character/persona/{list,create}/*_view_model.svelte.ts`, `services/export/export_service.svelte.ts`, `services/agent/agent_registry_service.svelte.ts`.

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

NPC table shape is TBD pending the public-vs-local NPC question below.

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

- **In Scope:** The seven client Firestore services and their consumers; `packages/frontend/firestore/`; `packages/backend/firestore/`; `firestore.rules`; the emulator seeding strategy; relocation of the domain schemas out of the `firestore/` directory; new local tables and their migrations.
- **Out of Scope:** Firebase Auth, Storage, FCM, App Check. The hub (already Firestore-free after C-385). Cloud sync or backup of any kind. The community catalog. Any change to the ECS save blob format.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** **Likely splits into three**, along entity boundaries,
once the Open Questions are answered:

- **C-386a — chat**: lowest risk and highest value. The local path already
  exists and is already written to; this is a deletion of the Firestore twin
  plus a read-path switch. Independently mergeable and independently useful.
- **C-386b — personas + NPCs**: new tables, new repositories, view-model
  changes, emulator reseeding.
- **C-386c — user profile, notifications, and package deletion**: blocked on
  the Open Questions; ends with the rules file reduced to default-deny.

Splitting this way keeps each piece independently mergeable and never leaves
an entity dual-written. Confirm the split when the Open Questions resolve.

## Acceptance Criteria

> ⚠️ **Placeholder.** These are the outcomes the contract must achieve, not
> yet executable ACs. Rewrite with Given/When/Then, evidence matrices and test
> hooks once the Open Questions are resolved and the split is confirmed.

- **AC-1** — Chat turns are written and read only from the local `chat_history` table; `npc_chat_firestore.svelte.ts` is deleted; no dual-write remains.
- **AC-2** — Personas are created, listed, activated and deleted entirely locally; the one-active-persona invariant holds under concurrent activation, enforced by the partial unique index.
- **AC-3** — NPCs resolve locally; `game_boot_service` boots with no Firestore call.
- **AC-4** — `packages/frontend/firestore/` and `packages/backend/firestore/` are deleted and no import of `firebase/firestore` remains outside `node_modules`.
- **AC-5** — `firestore.rules` contains only the default-deny catch-all, and the rules test suite asserts that reads and writes are denied for every previously-defined collection.
- **AC-6** — `bun run emulate` seeds a working local development state with no Firestore writes, and the client boots into a playable game against it.
- **AC-7** — Client boot time and chat turn latency are measured against the pre-contract baseline and neither regresses.

## Implementation Sequence

To be written after the split is confirmed. The ordering constraint that will
survive any split: **rehome each entity and verify it before deleting its
Firestore path** — never the reverse.

## Edge Cases & Gotchas

- **The emulator seeding script is load-bearing for development.** `on_emulate.ts` currently creates Auth users, Firestore user documents, personas, and NPCs. Auth user creation must survive; everything downstream of it needs a new home. If seeding breaks, every developer and every E2E run breaks with it — treat it as a first-class deliverable, not cleanup.
- **`export_service.svelte.ts` and `agent_registry_service.svelte.ts`** reference Firestore but were not part of the original inventory. Audit both before scoping; they may be trivial or may reveal a domain nobody has considered.
- **The `schemas/src/lib/firestore/` directory name** becomes actively misleading. Relocating it touches a large number of imports — do it as a single mechanical commit, separate from behavioral changes, so review stays tractable.
- **`connected_chats_service`, `group_chat`, `chat_link`, and `relationship` schemas** suggest multi-user intent. D-4 says chat is not realtime, but that decision covers single-player NPC chat. If any of these surfaces is genuinely multi-user, it does **not** move to the device — stop and amend the architecture rather than forcing it local.
- **`agreedAt` and `signInProviders`** on the user document may be legally or operationally significant (terms acceptance). Do not delete them without deciding where they live.

## Open Questions

Must be resolved before status becomes `approved`:

1. **User profile** — the Firestore `users/{uid}` document holds `agreedAt`, `signInProviders`, `displayName`, `email`, `userRole`. `displayName`, `email` and `userRole` are already available from Firebase Auth and custom claims. Where do `agreedAt` and `signInProviders` live? Options: Auth custom claims, a local `meta` row, or the future Postgres account table. Terms-acceptance timestamps arguably need a server-side record.
2. **In-app notifications** — `NotificationSchema` in `schemas/src/lib/firestore/notification.ts` defines `ctaClicked` / `videoViewed`, which is a *marketing analytics* model, while the Data Connect draft assumed in-app messages (recorded as ND-1). Are in-app notifications a real product surface? If they are only FCM push, the collection and service delete outright.
3. **NPC ownership** — are NPCs purely player-local, or is there a shared/community NPC catalog? This determines whether NPCs get a local table only, or a local table plus a future catalog entry. It also determines whether the `npcs/**` Storage prefix keeps public read.
4. **`connected_chats_service` scope** — is any chat surface genuinely multi-user (see Gotchas)? If yes, D-4 needs an amendment and that surface stays in a cloud store.
5. **Still zero users?** — confirm at execution time. The entire no-backfill migration strategy depends on it.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
