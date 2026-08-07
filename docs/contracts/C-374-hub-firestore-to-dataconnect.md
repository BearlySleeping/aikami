---
id: C-374
title: "Hub: Move Persona Data from Firestore to Data Connect"
source: "direct draft (user request)"
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-07"
---

# Contract C-374: Hub: Move Persona Data from Firestore to Data Connect

## Metadata

| Field | Value |
|---|---|
| **Source** | Direct draft — user request: "refactor and make the hub app work (apps/frontend/hub), move from firestore to dataconnect" |
| **Target** | `apps/frontend/hub` (persona data layer: client service, SSR load, moon config) + `apps/backend/firebase/dataconnect` (schema.gql + connector/queries.gql) + `packages/frontend/dataconnect` (regenerated SDK + wrapper exports) + `packages/shared/schemas` (regenerated row schema) |
| **Priority** | P1 — the hub's only product-data feature (personas) is entirely Firestore-backed; this contract swaps that layer to Data Connect and removes the hub's Firestore dependency. It is also the first real consumer of the already-authored Data Connect schema, exercising the pipeline C-375+ Hub catalog work will build on |
| **Dependencies** | None blocking. Reuses the Data Connect scaffold from C-014 (completed) and the already-authored `Persona` table in `apps/backend/firebase/dataconnect/schema/schema.gql`. Package deps: `@aikami/frontend-dataconnect`, `firebase@12.17.1` / `@firebase/data-connect@0.7.3` (verified: **no client-side transaction API** in this SDK version), `@aikami/frontend-configs` (Data Connect singleton + emulator wiring) |
| **Status** | approved |
| **Promotion** | `integrated` |
| **Docs Impact** | internal → none (no user-facing docs; hub is a dashboard app) |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: The hub's personas feature (`apps/frontend/hub/src/routes/(authenticated)/personas/`) is the only product-data feature in the hub and is backed entirely by Firestore:
  - Client service: `apps/frontend/hub/src/lib/client/services/firestore/persona_data.svelte.ts` → `personaFirestoreRepository` (`@aikami/frontend/firestore/persona.ts` → `FirestoreFrontendRepository`), with a Firestore write batch for the one-active-persona invariant.
  - SSR load: `apps/frontend/hub/src/routes/(authenticated)/personas/+page.server.ts` → `personaFirestoreRepository` (`@aikami/backend/firestore/persona`), serializing via `toJsonData`.
  - The hub's `moon.yml` `dependsOn` includes `frontend-firestore` and `backend-firestore`; `package.json` carries `@google-cloud/firestore` and `firebase-admin` (grep of `apps/frontend/hub/src` → no usage).
- **Reproduction**:
  1. Start the hub in emulator mode, sign in, open `/personas`.
  2. List/create/activate/delete personas — all read/write the Firestore `personas` collection; the SQL `Persona` table is untouched.
  3. `grep "personaFirestoreRepository" apps/frontend/hub/src` → 2 files (client service + SSR load; 8 references total) — the entire persona data path is Firestore.
- **Existing implementation to reuse**:
  - `apps/backend/firebase/dataconnect/schema/schema.gql` — the `Persona` table already exists (`@table(key: "id")`, `owner: User! @ref`, `name`, `description`, `avatarUrl`, `uid`, `traits: Any`), plus `updatedAt_expr: "request.time"` conventions documented in `schema-refactor-decisions.md`. **Missing**: `isActive` and `voiceConfigId` columns.
  - `apps/backend/firebase/dataconnect/connector/queries.gql` — existing queries/mutations pattern (`ListSaveSlots`, `UpsertSaveSlot` with caller-constructed `{uid}_{slotNumber}` id). **Missing**: persona operations.
  - Codegen pipeline: `bun moon run firebase:generate` (firestack generate → `packages/frontend/dataconnect/src/lib/generated/`) and `bun moon run firebase:generate-dataconnect-schemas` (→ `packages/shared/schemas/src/lib/generated-dataconnect/persona.ts`, `PersonaRowSchema`).
  - Client call pattern: `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts` (`getTracksByMood(dataConnect, { mood })`) and `packages/frontend/services/src/lib/services/game_state_sync.svelte.ts` (`upsertSaveSlot(dataConnect, vars)`).
  - Server-side Data Connect pattern: `packages/backend/firestore/src/lib/firebase_data_connect_service.ts` (`FirebaseDataConnectService` — `initializeApp` + `getDataConnect` + `executeQuery`/`executeMutation` + domain-error mapping).
  - Emulator wiring: `packages/frontend/configs/src/lib/data_connect.ts` — `connectDataConnectEmulator(instance, 'localhost', EMULATOR_PORTS.dataconnect)` (port `9398`).
