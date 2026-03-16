## Why

The Aikami project needs a centralized, well-documented component library to ensure consistency, reusability, and quality across the frontend. Storybook 10 provides a modern, Vite-powered development environment for building, testing, and documenting Svelte 5 components with Runes. Establishing this library now enables systematic UI development and accelerates future feature work.

## What Changes

- Create new `@aikami/frontend-components` package in `packages/frontend/components/`
- Initialize with Storybook 10 using `@storybook/sveltekit` (Vite-based)
- Configure Storybook addons: a11y, essentials, interactions, and storybook-design-token
- Set up Moon task runner with dev, build, and test tasks
- Create foundational `AiButton` component demonstrating Svelte 5 Runes pattern

## Capabilities

### New Capabilities

- `frontend-component-library`: Shared Svelte 5 component library with Storybook 10 documentation, enabling consistent UI development across Aikami

### Modified Capabilities

- (none)

## Impact

- New package: `packages/frontend/components/`
- Dependencies: svelte@next, storybook@latest, @storybook/sveltekit, tailwindcss
- Tasks added to Moon: `components:dev`, `components:build`, `components:test`
