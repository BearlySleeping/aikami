<!-- completed: 2026-07-03 -->

## Metadata

| Field | Value |
|---|---|
| **Source** | UI Component System Architecture Review |
| **Target** | `packages/frontend/components` & `apps/frontend/client` — UI Library & Global CSS Refactor |
| **Priority** | P1 — Fixes critical transparent dropdown UI bug and establishes DRY styling patterns |
| **Dependencies** | None |
| **Status** | ✅ completed |
| **Contract version** | 1.0.0 |

## Overview

This contract establishes a clean, scalable, AI-friendly UI component architecture. It wipes legacy code from the `@aikami/frontend-components` package and introduces a new directory structure `src/lib/<component_name>/`. It creates a custom DaisyUI-backed `<Select>` component to fix OS-level transparency rendering bugs. Finally, it eliminates inline typography utility spam by moving typography definitions into the Tailwind v4 `@theme` within the Client's global `app.css`.

## Design Reference

Follow the "Hybrid Component-as-Code" pattern:
1. **Primitives**: Simple elements (buttons, badges) remain native HTML with DaisyUI classes in the consuming app.
2. **Complex UI**: Complex elements (Select, Modal, Dropdown) are encapsulated in `@aikami/frontend-components` to manage state, accessibility, and complex DaisyUI HTML structures.
3. **DaisyUI Source**: Reference `.pi/generated-skills/daisyui/components/select.md` for proper class application.

For testing: **Playwright** handles functional E2E (`tests/*.spec.ts`), **Bun Visual Runner** handles AI visual assessment (`src/visual/suites/*.visual.ts`). Do NOT create `*_visual.spec.ts` files or use the old `scripts/*_visual.ts` pattern. See `.pi/skills/testing/SKILL.md` for conventions.

## Architecture Directives

1. **Clean Slate**: Delete `packages/frontend/components/src/ai_button.svelte` and `packages/frontend/components/src/ai_button.stories.ts`.
2. **New Component Structure**: Create `packages/frontend/components/src/lib/select/select.svelte`.
3. **Barrel Export**: Update `packages/frontend/components/src/index.ts` to export the new Select component.
4. **Global CSS**: Update `apps/frontend/client/src/app.css` to define Tailwind v4 theme variables for typography, replacing inline font definitions.

## State & Data Models

    // Component Props Structure (Strict JSDoc requirement)
    type SelectOption = {
        value: string;
        label: string;
    };

    type Props = {
        /** * The current value of the select input.
         * Must be bindable to support Svelte 5 two-way binding. 
         */
        value: string;
        
        /** * Array of options to render within the dropdown. 
         */
        options: SelectOption[];
        
        /** * Optional callback triggered when the value changes. 
         */
        onchange?: (value: string) => void;
        
        /** * DaisyUI sizing modifier.
         * @default 'md' 
         */
        size?: 'xs' | 'sm' | 'md' | 'lg';
        
        /** * Applies the 'select-bordered' DaisyUI class if true.
         * @default true 
         */
        bordered?: boolean;
        
        /** * Additional Tailwind/DaisyUI classes to apply to the root select element. 
         */
        class?: string;
    };

## Scope Boundaries

- **In Scope:**
    - Deleting old files in `packages/frontend/components/src/`.
    - Creating the `select` component directory and files.
    - Updating `packages/frontend/components/src/index.ts`.
    - Updating `apps/frontend/client/src/app.css` with `@theme` configurations for `font-mono` and `font-sans`.
    - Refactoring `apps/frontend/client/src/lib/views/settings/providers/tabs/text_tab.svelte` to use the new `<Select>` component and `font-mono` utilities.
- **Out of Scope:**
    - Refactoring other views to use the new `<Select>` component (keep scope tight to `text_tab.svelte` to prove the pattern).
    - Creating other components (e.g., Modals, Cards) in this specific contract.

## Acceptance Criteria

### AC-1: Global Typography Configured
**Given** the SvelteKit client application
**When** inspecting `apps/frontend/client/src/app.css`
**Then** Tailwind v4 `@theme` directives define `font-mono` as `'JetBrains Mono', monospace` and `font-sans` as `'Inter', sans-serif`.