- **Known gaps**:
  - The generated SDK in `packages/frontend/dataconnect/src/lib/generated/` is stale: `connectorConfig.location = 'us-east4'` while `dataconnect.yaml` declares `location: "europe-west4"`; no persona operations exist.
  - `@firebase/data-connect@0.7.3` exposes **no client transaction API** (verified against `dist/public.d.ts` — only `getDataConnect`, `queryRef`, `mutationRef`, `executeQuery`, `executeMutation`, `subscribe`, `terminate`), so the Firestore write-batch atomicity of `setActivePersona` cannot be replicated client-side. The server-side GraphQL `@transaction` directive is a separate mechanism — see the `SetActivePersona` note under State & Data Models.
  - No Firestore→Data Connect sync layer exists for personas (`apps/backend/firebase/src/controllers/firestore/users/*` only log create/delete; `persona` grep in `apps/backend/firebase/src` → only `rules/firestore.rules`), so pre-existing Firestore persona documents will not appear after cutover.
  - `firestack.config.ts` sets `dataconnectDirectory: mode !== 'emulator' ? '_EXCLUDE_' : undefined` — Data Connect is not deployed to staging/production (see Open Questions).
- **Baseline tests**:
  - `moon run hub:test` — currently **no test files** in `apps/frontend/hub/src` (verified via find: no `*.test.ts`).
  - `moon run firebase:generate` and `moon run firebase:generate-dataconnect-schemas` — regeneration gates that must succeed after schema edits.
  - `moon run :typecheck` / `validate()`.

## User Outcome

After this contract, a signed-in hub user can browse, create, activate, update, and delete their personas through Data Connect (Postgres) exactly as they did through Firestore. The personas page looks and behaves identically; the hub's data layer no longer touches Firestore. The one-active-persona invariant is preserved under concurrency via a database-level constraint.

## Success Measures

- **Time/latency target**: Personas list (SSR + client refresh) completes in under 500ms against a warm local Data Connect emulator connection; create/update/delete/activate each complete in under 200ms. `ListPersonas` is capped at 100 rows.
- **Offline/degraded behavior**: N/A — the hub is a server-backed dashboard. If Data Connect is unreachable, repository calls fail with typed domain errors surfaced in the existing ViewModel error banner; there is no silent fallback path.
- **Production journey enabled**: The hub's persona feature becomes the platform's first production Data Connect consumer, exercising the exact SQL schema → connector → generated-SDK → typed-repository pipeline that the Hub catalog contracts (C-375+) will build on.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Hub persona service interface | `apps/frontend/hub/src/lib/client/services/firestore/persona_data.svelte.ts` | **Modify** — keep `PersonaDataServiceInterface` byte-identical (ViewModel/View depend on it); replace the Firestore repository with a Data Connect repository; move file to `lib/client/services/dataconnect/` |
| Hub personas SSR load | `apps/frontend/hub/src/routes/(authenticated)/personas/+page.server.ts` | **Modify** — query Data Connect `ListPersonas` instead of `@aikami/backend/firestore/persona`; keep the 401 gate and epoch-ms serialization contract |
| Data Connect schema | `apps/backend/firebase/dataconnect/schema/schema.gql` | **Modify** — add `isActive`, `voiceConfigId`, and `@index(fields: ["uid", "isActive"])` to `Persona` |
| Connector operations | `apps/backend/firebase/dataconnect/connector/queries.gql` | **Modify** — add persona queries/mutations with `@auth` (read PUBLIC per Firestore rules; writes USER + owner check) |
| Generated SDK | `packages/frontend/dataconnect/src/lib/generated/` + `src/index.ts` | **Regenerate** via `firebase:generate`; **modify** the hand-maintained wrapper `src/index.ts` to re-export the new persona operations |
| Generated row schema | `packages/shared/schemas/src/lib/generated-dataconnect/persona.ts` | **Regenerate** via `firebase:generate-dataconnect-schemas` (picks up new columns) |
| Client Data Connect call pattern | `packages/frontend/services/src/lib/services/game_state_sync.svelte.ts` (`upsertSaveSlot(dataConnect, vars)`) | **Reuse** — same call shape for persona operations |
| Server Data Connect pattern | `packages/backend/firestore/src/lib/firebase_data_connect_service.ts` | **Reference only** — adopt its error-mapping style (domain errors, never raw Firebase shapes) in the hub repository |
| Caller-constructed id precedent | `UpsertSaveSlot` (`id = "{uid}_{slotNumber}"`) | **Reuse** — `CreatePersona` takes a caller-generated `persona_<uuid>` id (the `Persona.id` column is `String!` with no default) |
| Firestore persona repos | `packages/frontend/firestore/src/lib/persona.ts`, `packages/backend/firestore/src/lib/persona.ts` | **Remove usage from hub only** — packages stay (the game client still consumes them) |
| One-active-persona invariant | Firestore write batch in `persona_data.svelte.ts` | **Replace** — partial unique index `ON persona (uid) WHERE is_active` (DB-level guarantee; no client transaction exists) |

## Overview

This contract moves the hub's persona data layer from Firestore to Data Connect. It adds two columns to the already-authored SQL `Persona` table (`isActive`, `voiceConfigId`), defines persona connector operations with server-side ownership enforcement, regenerates the typed SDK, and replaces the hub's client service + SSR load with a Data Connect repository that maps SQL rows to the existing shared `PersonaData` shape. The ViewModel, View, and page markup are untouched. A database-level partial unique index preserves the one-active-persona invariant that Firestore's write batch previously guaranteed. The hub stops depending on Firestore for product data.

