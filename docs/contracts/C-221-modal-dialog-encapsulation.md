<!-- completed: 2026-07-04 -->

## Metadata

| Field | Value |
|---|---|
| **Source** | UI Component Architecture Review & C-220 |
| **Target** | `packages/frontend/components/src/lib/modal/` — Accessible DaisyUI Modal Wrapper |
| **Priority** | P1 — Prevents layout hallucinations and standardizes accessible backdrop overlays |
| **Dependencies** | C-219, C-220 |
| **Status** | ✅ completed |
| **Contract version** | 1.0.0 |

## Overview

This contract encapsulates DaisyUI's v5 backdrop and modal layouts within a pure, headless-behaved Svelte 5 component system using the native HTML `<dialog>` API. It wraps complex focus trapping, backdrop click-dismissals, and escape key handling into a scannable token element. This allows autonomous agents to safely trigger overlays without replicating raw DOM state mechanics.

## Design Reference

Follow the component purity rules enforced in `aikami-ui/SKILL.md`:
1. Component library files must never import from `$services`, extend `BaseViewModel`, or leverage Firebase clients.
2. Rely strictly on pure Svelte 5 `$props()` interfaces and standard HTML snippets (`{#snippet}`).
3. Reference `.pi/generated-skills/daisyui/components/modal.md` for DaisyUI structural class mapping.

For testing: **Playwright** handles functional E2E (`tests/*.spec.ts`), **Bun Visual Runner** handles AI visual assessment (`src/visual/suites/*.visual.ts`). Do NOT create `*_visual.spec.ts` files or use the old `scripts/*_visual.ts` pattern. See `.pi/skills/testing/SKILL.md` for conventions.

## Architecture Directives

1. **New Component Directory**: Create `packages/frontend/components/src/lib/modal/modal.svelte`.
2. **Public Re-export**: Append `export { default as Modal } from './lib/modal/modal.svelte';` to `packages/frontend/components/src/index.ts`.
3. **Smoke Test Integration**: Refactor `apps/frontend/client/src/lib/views/start/components/missing_providers_dialog.svelte` to implement the new component as validation.

## State & Data Models

    type ModalSize = 'sm' | 'md' | 'lg' | 'max';

    type Props = {
        /** Controls the display state of the modal element.
         * Must be bindable ($bindable()) to support auto-closing via escape or backdrop actions.
         */
        open: boolean;

        /** Optional snippet containing the modal header or title section. */
        title?: snippet;

        /** Required snippet containing the inner scrollable form or informational content. */
        children: snippet;

        /** Optional snippet specifying actionable bottom configurations (e.g., buttons). */
        actions?: snippet;

        /** Maximised layout threshold for the viewport overlay box.
         * @default 'md'
         */
        size?: ModalSize;

        /** Permits dismissing the overlay frame by hitting the overlay background mask layer.
         * @default true
         */
        closeOnBackdropClick?: boolean;

        /** Optional callback execution pipe fired explicitly when the modal window is toggled shut. */
        onclose?: () => void;
    };

## Scope Boundaries

- **In Scope:**
    - Implementation of `modal.svelte` using Svelte 5 reactive runes (`$props`, `$effect`).
    - Standard JSDoc generation detailing prop bindings, options, and fallbacks.
    - Exposing the component contract through the shared package index export.
    - Migrating `missing_providers_dialog.svelte` from raw modal CSS implementations to the clean component.
- **Out of Scope:**
    - Upgrading complex multi-step application alert managers or creating specific context-bound modal alerts (e.g., confirmation snackbars).

## Acceptance Criteria

### AC-1: Modal Interactivity and Component Purity
**Given** an open view requiring a modal dialog overlay
**When** the wrapper component mounts with `open={true}`
**Then** the native HTML `<dialog>` element invokes `.showModal()`, focus trapping is successfully bound, and no repository or service states leak inside the layout layer.

**Test Hooks**:
- Moon Task: `bun moon run components:typecheck`
- Integration: N/A
- E2E / Visual: N/A

