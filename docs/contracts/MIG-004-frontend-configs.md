## Metadata

| Field | Value |
|---|---|
| **Source** | Aikami reference: `packages/frontend/configs/src/lib/` |
| **Target** | `packages/frontend/configs/src/lib/` — Align singleton pattern, environment schema, and barrel exports |
| **Priority** | P0 — Architectural boundary; all frontend apps depend on this module for Firebase initialization |
| **Dependencies** | MIG-003 (Scripting), `@aikami/constants`, `@aikami/schemas`, `@aikami/utils`, `@aikami/types` |
| **Status** | completed |
| **Contract version** | 1.0.0 |

## Overview

Align the `packages/frontend/configs` module with the Aikami standard. This module serves as the strict configuration boundary for all Aikami frontend applications, exporting Firebase service singletons (app, auth, firestore, storage, functions, etc.) and a validated environment singleton. The alignment replaces Aikami's current ad-hoc patterns (`PUBLIC_FLAVOR`, positional `toAppError`, `getFirestore()`-based firestore initializer) with Aikami's proven abstract-singleton pattern (`PUBLIC_MODE`, object-style `toAppError`, `initializeFirestore()` with options).

This also introduces shared constants (`modes`, `frontendAppIds`, `MODE_PROJECT_MAP`, `EMULATOR_PORTS`, `CLOUD_FUNCTIONS_REGION`) and shared schemas (`ModeSchema`, `FrontendAppIdSchema`, `LogLevelSchema`) that were missing in Aikami but required by the configs module.

## Design Reference

**Aikami pattern**: `packages/frontend/configs/src/lib/`

Key structural elements:
- `environment.ts` — Validates `import.meta.env` against a Zod master schema; exports a frozen `publicEnv` singleton plus helper functions (`getProjectId`, `isEmulatorModePublic`, etc.)
- `app.ts` — Singleton Firebase app via `getApps()` / `initializeApp()`; eagerly kicks off App Check via dynamic `import()`
- Each Firebase service (`auth.ts`, `firestore.ts`, `storage.ts`, `fcm.ts`, `functions.ts`, `analytics.ts`, `remote_config.ts`, `app_check.ts`) follows a consistent pattern: import the app singleton → initialize with emulator connection in emulator mode → export the singleton
- `data_connect.ts` — Factory function (not singleton) because multiple connectors may exist
- Barrel `index.ts` only re-exports `environment.ts`; services are imported directly by consumers
- All Firebase config values come from `publicEnv` (validated .env file), never hardcoded except the reCAPTCHA test key fallback in app_check

## Changes Detail

### Shared packages (prerequisites)

**`packages/shared/utils`** — Update `toAppError` signature
- Current: `toAppError(errorType, errorMessage, details?)` (positional)
- Target: `toAppError({ errorType, errorMessage, details? })` (object, matching Aikami)
- Update all callers in Aikami codebase

**`packages/shared/constants`** — Add project & emulator constants
- Create `src/lib/project.ts` with `modes`, `frontendAppIds`, `MODE_PROJECT_MAP`, `CLOUD_FUNCTIONS_REGION`
- Create `src/lib/emulator.ts` with `EMULATOR_PORTS`, `EMULATOR_HOSTS`, helper functions
- Update `src/index.ts` barrel

**`packages/shared/schemas`** — Add project & logging schemas
- Create `src/lib/project.ts` with `ModeSchema`, `FrontendAppIdSchema`, `ProjectIdSchema`
- Create `src/lib/logging/log_entry.ts` with `LogLevelSchema`, `LogEntrySchema`, etc.
- Create `src/lib/logging/index.ts` barrel
- Update `src/index.ts` barrel

### Configs module (primary target)

**Rewrite** `packages/frontend/configs/src/lib/environment.ts`
- Replace `PUBLIC_FLAVOR` → `PUBLIC_MODE`
- Replace `getFlavor()` → `getPublicMode()`
- Replace `isEmulatorMode()` → `isEmulatorModePublic()`
- Add `PUBLIC_APP_ID` with `FrontendAppIdSchema`
- Add `APP_REQUIREMENTS` map
- Add `getProjectId()` derived from `MODE_PROJECT_MAP`
- Export `EMULATOR_PORTS`
- Use `ModeSchema`, `LogLevelSchema`, `FrontendAppIdSchema` from `@aikami/schemas`
- Use `MODE_PROJECT_MAP` from `@aikami/constants`