## Design Reference

- **Connector/`@auth` conventions**: Follow `apps/backend/firebase/dataconnect/schema/schema-refactor-decisions.md` §5 — `@auth` is valid on QUERY/MUTATION only; per-table policy for `Persona` is "read: PUBLIC (per rules); writes: USER + owner filter". Every write operation must carry `@auth(level: USER, expr: "auth.uid == $uid")` (verify the exact CEL form this Data Connect version supports — see Open Questions; `schema-refactor-decisions.md` references the `uid_expr: "auth.uid"`/`id_expr` argument style as the alternative).
- **Caller-constructed ids**: Follow the `UpsertSaveSlot` precedent — `CreatePersona` requires `$id` generated by the caller (`persona_<uuid>`). Duplicate id → Postgres PK conflict → typed error, never a duplicate row.
- **Server-set timestamps**: Follow `schema-refactor-decisions.md` §2 — `createdAt`/`updatedAt` default to `request.time` on insert; **every update/activate mutation must pass `updatedAt_expr: "request.time"`** or the row's `updatedAt` goes stale.
- **Error mapping**: Adopt `FirebaseDataConnectService.toDomainError` style — repository methods wrap SDK errors into domain errors (`unauthenticated` / `not-found` / `internal` / conflict), never leaking `DataConnectError` shapes to the ViewModel.
- **MVVM unchanged**: The hub's `PersonasViewModel` (`apps/frontend/hub/src/lib/views/personas/personas_view_model.svelte.ts`) and `personas_view.svelte` are consumers only — the refactored service keeps the exact same interface, so they require zero changes.
- **Data Connect emulator**: The emulator runs on port `9398` (`EMULATOR_PORTS.dataconnect`), wired automatically by `packages/frontend/configs/src/lib/data_connect.ts` when `PUBLIC_MODE` is `emulator`/`testing`. Start the suite via `herdr_session start firebase` (never `moon_run_task` for `:dev`/`:preview`).

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Schema** (`apps/backend/firebase/dataconnect/schema/schema.gql`): Add to `Persona`:
  - `isActive: Boolean! @col(name: "is_active") @default(value: false)`
  - `voiceConfigId: String @col(name: "voice_config_id")`
  - Table-level `@index(fields: ["uid", "isActive"])` (mirrors the existing `Chat` table-level `@index` pattern).
  - Do not change existing columns, the `owner` relation, or the id strategy.