**Test Hooks**:
- Moon Task: `bun moon run client:lint`
- Integration: N/A
- E2E / Visual:
    - **Functional**: N/A
    - **Visual**: N/A

### AC-2: Select Component Implemented
**Given** the `@aikami/frontend-components` package
**When** importing `{ Select }`
**Then** it provides a Svelte 5 component wrapping a DaisyUI `<select>` element, fully documented with JSDocs, that correctly renders options without OS-level transparency issues.

**Test Hooks**:
- Moon Task: `bun moon run components:typecheck`
- Integration: N/A
- E2E / Visual:
    - **Functional**: N/A
    - **Visual**: N/A

### AC-3: Text Tab Refactored
**Given** the Settings -> Providers -> Text tab
**When** rendering the view
**Then** the UI utilizes the new `<Select>` component, all inline `font-['JetBrains_Mono']` classes are replaced with `font-mono`, and the dropdown menu text is fully legible and not transparent.

**Test Hooks**:
- Moon Task: `bun moon run client:typecheck`
- Integration: N/A
- E2E / Visual:
    - **Functional**: N/A
    - **Visual**: Use `src/visual/suites/settings.visual.ts` (if exists) or manual verification in emulator mode.

## Implementation Sequence

1. **Phase 1 (Global CSS)**: Update `app.css` with Tailwind v4 `@theme` configurations. Search and replace `font-['JetBrains_Mono']` with `font-mono` specifically inside `text_tab.svelte`.
2. **Phase 2 (Component Library)**: Delete old components. Scaffold `src/lib/select/select.svelte`. Implement the DaisyUI markup and the strict Svelte 5 `$props()` definition with JSDocs. Update `index.ts`.
3. **Phase 3 (Integration)**: Import `Select` from `@aikami/frontend-components` into `text_tab.svelte` and replace the raw `<select>` HTML elements.

## Edge Cases & Gotchas

- **Theme Variable Overrides**: Ensure that the `@theme` block in `app.css` is placed *after* the `@plugin "daisyui";` import to ensure custom fonts take precedence over DaisyUI defaults if necessary.
- **Two-Way Binding**: Ensure the `<Select>` component correctly propagates the `$bindable()` rune for its `value` prop so view models can react to changes seamlessly.

---

## Execution Report — 2026-07-03

### Summary
All 3 acceptance criteria implemented. New `Select` component replaces DaisyUI raw `<select>` in `text_tab.svelte`, global typography variables added to Tailwind v4 `@theme`, and legacy `ai_button` component deleted.

### AC Status
| AC | Description | Status |
|----|-------------|--------|
| AC-1 | Global typography configured in `app.css` | ✅ Pass |
| AC-2 | Select component implemented in `@aikami/frontend-components` | ✅ Pass |
| AC-3 | Text tab refactored to use Select + `font-mono` | ✅ Pass |

### Files Created
- `packages/frontend/components/src/lib/select/select.svelte` — Svelte 5 `<Select>` component wrapping DaisyUI `<select>` with `$bindable()` value + `SelectOption[]` options

### Files Modified
- `apps/frontend/client/src/app.css` — Added `@theme` block with `--font-mono` and `--font-sans`
- `apps/frontend/client/src/lib/views/settings/providers/tabs/text_tab.svelte` — Replaced raw `<select>` with `<Select>`, all `font-['JetBrains_Mono']` → `font-mono`, `font-['Inter']` → `font-sans`
- `apps/frontend/client/package.json` — Added `@aikami/frontend-components: workspace:*` dependency
- `packages/frontend/components/src/index.ts` — Barrel now exports `Select` instead of `AiButton`
- `packages/frontend/components/package.json` — Removed `./ai-button` export subpath

### Files Deleted
- `packages/frontend/components/src/ai_button.svelte` — Legacy button component
- `packages/frontend/components/src/ai_button.stories.ts` — Legacy Storybook stories

### Deviations
None.

### Test Results
- `frontend-components:typecheck` — ✅ Pass (0 errors)
- `client:typecheck` — ✅ Pass (0 errors, 5 pre-existing a11y warnings)
- `client:lint` — 12 pre-existing errors in unrelated files, none from changes
- `components:lint` — ✅ Clean (0 issues)
