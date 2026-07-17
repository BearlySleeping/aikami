<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/lpc-preview/+page.svelte
  //
  // Dev sandbox — isolated LPC preview for visual testing.
  // Renders preset recipes directly without the onboarding flow.
  // Contract: C-325 Ship Real-Time LPC Appearance Preview with Safe Defaults

  import { DEFAULT_LPC_RECIPE, APPEARANCE_PRESETS } from '@aikami/constants';
  import LpcPreviewView from '$lib/views/character/lpc_preview/lpc_preview_view.svelte';
  import {
    getLpcPreviewViewModel,
    type LpcPreviewViewModelInterface,
  } from '$lib/views/character/lpc_preview/lpc_preview_view_model.svelte';
  import { page } from '$app/state';

  // Determine which preset to show from URL params
  const presetId = page.url.searchParams.get('preset') ?? 'default';
  const preset = APPEARANCE_PRESETS.find((p) => p.id === presetId);

  /** Builds LpcLayerRecipe[] from a recipe record. */
  const buildRecipes = (recipe: Record<string, string>, paletteOverrides?: Record<string, string>) => {
    const recipes: Array<{ slot: string; assetId: string; hexPalette: Uint8Array }> = [];
    for (const [slot, assetId] of Object.entries(recipe)) {
      const hexColor = paletteOverrides?.[slot];
      const hexPalette = new Uint8Array(1024);
      if (hexColor && hexColor.length === 6) {
        const r = Number.parseInt(hexColor.slice(0, 2), 16);
        const g = Number.parseInt(hexColor.slice(2, 4), 16);
        const b = Number.parseInt(hexColor.slice(4, 6), 16);
        if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
          for (let entry = 0; entry < 256; entry++) {
            const offset = entry * 4;
            hexPalette[offset] = r;
            hexPalette[offset + 1] = g;
            hexPalette[offset + 2] = b;
            hexPalette[offset + 3] = 255;
          }
        }
      }
      recipes.push({ slot, assetId, hexPalette });
    }
    return recipes;
  };

  const recipe = preset?.lpcLayers ?? DEFAULT_LPC_RECIPE;
  const paletteOverrides = preset?.paletteOverrides;
  const initialRecipes = buildRecipes(recipe, paletteOverrides);

  const previewVm: LpcPreviewViewModelInterface = getLpcPreviewViewModel({
    className: 'LpcPreviewSandbox',
  });

  // Push recipes after init
  let recipesSet = $state(false);
  $effect(() => {
    if (!recipesSet) {
      previewVm.setRecipes(initialRecipes);
      recipesSet = true;
    }
  });
</script>

<div class="min-h-screen bg-base-100 p-8 flex flex-col items-center justify-center gap-4">
  <h1 class="text-xl font-bold">LPC Preview Sandbox</h1>
  <p class="text-sm text-base-content/60">
    Preset: {preset?.label ?? 'Default'} (id: {presetId})
  </p>

  <LpcPreviewView viewModel={previewVm} />

  <!-- Preset switcher for manual testing -->
  <div class="flex flex-wrap gap-2 mt-4">
    {#each APPEARANCE_PRESETS as p}
      <a
        href="?preset={p.id}"
        class="btn btn-xs {p.id === presetId ? 'btn-primary' : 'btn-ghost'}"
      >
        {p.label}
      </a>
    {/each}
    <a href="?preset=default" class="btn btn-xs {presetId === 'default' ? 'btn-primary' : 'btn-ghost'}">
      Default
    </a>
  </div>
</div>