- **Connector** (`apps/backend/firebase/dataconnect/connector/queries.gql`): Add `ListPersonas`, `CreatePersona`, `UpdatePersona`, `DeletePersona`, `SetActivePersona` as specified under State & Data Models.
- **One-active invariant**: Add a partial unique index `ON persona (uid) WHERE is_active = true` via a new raw-SQL migration file `apps/backend/firebase/dataconnect/migrations/persona_one_active.sql` (predicted: the schema DSL cannot express partial indexes — verify; if the pinned version can, prefer the DSL and drop the SQL file). Apply to the emulator Postgres (`EMULATOR_DATACONNECT_URL`) during verification; document the Cloud SQL apply step for when Data Connect is enabled outside emulator mode.
- **Generated SDK** (`packages/frontend/dataconnect`): Regenerate via `bun moon run firebase:generate`; then extend `src/index.ts` to re-export `listPersonas`, `createPersona`, `updatePersona`, `deletePersona`, `setActivePersona` (and their refs/types) alongside the existing exports. Regenerate row schemas via `bun moon run firebase:generate-dataconnect-schemas`. Commit the generated files (they are tracked — no gitignore exclusion).
- **Hub client layer** (`apps/frontend/hub/src/lib/client/services/`): New `dataconnect/` directory (delete the `firestore/` directory):
  - `dataconnect/persona_repository.ts` — thin repository over the generated SDK functions (`listPersonas(dataConnect, ...)`, etc.), row↔`PersonaData` mapping, and error mapping. Pure module (no Svelte runes) so it is import-safe in both client and SSR.
  - `dataconnect/persona_data.svelte.ts` — the rewritten `PersonaDataService`; public interface unchanged; delegates to the repository; validates create/update inputs with `PersonaCreateSchema`/`PersonaUpdateSchema` from `@aikami/schemas` (replacing the Firestore repository's schema enforcement).
  - Update the `$services` barrel `apps/frontend/hub/src/lib/client/services/index.ts` (drop the firestore export, add the dataconnect export).
- **SSR load** (`apps/frontend/hub/src/routes/(authenticated)/personas/+page.server.ts`): Replace the `@aikami/backend/firestore/persona` import with `listPersonas(dataConnect, { uid })` from `@aikami/frontend/dataconnect`; keep the 401 gate and the epoch-ms timestamp serialization contract (map RFC 3339 → `Date.parse` epoch ms before returning).
- **Hub config**: `apps/frontend/hub/moon.yml` — add `frontend-dataconnect` to `dependsOn`; remove `frontend-firestore` and `backend-firestore` (verified: nothing else in the hub imports them). `apps/frontend/hub/package.json` — remove now-unused `@google-cloud/firestore` and `firebase-admin` dependencies (verified unused in `src/` and `scripts/`). The stale `firebase-admin` / `@google-cloud/firestore` entries in `vite.config.ts` `SERVER_ONLY_PACKAGES` become inert once the packages are gone (externalization only triggers on module resolution) — optionally remove them.
- **No changes** to `PersonasViewModel`, `personas_view.svelte`, `+page.svelte`, `+page.ts`, or any other hub route.

## State & Data Models

```graphql
# ── apps/backend/firebase/dataconnect/schema/schema.gql (Persona additions) ──
type Persona @table(key: "id") @index(fields: ["uid", "isActive"]) {
  # ...existing fields unchanged...

  # Hub one-active-persona flag. Atomicity is enforced by a partial unique
  # index on (uid) WHERE is_active = true — see
  # dataconnect/migrations/persona_one_active.sql. No client-side transaction
  # exists in @firebase/data-connect@0.7.3.
  isActive: Boolean! @col(name: "is_active") @default(value: false)

  # TTS voice configuration id (PersonaData.voiceConfigId parity).
  voiceConfigId: String @col(name: "voice_config_id")
}
```

```graphql
# ── apps/backend/firebase/dataconnect/connector/queries.gql (personas section) ──

# Read: PUBLIC — mirrors Firestore rules `personas/{personaId}: allow read: if true`.
# Public read is what makes SSR seeding work without re-authenticating the server.
query ListPersonas($uid: String!) @auth(level: PUBLIC) {
  personas(where: { uid: { eq: $uid } }, orderBy: { createdAt: DESC }, limit: 100) {
    id
    createdAt
    updatedAt
    name
    description
    avatarUrl
    uid
    traits
    isActive
    voiceConfigId
  }
}

# Write: USER + owner — the server rejects any caller whose uid differs from
# auth.uid. If @auth(expr:) is unsupported in this Data Connect version, use
# the CEL _expr argument style (uid_expr: "auth.uid") documented in
# schema-refactor-decisions.md §5. $id is caller-generated ("persona_<uuid>")
# following the UpsertSaveSlot precedent (Persona.id is String! with no default).
mutation CreatePersona(
  $id: String!
  $uid: String!
  $name: String!
  $avatarUrl: String
  $voiceConfigId: String
  $traits: Any
  $isActive: Boolean!
) @auth(level: USER, expr: "auth.uid == $uid") {
  persona_insert(
    data: {
      id: $id
      uid: $uid
      name: $name
      avatarUrl: $avatarUrl
      voiceConfigId: $voiceConfigId
      traits: $traits
      isActive: $isActive
    }
  )
}

# 🔴 OWNERSHIP ENFORCEMENT: `@auth(expr: "auth.uid == $uid")` only proves the
# caller passed their own uid — it does NOT scope the target row. Every
# row-level write therefore filters by BOTH id and uid in its `where` clause,
# so a caller can never address another user's row by id (the Firestore path
# enforced the same via `_getOwnedPersona` → "Persona not found"). Zero
# affected rows ⇒ the repository must throw a typed not-found error.
mutation UpdatePersona(
  $id: String!
  $uid: String!
  $name: String
  $avatarUrl: String
  $voiceConfigId: String
  $traits: Any
) @auth(level: USER, expr: "auth.uid == $uid") {
  persona_updateMany(
    where: { id: { eq: $id }, uid: { eq: $uid } }
    data: {
      name: $name
      avatarUrl: $avatarUrl
      voiceConfigId: $voiceConfigId
      traits: $traits
      updatedAt_expr: "request.time"
    }
  ) {
    id
  }
}

mutation DeletePersona($id: String!, $uid: String!)
@auth(level: USER, expr: "auth.uid == $uid") {
  persona_deleteMany(where: { id: { eq: $id }, uid: { eq: $uid } }) {
    id
  }
}

# One active persona per user. If the pinned dialect supports the server-side
# @transaction directive (documented in the dataconnect skill for multi-step
# mutations), wrap BOTH steps in @transaction so the deactivate+activate pair
# commits atomically and there is no transient zero-active window. Either way
# the partial unique index (uid) WHERE is_active is the concurrency backstop:
# the second concurrent activation fails with a unique-violation conflict
# instead of creating two active rows. Both steps are uid-scoped.
mutation SetActivePersona($id: String!, $uid: String!)
@auth(level: USER, expr: "auth.uid == $uid") {
  persona_updateMany(
    where: { uid: { eq: $uid }, isActive: { eq: true } }
    data: { isActive: false, updatedAt_expr: "request.time" }
  ) {
    id
  }
  persona_updateMany(
    where: { id: { eq: $id }, uid: { eq: $uid } }
    data: { isActive: true, updatedAt_expr: "request.time" }
  ) {
    id
  }
}
```

```sql
-- apps/backend/firebase/dataconnect/migrations/persona_one_active.sql
-- At most one active persona per user, enforced by Postgres.
-- Data Connect's schema DSL cannot express partial unique indexes (verify);
-- apply to the emulator DB (EMULATOR_DATACONNECT_URL) and to Cloud SQL when
-- Data Connect is deployed outside emulator mode.
CREATE UNIQUE INDEX IF NOT EXISTS persona_one_active_per_user
  ON persona (uid)
  WHERE is_active = true;
```

```typescript
// apps/frontend/hub/src/lib/client/services/dataconnect/persona_mapper.ts
// Row (generated SDK, re-exported from @aikami/frontend/dataconnect) → domain shape.
// PersonaRow:  { id, createdAt: string /* RFC 3339 */, updatedAt: string, name,
//                description?: string | null, avatarUrl?: string | null, uid,
//                traits?: unknown, isActive: boolean, voiceConfigId?: string | null }

// PersonaData (from @aikami/schemas, unchanged): flat character sheet — CoreSchema
// (id, createdAt/updatedAt as epoch-ms numbers in the hub wire format) +
// BaseCharacterSheetSchema fields at TOP level (name, race, class, level, ...) +
// { avatarUrl?, voiceConfigId?, uid?, isActive? }.

// Mapping rules (implementer must make them lossless for every field the
// personas view reads):
//   row → data: traits JSONB flattens back to top-level sheet fields (excluding
//     the top-level scalar columns id, createdAt, updatedAt, name, description,
//     avatarUrl, uid, isActive, voiceConfigId, priority); createdAt/updatedAt
//     convert RFC 3339 → epoch ms via Date.parse; description is dropped (not in
//     PersonaData); voiceConfigId is copied row.voiceConfigId → data.voiceConfigId
//     DIRECTLY (never inside traits — it is a top-level PersonaData field).
//   data → create/update row: sheet fields (minus the scalar columns above)
//     serialize into `traits`; name stays in the `name` column (do NOT duplicate
//     it inside traits); voiceConfigId maps to the `voice_config_id` column
//     (NOT traits); timestamps are never sent (server-set); updatedAt on
//     update is server-set via updatedAt_expr.
export type PersonaRow = {
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  description?: string | null;
  avatarUrl?: string | null;
  uid: string;
  traits?: unknown;
  isActive: boolean;
  voiceConfigId?: string | null;
};

// Repository facade (used by PersonaDataService; import-safe in client and SSR).
export type PersonaRepository = {
  listByOwner(options: { uid: string }): Promise<PersonaData[]>;
  create(options: { uid: string; data: PersonaCreateData & { isActive: boolean } }): Promise<string>;
  update(options: { uid: string; personaId: string; data: PersonaUpdateFields }): Promise<void>;
  remove(options: { uid: string; personaId: string }): Promise<void>;
  setActive(options: { uid: string; personaId: string }): Promise<void>;
};
```

## Quality Requirements

- **Offline/degraded mode**: N/A — the hub is server-backed; Data Connect unreachable → repository throws a typed domain error, surfaced by the existing ViewModel error banner. No silent fallback, by design.
- **Accessibility/input**: N/A — zero UI changes; View/ViewModel untouched.
- **Performance budget**: `ListPersonas` (limit 100) < 500ms and single-row writes < 200ms against a warm emulator connection. No N+1: the personas list is one query; no per-row round trips.
- **Security/privacy**: Every write operation is `@auth(level: USER)` with a server-side owner check (`auth.uid == $uid` or CEL `_expr` equivalent) — the repository never trusts a client-supplied owner identity beyond the signed-in uid. Additionally, every row-level write filters by `uid` in its `where` clause (see connector snippets) so a caller cannot address another user's row by id; zero affected rows maps to a typed not-found error. Reads are PUBLIC, matching the existing Firestore rules (personas carry no visibility field; ND-4 in `schema-refactor-decisions.md` remains the open product question — unchanged by this contract). Persona payloads contain no PII beyond `name`/`avatarUrl`/sheet data already exposed via the existing profile surface.
- **Persistence/migration**: Additive schema change only (`isActive` defaults `false`, `voiceConfigId` nullable) — existing rows stay valid. This is a cutover, not a data migration: pre-existing Firestore persona documents are not copied to Data Connect (see Migration & Rollback / Open Questions).
- **Cancellation/retry/idempotency**: `CreatePersona` with a caller-generated `persona_<uuid>` id is idempotency-safe — a retried call hits the PK constraint and fails with a typed conflict error instead of duplicating a row. `SetActivePersona` fails closed via the partial unique index (never two active rows). No client transaction API exists in `@firebase/data-connect@0.7.3` (verified) — do not attempt one.
- **Observability**: Repository/service log `operation + uid + personaId` (never the full persona payload or `traits`). Data Connect errors are wrapped into domain errors with the operation name and connector operation name, mirroring `FirebaseDataConnectService.toDomainError`.

## Migration & Rollback

- **Old data compatibility**: Additive columns only; existing SQL rows unaffected. Firestore persona documents remain untouched (the hub simply stops reading them). The game client (`apps/frontend/client`) still reads personas from Firestore and is out of scope — personas created in the hub will not appear there until that service also moves (tracker note, see Edge Cases).
- **Migration**: 1) Edit `schema.gql` + `connector/queries.gql`; 2) run `bun moon run firebase:generate` and `bun moon run firebase:generate-dataconnect-schemas`; 3) apply `persona_one_active.sql` to the emulator Postgres; 4) swap the hub data layer; 5) verify against the emulator (`herdr_session start firebase`). No backfill.
- **Rollback**: Revert the hub service/SSR to the Firestore repository (git revert of the hub diff), revert schema/connector changes, regenerate the SDK. The two data layers are independent — no data written by the new path is visible to the old one, so rollback is safe but drops Data Connect-created rows.
- **Feature flag or kill switch**: Not required for emulator-first scope. If the hub must keep working in staging/production before Data Connect is enabled there, see Open Questions — the personas page will fail in non-emulator modes until `firestack.config.ts` includes `dataconnectDirectory` and Data Connect is deployed.
- **Failure recovery**: N/A — additive schema; no data being migrated; verification targets the emulator.

