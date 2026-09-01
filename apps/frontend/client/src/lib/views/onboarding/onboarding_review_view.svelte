<script lang="ts">
// apps/frontend/client/src/lib/views/onboarding/onboarding_review_view.svelte
//
// Shared complete page for persona review & editing.
// Used by all three paths: DM chat, manual creation, and preset selection.
// Mirrors the TWEAK phase UI from PersonaCreateView.

import { onDestroy } from 'svelte';
import { BaseViewModelContainer, Image } from '$components';
import { getLpcCatalog } from '$lib/data/lpc_asset_catalog';
import LpcPreviewView from '$lib/views/character/lpc_preview/lpc_preview_view.svelte';
import {
  getLpcPreviewViewModel,
  type LpcPreviewViewModelInterface,
} from '$lib/views/character/lpc_preview/lpc_preview_view_model.svelte';
import type { OnboardingCoordinatorViewModelInterface } from './onboarding_coordinator_view_model.svelte';

type Props = {
  viewModel: OnboardingCoordinatorViewModelInterface;
};

const { viewModel }: Props = $props();

// ── Inline LPC preview ─────────────────────────────────────────────────
const previewVm: LpcPreviewViewModelInterface = getLpcPreviewViewModel({
  className: 'LpcPreviewViewModel',
});

onDestroy(() => {
  previewVm.dispose();
});

$effect(() => {
  const _persona = viewModel.persona;
  if (viewModel.lpcRecipe && Object.keys(viewModel.lpcRecipe).length > 0) {
    const recipe = viewModel.lpcRecipe;
    const engineSlots = ['body', 'hair', 'torso', 'legs', 'feet', 'head'];
    const recipes = engineSlots
      .filter((slot) => recipe[slot])
      .map((slot) => {
        const assetId = recipe[slot];
        const validIds = getLpcCatalog().assetIdsBySlot[slot];
        const validId = validIds?.includes(assetId)
          ? assetId
          : viewModel.defaultLpcRecipe[slot as keyof typeof viewModel.defaultLpcRecipe];
        return {
          slot,
          assetId: validId ?? assetId,
          hexPalette: new Uint8Array(1024),
        };
      });
    previewVm.setRecipes(recipes);
  } else {
    previewVm.setRecipes([]);
  }
});

const handleAvatarUpload = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    viewModel.chatViewModel.uploadAvatar(file);
  }
};