**Rewrite** `packages/frontend/configs/src/lib/app.ts`
- Remove hardcoded emulator config (now comes from validated env)
- Use `getProjectId()` from environment instead of `PUBLIC_FIREBASE_PROJECT_ID` directly
- Eagerly kick off App Check via `void import('./app_check.ts')`
- Match Aikami singleton pattern exactly

**Rewrite** `packages/frontend/configs/src/lib/firestore.ts`
- Replace `getFirestore()` → `initializeFirestore(app, options)`
- Add `localCache` option based on `PUBLIC_ENABLE_FIRESTORE_OFFLINE_PERSISTENCE`
- Add `ignoreUndefinedProperties` option for production mode
- Use `EMULATOR_PORTS.firestore` instead of hardcoded `8080`
- Re-export `addDoc`, `doc`, `collection`, etc. via barrel re-exports

**Update** `packages/frontend/configs/src/lib/data_connect.ts`
- Replace hardcoded `DATACONNECT_EMULATOR_PORT` → `EMULATOR_PORTS.dataconnect`
- Replace `isEmulatorMode()` → `isEmulatorModePublic()`

**Create** Firebase service singletons:
- `auth.ts` — `getAuth(app)`, connect emulator, export `auth`
- `analytics.ts` — `getAnalytics(app)`, export `analytics`
- `app_check.ts` — `initializeAppCheck(app, ...)`, export `appCheck` + `getAppCheckToken`
- `fcm.ts` — `getMessaging(app)`, export `messaging`
- `functions.ts` — `getFunctions(app, region)`, connect emulator, export `functions`
- `remote_config.ts` — `getRemoteConfig(app)`, export `remoteConfig`
- `storage.ts` — `getStorage(app)`, connect emulator, export `storage`

**Update** `packages/frontend/configs/src/index.ts`
- Only re-export `environment.ts` (matching Aikami)
- Services are imported directly by consuming code

**Update** `packages/frontend/configs/package.json`
- Add `@aikami/utils` dependency (already used by environment.ts)

**Update** `packages/frontend/configs/tsconfig.json`
- Add `@aikami/constants` paths
- Add `@aikami/schemas` paths

**Preserve** `packages/frontend/configs/src/lib/feature-flags.ts` (Aikami-specific)

## Acceptance Criteria

### AC-1: Environment singleton validates and freezes on module load
**Given** A frontend app consumes `@aikami/frontend-configs`
**When** `publicEnv` is imported from `./lib/environment.ts`
**Then** The object is a frozen `MasterEnv` with all `PUBLIC_*` fields validated by Zod, including `PUBLIC_APP_ID`, `PUBLIC_MODE`, `PUBLIC_LOG_LEVEL`, and all Firebase config fields
**And** Missing or invalid fields cause a thrown `AppError` during import

**Test Hooks**:
- Unit: Import `publicEnv` in a test with mock `import.meta.env`; verify frozen, verify throw on bad values
- CI: `moon run frontend-configs:typecheck` passes

**Watch Points**:
- SSR reads `import.meta.env` differently than browser — the validator must work in both contexts
- `getProjectId()` must work when `publicEnv` is not yet available (but it always is — validated on import)

### AC-2: Firebase app singleton initializes once
**Given** No Firebase apps exist
**When** `app` (default export) is imported from `./lib/app.ts`
**Then** A Firebase app is created with config sourced from `publicEnv` and `getProjectId()`
**And** `app_check.ts` is dynamically imported as a side effect
**And** Subsequent imports return the same `app` instance

**Test Hooks**:
- Unit: Import `app`, verify `getApps().length === 1`
- CI: `moon run frontend-configs:typecheck` passes

**Watch Points**:
- Do NOT import `app_check.ts` synchronously — it creates a circular dependency; use `void import('./app_check.ts')`
- `getApps()[0]` must be checked before calling `initializeApp()`

### AC-3: Firebase services export lazily-initialized singletons
**Given** The Firebase app singleton is initialized
**When** A consumer imports `auth`, `firestore`, `storage`, `messaging`, `functions`, `analytics`, or `remoteConfig`
**Then** Each service is initialized via the corresponding Firebase SDK function (e.g., `getAuth(app)`)
**And** In emulator mode (`PUBLIC_MODE === 'emulator'`), the emulator connection is established
**And** Each export is a singleton (single instance per module lifetime)