## Scope Boundaries

- **In Scope:**
  - `Persona` schema additions (`isActive`, `voiceConfigId`, `@index`) in `apps/backend/firebase/dataconnect/schema/schema.gql`.
  - Persona connector operations in `apps/backend/firebase/dataconnect/connector/queries.gql` with `@auth` enforcement.
  - Partial unique index migration `apps/backend/firebase/dataconnect/migrations/persona_one_active.sql` (+ emulator apply; Cloud SQL apply documented).
  - SDK regeneration (`packages/frontend/dataconnect`) + row-schema regeneration (`packages/shared/schemas`) + wrapper re-exports in `packages/frontend/dataconnect/src/index.ts`.
  - Hub data layer: new `lib/client/services/dataconnect/` repository + rewritten service, `$services` barrel update, SSR load swap, `moon.yml`/`package.json` cleanup.
  - Unit tests for the row↔`PersonaData` mapper and repository error mapping; integration verification of the CRUD + one-active flow against the emulator.
- **Out of Scope:**
  - Any UI change (View, ViewModel, page markup, styles) — the page must look and behave identically.
  - Migrating/backfilling existing Firestore persona documents into Data Connect (separate contract if required — see Open Questions).
  - Enabling Data Connect deployment for staging/production (`firestack.config.ts` `dataconnectDirectory` change + Cloud SQL provisioning) — a billing/infra decision, recorded as an Open Question.
  - Moving the game client's persona service (`apps/frontend/client/src/lib/services/persona/`) off Firestore.
  - Any other hub route (dashboard, login, API proxies).
  - Removing `packages/frontend/firestore` / `packages/backend/firestore` from the monorepo (other consumers exist).

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** 4 ACs; 4 moon projects touched (`apps/backend/firebase`, `packages/frontend/dataconnect`, `packages/shared/schemas`, `apps/frontend/hub`). Not split: the three non-hub projects are a single dependency chain — the schema change produces the generated SDK + row schema that the hub swap consumes, and splitting would force cross-contract coordination on the same generated files (the same reason C-373 stayed unified around one regenerated artifact pair). There is no independently releasable intermediate state (a schema with no consumer is inert; a hub swap with no schema is broken). Emulator-first scope keeps the blast radius small.

