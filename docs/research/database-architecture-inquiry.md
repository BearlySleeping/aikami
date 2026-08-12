# Aikami Database Architecture — Investigation Summary (for external review)

> Prepared 2026-08-12 for an external AI (Claude) to review and recommend the
> best database architecture (performance, UX, DX, cost). Please look beyond
> the files listed — if anything is missed, explore the repo yourself:
> `packages/shared/schemas/src/lib/`, `packages/frontend/`,
> `packages/backend/`, `apps/backend/firebase/`, `apps/frontend/hub/`,
> `apps/frontend/client/`, `docs/contracts/`, `docs/architecture/`.

---

## 1. Executive summary — four data layers currently in play

| Layer | Tech | Role today | Status |
|---|---|---|---|
| **1. Local SQLite (Turso/libSQL)** | `@tursodatabase/database` (Tauri native) + `@libsql/client/web` (WASM/OPFS) | Offline-first source of truth for game state: campaigns, saves, sessions, checkpoints, journal, chat history, characters, NPC schedules, string registry, asset registry | Active in client; **cloud sync never wired up** |
| **2. Firestore** | `firebase/firestore` | Realtime chats/messages/notifications + **legacy personas/NPCs/users in the client** | Active in client |
| **3. Data Connect (Postgres on Cloud SQL)** | `firebase/data-connect` | Relational mirror of Firestore shapes; used **only by the hub** (personas, save slots, audio tracks) | **Emulator-only — NOT deployed** (`firestack.config.ts:21` excludes it outside emulator "we don't want to pay for it yet") |
| **4. Blobs / static** | Firebase Storage + bundled `static/` | ECS save blobs (`saves/{uid}/slot_{n}.json`), content packs (`static/content-packs/`), game data (lpc/maps/music/sprites in `static/game-data/`) | Active |

Plus a **fifth implicit layer: schema definitions duplicated in 4 places** —
see §4.

---

## 2. Layer-by-layer inventory

### 2.1 Turso / local SQLite (offline-first source of truth)

- `packages/frontend/storage/src/lib/storage_adapter.ts` — `LocalDatabaseInterface` (query/execute/transaction/sync/close) + **`AIKAMI_SCHEMA_DDL`** (a hand-written `string[]` of `CREATE TABLE IF NOT EXISTS`): `campaigns`, `capability_profile`, `meta`, `saves`, `characters`, `npc_schedules`, `chat_history`, `string_registry`, `sessions`, `session_checkpoints`, `journal_entries`, `compacted_summaries`, `assets`, `asset_sources`, `install_state` + indexes. No migrations system, no schema source of truth, no codegen.
- `packages/frontend/storage/src/lib/turso_storage_adapter.ts` — Tauri native adapter. `TursoStorageAdapterOptions` has optional `syncUrl`/`authToken` for Turso cloud sync — **no caller anywhere passes them** (grep confirms only definitions exist).
- `packages/frontend/storage/src/lib/wasm_storage_adapter.ts` — browser WASM/OPFS adapter.
- `packages/frontend/storage/src/lib/local_database_factory.ts` — platform-detect singleton, applies `AIKAMI_SCHEMA_DDL` idempotently.
- `packages/frontend/storage/src/lib/assets.ts` + `opfs_asset_cache.ts` — asset registry (C-373): `asset_sources` supports backends `'bundled' | 'firebase-storage' | 'r2' | 'self-hosted'`.
- Client consumers: `apps/frontend/client/src/lib/services/{campaign,campaign_storage,chat/conversation_storage,npc/npc_schedule_storage,game/*}.svelte.ts`.
- Design docs: `docs/contracts/C-203-local-first-turso-sync.md` (concept: local SQLite syncs to a **remote Turso edge DB** via libSQL sync — NOT to Firebase), `docs/contracts/C-321-migrate-local-persistence-to-turso-as-the-source-of-truth.md`, `docs/contracts/C-373-turso-asset-registry-opfs-cache.md`.
- **Key finding:** the "sync with turso cloud" is designed but never configured (no env vars, no Turso org/DB, no token). The C-203 doc says Firebase Auth may issue custom tokens for Turso — unimplemented.

### 2.2 Firestore (realtime + legacy)

