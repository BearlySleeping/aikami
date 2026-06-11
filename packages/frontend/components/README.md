# @aikami/frontend-components

Shared UI components library for Aikami.

## Use Case

This package provides reusable Svelte 5 components with Storybook documentation:
- Shared UI primitives for the PWA
- Interactive component development via Storybook
- Visual regression testing via Storybook test runner

## Where It's Used

Used by `apps/frontend/client` and any frontend app that needs shared components.

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Peer Dependencies

- `svelte` ^5.0.0

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `dev` | `storybook dev --port 6006` | Start Storybook dev server |
| `build` | `storybook build` | Build Storybook static site |
| `test` | `test-storybook` | Run Storybook interaction tests |
| `typecheck` | `tsc --noEmit` | Run TypeScript type checking |
| `format` | `biome format .` | Format code with Biome |
| `lint` | `biome lint .` | Lint code with Biome |
| `fix` | `biome check --write .` | Auto-fix lint & format issues |

## Usage

```svelte
<script lang="ts">
  import AiButton from '@aikami/frontend-components/ai-button';
</script>

<AiButton onClick={handleClick}>Ask AI</AiButton>
```

## Components

| Component | Description |
|-----------|-------------|
| `AiButton` | Styled button for triggering AI interactions |
