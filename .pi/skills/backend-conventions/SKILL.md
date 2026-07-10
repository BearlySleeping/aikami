---
name: backend-conventions
description: >-
    🔴 LOAD BEFORE writing ANY Aikami backend code (Firebase Functions,
    packages/backend/*) — layered architecture (controller → service →
    repository → BaseDatabaseService), repository constructor injection,
    thin controllers with firestack wrappers, and backend testing rules.
    Load aikami-conventions first for universal rules.
version: 1.0.0
tags: ["aikami", "backend", "firebase", "functions", "repository", "service", "controller", "testing"]
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

## Related Skills

| Skill                  | Covers                                                   |
| ---------------------- | --------------------------------------------------------- |
| `firestack`            | Functions deployment, emulators, security rules           |
| `firestore-collection` | Scaffolding a new Firestore collection end-to-end         |
| `dataconnect`          | Data Connect schemas + generation + import surface        |
