## Metadata

| Field | Value |
|---|---|
| **Source** | Active memory: "Abstraction & Wrappers First" + "Firebase Data Connect (PostgreSQL) for the database"; existing `BaseRepository` / `BackendRepository` Firestore pattern |
| **Target** | `packages/backend/database/` — BaseDatabaseService interface + FirebaseDataConnectService; `packages/shared/mocks/` — MockDatabaseService; `apps/backend/functions/firestack.config.ts` — Data Connect emulator |
| **Priority** | P1 — Foundation for replacing Firestore with Data Connect; enables TDD with mockable database abstraction |
| **Dependencies** | C-005 (packages/shared structure), C-009 (standardized moon configs), C-013 (Tauri/PixiJS tooling — same priority tier) |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Overview

Replace the project's tight coupling to Firestore NoSQL with a vendor-agnostic `BaseDatabaseService` interface. Implement a `FirebaseDataConnectService` that satisfies this interface using Firebase Data Connect (PostgreSQL) as the first concrete backend. Create a `MockDatabaseService` for frontend unit testing without the emulator. Configure the local Firebase Emulator Suite to run the Data Connect (PostgreSQL) emulator alongside existing services. This is the first step in the "Abstraction & Wrappers First" architectural mandate — all future database code goes through the interface, never directly against Firestore or Data Connect.

## Design Reference

**Existing pattern to generalize**: `packages/shared/utils/src/lib/repository/base-repository-class.ts`
- `BaseRepository<T>` is already an abstract class with CRUD interface
- `BackendRepository<T>` extends it with Firestore-specific implementation
- `BaseFrontendRepository<T>` extends it for client-side Firestore SDK

**Goal**: Wrap the repository layer behind a `BaseDatabaseService` interface so the underlying engine (Firestore today, Data Connect tomorrow, in-memory DB for tests) is fully swappable.

**Data Connect (PostgreSQL) fundamentals**:
- Firebase Data Connect uses Cloud SQL for PostgreSQL under the hood
- Schema defined via `.gql` GraphQL SDL files + Data Connect YAML configs
- Queries defined as GraphQL operations (`.gql` files)
- SDK: `@firebase/data-connect` provides typed client via code generation
- Local emulator: `firebase emulators:start` with `dataconnect` service (Java-based, same suite)
- Firestack (`@snorreks/firestack`) supports Data Connect emulator via `--only dataconnect` or `emulators` config

## Changes Detail

### 1. BaseDatabaseService Interface (`packages/backend/database/`)

Define a TypeScript `interface` (OOP contract — correct use of `interface` per our coding rules) with generic CRUD operations:

```typescript
interface BaseDatabaseService {
  getDocument<T>(path: string, id: string): Promise<T | undefined>;
  getDocuments<T>(collection: string, filters?: QueryFilter[]): Promise<T[]>;
  addDocument<T>(collection: string, data: T): Promise<string>;
  setDocument<T>(path: string, id: string, data: T): Promise<void>;
  updateDocument<T>(path: string, id: string, data: Partial<T>): Promise<void>;
  deleteDocument(path: string, id: string): Promise<void>;
  runQuery<T>(query: string, params?: Record<string, unknown>): Promise<T[]>;
}
```

This interface lives in `packages/backend/database/src/lib/base-database-service.ts`. It must NOT import any Firebase-specific types — pure domain types only.

### 2. FirebaseDataConnectService (`packages/backend/database/`)

Implement the interface using Firebase Data Connect:

- `packages/backend/database/src/lib/firebase-data-connect-service.ts`
- Uses `@firebase/data-connect` SDK for GraphQL-to-PostgreSQL operations
- Translates the abstract CRUD methods to Data Connect GraphQL queries
- Handles connection initialization, schema compatibility, error mapping
- This replaces the current `BackendRepository` Firestore implementation incrementally — existing Firestore repos continue working until migrated

### 3. Data Connect Emulator Configuration

Configure `apps/backend/functions/firestack.config.ts` (or a new `firebase.json` at root) to include the Data Connect emulator:

```json
{
  "emulators": {
    "dataconnect": {
      "port": 9399,
      "postgresPort": 5432
    },
    "firestore": { "port": 8080 },
    "auth": { "port": 9099 },
    "functions": { "port": 5001 }
  }
}
```

Create `apps/backend/dataconnect/` directory with:
- `dataconnect.yaml` — Data Connect service config
- `schema/schema.gql` — PostgreSQL schema in GraphQL SDL
- `connector/connector.yaml` — connector configuration

### 4. MockDatabaseService (`packages/shared/mocks/`)

Create an in-memory implementation for TDD:

- `packages/shared/mocks/src/lib/mock-database-service.ts`
- Stores data in a `Map<string, Map<string, unknown>>` (collection → document)
- Implements `BaseDatabaseService` exactly
- Provides seed helpers: `seedCollection(name, docs)` for test fixture setup
- Provides reset helper: `reset()` to clear all data between tests
- Used by frontend unit tests (PWA) and backend unit tests (functions) when no emulator is needed

