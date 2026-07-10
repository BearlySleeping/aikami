---
name: dataconnect
description: >-
  🔴 LOAD BEFORE touching ANY Firebase Data Connect code — schema/query/mutation
  authoring in apps/backend/firebase/dataconnect/, SDK generation via
  `bun moon run firebase:generate` (NEVER npx firebase-tools directly), and the
  mandatory consumption path through packages/frontend/dataconnect/src/index.ts.
version: 1.0.0
tags: ["firebase", "dataconnect", "data-connect", "sql", "graphql", "codegen", "firestack"]
---

# Firebase Data Connect — Aikami Workflow

## 🔴 THE THREE NON-NEGOTIABLE RULES

1. **All schemas/operations live in `apps/backend/firebase/dataconnect/`.**
   Never create a second `dataconnect/` directory anywhere else.

2. **SDK generation runs ONLY via:**

   ```bash
   bun moon run firebase:generate
   ```

   ❌ NEVER `npx -y firebase-tools@latest dataconnect:sdk:generate`
   ❌ NEVER `firebase dataconnect:sdk:generate` directly
   Moon routes to `firestack generate`, which handles project ID, mode
   (emulator/staging/production), and output paths correctly.

3. **Frontend consumers import ONLY from `@aikami/frontend-dataconnect`
   (`packages/frontend/dataconnect/src/index.ts`).**
   ❌ NEVER import from `packages/frontend/dataconnect/src/lib/generated/`
   directly — the index wrapper injects the shared Data Connect singleton
   (`getDataConnect(connectorConfig)`) so ViewModels/services never manage
   connection state.

## Directory Layout

```
apps/backend/firebase/dataconnect/
├── dataconnect.yaml              # Service config
├── schema/
│   └── schema.gql                # Types: @table, @col, @default, @ref
└── connector/
    ├── connector.yaml            # SDK generation config (outputDir → packages/frontend/dataconnect)
    ├── queries.gql               # @auth(level: ...) required on EVERY operation
    └── mutations.gql             # _insert, _update, _upsert, _delete, @transaction

packages/frontend/dataconnect/
├── src/index.ts                  # 🔴 The ONLY import surface for consumers
└── src/lib/generated/            # 🔴 GENERATED — never edit by hand
```

## Workflow: Adding/Changing a Query or Table

1. Edit `.gql` files under `apps/backend/firebase/dataconnect/`
   (`schema/schema.gql`, `connector/queries.gql`, `connector/mutations.gql`).
2. Regenerate the SDK:

   ```bash
   bun moon run firebase:generate
   ```

   This updates `packages/frontend/dataconnect/src/lib/generated/`.
3. Re-export the new operation from
   `packages/frontend/dataconnect/src/index.ts` (wrap with the shared
   singleton like the existing exports).
4. Consume it in frontend services via `@aikami/frontend-dataconnect`.

## Authoring Rules

- **Auth**: `@auth(level: ...)` on every operation — `PUBLIC`, `USER_ANON`,
  `USER`, `NO_ACCESS`. No unauthenticated defaults.
- **Operations**: prefer native GraphQL generated operations. Raw SQL
  (`_select`/`_execute` with positional `$1` params) ONLY when genuinely
  required (PostGIS, window functions, complex aggregations).
- **Relations**: `@ref` for foreign keys, `@transaction` for atomic
  multi-step mutations.
- **Generated code is read-only**: never hand-edit
  `packages/frontend/dataconnect/src/lib/generated/` — it is fully
  overwritten on each generate.

## Deployment

Deploy Data Connect via firestack (see `firestack` skill):

```bash
bun run deploy:dataconnect          # or /firestack dataconnect [mode]
```

Firestack checksums the `.yaml`/`.gql` files and skips deployment when
nothing changed.