- Schemas: `packages/shared/schemas/src/lib/firestore/*.ts` — 20+ TypeBox schemas: `user`, `persona`, `npc`, `chat`, `message`, `notification`, `config`, `item`, `lorebook`, `memory`, `knowledge_graph`, `group_chat`, `relationship`, `skills`, `world`, `voice`, `branch`, `appearance`, `chat_link`, `character`.
- Client repos: `packages/frontend/firestore/src/lib/*.ts` (`base_firestore_frontend_repository`, `user`, `config`, `notification`, `npc`, `chat`, `persona`).
- Backend repos: `packages/backend/firestore/src/lib/*.ts` (`user_firestore_repository`, `persona`, `chat`, `message`, `npc`, `notification`, `config`, `base_firestore_backend_repository`, `base_firestore_service`, **`firebase_data_connect_service.ts`** — note: a Data Connect service living inside the "firestore" package, also built on the Firebase JS SDK).
- Rules: `apps/backend/firebase/src/rules/firestore.rules` (chats/messages/notifications/configs/users/personas/npcs).
- **Live client usage still Firestore-heavy**: `apps/frontend/client/src/lib/services/{persona/persona_firestore,npc/npc_firestore,chat/npc_chat_firestore,user/user_firestore,notification/notification_firestore,chat/connected_chats_service}.svelte.ts` — personas, NPCs, and chats in the client still hit Firestore, even though the design doc says they should move to Data Connect. `game_boot_service.svelte.ts` resolves the persona via `persona_firestore`.
- Design intent: `apps/backend/firebase/dataconnect/schema/firestore-vs-dataconnect.md` — "Firestore keeps only chats, messages, notifications; everything relational moves to Data Connect". The **migration was never executed** (no backfill/sync layer; the Firestore→Data Connect user triggers in `apps/backend/firebase/src/controllers/firestore/users/*` only log).

### 2.3 Data Connect / Postgres (hub-only, emulator-only)

- Schema: `apps/backend/firebase/dataconnect/schema/schema.gql` — 9 tables (`User`, `Npc`, `Persona`, `Chat`, `Message`, `Notification`, `SaveSlot`, `AudioTrack`, `Config`), enums, `@ref` relations, auth policy docs, open items **ND-1..ND-6** (unresolved design questions flagged in the file header + `schema-refactor-decisions.md`).
- Connector: `apps/backend/firebase/dataconnect/connector/queries.gql` — `ListUsers`, `GetTracksByMood`, `ListSaveSlots`/`UpsertSaveSlot`, `ListPersonas`/`GetPersona`/`CreatePersona`/`UpdatePersona`/`DeletePersona`/`DeactivatePersonas`/`ActivatePersona`. Auth via `@auth(expr: "auth.uid == request.variables.uid")` (no `@auth` on tables in this dialect).
- Migration: `apps/backend/firebase/dataconnect/migrations/persona_one_active.sql` — partial unique index; **must be manually applied** to emulator Postgres.
- Generated SDK: `packages/frontend/dataconnect/src/lib/generated/` (via `bun moon run firebase:generate`). Wrapper: `packages/frontend/dataconnect/src/index.ts` (pre-wired `dataConnect` singleton from `packages/frontend/configs/src/lib/data_connect.ts`).
- Generated TypeBox rows: `packages/shared/schemas/src/lib/generated-dataconnect/*.ts` via `apps/backend/firebase/scripts/generate_dataconnect_schemas.ts` (home-grown GraphQL parser — regex-based, drops relations, maps scalars, emits `<Table>RowSchema`).
- Server-side service: `packages/backend/firestore/src/lib/firebase_data_connect_service.ts` (`FirebaseDataConnectService`) — generic CRUD over `executeQuery`/`executeMutation`; unused by the hub (hub uses the generated SDK directly).
- Hub consumers: `apps/frontend/hub/src/lib/client/services/dataconnect/{persona_data,persona_mapper,persona_repository}.svelte.ts`, SSR load `apps/frontend/hub/src/routes/(authenticated)/personas/+page.server.ts`.
- Client consumers of Data Connect (unrelated to hub): `packages/frontend/services/src/lib/services/game_state_sync.svelte.ts` (save slots) and `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts` (audio tracks).
- `apps/frontend/hub/scripts/verify_persona_dataconnect.ts` — verification script.