### 5. Coding Standards Enforced

Per the active memory architectural mandate, this contract's implementation MUST follow:
- **`const` over `function`**: Arrow functions for all callbacks and module-level functions; `function` reserved for generator functions only
- **Escape early**: Guard clauses at the top of every method — validate preconditions and return/throw before the happy path
- **`{}` always**: Every `if`, `else if`, `else`, `for`, `while` body wrapped in curly braces, even single-line
- **`type` vs `interface`**: `type` for data shapes (params, return types, options); `interface` only for OOP contracts (the `BaseDatabaseService` itself)
- **Tests first**: Write failing tests against the interface before implementing the service — TDD from the mock through the real implementation

## Acceptance Criteria

### AC-1: BaseDatabaseService Interface Defined
**Given** the project currently couples all database code to Firestore
**When** `BaseDatabaseService` is created
**Then** `packages/backend/database/src/lib/base-database-service.ts` exports a pure TypeScript `interface` with no Firebase imports, defining CRUD + query operations

**Test Hooks**:
- Unit: `test -f packages/backend/database/src/lib/base-database-service.ts`
- Unit: File contains zero imports from `firebase`, `@firebase`, `@google-cloud/firestore`, or `firestore`
- Unit: Interface exports `getDocument`, `getDocuments`, `addDocument`, `setDocument`, `updateDocument`, `deleteDocument`, `runQuery`

**Watch Points**:
- Must use `interface` (not `type`) — this is an OOP contract per our coding rules
- Generic parameters must be unconstrained — no coupling to any specific data shape

### AC-2: FirebaseDataConnectService Implements Interface
**Given** the `BaseDatabaseService` interface
**When** `FirebaseDataConnectService` is implemented
**Then** it satisfies the interface and uses `@firebase/data-connect` SDK for all operations

**Test Hooks**:
- Unit: `test -f packages/backend/database/src/lib/firebase-data-connect-service.ts`
- Unit: TypeScript `implements BaseDatabaseService` compiles without errors
- Unit: File imports from `@firebase/data-connect` or `firebase/data-connect`
- Integration: Service initializes against Data Connect emulator without errors

**Watch Points**:
- Initialization must be lazy or explicit — do NOT connect to Data Connect at import time
- Error mapping: Data Connect errors must be translated to domain errors, not raw Firebase errors surfaced to callers

### AC-3: Data Connect Emulator Configured
**Given** the local development environment
**When** the emulator is started with Data Connect
**Then** `firebase emulators:start --only dataconnect` starts PostgreSQL locally on port 5432 and Data Connect on port 9399

**Test Hooks**:
- Unit: `test -f apps/backend/dataconnect/dataconnect.yaml`
- Unit: `test -f apps/backend/dataconnect/schema/schema.gql`
- Unit: `test -f apps/backend/dataconnect/connector/connector.yaml`
- Integration: `firebase emulators:start --only dataconnect` starts without errors
- Integration: Data Connect emulator UI accessible at `http://localhost:9399`

**Watch Points**:
- PostgreSQL port 5432 must not conflict with any local PostgreSQL instance — document this in setup
- The `dataconnect` emulator requires Java (same as other Firebase emulators) — document prerequisite
- Schema must reflect the existing Firestore collections as PostgreSQL tables for migration path

### AC-4: MockDatabaseService for TDD
**Given** the `BaseDatabaseService` interface
**When** unit tests need a database without the emulator
**Then** `MockDatabaseService` implements the interface in-memory with `seedCollection()` and `reset()` helpers

**Test Hooks**:
- Unit: `test -f packages/shared/mocks/src/lib/mock-database-service.ts`
- Unit: TypeScript `implements BaseDatabaseService` compiles without errors
- Unit: `seedCollection('users', [{id: '1', name: 'Test'}])` → `getDocument('users', '1')` returns the seeded data
- Unit: `reset()` clears all seeded data, subsequent `getDocument` returns `undefined`
- Unit: All CRUD methods operate on in-memory `Map` — no network, no emulator, no filesystem

**Watch Points**:
- Must be synchronous internally (no real async I/O) but methods return `Promise` to match the interface
- Must handle concurrent operations correctly (in-memory Map is single-threaded in Node/Bun, but tests may await interleaved)

### AC-5: TDD Workflow Demonstrated
**Given** the full abstraction stack
**When** a new repository is created
**Then** the TDD workflow is: write test using `MockDatabaseService` → test fails → implement using `FirebaseDataConnectService` → test passes → integration test against emulator

**Test Hooks**:
- Integration: At least one example test file (e.g., `packages/backend/database/tests/user-repository.test.ts`) demonstrates:
  1. Unit test with `MockDatabaseService` (fast, no emulator)
  2. Integration test with `FirebaseDataConnectService` + Data Connect emulator (slow, full stack)
