<script lang="ts">
// apps/frontend/client/src/lib/views/presets/preset_editor_view.svelte
import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import type { PresetEditorViewModelInterface } from './preset_editor_view_model.svelte.ts';

type Props = {
  viewModel: PresetEditorViewModelInterface;
};

let { viewModel }: Props = $props();

/** Current preset name for display. */
const currentPresetName = $derived.by(() => {
  if (viewModel.isNewPreset) {
    return viewModel.newPresetName || 'New Preset';
  }
  const preset = viewModel.presets.find((p) => p.id === viewModel.selectedPresetId);
  return preset?.name ?? 'Select a preset';
});
</script>

<BaseViewModelContainer {viewModel} fillHeight>
  <div class="flex flex-col min-h-full p-6 gap-4">
    <h1 class="text-2xl font-bold">Prompt Presets</h1>
    <p class="text-base-content/60 text-sm mb-2">
      Create and manage prompt presets with macro placeholders.
    </p>

    <div class="flex gap-4 flex-1">
      <!-- ── Preset list (sidebar) ────────────────────────────────── -->
      <div class="w-64 shrink-0">
        <div class="flex items-center justify-between mb-3">
          <span class="text-xs font-semibold uppercase tracking-wider text-base-content/50">
            Presets
          </span>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            onclick={() => viewModel.createNewPreset()}
          >
            + New
          </button>
        </div>

        <div class="flex flex-col gap-1">
          {#each viewModel.presets as preset}
            <button
              type="button"
              class="btn btn-sm justify-start text-left {preset.id === viewModel.selectedPresetId
                ? 'btn-primary'
                : 'btn-ghost'}"
              onclick={() => viewModel.selectPreset({ id: preset.id })}
            >
              <span class="truncate flex-1">{preset.name}</span>
              {#if preset.isBuiltIn}
                <span class="badge badge-ghost badge-xs shrink-0">built-in</span>
              {/if}
            </button>
          {/each}
        </div>
      </div>

      <!-- ── Editor panel ─────────────────────────────────────────── -->
      <div class="flex-1 min-w-0">
        {#if viewModel.selectedPresetId}
          <!-- New preset header -->
          {#if viewModel.isNewPreset}
            <div class="mb-4">
              <label class="form-control w-full">
                <div class="label">
                  <span class="label-text font-semibold">Preset Name</span>
                </div>
                <input
                  type="text"
                  class="input input-bordered w-full"
                  placeholder="My Custom Preset"
                  bind:value={viewModel.newPresetName}
                >
              </label>
            </div>
          {:else}
            <div class="flex items-center justify-between mb-4">
              <div>
                <h2 class="text-xl font-bold">{currentPresetName}</h2>
                <span class="text-xs text-base-content/40"
                  >{viewModel.sections.length}
                  sections</span
                >
              </div>
              <div class="flex gap-2">
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  onclick={() => viewModel.duplicatePreset()}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm text-error"
                  onclick={() => viewModel.deletePreset()}
                  disabled={viewModel.presets.find((p) => p.id === viewModel.selectedPresetId)?.isBuiltIn}
                >
                  Delete
                </button>
              </div>
            </div>
          {/if}

          <!-- Sections area -->
          <div class="flex flex-col gap-3">
            {#each viewModel.sections as section, idx}
              <div class="card bg-base-200 shadow-sm">
                <div class="card-body p-3">
                  <!-- Section header -->
                  <div class="flex items-center gap-2 mb-2">
                    <!-- Drag handle placeholder -->
                    <span class="text-base-content/30 cursor-grab text-lg">⠿</span>

                    <!-- Section name -->
                    <input
                      type="text"
                      class="input input-ghost input-xs flex-1 font-semibold"
                      value={section.name}
                      oninput={(e: Event) => {
                        const target = e.target as HTMLInputElement;
                        viewModel.updateSectionName({ id: section.id, name: target.value });
                      }}
                    >

                    <!-- Enable toggle -->
                    <input
                      type="checkbox"
                      class="toggle toggle-xs toggle-primary"
                      checked={section.enabled !== false}
                      onchange={() => viewModel.toggleSection({ id: section.id })}
                    >

                    <!-- Move up -->
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      onclick={() => viewModel.moveSectionUp({ id: section.id })}
                      disabled={idx === 0}
                    >
                      ▲
                    </button>

                    <!-- Move down -->
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      onclick={() => viewModel.moveSectionDown({ id: section.id })}
                      disabled={idx === viewModel.sections.length - 1}
                    >
                      ▼
                    </button>

                    <!-- Remove -->
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs text-error"
                      onclick={() => viewModel.removeSection({ id: section.id })}
                    >
                      ✕
                    </button>
                  </div>

                  <!-- Section content editor -->
                  <textarea
                    class="textarea textarea-bordered w-full min-h-24 font-mono text-sm"
                    placeholder={"Enter template content with {{macro}} placeholders..."}
                    oninput={(e: Event) => {
                      const target = e.target as HTMLTextAreaElement;
                      viewModel.updateSectionContent({ id: section.id, content: target.value });
                    }}
                  >
                    {section.content}
                  </textarea>
                </div>
              </div>
            {/each}
          </div>

          <!-- Add section button -->
          <div class="mt-4 flex items-center gap-2">
            <input
              type="text"
              class="input input-bordered input-sm flex-1"
              placeholder="New section name..."
              bind:value={viewModel.newSectionName}
              onkeydown={(e: KeyboardEvent) => {
                if (e.key === 'Enter') {
                  viewModel.addSection();
                }
              }}
            >
            <button
              type="button"
              class="btn btn-primary btn-sm"
              onclick={() => viewModel.addSection()}
            >
              + Add Section
            </button>
          </div>

          <!-- Save / Discard (new preset only) -->
          {#if viewModel.isNewPreset}
            <div class="mt-4 flex gap-2">
              <button
                type="button"
                class="btn btn-primary"
                onclick={() => viewModel.savePreset()}
                disabled={!viewModel.newPresetName.trim() || viewModel.sections.length === 0}
              >
                Save Preset
              </button>
              <button
                type="button"
                class="btn btn-ghost"
                onclick={() => viewModel.discardChanges()}
              >
                Discard
              </button>
            </div>
          {/if}
        {:else}
          <!-- No preset selected -->
          <div class="flex flex-col items-center justify-center h-64 text-base-content/40">
            <span class="text-4xl mb-2">📝</span>
            <p>Select a preset or create a new one to start editing.</p>
          </div>
        {/if}
      </div>
    </div>
  </div>
</BaseViewModelContainer>