### 2.4 The hub app itself

- `apps/frontend/hub/` — SvelteKit 2 + Svelte 5 runes, `svelte-adapter-bun`, deployed to Cloud Run. Only product-data feature today: **personas** (user said this is just an example page; real targets: lpc, sprites, maps, music, assets, content-packs).
- Routes: `src/routes/(authenticated)/{dashboard,personas}`, `(unauthenticated)/login`, `api/[...slugs]/+server.ts` (Elysia mount), `api/internal_logging`.
- Server API: `apps/frontend/hub/src/lib/server/api/index.ts` — Elysia, single endpoint `POST /api/auth/session` (Firebase session cookie minting). **No product-data endpoints exist yet.**
- Auth flow: `hooks.server.ts` → `getUserSession` from `__session` cookie; `apps/frontend/hub/src/lib/client/services/api/auth.svelte.ts` syncs ID token → session cookie.
- `moon.yml` deps include `frontend-dataconnect`, `frontend-storage`, `frontend-firestore` (legacy), `backend-configs`, `backend-utils`.

### 2.5 Content packs / assets / game data (the "important" features)

- Static content packs: `apps/frontend/client/static/content-packs/` (`index.json` registry + `emberwatch/`, `whispering-caves/`) — schema `packages/shared/schemas/src/lib/game/content_pack.ts` + `pack_index.ts`.
- Game data: `apps/frontend/client/static/game-data/` — `lpc/`, `maps/`, `music/`, `sprites/`, `manifest.json`, `asset_hashes.json`.
- Asset registry lives in **turso** (`assets`/`asset_sources`/`install_state` tables) — `packages/frontend/storage/src/lib/assets.ts`, seeded from the bundled manifest; firebase-storage fallback sources can be added (`addFirebaseStorageSources`).
- Schemas: `packages/shared/schemas/src/lib/game/{lpc_recipe,game_assets,content_pack,pack_index,campaign,...}.ts` — rich TypeBox definitions already exist for all of these domains.
- **None of these are in Firestore or Data Connect today.** They are bundled static + local turso registry. A hub "content" page would need a server-side catalog of these (currently no server-side catalog exists).

---

## 3. Answers to the specific questions raised

### Q1: Turso is main storage for the user (offline-first), optional sync with Firebase — how does that work with personas + Data Connect? Are we duplicating turso and dataconnect?

- **Turso is NOT synced with Firebase today.** The libSQL sync is designed to go to a **remote Turso edge DB** (`syncUrl`/`authToken` on the adapter), and that is never configured anywhere. Firebase is a *separate* cloud (auth, storage, firestore, dataconnect). There is no turso↔firebase sync layer, and no turso↔dataconnect sync layer.
- The duplication is real but different from "turso vs dataconnect": the duplication is **Firestore vs Data Connect** (both hold `User`, `Npc`, `Persona`, `Chat`, `Message`, `Notification` shapes — the SQL tables are a faithful mirror of Firestore collections) while **turso holds a different shape** (session/campaign-oriented game state).
- The client is *already* duplicating per-entity: persona lives in Firestore (client boot resolves it), in Data Connect (hub), and could be in turso if made local-first. Chat turns go to Firestore (`npc_chat_firestore`) **and** turso (`conversation_storage`).

### Q2: Can the hub read the user's turso?

- **Not the local one.** The hub is a web SSR app; the user's turso lives on their device (Tauri AppData or browser OPFS). There is no mechanism for the hub to reach it.
- **Only via the Turso cloud sync** (unimplemented): if the client's local DB syncs to a Turso edge DB, the hub *server* could connect to that remote DB with `@libsql/client` + a per-user token (Firebase Auth can mint custom tokens — C-203 mentions this). Then hub pages could query the user's synced data directly, eliminating the need for Firestore/Data Connect copies of user-owned data.
- Decision point for Claude: is the intended source of truth for *user-owned content* (personas, saves, NPCs, chat) **the user's turso DB (synced to Turso cloud)** — with Firestore/Data Connect only for *shared catalog* (public NPCs, content packs, audio) and *realtime notifications*? That would collapse the current duplication.

