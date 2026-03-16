## 1. Project Setup

- [x] 1.1 Create `packages/frontend/components/` directory
- [x] 1.2 Initialize `package.json` with name "@aikami/frontend-components", type: "module", exports
- [x] 1.3 Add dependencies: svelte@latest, storybook@latest, @storybook/sveltekit, tailwindcss, postcss, autoprefixer
- [x] 1.4 Add devDependencies: @storybook/addon-a11y (Note: @storybook/addon-essentials and @storybook/addon-interactions not yet compatible with Storybook 10)

## 2. Storybook Configuration

- [x] 2.1 Create `.storybook/main.ts` with @storybook/sveltekit framework and addon configuration
- [x] 2.2 Create `.storybook/preview.ts` with Tailwind decorator and preview parameters
- [x] 2.3 Create `tailwind.config.js` with content paths for components
- [x] 2.4 Create `postcss.config.js` with Tailwind/Autoprefixer
- [x] 2.5 Create `src/index.ts` with component exports

## 3. Moon Tasks

- [x] 3.1 Create `moon.yml` with task "components:dev": "bun storybook dev"
- [x] 3.2 Add task "components:build": "bun storybook build"
- [x] 3.3 Add task "components:test": "bun storybook test"

## 4. AiButton Component

- [x] 4.1 Create `src/AiButton.svelte` with $props for variant, size, disabled, and $state for internal state
- [x] 4.2 Add Tailwind classes for primary/secondary/ghost variants
- [x] 4.3 Add click handler with onClick prop

## 5. AiButton Stories

- [x] 5.1 Create `src/AiButton.stories.ts` with CSF 3.0 format
- [x] 5.2 Add default, primary, secondary, ghost, disabled, loading stories
- [x] 5.3 Configure a11y parameters for accessibility testing

## 6. Verification

- [x] 6.1 Run `moon run components:dev` to verify Storybook starts
- [x] 6.2 Run `moon run components:build` to verify static build
- [ ] 6.3 Verify AiButton renders correctly in Storybook (stories need Storybook restart)
