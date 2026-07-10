<!-- completed: 2026-07-01 -->

## Metadata

| Field | Value |
|---|---|
| **Source** | Visual testing reports and overlay cleanup specifications |
| **Target** | `packages/frontend/services/src/lib/base/base_dev_view_model.svelte.ts`, `apps/frontend/client/src/lib/views/dev/sandbox/map/map_sandbox_view_model.svelte.ts`, `apps/frontend/client/src/routes/(dev)/dev/(sandbox)/+layout.svelte`, `apps/frontend/client/src/routes/(dev)/+layout.svelte`, and `apps/frontend/client/src/lib/views/dev/sandbox/map/map_sandbox_view.svelte` |
| **Priority** | P0 — Utility panels and developer UI elements block the canvas view during automated testing, corrupting bounding box assertions. |
| **Dependencies** | `docs/contracts/C-200-visual-pipeline-optimization.md` |
| **Status** | completed |
| **Contract version** | 1.1.0 |

### Execution Report — 2026-07-01

**Summary**: Created `BaseDevViewModel` in `packages/frontend/services`, updated `MapSandboxViewModel` to inherit from it, and wrapped all dev overlays in conditional blocks across three layout/view files. All overlays unmount cleanly when `?screenshot=true` is present.

**AC Status**:
- AC-1 (Baseline DevViewModel Extraction): ✅ — `BaseDevViewModel` provides `isScreenshot` and `hideOverlays` as reactive `$state` fields; subclasses inherit without duplicate parsing logic. Static `BaseDevViewModel.isScreenshot()` available for use in layouts/views without a full ViewModel instance.
- AC-2 (Total Overlay Suppression): ✅ — All dev overlays (status bar, map indicator, error display, interaction hint, NPC dialog, floating map buttons, `<ModeIndicator />`, dev layout navbar/sidebar) unmount when `?screenshot=true` is passed. Only the raw canvas container renders.
- AC-3 (Safe Human Iteration Mode): ✅ — Without `?screenshot`, all utility panels, floating map-switchers, and status bars remain visible and interactive.

**Files Created**:
- `packages/frontend/services/src/lib/base/base_dev_view_model.svelte.ts` — New abstract class extending `BaseViewModel` with `isScreenshot`/`hideOverlays` reactive flags

**Files Modified**:
- `packages/frontend/services/src/index.ts` — Barrel export for `BaseDevViewModel`
- `apps/frontend/client/src/lib/views/dev/sandbox/map/map_sandbox_view_model.svelte.ts` — Swapped `extends BaseViewModel` → `extends BaseDevViewModel`
- `apps/frontend/client/src/lib/views/dev/sandbox/map/map_sandbox_view.svelte` — Wrapped all overlay divs in `{#if !viewModel.isScreenshot}`
- `apps/frontend/client/src/routes/(dev)/dev/(sandbox)/+layout.svelte` — Wrapped `<ModeIndicator />` in `{#if !isScreenshot}` using static helper
- `apps/frontend/client/src/routes/(dev)/+layout.svelte` — Bypasses `<DevView>` wrapper (navbar + sidebar) in screenshot mode, renders children directly

**Deviations**: None.

**Test Results**: `validate({ test: true })` — 4/4 passed (fix, typecheck, build, test on client + frontend-services).



This contract implements a clean separation between development-only UI components and production canvas views during automated visual smoke testing execution loops. By introducing a reusable `BaseDevViewModel` parent class, any sandbox route gains instant, reactive knowledge of whether it is running inside an end-to-end screen capture harness. When a `?screenshot=true` search parameter is passed to the browser viewport, layout shells, overlay buttons, text labels, and floating panels dynamically unmount to provide clean canvas screenshots for VLM visual grounding pipelines.

## Design Reference