### Q3: Hub should focus on lpc/sprites/maps/music/assets/content-packs, not personas

- Confirmed: none of those domains exist in any cloud DB today — they are bundled static + turso asset registry. A hub feature for them needs a **server-side catalog** (metadata + download URLs). Claude should advise which store is right for a content catalog:
  - Data Connect/Postgres (relational, filterable, but emulator-only + per-request auth via SDK),
  - Firestore (already has rules; but Firestore is being minimized per the design doc),
  - Turso cloud (if the client pulls packs via libSQL sync),
  - or a plain static/CDN JSON index (content packs are already versioned manifests; `pack_index.ts` exists) — possibly the cheapest and most offline-friendly for immutable content, with mutable metadata (likes, ratings, install counts) in a small relational DB.

### Q4: SSR uses `@aikami/frontend/dataconnect` (Firebase *frontend* SDK) in the backend — that can't be good, right?

- **Confirmed smell.** `apps/frontend/hub/src/routes/(authenticated)/personas/+page.server.ts` imports the Firebase JS SDK (`firebase/data-connect`) and runs it under **Bun** (`svelte-adapter-bun`). Problems:
  1. It only works because `ListPersonas`/`GetPersona` are `@auth(level: PUBLIC)` — the comment in `queries.gql` admits this: "Public read is what makes SSR seeding work without re-authenticating the server." That means **any anonymous caller can enumerate any user's personas** by uid (personas contain the user's self-characterization; ND-4 flags this exact policy question).
  2. The Firebase JS SDK is a browser-oriented client SDK; running it in a Bun SSR process is unorthodox (it does support Node, but you lose the admin-SDK/server patterns: no service-account auth, no server-side session enforcement, cache policy handled by SDK internals).
  3. There are two competing server patterns already: `FirebaseDataConnectService` in `packages/backend/firestore/` (also JS SDK) and the hub's Elysia API (`apps/frontend/hub/src/lib/server/api/index.ts`) which today only does session cookies. The natural fix: **move product-data reads/writes behind the hub's Elysia API** (server-side), authenticated from the session cookie, using either the Firebase Admin SDK's Data Connect path, `pg` directly against Cloud SQL, or Data Connect REST with a service account. Client-side hub features can then use `@elysiajs/eden` (already a dependency).
- Also note `fetchPolicy: 'SERVER_ONLY'` is used to dodge the SDK's client cache — more evidence the SDK is being fought rather than used.

### Q5: Schema restructure `schemas/src/lib/database/{firestore,generated-dataconnect,turso}` + no duplicated fields

- Current layout: `packages/shared/schemas/src/lib/{firestore,generated-dataconnect}/` (+ `game/`, `common/`, `media/`, `api/`, `auth/`, …). Proposed `database/` umbrella is reasonable and matches the old naming the refactor doc says was renamed *away* from (`database/` → `firestore/`) — so there's history to reconcile.
- The deeper issue is **per-entity duplication with divergent shapes**:
  - `Persona` exists as: Firestore `PersonaSchema` (`firestore/persona.ts`, with `isActive`, `voiceConfigId`, `uid` optional), generated `PersonaRowSchema` (`generated-dataconnect/persona.ts`), `PersonaData` in `packages/shared/types/src/lib/firestore/persona.ts`, and SQL columns in `schema.gql`. The mapper `persona_mapper.ts` exists precisely to bridge row↔data shapes (RFC 3339 ↔ epoch ms, uid required vs optional).
  - `Chat`/`Message` exist in **three** stores simultaneously (Firestore live, Data Connect tables idle-but-defined, turso `chat_history` with a *different* session-based shape).
- Claude should advise: **one schema source per entity, one store per entity**, with generation where the store is generated (Data Connect rows already are; turso DDL could be too — see Q6) and deletion where the store is deprecated (Firestore personas/npcs/users if Data Connect or Turso cloud takes over).

### Q6: Generate turso schemas from a defined schema source