const scoreLabels = [
  { key: 'strength' as const, label: 'STR', desc: 'Strength' },
  { key: 'dexterity' as const, label: 'DEX', desc: 'Dexterity' },
  { key: 'constitution' as const, label: 'CON', desc: 'Constitution' },
  { key: 'intelligence' as const, label: 'INT', desc: 'Intelligence' },
  { key: 'wisdom' as const, label: 'WIS', desc: 'Wisdom' },
  { key: 'charisma' as const, label: 'CHA', desc: 'Charisma' },
];
</script>
<BaseViewModelContainer {viewModel}>
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <!-- Avatar card -->
    <div class="card bg-base-200 shadow">
      <div class="card-body items-center gap-4">
        <h2 class="card-title text-lg">Persona Avatar</h2>
        <div
          class="w-48 h-48 rounded-xl bg-base-300 flex items-center justify-center overflow-hidden"
        >
          {#if viewModel.avatarUrl}
            <Image
              src={viewModel.avatarUrl}
              alt="Persona avatar"
              class="object-cover w-full h-full"
            />
          {:else}
            <div class="text-center px-4">
              <p class="text-3xl mb-2">🖼️</p>
              <p class="text-xs text-base-content/40">No avatar yet</p>
            </div>
          {/if}
        </div>

        <!-- Avatar upload -->
        <div class="flex flex-col items-center gap-1">
          <input
            type="file"
            id="review-avatar-upload"
            accept="image/*"
            class="file-input file-input-bordered file-input-xs w-full max-w-48"
            onchange={handleAvatarUpload}
          >
          <span class="text-[10px] text-base-content/40">Upload an image or AI card</span>
        </div>

        <!-- LPC Sprite Preview -->
        {#if viewModel.lpcRecipe && Object.keys(viewModel.lpcRecipe).length > 0}
          <div class="divider text-xs text-base-content/40 my-0">LPC Sprite</div>
          <div class="w-full">
            <LpcPreviewView viewModel={previewVm} />
          </div>
          <p class="text-[10px] text-base-content/40">
            Preview updates live from the extracted appearance recipe
          </p>
        {/if}
      </div>
    </div>

    <!-- Persona details card -->
    <div class="card bg-base-200 shadow">
      <div class="card-body gap-4">
        <h2 class="card-title text-lg">Persona Details</h2>

        {#if viewModel.persona}
          {@const p = viewModel.persona}

          <!-- Name -->
          <label class="form-control w-full">
            <div class="label py-0.5">
              <span class="label-text font-semibold">Name</span>
            </div>
            <input
              type="text"
              class="input input-bordered w-full"
              bind:value={p.name}
              placeholder="Persona name"
            >
          </label>

          <!-- Race + Class -->
          <div class="grid grid-cols-2 gap-3">
            <label class="form-control">
              <div class="label py-0.5">
                <span class="label-text font-semibold text-xs">Race</span>
              </div>
              <input
                type="text"
                class="input input-bordered input-sm w-full"
                bind:value={p.race}
                placeholder="Elf, Tiefling..."
              >
            </label>
            <label class="form-control">
              <div class="label py-0.5">
                <span class="label-text font-semibold text-xs">Class</span>
              </div>
              <input
                type="text"
                class="input input-bordered input-sm w-full"
                bind:value={p.class}
                placeholder="Wizard, Rogue..."
              >
            </label>
          </div>

          <!-- Subclass + Level + Alignment -->
          <div class="grid grid-cols-3 gap-3">
            <label class="form-control">
              <div class="label py-0.5">
                <span class="label-text font-semibold text-xs">Subclass</span>
              </div>
              <input
                type="text"
                class="input input-bordered input-sm w-full"
                bind:value={p.subclass}
                placeholder="Optional"
              >
            </label>
            <label class="form-control">
              <div class="label py-0.5">
                <span class="label-text font-semibold text-xs">Level</span>
              </div>
              <input
                type="number"
                class="input input-bordered input-sm w-full text-center"
                bind:value={p.level}
                min="1"
                max="20"
              >
            </label>
            <label class="form-control">
              <div class="label py-0.5">
                <span class="label-text font-semibold text-xs">Alignment</span>
              </div>
              <input
                type="text"
                class="input input-bordered input-sm w-full"
                bind:value={p.alignment}
                placeholder="Chaotic Good"
              >
            </label>
          </div>

          <!-- Background -->
          <label class="form-control w-full">
            <div class="label py-0.5">
              <span class="label-text font-semibold">Background</span>
            </div>
            <textarea
              class="textarea textarea-bordered w-full min-h-16 text-sm"
              bind:value={p.background}
              placeholder="Persona background story..."
              rows="3"
            ></textarea>
          </label>

          <!-- Combat stats -->
          <div class="grid grid-cols-3 gap-3">
            <label class="form-control">
              <div class="label py-0.5">
                <span class="label-text font-semibold text-xs">HP</span>
              </div>
              <input
                type="number"
                class="input input-bordered input-sm w-full text-center"
                bind:value={p.hitPoints}
                min="1"
              >
            </label>
            <label class="form-control">
              <div class="label py-0.5">
                <span class="label-text font-semibold text-xs">AC</span>
              </div>
              <input
                type="number"
                class="input input-bordered input-sm w-full text-center"
                bind:value={p.armorClass}
                min="1"
              >
            </label>
            <label class="form-control">
              <div class="label py-0.5">
                <span class="label-text font-semibold text-xs">Speed</span>
              </div>
              <input
                type="number"
                class="input input-bordered input-sm w-full text-center"
                bind:value={p.speed}
                min="1"
              >
            </label>
          </div>

          <!-- Appearance -->
          <label class="form-control w-full">
            <div class="label py-0.5">
              <span class="label-text font-semibold">Appearance</span>
            </div>
            <textarea
              class="textarea textarea-bordered w-full min-h-20 text-sm"
              value={p.appearance?.physicalDescription ?? ''}
              oninput={(e: Event) => {
              if (p.appearance) {
                p.appearance.physicalDescription = (e.target as HTMLTextAreaElement).value;
              }
            }}
              placeholder="Physical description for avatar generation"
              rows="3"
            ></textarea>
          </label>

          <!-- Languages -->
          <label class="form-control w-full">
            <div class="label py-0.5">
              <span class="label-text font-semibold">Languages</span>
              <span class="label-text-alt text-base-content/40">comma-separated</span>
            </div>
            <input
              type="text"
              class="input input-bordered w-full text-sm"
              value={p.languages?.join(', ') ?? ''}
              oninput={(e: Event) => {
              p.languages = (e.target as HTMLInputElement).value
                .split(',')
                .map((s: string) => s.trim())
                .filter(Boolean);
            }}
              placeholder="Common, Elvish, Dwarvish..."
            >
          </label>

          <!-- Proficiencies -->
          <label class="form-control w-full">
            <div class="label py-0.5">
              <span class="label-text font-semibold">Proficiencies</span>
              <span class="label-text-alt text-base-content/40">comma-separated</span>
            </div>
            <input
              type="text"
              class="input input-bordered w-full text-sm"
              value={p.proficiencies?.join(', ') ?? ''}
              oninput={(e: Event) => {
              p.proficiencies = (e.target as HTMLInputElement).value
                .split(',')
                .map((s: string) => s.trim())
                .filter(Boolean);
            }}
              placeholder="Arcana, Stealth, Persuasion..."
            >
          </label>

          <!-- Equipment -->
          <label class="form-control w-full">
            <div class="label py-0.5">
              <span class="label-text font-semibold">Equipment</span>
              <span class="label-text-alt text-base-content/40">comma-separated</span>
            </div>
            <input
              type="text"
              class="input input-bordered w-full text-sm"
              value={p.equipment?.join(', ') ?? ''}
              oninput={(e: Event) => {
              p.equipment = (e.target as HTMLInputElement).value
                .split(',')
                .map((s: string) => s.trim())
                .filter(Boolean);
            }}
              placeholder="Longsword, Shield, Explorer's Pack..."
            >
          </label>

          <!-- Personality -->
          <div class="grid grid-cols-2 gap-3">
            <label class="form-control">
              <div class="label py-0.5">
                <span class="label-text font-semibold text-xs">Personality Traits</span>
              </div>
              <input
                type="text"
                class="input input-bordered input-sm w-full"
                bind:value={p.personalityTraits}
                placeholder="Traits..."
              >
            </label>
            <label class="form-control">
              <div class="label py-0.5">
                <span class="label-text font-semibold text-xs">Ideals</span>
              </div>
              <input
                type="text"
                class="input input-bordered input-sm w-full"
                bind:value={p.ideals}
                placeholder="Ideals..."
              >
            </label>
            <label class="form-control">
              <div class="label py-0.5">
                <span class="label-text font-semibold text-xs">Bonds</span>
              </div>
              <input
                type="text"
                class="input input-bordered input-sm w-full"
                bind:value={p.bonds}
                placeholder="Bonds..."
              >
            </label>
            <label class="form-control">
              <div class="label py-0.5">
                <span class="label-text font-semibold text-xs">Flaws</span>
              </div>
              <input
                type="text"
                class="input input-bordered input-sm w-full"
                bind:value={p.flaws}
                placeholder="Flaws..."
              >
            </label>
          </div>
        {:else}
          <p class="text-sm text-base-content/40 italic">No persona data available.</p>
        {/if}
      </div>
    </div>

    <!-- Ability Scores -->
    <div class="card bg-base-200 shadow lg:col-span-2">
      <div class="card-body gap-4">
        <h2 class="card-title text-lg">Ability Scores</h2>

        {#if viewModel.persona?.abilityScores}
          {@const scores = viewModel.persona.abilityScores}
          <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
            {#each scoreLabels as stat}
              <div class="form-control">
                <div class="label">
                  <span class="label-text font-semibold">{stat.label}</span>
                  <span class="label-text-alt text-base-content/40">{stat.desc}</span>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost btn-square"
                    onclick={() => {
                    const current = scores[stat.key];
                    if (typeof current === 'number' && current > 8) {
                      scores[stat.key] = current - 1;
                    }
                  }}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    class="input input-bordered w-20 text-center"
                    min="8"
                    max="15"
                    bind:value={scores[stat.key]}
                  >
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost btn-square"
                    onclick={() => {
                    const current = scores[stat.key];
                    if (typeof current === 'number' && current < 15) {
                      scores[stat.key] = current + 1;
                    }
                  }}
                  >
                    +
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-base-content/40 italic">
            Ability scores not provided. Edit the persona details to refine.
          </p>
        {/if}
      </div>
    </div>

    <!-- Actions -->
    <div class="flex justify-center gap-4 lg:col-span-2">
      {#if viewModel.mode === 'manual_steps'}
        <!-- Inside manual creation: back to previous step -->
        <button type="button" class="btn btn-ghost" onclick={() => viewModel.previousStep()}>
          ← Back
        </button>
      {:else}
        <!-- From chat or preset: back to chat -->
        <button type="button" class="btn btn-ghost" onclick={() => viewModel.backToChat()}>
          ← Back to Chat
        </button>
      {/if}
      <button
        type="button"
        class="btn btn-primary"
        onclick={() => viewModel.confirmAndEnter()}
        disabled={viewModel.isConfirming}
      >
        {viewModel.isConfirming ? 'Entering...' : '⚔️ Enter World'}
      </button>
    </div>
  </div>
</BaseViewModelContainer>
