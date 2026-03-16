## Context

The Aikami monorepo uses Bun, SvelteKit, and Moon for task orchestration. Currently, there is no centralized component library - components are scattered across the PWA or duplicated. Storybook 10 offers Vite-based development with native Svelte 5 support, making it ideal for documenting and developing components with Runes.

## Goals / Non-Goals

**Goals:**
- Establish `packages/frontend/components/` as the canonical location for shared UI components
- Configure Storybook 10 with SvelteKit, Tailwind CSS, and essential addons
- Set up Moon tasks for dev, build, and test workflows
- Create a reference `AiButton` component demonstrating Svelte 5 patterns

**Non-Goals:**
- Migrating existing components from the PWA (future work)
- Setting up component testing with Vitest (out of scope)
- Publishing to npm (internal package only)

## Decisions

### Svelte 5 Runes for All Components
All components SHALL use Svelte 5 runes (`$props`, `$state`, `$derived`) exclusively. No legacy Svelte 4 patterns.

### Storybook 10 with @storybook/sveltekit
Using `@storybook/sveltekit` over `@storybook/svelte` provides:
- Vite-native development (matches Aikami's build)
- SvelteKit routing support
- Hot module replacement

### Tailwind CSS for Styling
Tailwind CSS provides:
- Consistent design tokens
- Rapid development
- Tree-shakeable output
- Integration with storybook-design-token for documentation

### Moon Task Runner
Using Moon (consistent with Aikami monorepo):
- `components:dev` - Start Storybook dev server
- `components:build` - Build static Storybook
- `components:test` - Run Storybook tests

## Risks / Trade-offs

- **Risk**: Storybook 10 is relatively new → **Mitigation**: Use stable versions and monitor for updates
- **Risk**: Svelte 5 is in preview (`svelte@next`) → **Mitigation**: Pin to known-working version, test frequently
- **Risk**: Two package.json files in monorepo → **Mitigation**: Ensure consistent Bun/Node versions via workspace config