- Today turso DDL is a hand-written `string[]` (`AIKAMI_SCHEMA_DDL` in `storage_adapter.ts`) with no type generation. The Data Connect pipeline already proves the pattern: `schema.gql` → (a) Firebase SDK via `firebase:generate`, (b) TypeBox row schemas via the home-grown `generate_dataconnect_schemas.ts` parser. The same idea for turso: define tables once (e.g. TypeBox object schemas or a `.sql`/DSL), generate (1) DDL (idempotent CREATE TABLE IF NOT EXISTS, migrations), (2) row types, (3) repository helpers. Claude should weigh: a migration framework (like `drizzle-kit`/`kysely`/`better-sqlite3`-style) vs staying with hand-rolled DDL + generated types.

### Q7: Redis / other databases?

- No Redis anywhere today (grep confirms; only unrelated matches like `world_gen.ts`). Claude should evaluate: hub rate-limiting/session cache, catalog caching, presence/leaderboards, queueing for AI jobs — vs the cost of another infra dependency. Note the project is a **local-first, self-hostable** product (BYOK philosophy, see `apps/frontend/site/src/content/blog/self-hosted-byok-philosophy.mdx`), so any added infra must stay optional/self-hostable.

---

## 4. Schema duplication map (the double-maintenance pain)

| Entity | Firestore schema | Data Connect (SQL + generated row) | Turso DDL | Types pkg | Notes |
|---|---|---|---|---|---|
| User | `firestore/user.ts` | `schema.gql User` + `generated-dataconnect/user.ts` | — | `types/.../firestore/user.ts` | Firestore→DC sync triggers only log, don't sync |
| Persona | `firestore/persona.ts` | `schema.gql Persona` + `generated-dataconnect/persona.ts` | — | `types/.../firestore/persona.ts` | hub uses DC; client boot uses Firestore — **both live** |
| Npc | `firestore/npc.ts` | `schema.gql Npc` + `generated-dataconnect/npc.ts` | `npc_schedules` (different shape) | `types/.../firestore/npc.ts` | client uses Firestore |
| Chat | `firestore/chat.ts` | `schema.gql Chat` (idle) | `chat_history` (session-based, different) | `types/.../firestore/chat.ts` | client chat = Firestore + turso writes |
| Message | `firestore/message.ts` | `schema.gql Message` (idle) | `chat_history` rows | `types/.../firestore/message.ts` | same |
| Notification | `firestore/notification.ts` | `schema.gql Notification` (idle) | — | `types/.../firestore/notification.ts` | ND-1: two different notification models (in-app vs marketing) |
| Config | `firestore/config.ts` | `schema.gql Config` | `meta` table | `types/.../firestore/config.ts` | ND-3 unresolved |
| SaveSlot | — | `schema.gql SaveSlot` + generated | `saves` table (payload JSONB) | — | blob in Firebase Storage; DC metadata + turso local copies |
| AudioTrack | — | `schema.gql AudioTrack` (catalog) | — | — | only DC table with no Firestore twin |
| Item/Lorebook/Memory/World/Skills/Relationship/... | `firestore/*.ts` | — | — | `types/...` | Firestore-only schemas, no SQL twin yet |

---

## 5. Known design debt / open questions Claude should address

