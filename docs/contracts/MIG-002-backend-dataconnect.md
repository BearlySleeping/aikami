<!-- completed: 2026-06-29 -->
# Contract: MIG-002 — Backend DataConnect Restructure

| Metadata     | Value                                                 |
| ------------ | ----------------------------------------------------- |
| Source       | Architect                                             |
| Target       | `apps/backend/firebase`, `packages/frontend/services` |
| Priority     | P1                                                    |
| Dependencies | C-117                                                 |
| Status       | completed                                             |
| Version      | 1.0.0                                                 |

## Overview

Implement the hybrid persistence approach for game saves. This involves updating the Data Connect PostgreSQL schema to store queryable `SaveSlot` metadata, while establishing the Firebase Cloud Storage pipeline to handle the dense ECS serialized blobs.

## Design Reference

Data Connect handles relational Account/Global State (like which slot you are using, time played, and map location), while Firebase Cloud Storage handles the high-frequency simulation state. The frontend `GameStateSyncService` orchestrates the two seamlessly.

## Architecture Directives

- Add a `SaveSlot` type to `apps/backend/firebase/dataconnect/schema/schema.gql`.
- Add queries and mutations for `SaveSlot` to `apps/backend/firebase/dataconnect/connector/queries.gql`.
- Regenerate the frontend Data Connect SDK by running the appropriate moon task or Firebase CLI command.
- Verify and update `packages/frontend/services/src/lib/firebase/firebase_storage.ts` to expose reliable string/blob upload and download methods.
- Create `GameStateSyncService` in `packages/frontend/services` to act as the orchestrator bridge between `EcsSerializer`, `FirebaseStorage`, and `DataConnect`.

## State & Data Models

    type SaveSlot @table {
      id: String! @col(name: "id")
      uid: String! @col(name: "uid")
      createdAt: Date @col(name: "created_at")
      updatedAt: Date @col(name: "updated_at")

      slotNumber: Int! @col(name: "slot_number")
      lastLocationName: String @col(name: "last_location_name")
      playedTimeSeconds: Int @col(name: "played_time_seconds")
      storageRef: String! @col(name: "storage_ref")
    }

## Acceptance Criteria

- **Given** the updated schema and regenerated SDK,
- **When** the frontend executes the `UpsertSaveSlot` mutation,
- **Then** a `SaveSlot` row is successfully created or updated in the Data Connect emulator.
- [Test Hook] Unit/integration tests in `packages/frontend/services` to verify the Data Connect mutation works.

- **Given** an ECS snapshot string payload,
- **When** `GameStateSyncService.saveGame(uid, slot, payload, metadata)` is called,
- **Then** the string is uploaded to `saves/{uid}/slot_{n}.json` in Cloud Storage AND the corresponding `SaveSlot` metadata row is updated via Data Connect.
- [Test Hook] Unit/integration tests verify the orchestrator calls both Firebase Storage and Data Connect correctly.

## Implementation Notes

1. Update `apps/backend/firebase/dataconnect/schema/schema.gql` with the new `SaveSlot` table.
2. Add `ListSaveSlots` (query) and `UpsertSaveSlot` (mutation) to `queries.gql`.
3. Run `moon run dataconnect:generate` (or equivalent backend build task) to update the generated TS definitions.
4. Ensure `apps/backend/firebase/src/rules/storage.rules` allows users to read/write `saves/{request.auth.uid}/...`.
5. Implement `GameStateSyncService` in the `services` package.

## Edge Cases & Gotchas

- **Storage Security:** Ensure Firebase Storage security rules are tightly scoped so players can only overwrite their own save files. We don't want cross-account save corruption.
- **SDK Sync:** The SvelteKit dev server might need a restart after Data Connect regenerates the TypeScript SDKs due to Vite caching.
