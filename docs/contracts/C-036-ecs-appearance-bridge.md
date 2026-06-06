# Contract: C-036 ECS Appearance Bridge

## Metadata
| Source | Target | Priority | Dependencies | Status | Version |
|--------|--------|----------|--------------|--------|---------|
| Engine Architecture | Game Client View | High | C-034, C-035 | completed | 1.0.0 |

## Overview
This contract implements the data synchronization loop that binds bitECS entity state modifications to the `LpcBatchManager` rendering lanes. It establishes the concrete pipeline that reads raw array modifications inside the `Appearance` component buffers, maps structural alterations to unique entity slot footprints, and invokes low-overhead streaming writes down into the mega-UBO layout during the unified system tick.

## Design Reference
- `packages/frontend/engine/src/components/appearance.ts`: bitECS property fields (`body`, `hair`, `torso`, etc.).
- `packages/frontend/engine/src/systems/render_system.ts`: `LpcBatchManager` allocation and slot assignment methods.

## Changes Detail
### Modified Files

#### `packages/frontend/engine/src/systems/render_system.ts`
- Integrate bitECS tracking query arrays inside the execution phase loop.
- Intercept entity instantiation and removal lifecycle changes using bitECS enter/exit semantics to invoke `LpcBatchManager.allocateSlot()` and `LpcBatchManager.freeSlot()`.
- Implement `syncAppearanceSystem()`: For each active match, map property arrays to the `packRecipeToUboBuffer()` structural byte stream, detect modifications via value-by-value comparison against cached fingerprints, and schedule dirty block updates to eliminate redundant CPU-to-GPU memory copies.

## Acceptance Criteria
### AC-1: Automated Slot Allocation & LIFO LpcBatchManager Tracking
- **Given** an engine loop with an empty instance allocation matrix.
- **When** 5 new bitECS entities with active `Appearance` descriptors enter the system query.
- **Then** the framework must automatically reserve consecutive data indices via the free-slot stack, assigning unique structural targets.
- *Test Hook*: Assert entity slot assignment correctness inside unit testing contexts.

### AC-2: Fingerprint Evaluation Optimization Check
- **Given** an active rendering loop processing a stable population layout.
- **When** entity positions change state while structural clothing indices remain identical across frames.
- **Then** the appearance synchronization pass must flag the item layout as unchanged, passing over redundant write steps.
- *Test Hook*: Verify that `batchUpdatesPerformed` metrics only increment when property array changes occur.

## Implementation Notes
1. Open `packages/frontend/engine/src/systems/render_system.ts`.
2. Construct the core bitECS sync loops mapping array indices directly to slot parameters.
3. Call `validate()` to ensure full type resolution and alignment against monorepo rules.
