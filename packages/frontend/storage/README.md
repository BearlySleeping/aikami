# @aikami/frontend-storage

Shared frontend local storage adapters (local-first SQLite).

## Use Case

This package provides the local persistence layer used by the client:

- `LocalDatabaseInterface` + platform adapters:
  - `TursoStorageAdapter` (Tauri native libSQL via `@tursodatabase/database`)
  - `WasmStorageAdapter` (browser WASM + OPFS via `@sqlite.org/sqlite-wasm`)
- `getLocalDatabase()` / `closeLocalDatabase()` / `resetLocalDatabase()`
  (shared connection, idempotent `AIKAMI_SCHEMA_DDL`)
- `AssetRegistryRepository` (asset metadata registry over the local DB)
- `OpfsAssetCache` (OPFS asset cache)

This is the *local* SQLite layer only. Firestore repositories live in
`@aikami/frontend-firestore` (Data Connect was removed in C-385).

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `typecheck` | `tsgo --noEmit` | Run TypeScript type checking |
| `test` | `bun test` | Run tests (storage adapters, asset registry) |
| `lint` | `biome lint .` | Lint code with Biome |
| `fix` | `biome check --write .` | Auto-fix lint & format issues |

## Usage

```typescript
import { getLocalDatabase } from '@aikami/frontend/storage';
import type { AssetRegistryRepository } from '@aikami/frontend/storage';
```
