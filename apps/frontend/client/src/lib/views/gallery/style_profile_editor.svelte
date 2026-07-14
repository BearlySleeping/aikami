<script lang="ts">
// apps/frontend/client/src/lib/views/gallery/style_profile_editor.svelte
//
// Style profile editor — select, view, and edit image style profiles.
// Built-in profiles are read-only but can be cloned. Custom profiles
// support full editing of positive/negative tags and per-image-type overrides.
//
// Contract: C-242 Image Generation Pipeline

import type { StyleProfileEditorViewModelInterface } from './style_profile_editor_view_model.svelte.ts';

type Props = { viewModel: StyleProfileEditorViewModelInterface };
const { viewModel }: Props = $props();

const IMAGE_TYPES = ['background', 'portrait', 'illustration', 'sprite', 'selfie'] as const;
</script>

<div class="space-y-4">
  <!-- Active profile selector -->
  <div>
    <label
      class="text-xs font-semibold text-base-content/60 uppercase tracking-wider block mb-1"
      for="style-active-profile"
      >Active Profile</label
    >
    <select
      id="style-active-profile"
      class="select select-bordered w-full text-sm"
      value={viewModel.activeProfileId}
      onchange={(e: Event) => viewModel.selectProfile((e.target as HTMLSelectElement).value)}
    >
      {#each viewModel.profiles as profile (profile.id)}
        <option value={profile.id}>
          {profile.name} {profile.isBuiltIn ? '🔒' : '✏️'}
        </option>
      {/each}
    </select>
  </div>

  <!-- Active profile info -->
  {#if viewModel.activeProfile}
    <div class="rounded-lg border border-base-300 bg-base-200 p-4 space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="font-semibold text-sm">{viewModel.activeProfile.name}</h3>
        <span class="badge badge-sm">{viewModel.activeProfile.promptGrammar}</span>
      </div>

      <div>
        <span class="text-[10px] font-mono uppercase text-base-content/40">Positive Tags</span>
        <p class="text-xs font-mono text-base-content/70 mt-0.5 break-all">
          {viewModel.activeProfile.positiveTags || '(none)'}
        </p>
      </div>

      <div>
        <span class="text-[10px] font-mono uppercase text-base-content/40">Negative Tags</span>
        <p class="text-xs font-mono text-base-content/70 mt-0.5 break-all">
          {viewModel.activeProfile.negativeTags || '(none)'}
        </p>
      </div>

      <div>
        <span class="text-[10px] font-mono uppercase text-base-content/40">Per-Image Tags</span>
        <div class="grid grid-cols-2 gap-1 mt-1">
          {#each viewModel.activeProfilePerImageTags as [ key, value ]}
            <span class="text-[10px] font-mono bg-base-300 rounded px-1 py-0.5">
              <span class="text-primary">{key}:</span> {value.slice(0, 30)}
            </span>
          {/each}
        </div>
      </div>

      <div class="flex gap-2">
        {#if viewModel.activeProfile.isBuiltIn}
          <button
            type="button"
            class="btn btn-xs btn-outline"
            onclick={() => viewModel.cloneProfile(viewModel.activeProfileId)}
          >
            📋 Clone & Edit
          </button>
        {:else}
          <button
            type="button"
            class="btn btn-xs btn-primary"
            onclick={() => viewModel.startEditing(viewModel.activeProfileId)}
          >
            ✏️ Edit
          </button>
          <button
            type="button"
            class="btn btn-xs btn-error btn-outline"
            onclick={() => viewModel.deleteProfile(viewModel.activeProfileId)}
          >
            🗑️ Delete
          </button>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Edit form (only for custom profiles) -->
  {#if viewModel.isEditing && viewModel.editingProfile}
    <div class="rounded-lg border border-primary/50 bg-base-200 p-4 space-y-3">
      <h3 class="font-semibold text-sm text-primary">Editing: {viewModel.editingProfile.name}</h3>

      <div>
        <label class="text-xs font-semibold text-base-content/60 block mb-0.5" for="style-name"
          >Name</label
        >
        <input
          id="style-name"
          class="input input-bordered input-sm w-full text-sm"
          value={viewModel.editingProfile.name}
          oninput={(e: Event) => viewModel.updateEditingField('name', (e.target as HTMLInputElement).value)}
        >
      </div>

      <div>
        <label
          class="text-xs font-semibold text-base-content/60 block mb-0.5"
          for="style-positive-tags"
          >Positive Tags</label
        >
        <textarea
          id="style-positive-tags"
          class="textarea textarea-bordered w-full text-xs font-mono h-20"
          value={viewModel.editingProfile.positiveTags}
          oninput={(e: Event) => viewModel.updateEditingField('positiveTags', (e.target as HTMLTextAreaElement).value)}
        ></textarea>
      </div>

      <div>
        <label
          class="text-xs font-semibold text-base-content/60 block mb-0.5"
          for="style-negative-tags"
          >Negative Tags</label
        >
        <textarea
          id="style-negative-tags"
          class="textarea textarea-bordered w-full text-xs font-mono h-20"
          value={viewModel.editingProfile.negativeTags}
          oninput={(e: Event) => viewModel.updateEditingField('negativeTags', (e.target as HTMLTextAreaElement).value)}
        ></textarea>
      </div>

      <div>
        <fieldset class="border-0 p-0">
          <legend class="text-xs font-semibold text-base-content/60 block mb-0.5">
            Per-Image Tags
          </legend>
          <div class="grid grid-cols-1 gap-2">
            {#each IMAGE_TYPES as imageType}
              <div>
                <span class="text-[10px] font-mono text-base-content/40">{imageType}</span>
                <input
                  class="input input-bordered input-sm w-full text-xs font-mono"
                  value={viewModel.editingProfile.perImageTags[imageType] ?? ''}
                  oninput={(e: Event) => viewModel.updatePerImageTag(imageType, (e.target as HTMLInputElement).value)}
                >
              </div>
            {/each}
          </div>
        </fieldset>
      </div>

      <div class="flex gap-2 pt-2">
        <button
          type="button"
          class="btn btn-sm btn-primary"
          onclick={() => viewModel.saveProfile()}
        >
          💾 Save
        </button>
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          onclick={() => viewModel.cancelEditing()}
        >
          Cancel
        </button>
      </div>
    </div>
  {/if}

  <!-- Profile list (all profiles) -->
  <details class="collapse collapse-arrow border border-base-300 rounded-lg">
    <summary class="collapse-title text-sm font-semibold">
      All Profiles ({viewModel.profiles.length})
    </summary>
    <div class="collapse-content space-y-1">
      {#each viewModel.profiles as profile (profile.id)}
        <div class="flex items-center justify-between py-1 px-2 rounded hover:bg-base-200">
          <div class="flex items-center gap-2">
            <span class="text-sm">{profile.name}</span>
            <span class="badge badge-xs">{profile.promptGrammar}</span>
            {#if profile.id === viewModel.activeProfileId}
              <span class="badge badge-xs badge-primary">active</span>
            {/if}
          </div>
          <div class="flex gap-1">
            {#if !profile.isBuiltIn}
              <button
                type="button"
                class="btn btn-xs btn-ghost"
                onclick={() => viewModel.startEditing(profile.id)}
              >
                ✏️
              </button>
              <button
                type="button"
                class="btn btn-xs btn-ghost text-error"
                onclick={() => viewModel.deleteProfile(profile.id)}
              >
                🗑️
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </details>
</div>
