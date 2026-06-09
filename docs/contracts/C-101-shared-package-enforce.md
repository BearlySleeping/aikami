# Contract C-101: Shared Package Enforce (Boundary Bleed)

## Goal
Eradicate boundary bleed. The frontend application (`apps/frontend/pwa`) currently contains domain constants, TypeScript types/interfaces, and Zod schemas that should be shared across the entire monorepo (Firebase functions, AI microservices, etc.). We must migrate these to the `packages/shared/*` workspaces.

## Scope
- **Source:** `apps/frontend/pwa/src/lib/types`, `apps/frontend/pwa/src/lib/constants`, and any stray Zod schemas in the frontend.
- **Destinations:**
  - `packages/shared/constants/src/lib/`
  - `packages/shared/types/src/lib/`
  - `packages/shared/schemas/src/lib/`

## Steps
1. **Audit:** Identify all constants, types, and schemas currently living inside `apps/frontend/pwa/src/` that represent domain models (e.g., Character, User, Message, Chat, Settings).
2. **Migrate Constants:** Move identified constants to `packages/shared/constants/src/lib/` and ensure they are exported in `packages/shared/constants/src/index.ts`.
3. **Migrate Types:** Move identified types/interfaces to `packages/shared/types/src/lib/` and export them in `packages/shared/types/src/index.ts`.
4. **Migrate Schemas:** Move identified Zod schemas to `packages/shared/schemas/src/lib/` and export them in `packages/shared/schemas/src/index.ts`.
5. **Update Imports:** Refactor `apps/frontend/pwa` to import these assets using the workspace package names:
   - `@aikami/shared-constants`
   - `@aikami/shared-types`
   - `@aikami/shared-schemas`
6. **Verify:** Run TypeScript checks (`bun x svelte-check` or `bun run check` inside the frontend) to ensure no imports are broken.

## Strict Rules
- **Rule 1:** Pure frontend-only types (like a specific UI component's prop types or Svelte 5 snippets) stay in the frontend. Only move domain/business logic types.
- **Rule 2:** Do not duplicate code. If a type already exists in the shared package, delete the frontend version and update the import.
- **Rule 3:** Ensure package.json dependencies are correct. If the frontend needs a shared package, it must be listed in `apps/frontend/pwa/package.json` as a workspace dependency (e.g., `"@aikami/shared-types": "workspace:*"`).
