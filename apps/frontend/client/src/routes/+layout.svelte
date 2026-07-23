<script lang="ts">
// apps/frontend/client/src/routes/+layout.svelte
import '../app.css';

// Required side-effect import for dynamic shader
// compilation under strict CSP. Must evaluate before any PixiJS
// renderer is created to avoid runtime failures on high-security
// hosts where unsafe-eval is blocked by default.
// TODO: lazy load in apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts boot method instead
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
