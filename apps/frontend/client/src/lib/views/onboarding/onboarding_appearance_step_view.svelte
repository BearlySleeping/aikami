<script lang="ts">
// apps/frontend/client/src/lib/views/onboarding/onboarding_appearance_step_view.svelte
//
// Appearance step — LPC sprite preview, curated presets, layer selectors,
// palette/tint controls, and text description.
// Contract: C-325 Ship Real-Time LPC Appearance Preview with Safe Defaults

import { onDestroy } from 'svelte';
import { GENERATED_LPC_SLOTS } from '$lib/data/lpc_asset_catalog_generated';
import LpcPreviewView from '$lib/views/character/lpc_preview/lpc_preview_view.svelte';
import {
  getLpcPreviewViewModel,
  type LpcPreviewViewModelInterface,
} from '$lib/views/character/lpc_preview/lpc_preview_view_model.svelte';
import type { OnboardingCoordinatorViewModelInterface } from './onboarding_coordinator_view_model.svelte';

type Props = {
  viewModel: OnboardingCoordinatorViewModelInterface;
};
let { viewModel }: Props = $props();

// ── LPC preview sub-ViewModel ──────────────────────────────────────

const previewVm: LpcPreviewViewModelInterface = getLpcPreviewViewModel({
  className: 'LpcPreviewViewModel',
});

// Dispose the PixiJS context when leaving the appearance step
onDestroy(() => {
  previewVm.dispose();
});

// Reactively push recipes to the preview VM
$effect(() => {
  void viewModel.lpcPreviewRecipes;
  void viewModel.lpcRecipe;
  void viewModel.paletteOverrides;
  previewVm.setRecipes(viewModel.lpcPreviewRecipes);
});

// Sync animation toggle (one-way: coordinator → preview)
let _prevPlaying = false;
$effect(() => {
  void viewModel.previewPlaying;
  // Only toggle if the coordinator changed the state
  if (viewModel.previewPlaying !== _prevPlaying) {
    previewVm.togglePlayback();
    _prevPlaying = viewModel.previewPlaying;
  }
});

// ── Slot variant lookup helper ────────────────────────────────────

/**
 * Returns available variants for a given LPC slot from the generated catalog.
 */
const getSlotVariants = (slotName: string): Array<{ assetId: string; label: string }> => {
  const slotDef = GENERATED_LPC_SLOTS.find((s) => s.slot === slotName);
  if (!slotDef) {
    return [];
  }
  return slotDef.variants.map((v) => ({
    assetId: v.assetId,
    label: v.label,
  }));
};

// Slots exposed in the onboarding UI
const editableSlots = ['body', 'hair', 'head', 'torso', 'legs', 'feet'] as const;
const slotLabels: Record<string, string> = {
  body: 'Body',
  hair: 'Hair',
  head: 'Head',
  torso: 'Torso',
  legs: 'Legs',
  feet: 'Feet',
};

// ── Color picker state ─────────────────────────────────────────────

const getPaletteHex = (slot: string): string => {
  return viewModel.paletteOverrides[slot] ?? 'CCCCCC';
};
</script>