## Acceptance Criteria

### AC-1: Persona Schema + Connector Operations Deploy and Regenerate Cleanly
**Given** the Data Connect emulator running with the updated `schema.gql` and `connector/queries.gql` (`herdr_session start firebase`)
**When** `bun moon run firebase:generate` and `bun moon run firebase:generate-dataconnect-schemas` succeed
**Then** the generated SDK (`packages/frontend/dataconnect/src/lib/generated/`) contains `listPersonas`, `createPersona`, `updatePersona`, `deletePersona`, `setActivePersona`; `PersonaRowSchema` (`packages/shared/schemas/src/lib/generated-dataconnect/persona.ts`) includes `isActive` and `voiceConfigId`; the generated `connectorConfig.location` matches `dataconnect.yaml` (`europe-west4`); and `moon run :typecheck` passes.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | regenerated SDK + row schema committed; `packages/frontend/dataconnect/src/index.ts` re-exports the five persona operations | N/A (SDK layer) | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run firebase:generate`, `moon run firebase:generate-dataconnect-schemas`, `moon run :typecheck`
- Integration: diff the regenerated `connectorConfig.location` against `dataconnect.yaml`; grep the generated `index.d.ts` for the five operation names
- E2E / Visual:
    - **Functional**: N/A — SDK layer, no UI.
    - **Visual**: N/A.

**Watch Points**:
- The generated SDK is currently stale (`location: 'us-east4'` vs `europe-west4` in `dataconnect.yaml`) — if regeneration does not correct it, stop and investigate the firestack generation source before proceeding.
- Generated files are committed; never hand-edit them (only the wrapper `src/index.ts` is hand-maintained).

### AC-2: Persona CRUD Round-Trips Through Data Connect with Lossless Mapping
**Given** the emulator running, a signed-in user in the auth emulator, and the generated SDK
**When** the hub repository performs `createPersona({ name })`, `listByOwner({ uid })`, `update({ personaId, data })`, and `remove({ personaId })`
**Then** rows persist in the SQL `Persona` table; `listByOwner` returns only the owning user's rows ordered `createdAt DESC`; every field the personas view reads round-trips losslessly (`id`, `name`, `avatarUrl`, `voiceConfigId`, `race`, `class`, `level`, `isActive`, sheet `traits`); timestamps are converted RFC 3339 → epoch ms; a create with a duplicate id fails with a typed conflict error rather than duplicating a row; update/delete/activate against a missing or not-owned row id throws a typed not-found error (zero affected rows).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + Integration | `apps/frontend/hub/src/lib/client/services/dataconnect/__tests__/persona_mapper.test.ts` (new — row↔PersonaData mapping, timestamp conversion, conflict error mapping) + emulator verification script | `/personas` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run hub:test` (unit), plus the new emulator verification script under `apps/frontend/hub/scripts/` (run after `herdr_session start firebase`)
- Integration: script asserts create → list → update → delete round-trip against the emulator Postgres
- E2E / Visual:
    - **Functional**: N/A — behavior verified at the repository/integration level; the page markup is unchanged.
    - **Visual**: N/A.