**Test Hooks**:
- Unit: Test each service import in emulator and production modes
- CI: `moon run frontend-configs:typecheck` passes

**Watch Points**:
- `firestore` uses `initializeFirestore()` (not `getFirestore()`) for `localCache` and `ignoreUndefinedProperties` options
- `data_connect` is a factory, not a singleton — it's intentionally re-created per connector

### AC-4: Barrel index only exports environment
**Given** The configs module is complete
**When** `import { publicEnv, isEmulatorModePublic, getProjectId } from '@aikami/frontend-configs'` is used
**Then** Only environment exports are available via the barrel
**And** Firebase service singletons must be imported from their specific paths (e.g., `@aikami/frontend-configs/auth`)

**Test Hooks**:
- Unit: Verify barrel export list matches Aikami
- CI: `moon run frontend-configs:typecheck` passes

**Watch Points**:
- Barrel file (`src/index.ts`) must NOT re-export `app.ts`, `auth.ts`, `firestore.ts`, etc.

## Implementation Notes

1. **Files to create**:
   - `docs/contracts/MIG-004-frontend-configs.md`
   - `packages/shared/constants/src/lib/project.ts`
   - `packages/shared/constants/src/lib/emulator.ts`
   - `packages/shared/schemas/src/lib/project.ts`
   - `packages/shared/schemas/src/lib/logging/log_entry.ts`
   - `packages/shared/schemas/src/lib/logging/index.ts`
   - `packages/frontend/configs/src/lib/auth.ts`
   - `packages/frontend/configs/src/lib/analytics.ts`
   - `packages/frontend/configs/src/lib/app_check.ts`
   - `packages/frontend/configs/src/lib/fcm.ts`
   - `packages/frontend/configs/src/lib/functions.ts`
   - `packages/frontend/configs/src/lib/remote_config.ts`
   - `packages/frontend/configs/src/lib/storage.ts`

2. **Files to modify**:
   - `packages/shared/utils/src/lib/common/error.ts`
   - `packages/shared/constants/src/index.ts`
   - `packages/shared/schemas/src/index.ts`
   - `packages/frontend/configs/src/lib/environment.ts`
   - `packages/frontend/configs/src/lib/app.ts`
   - `packages/frontend/configs/src/lib/firestore.ts`
   - `packages/frontend/configs/src/lib/data_connect.ts`
   - `packages/frontend/configs/src/index.ts`
   - `packages/frontend/configs/package.json`
   - `packages/frontend/configs/tsconfig.json`

3. **Files to delete**: None

4. **Order of operations**:
   1. Update `toAppError` in utils (shared dependency)
   2. Create `project.ts` and `emulator.ts` in constants
   3. Update constants barrel
   4. Create `project.ts` and `logging/` in schemas
   5. Update schemas barrel
   6. Rewrite configs files (environment → app → firestore → services)
   7. Update configs package.json and tsconfig.json
   8. Run `moon run frontend-configs:typecheck` to verify

5. **Verification**:
   - `moon run frontend-configs:typecheck` passes
   - Visual diff confirmation that each file matches Aikami pattern

## Edge Cases & Gotchas

- **`toAppError` signature change**: Existing callers in Aikami that use positional args must be updated. The `environment.ts` already uses the object form; `app.ts` uses positional and must be updated as part of the rewrite.
- **Circular dependency on `app_check.ts`**: The App Check module imports `app` from `app.ts`, and `app.ts` dynamically imports `app_check.ts`. This must use `void import('./app_check.ts')` (not a synchronous `import`) to avoid the cycle.
- **`PUBLIC_MODE` vs `PUBLIC_FLAVOR`**: All references to `PUBLIC_FLAVOR` in env files and consuming code must be migrated to `PUBLIC_MODE`. This contract covers the configs module; downstream migration is tracked separately.
- **`MODE_PROJECT_MAP` for Aikami**: Uses `aikami-dev`, `aikami-prod`, `demo-aikami-emulator` — project-specific, not copied verbatim from Aikami.
- **`frontendAppIds` for Aikami**: `['docs', 'gamejs', ''landing_page', ''client']` — matches actual Aikami apps, not Aikami's app list.
- **Emulator port consistency**: All ports must match what the Firebase emulator suite actually uses (defined in `firebase.json`). These are standardized and identical to Aikami.