<div class="space-y-6">
  <h2 class="text-2xl font-bold text-base-content">Describe Your Hero</h2>

  <!-- LPC Preview -->
  <LpcPreviewView viewModel={previewVm} />

  <!-- Curated Appearance Presets -->
  <fieldset class="border-0 p-0">
    <legend class="text-sm font-semibold mb-2">Quick Presets</legend>
    <div class="grid grid-cols-2 gap-2">
      {#each viewModel.appearancePresets as preset}
        <button
          type="button"
          class="card bg-base-200 hover:bg-base-300 transition-colors border cursor-pointer text-left p-3 {viewModel.selectedPresetId === preset.id
            ? 'border-primary'
            : 'border-base-300'}"
          onclick={() => viewModel.selectAppearancePreset(preset.id)}
          aria-pressed={viewModel.selectedPresetId === preset.id}
        >
          <div class="font-semibold text-sm">{preset.label}</div>
          <div class="text-xs text-base-content/60 mt-1">{preset.description}</div>
        </button>
      {/each}
    </div>
  </fieldset>

  <!-- Layer Selectors -->
  <fieldset class="border-0 p-0">
    <legend class="text-sm font-semibold mb-2">Customize Layers</legend>
    <div class="grid grid-cols-2 gap-2">
      {#each editableSlots as slot}
        {@const variants = getSlotVariants(slot)}
        {@const currentAssetId = viewModel.lpcRecipe[slot] ?? ''}
        <div class="form-control w-full">
          <label for="lpc-slot-{slot}" class="label py-1">
            <span class="label-text text-xs">{slotLabels[slot] ?? slot}</span>
          </label>
          <select
            id="lpc-slot-{slot}"
            class="select select-bordered select-sm w-full"
            value={currentAssetId}
            onchange={(e) =>
              viewModel.setLpcLayer(slot, (e.target as HTMLSelectElement).value)}
          >
            <option value="">—</option>
            {#each variants as variant}
              <option value={variant.assetId}>{variant.label}</option>
            {/each}
          </select>
        </div>
      {/each}
    </div>
  </fieldset>

  <!-- Palette / Color Controls -->
  <fieldset class="border-0 p-0">
    <legend class="text-sm font-semibold mb-2">Colors</legend>
    <div class="flex flex-wrap gap-3">
      <div class="form-control">
        <label for="lpc-color-skin" class="label py-1">
          <span class="label-text text-xs">Skin</span>
        </label>
        <input
          id="lpc-color-skin"
          type="color"
          class="w-10 h-10 rounded cursor-pointer"
          value="#{getPaletteHex('body')}"
          oninput={(e) =>
            viewModel.setPaletteOverride(
              'body',
              (e.target as HTMLInputElement).value.replace('#', ''),
            )}
        >
      </div>
      <div class="form-control">
        <label for="lpc-color-hair" class="label py-1">
          <span class="label-text text-xs">Hair</span>
        </label>
        <input
          id="lpc-color-hair"
          type="color"
          class="w-10 h-10 rounded cursor-pointer"
          value="#{getPaletteHex('hair')}"
          oninput={(e) =>
            viewModel.setPaletteOverride(
              'hair',
              (e.target as HTMLInputElement).value.replace('#', ''),
            )}
        >
      </div>
    </div>
  </fieldset>

  <!-- Appearance Description -->
  <div class="form-control w-full">
    <label for="onboarding-appearance" class="label">
      <span class="label-text font-semibold">Physical Description</span>
    </label>
    <textarea
      id="onboarding-appearance"
      class="textarea textarea-bordered w-full h-24"
      placeholder="Describe what your character looks like..."
      value={viewModel.appearanceDescription}
      oninput={(e) =>
        viewModel.setAppearanceDescription((e.target as HTMLTextAreaElement).value)}
    ></textarea>
  </div>

  <!-- Background -->
  <div class="form-control w-full">
    <label for="onboarding-background" class="label">
      <span class="label-text font-semibold">Background Story</span>
    </label>
    <textarea
      id="onboarding-background"
      class="textarea textarea-bordered w-full h-20"
      placeholder="Where does your character come from? What drives them?"
      value={viewModel.background}
      oninput={(e) => viewModel.setBackground((e.target as HTMLTextAreaElement).value)}
    ></textarea>
  </div>

  <!-- Personality Traits -->
  <div class="form-control w-full">
    <label for="onboarding-personality" class="label">
      <span class="label-text font-semibold">Personality Traits</span>
    </label>
    <input
      id="onboarding-personality"
      type="text"
      class="input input-bordered w-full"
      placeholder="e.g., Brave, curious, stubborn, compassionate..."
      value={viewModel.personalityTraits}
      oninput={(e) =>
        viewModel.setPersonalityTraits((e.target as HTMLInputElement).value)}
    >
  </div>
</div>
