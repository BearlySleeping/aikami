# Firestore vs Data Connect — data placement decisions

Companion to `schema.gql` and `schema-refactor-decisions.md`. This document
decides **where each entity lives** — Firestore (minimal, realtime) vs
Firebase SQL Connect / Data Connect (relational) — and records the naming
conventions introduced by the storage-layer rename (repository/database →
firestore) so future code follows one vocabulary.

Decision date: 2026-08-07. Status: **agreed** (see below); the actual data
migration is a separate follow-up task — this document is the source of truth
for *where new code reads/writes each entity*.

---

## 1. The split — one line

> **Firestore keeps only what needs real-time subscriptions and high-frequency
> writes: chats, messages, and notifications. Everything relational — users,
> NPCs, personas, save slots, audio tracks, configs — moves to Data Connect
> (PostgreSQL).**

| Entity | Store | Why |
|--------|-------|-----|
| `Chat` | 🔥 Firestore | Live chat list; `onSnapshot` streaming; high write rate (message counters, affection). |
| `Message` | 🔥 Firestore | Subcollection of chats; streamed to the UI turn-by-turn; regenerations are high-frequency writes. |
| `Notification` | 🔥 Firestore | Real-time badge/feed; `onSnapshot` on `users/{uid}/notifications`. |
| `User` | 🐘 Data Connect | Auth-driven profile, unique email, role enums — classic relational row; no realtime need. |
| `Npc` | 🐘 Data Connect | Catalog metadata; public browse via `visibility` filters (Postgres index), owner queries via FK. |
| `Persona` | 🐘 Data Connect | User-owned metadata; relational FK to User (cascade delete); no streaming. |
| `SaveSlot` | 🐘 Data Connect | Queryable save metadata (`{uid}_{slotNumber}` PK, composite unique); blob lives in Cloud Storage. |
| `AudioTrack` | 🐘 Data Connect | Read-only catalog for AI Director (`GetTracksByMood`); UUID ids, no Firestore equivalent. |
| `Config` | 🐘 Data Connect | Pending **ND-3** — per-user settings model needs a `uid` FK; see below. |

Everything not listed (game state, ECS snapshots, local SQLite caches) is
out of scope: ECS blobs go to Cloud Storage, local-first state goes to the
local SQLite layer (`@aikami/frontend/storage`, Turso/WASM).

---

## 2. Rationale per Firestore survivor

**Chats + Messages.** The chat screen is a live stream: messages appear
mid-stream, tokens accumulate, affection ticks up. That is the canonical
Firestore `onSnapshot` use case, and the Firestore security rules already
express chat ownership (`chats/{chatId}` + `messages/{messageId}`
subcollection). Moving chats to Postgres would force a polling/reconnect
shim and lose subcollection semantics. Denormalized display fields
(`Chat.npcName`, `npcAvatarUrl`) stay — see schema-refactor-decisions §7.

**Notifications.** The notification bell is a realtime feed
(`users/{uid}/notifications`). Same argument as chats; keep Firestore.

Trade-off accepted: chat/message data is *not* queryable in SQL (no joins,
no aggregations across users). When group chats / analytics arrive
(FEATURES.md #2, marketing events), those go to Data Connect as new tables
— the schema.gql `Message`/`Chat` tables stay available for a future
backfill or read-replica, but are **not** the source of truth while the
Firestore copy lives.

---

## 3. Why the rest moves to Data Connect

- **User** — unique email, `role` enum, FK target for every other table. Postgres
  enforces referential integrity that Firestore rules approximate with string
  comparisons.
- **Npc / Persona** — catalog + profile metadata, mostly read-once or
  owner-scoped. `visibility` filtering and owner FKs are exactly what SQL
  indexes are for. (`Npc.owner` optional → `SET NULL`, `Persona.owner`
  required → `CASCADE`.)
- **SaveSlot / AudioTrack / Config** — no Firestore equivalent today
  (SaveSlot's blob lives in Storage; AudioTrack is a seed-only catalog;
  Config is a KV store pending ND-3). They were always Data Connect targets.

---

## 4. Naming conventions (this refactor)

The storage layer was renamed so "firestore" and "dataconnect" are never
ambiguous:

| Old | New |
|-----|-----|
| `packages/backend/database` (`@aikami/backend-database`) | `packages/backend/firestore` (`@aikami/backend-firestore`) |
| `packages/frontend/repositories` (`@aikami/frontend-repositories`) | split → `packages/frontend/firestore` (`@aikami/frontend-firestore`) + `packages/frontend/storage` (`@aikami/frontend-storage`, local SQLite) |
| `BaseRepository` | `BaseFirestoreRepository` |
| `FrontendRepository` | `FirestoreFrontendRepository` |
| `BackendRepository` | `FirestoreBackendRepository` |
| `RepositoryType` | `FirestoreRepositoryType` |
| `userRepository` / `npcRepository` / … | `userFirestoreRepository` / `npcFirestoreRepository` / … |
| `packages/shared/schemas/src/lib/database/` | `packages/shared/schemas/src/lib/firestore/` |
| `packages/shared/types/src/lib/database/` + `repository/` | `packages/shared/types/src/lib/firestore/` |
| `packages/shared/utils/src/lib/database/` + `repository/` | `packages/shared/utils/src/lib/firestore/` |
| `@aikami/backend/configs/database` (getFirestore) | `@aikami/backend/configs/firestore` |
| client `*_repository.svelte.ts` (Firestore-backed) | `*_firestore.svelte.ts` |
| client `*_repository.svelte.ts` (local SQLite) | `*_storage.svelte.ts` |

Rules going forward:

- **Firestore code** (realtime survivors) imports from
  `@aikami/backend/firestore`, `@aikami/frontend/firestore`,
  `@aikami/schemas/firestore/*` (or the barrel), and uses
  `*FirestoreRepository` naming.
- **Data Connect code** imports from `@aikami/frontend/dataconnect` (generated
  SDK) and the generated schemas in
  `packages/shared/schemas/src/lib/generated-dataconnect/` (see
  `apps/backend/firebase/scripts/generate_dataconnect_schemas.ts`).
- **Local SQLite code** imports from `@aikami/frontend/storage`.
- Never write new Firestore-shaped repositories for entities that belong to
  Data Connect (see §1 table).

---

## 5. Migration implications (follow-up, not done here)

1. **Seed Data Connect from Firestore**: users, npcs, personas backfill
   (`User.id` = auth uid, `Npc.uid` = `creatorUid`, normalize `email` to
   lowercase — see schema-refactor-decisions §2).
2. **Flip reads** table-by-table: Npc catalog → `ListNpcs`/`GetNpc` connector
   queries; persona → owner-scoped query; user → `GetUser`. Firestore rules
   stop guarding the migrated collections (keep rules for chats/messages/
   notifications).
3. **Keep a sync layer** for the denormalized chat fields
   (`npcName`/`npcAvatarUrl` refreshed from the Npc row) while both stores
   exist.
4. **Chat/Message SQL tables** in schema.gql remain defined but idle until a
   read-replica or backfill is required (they document the shape and keep
   FK planning honest).
5. **Config ND-3** must be resolved before Config moves — decide per-user
   settings (add `uid` FK) vs generic KV (different auth model).

---

## 6. Open items inherited from schema-refactor-decisions.md

Unchanged by this decision: ND-1 (Notification type enum), ND-2 (Chat.npc
delete semantics — keep `SET NULL`), ND-4 (Persona visibility), ND-5
(AudioTrack mood enum), ND-6 (Any columns without governing schemas).
This document only fixes the *placement* question (ND-3 for Config is
flagged in §5.5).