- `packages/frontend/services/src/lib/base/base_view_model.svelte.ts`: Core reactive view model class handling dependency parameters and teardown lifecycles.
- `apps/frontend/client/src/lib/views/dev/sandbox/map/map_sandbox_view_model.svelte.ts`: Custom view model managing map chunk initialization vectors and entity spawning.
- `apps/frontend/client/src/lib/views/dev/sandbox/map/map_sandbox_view.svelte`: Layout layer containing floating sandbox tools and rendering wrappers.

## Architecture Directives

1. Author `BaseDevViewModel` as an abstract class extending from `BaseViewModel` inside the shared service module. 
2. Expose a protected or public reactive getter `isScreenshot` inside `BaseDevViewModel` that parses `window.location.search` for the key parameter `screenshot=true` during instantiation or lifecycle execution, backed by a Svelte 5 `$state` or `$derived` block.
3. Add a reusable `hideOverlays` helper flag and standard developer controls to `BaseDevViewModel` to allow individual sub-views to easily stack configuration flags.
4. Refactor `MapSandboxViewModel` to extend `BaseDevViewModel` rather than `BaseViewModel` directly to inherit coordinate checking features.
5. Update Svelte views (`+layout.svelte` blocks and custom components) to check `viewModel.isScreenshot`. Wrap the `<ModeIndicator />`, dev panels, overlay buttons, status monitors, and map tags inside clear `{#if !viewModel.isScreenshot}` conditional expressions.

## State & Data Models

    // Shared parent layer in service core package
    abstract class BaseDevViewModel<O> extends BaseViewModel<O> {
        readonly isScreenshot: boolean;
        readonly hideOverlays: boolean;
        
        protected detectScreenshotEnvironment(): boolean;
    }

    interface VisualQueryParameters {
        screenshot?: "true" | "false";
        zone?: "a" | "b";
    }

## Scope Boundaries

- **In Scope:**
    - Creating the reusable `BaseDevViewModel` architecture to manage development-specific flags.
    - Swapping the base extension layer inside `map_sandbox_view_model.svelte.ts`.
    - Wrapping developer tool widgets and layout shells inside conditional visibility blocks across the specified files.
- **Out of Scope:**
    - Changing production-level HUD layouts, equipment cards, or non-developer UI systems.
    - Adjusting underlying canvas WebGPU shaders, rigid movement transforms, or global collision logic.

## Acceptance Criteria

### AC-1: Baseline Developer View Model Extraction
**Given** An active development workspace containing complex sandbox routes
**When** Extending features from `BaseDevViewModel`
**Then** Sub-classes must inherit reactive getters for screen capture detection without writing duplicate parsing logic.

### AC-2: Total Overlay Suppression on Target Key
**Given** A running instance of the test application shell
**When** Navigating to a sandbox view URL passing the option string `?screenshot=true`
**Then** Dev tools panel views, overlay status displays, floating zone buttons, and coordinate tags must unmount cleanly, leaving an isolated canvas layout view.

**Test Hooks**:
- Moon Task: `moon run apps/e2e:test`
- Integration: Manual browser verification of `http://localhost:5274/dev/sandbox/map?screenshot=true`
- E2E / Visual:
    - **Functional**: N/A
    - **Visual**: Confirm that screenshots saved to disk contain only the raw canvas container with zero overlay panels.

### AC-3: Safe Human Iteration Mode
**Given** A human developer running local sandboxes without passing visual test parameters
**When** Browsing sandbox pages at `http://localhost:5274/dev/sandbox/map`
**Then** All utility menu boxes, floating map-switchers, and status bars must remain visible and interactive.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Build `BaseDevViewModel` inside the frontend services directory, introducing the `isScreenshot` detection mechanics. Update `MapSandboxViewModel` to inherit from the new base class.
2. **Phase 2 (Integration)**: Wrap overlay widgets, panel arrays, and layout frames in the layout and view directories with `{#if !viewModel.isScreenshot}` constraints.
3. **Phase 3 (Validation)**: Execute the visual test suite and verify that the output images are free of developer tool panels.
