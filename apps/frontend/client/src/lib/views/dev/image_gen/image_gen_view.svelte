<script lang="ts">
// apps/frontend/client/src/lib/views/dev/image_gen/image_gen_view.svelte
//
// Dev sandbox for the Image Generation Pipeline (C-242).
// Integrates style profile editor, prompt compiler live test area,
// contextual trigger simulator, and gallery viewer.
//
// Contract: C-242 Image Generation Pipeline

import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import type { ImageGenViewModelInterface } from './image_gen_view_model.svelte.ts';

type Props = { viewModel: ImageGenViewModelInterface };
const { viewModel }: Props = $props();

const IMAGE_TYPES = ['background', 'portrait', 'illustration', 'sprite', 'selfie'] as const;
const TRIGGER_EVENTS = [
  'location_changed',
  'combat_started',
  'npc_introduced',
  'dramatic_moment',
  'quest_completed',
] as const;
</script>

<svelte:head>
  <title>Image Gen Pipeline - Dev Console</title>
</svelte:head>

<BaseViewModelContainer {viewModel}>
  <div class="flex flex-col items-center min-h-full p-8 gap-6">
    <div class="w-full max-w-3xl">
      <h1 class="mb-2 text-2xl font-bold">Image Gen Pipeline</h1>
      <p class="mb-6 text-base-content/60">
        Style profiles, prompt compiler, contextual triggers, and gallery.
      </p>

      <!-- ── Tab bar ── -->
      <div class="tabs tabs-bordered mb-6">
        {#each viewModel.tabs as tab}
          <button
            type="button"
            class="tab tab-sm font-mono text-xs uppercase tracking-wider {viewModel.activeTab === tab.key ? 'tab-active border-primary text-primary' : ''}"
            onclick={() => (viewModel.activeTab = tab.key)}
          >
            {tab.label}
          </button>
        {/each}
      </div>

      <!-- ══════════ Profiles Tab ══════════ -->
      {#if viewModel.activeTab === 'profiles'}
        <div class="space-y-4">
          <!-- Active profile selector -->
          <div>
            <label
              class="text-xs font-semibold text-base-content/60 uppercase tracking-wider block mb-1"
              >Active Profile</label
            >
            <select
              class="select select-bordered w-full text-sm"
              value={viewModel.activeProfileId}
              onchange={(e: Event) => (viewModel.activeProfileId = (e.target as HTMLSelectElement).value)}
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
                <span class="text-[10px] font-mono uppercase text-base-content/40"
                  >Positive Tags</span
                >
                <p class="text-xs font-mono text-base-content/70 mt-0.5 break-all">
                  {viewModel.activeProfile.positiveTags || '(none)'}
                </p>
              </div>

              <div>
                <span class="text-[10px] font-mono uppercase text-base-content/40"
                  >Negative Tags</span
                >
                <p class="text-xs font-mono text-base-content/70 mt-0.5 break-all">
                  {viewModel.activeProfile.negativeTags || '(none)'}
                </p>
              </div>

              <div>
                <span class="text-[10px] font-mono uppercase text-base-content/40"
                  >Per-Image Tags</span
                >
                <div class="grid grid-cols-2 gap-1 mt-1">
                  {#each viewModel.activeProfilePerImageTags as [ key, value ]}
                    <span class="text-[10px] font-mono bg-base-300 rounded px-1 py-0.5">
                      <span class="text-primary">{key}:</span> {value.slice(0, 30)}
                    </span>
                  {/each}
                </div>
              </div>

              <div class="flex gap-2">
                <button
                  type="button"
                  class="btn btn-xs btn-outline"
                  onclick={() => viewModel.cloneProfile(viewModel.activeProfileId)}
                >
                  📋 Clone
                </button>
                {#if !viewModel.activeProfile.isBuiltIn}
                  <button
                    type="button"
                    class="btn btn-xs btn-primary"
                    onclick={() => viewModel.startEditingProfile(viewModel.activeProfileId)}
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

          <!-- Edit form -->
          {#if viewModel.isEditing && viewModel.editingProfile}
            <div class="rounded-lg border border-primary/50 bg-base-200 p-4 space-y-3">
              <h3 class="font-semibold text-sm text-primary">
                Editing: {viewModel.editingProfile.name}
              </h3>

              <div>
                <label class="text-xs font-semibold text-base-content/60 block mb-0.5">Name</label>
                <input
                  class="input input-bordered input-sm w-full text-sm"
                  value={viewModel.editingProfile.name}
                  oninput={(e: Event) => viewModel.updateEditingField('name', (e.target as HTMLInputElement).value)}
                >
              </div>

              <div>
                <label class="text-xs font-semibold text-base-content/60 block mb-0.5"
                  >Positive Tags</label
                >
                <textarea
                  class="textarea textarea-bordered w-full text-xs font-mono h-20"
                  value={viewModel.editingProfile.positiveTags}
                  oninput={(e: Event) => viewModel.updateEditingField('positiveTags', (e.target as HTMLTextAreaElement).value)}
                ></textarea>
              </div>

              <div>
                <label class="text-xs font-semibold text-base-content/60 block mb-0.5"
                  >Negative Tags</label
                >
                <textarea
                  class="textarea textarea-bordered w-full text-xs font-mono h-20"
                  value={viewModel.editingProfile.negativeTags}
                  oninput={(e: Event) => viewModel.updateEditingField('negativeTags', (e.target as HTMLTextAreaElement).value)}
                ></textarea>
              </div>

              <div>
                <label class="text-xs font-semibold text-base-content/60 block mb-0.5"
                  >Per-Image Tags</label
                >
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
        </div>
      {/if}

      <!-- ══════════ Compiler Tab ══════════ -->
      {#if viewModel.activeTab === 'compiler'}
        <div class="space-y-4">
          <div>
            <label
              class="text-xs font-semibold text-base-content/60 uppercase tracking-wider block mb-1"
              >Active Profile</label
            >
            <p class="text-sm font-mono">
              {viewModel.activeProfile?.name ?? 'none'}
              ({viewModel.activeProfile?.promptGrammar ?? '-'})
            </p>
          </div>

          <div>
            <label
              class="text-xs font-semibold text-base-content/60 uppercase tracking-wider block mb-1"
              >Base Prompt</label
            >
            <textarea
              class="textarea textarea-bordered w-full text-sm font-mono h-16"
              value={viewModel.compilerBasePrompt}
              oninput={(e: Event) => (viewModel.compilerBasePrompt = (e.target as HTMLTextAreaElement).value)}
            ></textarea>
          </div>

          <div>
            <label
              class="text-xs font-semibold text-base-content/60 uppercase tracking-wider block mb-1"
              >Image Type</label
            >
            <select
              class="select select-bordered w-full text-sm"
              value={viewModel.compilerImageType}
              onchange={(e: Event) => (viewModel.compilerImageType = (e.target as HTMLSelectElement).value as ImageGenViewModelInterface['compilerImageType'])}
            >
              {#each IMAGE_TYPES as imageType}
                <option value={imageType}>{imageType}</option>
              {/each}
            </select>
          </div>

          <button
            type="button"
            class="btn btn-primary btn-sm w-full"
            onclick={() => viewModel.runCompiler()}
          >
            🧪 Compile Prompt
          </button>

          {#if viewModel.compilerResultPositive || viewModel.compilerResultNegative}
            <div class="rounded-lg border border-base-300 bg-base-200 p-4 space-y-3">
              <div>
                <span class="text-xs font-semibold text-success uppercase tracking-wider"
                  >Positive</span
                >
                <p class="text-xs font-mono text-base-content mt-1 break-all">
                  {viewModel.compilerResultPositive}
                </p>
              </div>
              <div>
                <span class="text-xs font-semibold text-error uppercase tracking-wider"
                  >Negative</span
                >
                <p class="text-xs font-mono text-base-content mt-1 break-all">
                  {viewModel.compilerResultNegative || '(none)'}
                </p>
              </div>
            </div>
          {/if}
        </div>
      {/if}

      <!-- ══════════ Triggers Tab ══════════ -->
      {#if viewModel.activeTab === 'triggers'}
        <div class="space-y-4">
          <div class="flex items-center gap-2">
            <label class="text-xs font-semibold text-base-content/60 uppercase tracking-wider"
              >Enabled</label
            >
            <input
              type="checkbox"
              class="toggle toggle-sm"
              checked={viewModel.triggerEnabled}
              onchange={() => (viewModel.triggerEnabled = !viewModel.triggerEnabled)}
            >
          </div>

          <div>
            <label
              class="text-xs font-semibold text-base-content/60 uppercase tracking-wider block mb-1"
              >Trigger Event</label
            >
            <select
              class="select select-bordered w-full text-sm"
              value={viewModel.triggerEvent}
              onchange={(e: Event) => (viewModel.triggerEvent = (e.target as HTMLSelectElement).value as typeof viewModel.triggerEvent)}
            >
              {#each TRIGGER_EVENTS as event}
                <option value={event}>{event}</option>
              {/each}
            </select>
          </div>

          <div>
            <label
              class="text-xs font-semibold text-base-content/60 uppercase tracking-wider block mb-1"
              >Context</label
            >
            <input
              class="input input-bordered w-full text-sm"
              value={viewModel.triggerContext}
              oninput={(e: Event) => (viewModel.triggerContext = (e.target as HTMLInputElement).value)}
            >
          </div>

          <div>
            <label
              class="text-xs font-semibold text-base-content/60 uppercase tracking-wider block mb-1"
              >Character Name (for NPC events)</label
            >
            <input
              class="input input-bordered w-full text-sm"
              value={viewModel.triggerCharacterName}
              oninput={(e: Event) => (viewModel.triggerCharacterName = (e.target as HTMLInputElement).value)}
            >
          </div>

          <button
            type="button"
            class="btn btn-primary btn-sm w-full"
            onclick={() => viewModel.fireTrigger()}
          >
            🔥 Fire Trigger
          </button>

          {#if viewModel.triggerResultPositive}
            <div class="rounded-lg border border-base-300 bg-base-200 p-4 space-y-3">
              <div>
                <span class="text-xs font-semibold text-success uppercase tracking-wider"
                  >Compiled Positive</span
                >
                <p class="text-xs font-mono text-base-content mt-1 break-all">
                  {viewModel.triggerResultPositive}
                </p>
              </div>
              <div>
                <span class="text-xs font-semibold text-error uppercase tracking-wider"
                  >Compiled Negative</span
                >
                <p class="text-xs font-mono text-base-content mt-1 break-all">
                  {viewModel.triggerResultNegative || '(none)'}
                </p>
              </div>
            </div>
          {/if}
        </div>
      {/if}

      <!-- ══════════ Gallery Tab ══════════ -->
      {#if viewModel.activeTab === 'gallery'}
        <div class="space-y-4">
          <div class="flex gap-2 items-end">
            <div class="flex-1">
              <label
                class="text-xs font-semibold text-base-content/60 uppercase tracking-wider block mb-1"
                >Chat ID</label
              >
              <input
                class="input input-bordered input-sm w-full text-sm"
                value={viewModel.galleryChatId}
                oninput={(e: Event) => viewModel.setGalleryChatId((e.target as HTMLInputElement).value)}
              >
            </div>
            <button
              type="button"
              class="btn btn-sm btn-outline"
              onclick={() => viewModel.addMockGalleryImage()}
            >
              ➕ Add Mock
            </button>
          </div>

          {#if viewModel.galleryImages.length === 0}
            <div class="flex flex-col items-center justify-center py-12 text-center">
              <span class="text-3xl mb-2">🖼️</span>
              <p class="text-sm font-semibold text-base-content/50">No images in this chat</p>
              <p class="mt-1 text-xs text-base-content/30">
                Add mock images or generate some via triggers.
              </p>
            </div>
          {:else}
            <div class="columns-2 gap-2">
              {#each viewModel.galleryImages as image (image.id)}
                <button
                  type="button"
                  class="mb-2 break-inside-avoid rounded-lg overflow-hidden border border-base-300 cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all w-full text-left bg-transparent p-0"
                  onclick={() => viewModel.expandGalleryImage(image.url)}
                >
                  <img
                    src={image.url}
                    alt="Gallery image"
                    class="w-full h-auto block"
                    loading="lazy"
                  >
                  <div class="p-1.5">
                    <span class="text-[10px] font-mono text-base-content/50 truncate block"
                      >{image.prompt.slice(0, 40)}</span
                    >
                    <span class="badge badge-xs mt-0.5">{image.imageType}</span>
                  </div>
                </button>
              {/each}
            </div>
          {/if}

          {#if viewModel.galleryExpandedUrl}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
              onclick={() => viewModel.closeGalleryExpand()}
              onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') { viewModel.closeGalleryExpand(); } }}
              role="dialog"
              aria-modal="true"
              tabindex="-1"
            >
              <button
                type="button"
                class="absolute top-4 right-4 btn btn-sm btn-ghost text-white text-xl"
                onclick={() => viewModel.closeGalleryExpand()}
              >
                ✕
              </button>
              <img
                src={viewModel.galleryExpandedUrl}
                alt="Gallery image (fullscreen)"
                class="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl"
              >
            </div>
          {/if}
        </div>
      {/if}

      <div data-testid="game-ready" class="hidden"></div>
    </div>
  </div>
</BaseViewModelContainer>