1. **Store-per-entity strategy.** Which store is the source of truth for each domain: user-owned content (personas, saves, NPCs, chat) → turso cloud (via libSQL sync) vs Firestore vs Data Connect? Shared catalog (packs, audio, public NPCs) → Data Connect vs static CDN vs Firestore? Realtime (notifications, group chat) → Firestore only?
2. **Is Firebase Data Connect worth it at all?** It's emulator-only, `@auth` is operation-level only (no table-level), no client transactions (`@firebase/data-connect@0.7.3`), requires a hand-applied partial-index migration, generated SDK is a browser SDK, and it's excluded from staging/prod for cost. Alternatives: direct Postgres/Cloud SQL (or Supabase/Neon) via `pg` on the hub server; or Turso cloud for both client sync AND hub reads (one SQL dialect everywhere); or keep Firestore for everything (it already works, has rules, offline SDK, realtime).
3. **Hub SSR data access pattern.** Replace frontend-SDK-in-Bun with server-side gateway (Elysia API + `pg`/admin/Data Connect REST) authenticated by the existing session cookie; close the `PUBLIC`-auth data-exposure holes (`ListPersonas` with public read).
4. **Client still on Firestore for personas/NPCs/chats.** Either finish the migration (client → turso local-first, sync to turso cloud; hub reads turso cloud) or accept Firestore for those and drop the Data Connect mirror (avoid triple storage).
5. **Turso cloud sync.** Should the C-203 libSQL sync (local DB → Turso edge DB, per-user auth via Firebase custom tokens) be the backbone? It's the missing link that would let the hub read "the user's turso". Note libSQL sync is database-granular (whole DB sync), which conflicts with multi-tenant per-user data in one DB — may need per-user DBs or a different sync design (e.g. CRDT per-document, or "local DB + cloud API" instead of DB-level sync).
6. **Schema single-source + codegen.** One definition per entity → generate TypeBox rows (done for DC), turso DDL + types (not done), Firestore schemas (hand-written), and types pkg (hand-written). Is a meta-DSL (like the DC `schema.gql` + parser) the right approach, or adopt a real ORM/migration tool (drizzle/kysely/prisma) for the SQL side?
7. **Redis / caching / queues.** Needed for hub (sessions, rate limits, catalog caching, background jobs like AI generation or pack indexing)? Must stay optional/self-hostable.
8. **Cost/scale target.** Data Connect excluded from prod "to not pay for it yet" — is Cloud SQL in the budget? Is Firestore's cost model (per-doc read) acceptable for chat at scale, or should chat move to a relational DB with realtime via something else?
9. **The ND-1..ND-6 open items** in `schema-refactor-decisions.md` (notification model conflict, chat delete semantics, config model, persona visibility, audio mood enum, ungoverned JSONB columns) — several become moot if the store split changes; otherwise they need decisions.

---

## 6. Most useful files for the reviewer (quick start)

**Architecture/design docs**
- `docs/architecture/architecture.md`
- `apps/backend/firebase/dataconnect/schema/firestore-vs-dataconnect.md`
- `apps/backend/firebase/dataconnect/schema/schema-refactor-decisions.md`
- `docs/contracts/C-203-local-first-turso-sync.md`, `C-321-...turso-source-of-truth.md`, `C-373-turso-asset-registry-opfs-cache.md`, `C-374-hub-firestore-to-dataconnect.md`
- `docs/guides/FEATURES.md`

**Data Connect**
- `apps/backend/firebase/dataconnect/schema/schema.gql`
- `apps/backend/firebase/dataconnect/connector/queries.gql`
- `apps/backend/firebase/scripts/generate_dataconnect_schemas.ts`
- `packages/frontend/dataconnect/src/index.ts`, `packages/frontend/configs/src/lib/data_connect.ts`
- `packages/backend/firestore/src/lib/firebase_data_connect_service.ts`

**Hub**
- `apps/frontend/hub/src/routes/(authenticated)/personas/+page.server.ts`
- `apps/frontend/hub/src/lib/client/services/dataconnect/{persona_repository,persona_mapper,persona_data}.svelte.ts`
- `apps/frontend/hub/src/lib/server/api/index.ts`, `apps/frontend/hub/src/hooks.server.ts`
- `apps/frontend/hub/moon.yml`, `apps/frontend/hub/package.json`

**Turso/local storage**
- `packages/frontend/storage/src/lib/{storage_adapter,turso_storage_adapter,wasm_storage_adapter,local_database_factory,assets}.ts`
- `packages/frontend/engine/src/sync/firebase_sql_connect_sync.ts` (note: references a `string_registry` table/query that doesn't exist in the DC schema — stale/aspirational)

**Client data services (Firestore + turso usage)**
- `apps/frontend/client/src/lib/services/{persona/persona_firestore,npc/npc_firestore,chat/npc_chat_firestore,chat/conversation_storage,chat/connected_chats_service,game/game_boot_service}.svelte.ts`

**Schemas / types**
- `packages/shared/schemas/src/lib/{firestore,generated-dataconnect,game}/`
- `packages/shared/types/src/lib/firestore/`

**Config/deploy**
- `apps/backend/firebase/firestack.config.ts` (line 21: Data Connect excluded from staging/prod)
- `apps/backend/firebase/moon.yml` (generate tasks)
- `apps/backend/firebase/dataconnect/migrations/persona_one_active.sql`
