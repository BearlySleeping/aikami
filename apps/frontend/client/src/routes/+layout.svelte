<script lang="ts">
// apps/frontend/client/src/routes/+layout.svelte
// `$appCss` is an absolute alias (svelte.config.js) so the same layout
// resolves correctly from the filtered production routes copy at
// `.svelte-kit/routes-prod` (C-418 Feature B).
import '$appCss';

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
