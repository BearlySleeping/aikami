---
name: backend-conventions
description: >-
    🔴 LOAD BEFORE writing ANY Aikami backend code (Firebase Functions,
    packages/backend/*) — layered architecture (controller → service →
    repository → BaseDatabaseService), repository constructor injection,
    thin controllers with firestack wrappers, and backend testing rules.
    Load aikami-conventions first for universal rules.
version: 1.0.0
tags: ["aikami", "backend", "firebase", "functions", "repository", "controller", "testing"]
---

# Aikami Backend Conventions

**Prerequisite**: load `aikami-conventions` first (logger, imports, TS
strictness, monorepo boundaries, TypeBox schema-first types).

---

## Architecture Layers

```
Controller (thin) → Service (business logic) → Repository (data access) → BaseDatabaseService (abstraction)
```

Each layer only talks to the layer directly below it. No skipping layers.

---

## Repository Pattern

Every repository accepts a `BaseDatabaseService` via constructor injection.

```typescript
export class UserRepository {
	private readonly _collection = "users";

	constructor(private readonly _db: BaseDatabaseService) {
		if (!_db) throw new Error("UserRepository requires BaseDatabaseService");
	}

	async findById(id: string): Promise<UserDocument | undefined> {
		if (!id) throw new Error("id is required");
		return this._db.getDocument<UserDocument>(this._collection, id);
	}
}
```

### Rules

- Constructor injection: `constructor(private readonly _db: BaseDatabaseService)`
- Guard clauses first
- Never import Firestore SDK directly — go through `BaseDatabaseService`
- Collection name as private field

---

## Service Layer

Services contain business logic, depend on repositories (never on database
directly):

- Options object for constructor
- Depend on repositories, not database
- Business logic only — no HTTP concerns, no Firestore SDK calls

---

## Controller Structure

Thin — parse input, call service, return response. One `export default` per
file. Use firestack wrappers: `onCall`, `onRequest`, `onCreated`, etc.

See the `firestack` skill for deployment, emulators, and security rules.

---

## Data Validation

All cross-boundary inputs are validated with TypeBox schemas from
`@aikami/schemas` (see `aikami-conventions` § Validation). Never define
schemas inside `apps/backend/**` — they live in `packages/shared/schemas/`.

Errors use `toAppError` from `@aikami/utils` (see `aikami-conventions`
§ Error Handling).

---

## Backend Testing

- Tests in `tests/` at project root (not `src/__tests__/`)
- Use `bun:test`
- Mock `BaseDatabaseService`, never Firestore SDK directly

---

## What Does NOT Belong in Firebase Functions

Cloud Functions are **stateless, ephemeral, and deployed to GCP** — they have
no persistent local filesystem. The following MUST NOT be allocated to
`apps/backend/firebase/src/controllers/`:

- **Local filesystem operations**: directory scanning, `manifest.json`
  writes, file copy/move/rename on disk, reading/writing files outside
  `/tmp`.
- **Binary file serving from disk**: streaming images, audio, or video from
  a local directory. Use Firebase Storage + signed URLs instead.
- **Local asset management**: upload to a local folder, folder browser UIs
  backed by `fs.readdirSync`, OS file-picker integration.

These belong in:

| Concern                           | Correct location                                      |
| --------------------------------- | ----------------------------------------------------- |
| Local file scanning, manifest gen | `packages/frontend/engine/src/` (runs in client)      |
| Binary file serving in dev        | Vite dev server (client) or Tauri `asset://` protocol |
| OS file-picker, drag-drop upload  | `apps/frontend/client/src/` (Tauri APIs)              |
| Heavy local processing            | `apps/backend/{image,text,voice}/` (local services)   |
| Authenticated Firebase Storage    | `controllers/callable/` (not `controllers/api/`)      |

🔴 **Rule**: Before writing any `controllers/` file, ask: "Does this operation
touch the local filesystem?" If yes, it does NOT belong in Firebase Functions.

### Dynamic Imports: Avoid `await import()` in Functions

Firebase Functions bundles are deployed whole — there is no tree-shaking.
Dynamic imports do not reduce bundle size and add runtime overhead to
already-slow cold starts. Prefer static `import`.

✅ **Valid exceptions** (all backend):

- Optional native packages (`pg`, `@tursodatabase/database`) — only loaded
  when a feature path is taken
- Emulator-only scripts (`on_emulate.ts`) — acceptable but static is simpler

❌ **Not valid**:

- "Cold start optimization" — the overhead of `await import()` during cold
  start is typically larger than the deferred load saves
- Wrapping Firebase Admin SDK or `@aikami/backend/*` imports — these are
  always needed

## Related Skills

| Skill                  | Covers                                             |
| ---------------------- | -------------------------------------------------- |
| `firestack`            | Functions deployment, emulators, security rules    |
| `firestore-collection` | Scaffolding a new Firestore collection end-to-end  |
| `dataconnect`          | Data Connect schemas + generation + import surface |