- Integration: Both test suites pass with `bun test`

**Watch Points**:
- The example test must cover one real repository (e.g., `UserRepository`) to validate the abstraction works end-to-end
- Mock tests should run in < 100ms; integration tests will be slower and can be skipped with `--no-emulator` flag

## Implementation Notes

### Coding Rules (must be followed throughout implementation)

1. **Prefer `const` over `function`** — Use arrow functions for all callbacks and module-level functions. Reserve `function` only for generator functions (`function*`).
2. **Escape early** — Every method begins with guard clauses. Validate preconditions at the top; return or throw before the happy path indents.
3. **Always `{}` for `if`** — Every `if`, `else if`, `else`, `for`, `while` body is wrapped in curly braces `{}`, even for single-line statements.
4. **`type` for data, `interface` for contracts** — Use `type` for parameter shapes, return types, option bags. Use `interface` exclusively for OOP abstraction contracts (the `BaseDatabaseService` itself is the canonical example).
5. **Tests first** — Write the test before the implementation. Tests use `MockDatabaseService`; then implement `FirebaseDataConnectService` to make the same tests pass against the emulator.

### Files to create
- `packages/backend/database/src/lib/base-database-service.ts` — interface
- `packages/backend/database/src/lib/firebase-data-connect-service.ts` — Data Connect implementation
- `packages/shared/mocks/src/lib/mock-database-service.ts` — in-memory mock
- `apps/backend/dataconnect/dataconnect.yaml` — Data Connect service config
- `apps/backend/dataconnect/schema/schema.gql` — initial PostgreSQL schema (mirrors core Firestore collections)
- `apps/backend/dataconnect/connector/connector.yaml` — connector config
- `packages/backend/database/tests/user-repository.test.ts` — TDD example test (mock + integration)

### Files to modify
- `apps/backend/functions/firestack.config.ts` — add Data Connect emulator config
- `packages/backend/database/package.json` — add `@firebase/data-connect` dependency
- `packages/backend/database/moon.yml` — add test task, update deps
- `packages/shared/mocks/package.json` — ensure `@aikami/backend-database` is a dependency (for the interface import)
- `.moon/workspace.yml` — add `dataconnect` project entry

### Files to delete
- None (existing Firestore repositories remain until incremental migration)

### Order of operations
1. Define `BaseDatabaseService` interface first (no deps, pure contract)
2. Create `MockDatabaseService` (depends on interface only)
3. Write TDD example test against `MockDatabaseService` — **verify it fails**
4. Scaffold Data Connect emulator config (`dataconnect.yaml`, schema, connector)
5. Implement `FirebaseDataConnectService` — make the TDD test pass against emulator
6. Configure `firestack.config.ts` with Data Connect emulator
7. Run full test suite: `bun test` (mock) + `bun test --emulator` (integration)
8. Verify emulator starts with `firebase emulators:start --only dataconnect`

### Verification
- `bun test` in `packages/backend/database/` passes (mock tests only, no emulator)
- `bun test --emulator` passes (integration tests against Data Connect emulator)
- `firebase emulators:start --only dataconnect` starts successfully
- TypeScript compiles: `bun run typecheck` across all affected packages
- `MockDatabaseService` can be imported by `packages/frontend/repositories/` for PWA unit tests

## Edge Cases & Gotchas

- **Data Connect SDK code generation**: The `@firebase/data-connect` SDK requires running a code generator (`firebase dataconnect:generate`) after schema changes. This contract only sets up the initial schema — code generation is a follow-up step
- **PostgreSQL vs Firestore paradigm mismatch**: Firestore is document-based (nested data, no joins); PostgreSQL is relational (normalized tables, joins). The initial schema should mirror existing collection shapes as tables, with relationships modeled as foreign keys
- **Data Connect emulator Java requirement**: Same as other Firebase emulators — Java 11+ required. Document this in the setup guide
- **Port 5432 conflict**: If the developer already runs a local PostgreSQL instance, the Data Connect emulator's PostgreSQL will conflict. Provide a `dataconnect.yaml` config override for the port
- **Mock data consistency**: The `MockDatabaseService` uses in-memory `Map` — no schema validation. Tests must ensure data shapes match the real service. Consider adding optional Zod schema validation to the mock for type safety
- **Existing BackendRepository references**: The current codebase has `BackendRepository` used extensively in functions. This contract does NOT migrate those — it establishes the new abstraction path. Migration is a separate contract
- **Data Connect v1 vs v2**: Firebase Data Connect is in public preview with evolving APIs. Pin the SDK version and document the tested version in the contract
- **Cold start latency**: Data Connect emulator starts PostgreSQL from scratch on first run — first `emulators:start` may take 30-60 seconds. Warn developers
