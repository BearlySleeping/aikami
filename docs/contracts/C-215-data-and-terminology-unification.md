<!-- completed: 2026-07-03 -->
# C-215: Data and Terminology Unification

## Context
As the platform has grown, our naming conventions have become muddy. We currently use `character`, `persona`, and `npc` interchangeably across services, schemas, and UI components. 

We need to establish and enforce a strict hierarchy:
- `Character`: The abstract base type (stats, inventory, position).
- `Persona`: A User-created, playable character.
- `NPC`: A System/AI-driven non-playable character.

Additionally, we need to clean up the frontend's `data` vs `constants` directories to ensure we are properly utilizing `packages/shared/constants` for cross-boundary values.

## Objectives
1. Enforce the Character/Persona/NPC terminology across schemas and client services.
2. Consolidate `apps/frontend/client/src/lib/data` and `apps/frontend/client/src/lib/constants`.

## Acceptance Criteria

- **Terminology & Services Enforcement**:
    - Audit `apps/frontend/client/src/lib/services/character`. Split or rename its contents into `persona_service` and `npc_service` where appropriate. If logic truly applies to both, keep it in a generic `character_utils` or base class.
    - Audit `packages/shared/schemas`. Ensure the base `Character` schema is extended by distinct `Persona` and `NPC` schemas.
- **Data vs Constants Consolidation**:
    - Audit `apps/frontend/client/src/lib/data` and `apps/frontend/client/src/lib/constants`.
    - Move globally shared constants (e.g., max level, default stats, global enums) into `packages/shared/constants`.
    - Retain `client/src/lib/constants` ONLY for frontend-specific UI constants (e.g., route paths, CSS class maps).
    - Retain `client/src/lib/data` ONLY for large, static, read-only datasets (e.g., `lpc_asset_catalog.ts`).
- **Dependencies**:
    - Fix all downstream imports across the client and engine.
    - Run `bun run validate` to guarantee 0 type or lint errors.

## E2E Visual Test Hook
    - **Capture State**: Client Dashboard -> Persona Selection / Character List View.
    - **Condition**: Ensure the UI correctly binds to the updated `Persona` schemas and services. The list of user-created Personas must render without undefined variable errors.
    - **Evaluation**: The visual snapshot must match the baseline, confirming that the underlying data restructuring did not break the Svelte template bindings for character cards.

## Technical Notes
- Be careful with `packages/backend/firebase`. Changing the schemas in `shared` might require you to update the Firestore rules or Data Connect queries if they explicitly reference the old terminology. Keep the database changes additive or carefully mapped if possible to avoid breaking existing emulator data.

---

## Execution Report — 2026-07-03

### Summary
Enforced Character → Persona/NPC terminology. `CharacterCreationService` → `PersonaCreationService`, `CharacterTextStreamService` → `PersonaCreationTextStreamService`. Both moved to services/persona/. Data/constants audit: structure already correct.

### Files Created
- `services/persona/persona_creation_service.svelte.ts`
- `services/persona/persona_creation_text_stream.svelte.ts`

### Files Deleted
- `services/character/character_service.svelte.ts`
- `services/character/character_text_stream.svelte.ts`

### Files Modified
- `services/index.ts`, `persona_create_view_model.svelte.ts`, `.test.ts`, `.dev.svelte.ts`, `test_preload.ts`, `image_view_model.test.ts`

### Test Results
- Typecheck: 0 errors, 0 warnings
- Validate: passed (client + types)
- Visual test: ✅ captured successfully (persona_list suite, 1/1 pass, 101KB screenshot)