### AC-2: Backdrop and Escape Graceful Closure
**Given** an active visible modal instance with `closeOnBackdropClick={true}`
**When** a user hits the escape key or clicks directly on the underlying backdrop layout mask
**Then** the `open` state automatically mutates to `false`, the `.close()` native method runs safely, and the `onclose` notification fires exactly once.

**Test Hooks**:
- Moon Task: `bun moon run client:typecheck`
- Integration: N/A
- E2E / Visual:
    - **Functional**: Verification inside client smoke suites (e.g., `tests/client/sandboxes.spec.ts`).

## Implementation Sequence

1. **Phase 1 (Component Layout)**: Scaffold `packages/frontend/components/src/lib/modal/modal.svelte`. Map an internal reactive effect running on `open` to synchronize with a native element bind using `.showModal()` and `.close()`.
2. **Phase 2 (Accessibility Guard)**: Wire the native `onclose` container listener to safely reset the outer state variable upon user-driven exit cues. Ensure backdrop coordinate math maps boundaries safely to bypass close overrides on inner body mouse hits.
3. **Phase 3 (Integration Validation)**: Update package exports. Refactor `missing_providers_dialog.svelte`, clean up arbitrary code, run standard linting commands, and execute workspace builds.

## Edge Cases & Gotchas

- **Preventing Body Clicks From Triggering Closure**: The backdrop wrapper structure inside DaisyUI often relies on absolute spacing coordinates on the dialog container frame. Ensure your close condition targets only click elements where `event.target === dialogRef` to prevent content wrapper clicks from accidentally collapsing form states.

---

## Execution Report — 2026-07-04

### Summary
Created `packages/frontend/components/src/lib/modal/modal.svelte` — a Svelte 5 Modal component wrapping the native `<dialog>` API with DaisyUI styling. Uses `$bindable()` open state, title/children/actions snippets, size variants, backdrop click dismissal via `<form method="dialog">`, and a guard flag to prevent duplicate `onclose` firing. Refactored `missing_providers_dialog.svelte` to use the new Modal, and updated `start_view.svelte` to use `bind:open` instead of `{#if}`.

### AC Status
| AC | Description | Status |
|----|-------------|--------|
| AC-1 | Modal interactivity and component purity — native `<dialog>` with `.showModal()`, no service/repo leaks | ✅ Pass |
| AC-2 | Backdrop and Escape closure — `closeOnBackdropClick`, form-based backdrop, `onclose` fires exactly once | ✅ Pass |

### Files Created
- `packages/frontend/components/src/lib/modal/modal.svelte` — Svelte 5 Modal with native `<dialog>` API, `$bindable()` open, snippets, `_closingFromEffect` guard for single-fire `onclose`

### Files Modified
- `packages/frontend/components/src/index.ts` — Added `Modal` barrel export
- `apps/frontend/client/src/lib/views/start/components/missing_providers_dialog.svelte` — Replaced raw DaisyUI `modal-open` div with `<Modal>`, content now passes via snippets, `open` is `$bindable()`
- `apps/frontend/client/src/lib/views/start/start_view.svelte` — Replaced `{#if showMissingProvidersDialog}` wrapper with `bind:open={viewModel.showMissingProvidersDialog}`
- `.pi/skills/aikami-ui/SKILL.md` — Added `Modal` to component exports list

### Deviations
- View update (`start_view.svelte`) was required beyond the contract scope — the `{#if}` pattern is incompatible with `<dialog>`-based components which manage their own visibility. Changed to `bind:open` for correct two-way binding chain.
- Biome `useBlockStatements` required wrapping two single-line `if` statements in braces (auto-fixed).

### Test Results
- `client:typecheck` — ✅ 0 errors, 5 pre-existing warnings
- `frontend-components:typecheck` — ✅ Clean (0 errors)
- `frontend-components:fix` — ✅ Clean (0 errors)
- `client:fix` — 12 pre-existing errors in unrelated files, none from changes
