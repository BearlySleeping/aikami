---
name: svelte-page
description: Scaffold a new SvelteKit page conforming to the Svelte 5 View and ViewModel pattern.
---

# Svelte Page Scaffolding Skill

Use this skill when adding a new page or view component to the SvelteKit app. It enforces a strict, SSR-safe View-ViewModel pattern where the View handles only UI rendering and wraps its content inside the `<BaseViewModelContainer>` to safely execute client-side initialization.

## Prerequisites
- The target route path (e.g., `authenticated/chat/[chat_id]`)
- The page name in snake_case (e.g., `chat_room`)

## Directory and File Rules
1. **Directory**: Create a dedicated view directory under `apps/frontend/pwa/src/lib/views/{page_name_snake}/`.
2. **Files**: All filenames must be strictly `snake_case`:
   - View component: `{page_name_snake}_view.svelte`
   - ViewModel: `{page_name_snake}_view_model.svelte.ts`
3. **Route Page**: `apps/frontend/pwa/src/routes/{route}/+page.svelte` (no capital letters or dashes).

---

## 1. Create the ViewModel
**File**: `apps/frontend/pwa/src/lib/views/{page_name_snake}/{page_name_snake}_view_model.svelte.ts`

```typescript
// apps/frontend/pwa/src/lib/views/{page_name_snake}/{page_name_snake}_view_model.svelte.ts
import {
	BaseViewModel,
	type BaseViewModelInterface,
	type BaseViewModelOptions,
} from "@aikami/frontend/services";

/**
 * Public API of the {PageNameCamel} ViewModel.
 */
export type {PageNameCamel}ViewModelInterface = BaseViewModelInterface & {
	/** Reactive indicator for loading state. */
	isLoading: boolean;
	/** Reactive data array or resource object. */
	data: string[];
};

/**
 * Configuration options for the {PageNameCamel} ViewModel.
 */
export interface {PageNameCamel}ViewModelOptions extends BaseViewModelOptions {
	// ... any page-specific constructor options, route params, or server load data
}

export class {PageNameCamel}ViewModel
	extends BaseViewModel<{PageNameCamel}ViewModelOptions>
	implements {PageNameCamel}ViewModelInterface
{
	isLoading = $state<boolean>(true);
	data = $state<string[]>([]);

	/**
	 * Client-side only initialization. Runs safely onMount inside the view container.
	 */
	async initialize(): Promise<void> {
		this.debug("initialize");
		try {
			this.isLoading = true;
			// Perform client-only SDK calls (e.g. Firebase Auth, Firestore)
			this.data = ["Nord", "Claw", "Agent"];
		} catch (error) {
			this.error("Failed to initialize", error);
		} finally {
			this.isLoading = false;
		}
	}
}

/**
 * Factory function to retrieve a new {PageNameCamel} ViewModel instance.
 */
export const get{PageNameCamel}ViewModel = (options: {PageNameCamel}ViewModelOptions): {PageNameCamel}ViewModel => {
	return new {PageNameCamel}ViewModel(options);
};
```

---

## 2. Create the View
**File**: `apps/frontend/pwa/src/lib/views/{page_name_snake}/{page_name_snake}_view.svelte`

Wrap all markup inside `<BaseViewModelContainer>` to guarantee that `viewModel.initialize()` is called safely client-side.

```svelte
<script lang="ts">
  // apps/frontend/pwa/src/lib/views/{page_name_snake}/{page_name_snake}_view.svelte
  import BaseViewModelContainer from '@aikami/frontend/components/base_view_model_container.svelte';
  import type { {PageNameCamel}ViewModelInterface } from './{page_name_snake}_view_model.svelte.ts';

  type Props = { viewModel: {PageNameCamel}ViewModelInterface };
  const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel} class="p-8 md:p-12 max-w-4xl">
  {#if viewModel.isLoading}
    <div class="font-mono text-xs text-muted-foreground">Loading...</div>
  {:else}
    <h1 class="text-2xl font-bold font-serif mb-4">Welcome to {PageNameCamel}</h1>
    <ul>
      {#each viewModel.data as item}
        <li class="font-mono text-sm">{item}</li>
      {/each}
    </ul>
  {/if}
</BaseViewModelContainer>
```

---

## 3. Create the Route Page
**File**: `apps/frontend/pwa/src/routes/{route}/+page.svelte`

Instantiate the ViewModel in the SvelteKit route page and pass it to the View as a single prop. Do not call `.initialize()` here.

```svelte
<script lang="ts">
  // apps/frontend/pwa/src/routes/{route}/+page.svelte
  import {PageNameCamel}View from '$views/{page_name_snake}/{page_name_snake}_view.svelte';
  import { get{PageNameCamel}ViewModel } from '$views/{page_name_snake}/{page_name_snake}_view_model.svelte.ts';

  const viewModel = get{PageNameCamel}ViewModel({
    className: '{PageNameCamel}ViewModel',
  });
</script>

<{PageNameCamel}View {viewModel} />
```
