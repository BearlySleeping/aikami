<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/lpc-preview/+page.svelte
//
// Dev sandbox — isolated LPC preview for visual testing.
// Renders preset recipes directly without the onboarding flow.
// Contract: C-325 Ship Real-Time LPC Appearance Preview with Safe Defaults

import { onDestroy } from 'svelte';
import { APPEARANCE_PRESETS, DEFAULT_LPC_RECIPE } from '@aikami/constants';
import { page } from '$app/state';
import LpcPreviewView from '$lib/views/character/lpc_preview/lpc_preview_view.svelte';
import {
  getLpcPreviewViewModel,
  type LpcPreviewViewModelInterface,
} from '$lib/views/character/lpc_preview/lpc_preview_view_model.svelte';

/** Builds LpcLayerRecipe[] from a recipe record. */
const buildRecipes = (
  recipe: Record<string, string>,
  paletteOverrides?: Record<string, string>,
) => {
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

const previewVm: LpcPreviewViewModelInterface = getLpcPreviewViewModel({
  className: 'LpcPreviewSandbox',
});

// Reactive preset selection from URL
let presetId = $derived(page.url.searchParams.get('preset') ?? 'default');
let preset = $derived(APPEARANCE_PRESETS.find((p) => p.id === presetId));
let recipe = $derived(preset?.lpcLayers ?? DEFAULT_LPC_RECIPE);
let paletteOverrides = $derived(preset?.paletteOverrides);

// Update recipes when preset changes
$effect(() => {
  const recipes = buildRecipes(recipe, paletteOverrides);
  previewVm.setRecipes(recipes);
});

// Clean up PixiJS resources on unmount
onDestroy(() => {
  previewVm.dispose();
});
</script>

<div class="min-h-screen bg-base-100 p-8 flex flex-col items-center justify-center gap-4">
  <h1 class="text-xl font-bold">LPC Preview Sandbox</h1>
  <p class="text-sm text-base-content/60">Preset: {preset?.label ?? 'Default'} (id: {presetId})</p>

  <LpcPreviewView viewModel={previewVm} />

  <!-- Preset switcher for manual testing -->
  <div class="flex flex-wrap gap-2 mt-4">
    {#each APPEARANCE_PRESETS as p}
      <a href="?preset={p.id}" class="btn btn-xs {p.id === presetId ? 'btn-primary' : 'btn-ghost'}">
        {p.label}
      </a>
    {/each}
    <a
      href="?preset=default"
      class="btn btn-xs {presetId === 'default' ? 'btn-primary' : 'btn-ghost'}"
    >
      Default
    </a>
  </div>
</div>