**Watch Points**:
- `traits` is an untyped `Any` column — the repository must validate inputs with `PersonaCreateSchema`/`PersonaUpdateSchema` before writing (replaces Firestore's repository-level schema enforcement).
- `name` lives in its own SQL column; do NOT duplicate it inside `traits` (see Open Questions on the exact traits boundary).
- `persona_updateMany` / `persona_deleteMany` return the affected rows via the `{ id }` selection — an empty result means the row is missing OR not owned; the repository must throw a typed not-found error (preserving the Firestore path's "Persona not found" behavior).

### AC-3: One-Active-Persona Invariant Holds Under Concurrency
**Given** a user with two personas, both inactive, and the partial unique index applied to the emulator DB
**When** two `setActive` calls for different personas execute concurrently (or back-to-back without refresh)
**Then** at most one `Persona` row has `is_active = true` at all times; the second concurrent activation fails with a unique-violation conflict surfaced as a typed error by the repository; a normal single `setActive` clears the previous active row and sets the new one.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration | emulator verification script — concurrent `setActive` assertion + single-activation flow; migration file `persona_one_active.sql` applied | `/personas` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run hub:test` (repository error-path unit test for the conflict case) + emulator script
- Integration: run two parallel `SetActivePersona` calls in the script and assert one succeeds, one fails, and exactly one active row remains
- E2E / Visual:
    - **Functional**: N/A — concurrency verified at the integration level.
    - **Visual**: N/A.

**Watch Points**:
- There is **no client transaction API** in `@firebase/data-connect@0.7.3` (verified against `dist/public.d.ts`) — the partial unique index is the guarantee; do not attempt to recreate the Firestore write-batch pattern.
- If the pinned dialect supports the server-side `@transaction` directive (documented in the dataconnect skill for multi-step mutations), wrap `SetActivePersona` in `@transaction` so the deactivate+activate pair is atomic (no transient zero-active window); the partial unique index remains the concurrency backstop regardless. Verify and document the outcome.
- The emulator Postgres persists between runs; the index must be reapplied after a schema drop (document the `psql` command against `EMULATOR_DATACONNECT_URL` in the migration file).

### AC-4: Hub Personas Page Works End-to-End with No Firestore Usage
**Given** the emulator and the hub running in emulator mode with a signed-in user
**When** the user opens `/personas`, creates a persona, sets it active, and deletes it
**Then** the UI behaves exactly as before (SSR-seeded list, create form, active badge, delete confirmation); no Firestore calls occur anywhere in the hub data path — `grep "personaFirestoreRepository" apps/frontend/hub/src` returns no matches and the hub `moon.yml` no longer lists `frontend-firestore`/`backend-firestore` in `dependsOn`; `moon run hub:test` passes.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Integration (manual browser check against emulator) | updated `+page.server.ts`, `persona_data.svelte.ts`, `moon.yml`, `package.json`; grep evidence; `moon run hub:test` green | `/personas` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run hub:test`, `moon run hub:build`, `moon run :validate`
- Integration: `herdr_session start firebase` + `bun run dev` (emulator mode); exercise the full persona flow in the browser; confirm the list is SSR-seeded (view-source shows personas) and that client refresh matches
- E2E / Visual:
    - **Functional**: N/A for this contract — no user-visible behavior change; the flow is covered by integration verification. A hub E2E spec (`apps/e2e`) may be added in a follow-up if the suite is extended to the hub.
    - **Visual**: N/A — markup/styles unchanged.

**Watch Points**:
- The SSR load must keep returning epoch-ms timestamps (the client `+page.ts` cast contract depends on it) — the mapper's RFC 3339 → epoch ms conversion must run server-side too.
- `ListPersonas` is PUBLIC by design (mirrors Firestore rules) so SSR works without re-authenticating the server; the page-level 401 gate in `+page.server.ts` stays.
- Verify the removed `package.json` deps (`@google-cloud/firestore`, `firebase-admin`) truly have zero import sites before removal (grep already shows none in `src/` or `scripts/`).
- The emulator verification script must sign in to the Auth emulator before exercising create/update/delete/activate — those are `@auth(level: USER)` and reject unauthenticated callers; PUBLIC `ListPersonas` alone cannot cover them.

**Watch Points (all ACs)**:
- Confirm the pinned Data Connect version supports `@auth(expr: ...)` on mutations; if not, use the CEL `_expr` argument style (`uid_expr: "auth.uid"`) referenced in `schema-refactor-decisions.md` §5 and document the deviation.
- Confirm whether the schema DSL supports partial unique indexes; predicted no → the raw SQL migration file is the mechanism.

## Implementation Sequence

1. **Phase 1 (Schema + Connector)**: Edit `schema.gql` (`isActive`, `voiceConfigId`, `@index`); add the five persona operations to `connector/queries.gql`; add `migrations/persona_one_active.sql`; run `firebase:generate` + `firebase:generate-dataconnect-schemas`; extend `packages/frontend/dataconnect/src/index.ts` re-exports; verify `connectorConfig.location` and typecheck.
2. **Phase 2 (Hub data layer)**: Build `lib/client/services/dataconnect/persona_repository.ts` (mapper + error mapping + validation); rewrite `persona_data.svelte.ts` against the same public interface; delete the `firestore/` service directory; update the `$services` barrel; swap the SSR load in `+page.server.ts`; update `moon.yml` and `package.json`.
3. **Phase 3 (Invariant + Tests)**: Apply the partial unique index to the emulator Postgres; write mapper unit tests; write the emulator verification script (`apps/frontend/hub/scripts/verify_persona_dataconnect.ts` or equivalent) covering CRUD + concurrent `setActive`; run `hub:test`.
4. **Phase 4 (Validation)**: Start the emulator suite, run the verification script, do the manual browser pass of `/personas`, run `validate()`, collect the grep evidence for AC-4.

## Edge Cases & Gotchas

- **Stale generated SDK**: The committed SDK predates the `dataconnect.yaml` location change (`us-east4` vs `europe-west4`) — always regenerate and commit; treat a location that still reads `us-east4` as a generator failure to investigate.
- **`traits` has no server-side validation**: The `Any` column accepts anything; the repository's TypeBox validation (`PersonaCreateSchema`/`PersonaUpdateSchema`) is the only gate — do not skip it.
- **Emulator Postgres persistence**: the Data Connect emulator DB (`EMULATOR_DATACONNECT_URL` from `@aikami/constants` — currently `postgresql://postgres@localhost:5432/dataconnect_emulator?sslmode=disable`) persists between runs; schema drops can strand the partial unique index — the migration file must be idempotent (`IF NOT EXISTS`) and its apply command documented.
- **`updatedAt` staleness**: Every update/activate connector call must pass `updatedAt_expr: "request.time"` (schema-refactor-decisions.md §2); forgetting it makes `updatedAt` stale and breaks the list ordering expectations.
- **Firestore bridge divergence**: The game client still reads personas from Firestore — hub-created personas will not appear in the game client until C-37X moves the client persona service too (tracker note; do not silently extend this contract).
- **Concurrent activation race**: The two-step `SetActivePersona` can transiently leave zero active rows (crash between steps); the invariant that matters — never two active — is enforced by the index; the UI recovers on refresh. If the dialect supports `@transaction`, wrapping the pair removes even the transient window (see AC-3 Watch Points).
- **SSR import safety**: The mapper/repository modules must be browser-API-free (pure TS) so they are import-safe in both the client bundle and the Bun SSR load.

## Open Questions

Must be resolved before status becomes `approved`:

- **Enable Data Connect outside emulator mode?** `apps/backend/firebase/firestack.config.ts` excludes `dataconnectDirectory` for staging/production ("we don't want to pay for it yet"). After this contract, the hub's personas page in staging/production depends on Data Connect being deployed there (Cloud SQL provisioning + billing). Options: (a) include the `firestack.config.ts` flip + deploy in this contract (recommended if "make the hub app work" includes staging/production), or (b) keep emulator-only verification and file a follow-up contract for production enablement.
- **Preserve existing Firestore personas?** No sync layer exists (`apps/backend/firebase/src/controllers` has no persona sync). Options: accept the cutover (recommended — hub persona data is dev/emulator data today), or add a one-time backfill script (new scope, requires a `ListPersonas`-shaped Firestore read + `CreatePersona`-shaped insert per document).
- **`@auth` ownership syntax**: Does the pinned Data Connect version support `@auth(level: USER, expr: "auth.uid == $uid")` on mutations, or must ownership use CEL `_expr` arguments (`uid_expr: "auth.uid"`) as referenced in `schema-refactor-decisions.md` §5? The implementer verifies against the actual version and documents the chosen form.
- **Partial unique index mechanism**: Confirm the schema DSL cannot express `CREATE UNIQUE INDEX ... WHERE is_active` (predicted). If the pinned version supports it, prefer the DSL; otherwise the raw SQL migration file (`dataconnect/migrations/persona_one_active.sql`) is the mechanism and its Cloud SQL apply step must be documented.
- **`traits` boundary**: `PersonaSheetSchema` includes `name`, but the SQL row has a separate `name` column. Store the sheet WITHOUT `name` in `traits` (recommended — no duplication) and update the `traits` field doc comment in `schema.gql` so the regenerated `PersonaRowSchema` comment stays truthful. Implementer confirms the round-trip is lossless for every field the personas view reads.

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
