<script lang="ts">
// apps/frontend/client/src/routes/+layout.svelte
import '../app.css';

// Contract C-213: Required side-effect import for dynamic shader
// compilation under strict CSP. Must evaluate before any PixiJS
// renderer is created to avoid runtime failures on high-security
// hosts where unsafe-eval is blocked by default.
import 'pixi.js/unsafe-eval';

import { untrack } from 'svelte';
import AppView from '$lib/views/app/app_view.svelte';
import { getAppViewModel } from '$lib/views/app/app_view_model.svelte.ts';
import type { LayoutProps } from './$types';

let { data, children }: LayoutProps = $props();

const viewModel = untrack(() =>
  getAppViewModel({
    className: 'AppViewModel',
    data: data ?? {},
  }),
);
</script>

<AppView {viewModel}> {@render children()} </AppView>
