<script lang="ts">
// apps/frontend/client/src/lib/views/character/npc/list/npc_list_view.svelte

import { BaseViewModelContainer, Image } from '$components';
import t from '$i18n';
import type { NpcListViewModelInterface } from './npc_list_view_model.svelte.ts';

type Props = {
  viewModel: NpcListViewModelInterface;
};
const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="p-4">
    <header class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-bold">{t.nonPlayerCharacters()}</h1>
      <button type="button" class="btn btn-primary" onclick={() => viewModel.openCreateModal()}>
        Create NPC
      </button>
    </header>

    <div class="tabs tabs-boxed mb-4">
      {#each viewModel.tabs as tab}
        <button
          type="button"
          class="tab"
          class:tab-active={viewModel.activeTab === tab.key}
          onclick={() => viewModel.setActiveTab(tab.key)}
        >
          {tab.label}
          <span class="badge badge-sm ml-2">{viewModel.getTabCount(tab.key)}</span>
        </button>
      {/each}
    </div>

    <div class="mb-4 flex gap-2">
      <label class="btn btn-outline btn-sm" for="npc-file-import"> Import PNG/JSON </label>
      <button type="button" class="btn btn-outline btn-sm" onclick={() => viewModel.openUrlModal()}>
        Import from URL
      </button>
      <input
        id="npc-file-import"
        type="file"
        accept=".png,.json"
        class="hidden"
        onchange={(event) => viewModel.handleFileChange({ event })}
      >
    </div>

    {#if viewModel.isLoading || viewModel.isImporting}
      <div class="flex justify-center py-10">
        <span class="loading loading-spinner loading-lg"></span>
      </div>
    {:else if viewModel.errorMessage}
      <div class="alert alert-error mb-4"><span>{viewModel.errorMessage}</span></div>
    {:else}
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {#each viewModel.npcs as npc (npc.id)}
          <div class="card bg-base-200 hover:bg-base-300 transition-colors cursor-pointer">
            <button
              type="button"
              class="w-full text-left"
              onclick={() => viewModel.navigateToChat({ npcId: npc.id })}
            >
              <div class="bg-base-300 relative h-48">
                {#if npc.avatarUrl}
                  <Image src={npc.avatarUrl} alt={npc.name} class="h-full w-full object-cover" />
                {:else}
                  <div
                    class="flex h-full w-full items-center justify-center text-4xl text-base-content/30"
                  >
                    {npc.name.charAt(0).toUpperCase()}
                  </div>
                {/if}
                {#if npc.creatorUid}
                  <span class="badge badge-secondary absolute bottom-2 left-2"
                    >{npc.visibility === 'public' ? 'Public' : 'Mine'}</span
                  >
                {:else}
                  <span class="badge badge-accent absolute bottom-2 left-2">System</span>
                {/if}
              </div>
              <div class="card-body p-3">
                <h3 class="card-title truncate text-base">{npc.name}</h3>
                <p class="text-sm text-base-content/70">{npc.race} {npc.class} Lv. {npc.level}</p>
                {#if npc.occupation}
                  <p class="text-xs text-base-content/50 truncate">{npc.occupation}</p>
                {/if}
              </div>
            </button>
            {#if !npc.creatorUid}
              <div class="px-3 pb-3 flex gap-2">
                <button
                  type="button"
                  class="btn btn-xs btn-outline"
                  onclick={() => viewModel.handleForkNpc({ npcId: npc.id })}
                >
                  Fork
                </button>
              </div>
            {:else}
              <div class="px-3 pb-3 flex gap-2">
                <button
                  type="button"
                  class="btn btn-xs btn-outline"
                  onclick={() => viewModel.openEditForm({ npc })}
                >
                  Edit
                </button>
                <button
                  type="button"
                  class="btn btn-xs btn-outline btn-error"
                  onclick={() => viewModel.handleDeleteNpc({ npcId: npc.id })}
                >
                  Delete
                </button>
              </div>
            {/if}
          </div>
        {/each}

        {#if viewModel.npcs.length === 0}
          <div class="col-span-full py-10 text-center text-base-content/50">
            No NPCs found. Create one or import to get started!
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- URL Import Modal -->
  {#if viewModel.showUrlModal}
    <div class="modal modal-open">
      <div class="modal-box">
        <h3 class="font-bold text-lg">Import from URL</h3>
        <p class="py-4">Enter a URL to import an NPC from (Chub, Risu, etc.)</p>
        <input
          type="text"
          placeholder="https://chub.ai/characters/..."
          class="input input-bordered w-full"
          bind:value={viewModel.urlInput}
        >
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" onclick={() => viewModel.closeUrlModal()}>
            Cancel
          </button>
          <button type="button" class="btn btn-primary" onclick={() => viewModel.handleUrlSubmit()}>
            Import
          </button>
        </div>
      </div>
      <button
        class="modal-backdrop border-none bg-transparent p-0"
        type="button"
        onclick={() => viewModel.closeUrlModal()}
        onkeydown={(event) => viewModel.handleUrlModalKeydown({ event })}
        aria-label="Close"
      ></button>
    </div>
  {/if}

  <!-- Create NPC Modal (Placeholder) -->
  {#if viewModel.showCreateModal}
    <div class="modal modal-open">
      <div class="modal-box">
        <h3 class="font-bold text-lg">Create New NPC</h3>
        <p class="py-4">NPC creation form coming soon!</p>
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" onclick={() => viewModel.closeCreateModal()}>
            Close
          </button>
        </div>
      </div>
      <button
        class="modal-backdrop border-none bg-transparent p-0"
        type="button"
        onclick={() => viewModel.closeCreateModal()}
        onkeydown={(event) => viewModel.handleCreateModalKeydown({ event })}
        aria-label="Close"
      ></button>
    </div>
  {/if}

  <!-- Edit NPC Modal -->
  {#if viewModel.editingNpc}
    <div class="modal modal-open">
      <div class="modal-box max-w-2xl">
        <h3 class="font-bold text-lg">Edit NPC</h3>
        <div class="py-4 grid grid-cols-2 gap-4">
          <label class="form-control w-full">
            <span class="label-text">Name</span>
            <input
              type="text"
              bind:value={viewModel.editName}
              class="input input-bordered w-full"
              onblur={() => viewModel.saveField({ field: 'name', value: viewModel.editName })}
            >
          </label>
          <label class="form-control w-full">
            <span class="label-text">Occupation</span>
            <input
              type="text"
              bind:value={viewModel.editOccupation}
              class="input input-bordered w-full"
              onblur={() => viewModel.saveField({ field: 'occupation', value: viewModel.editOccupation })}
            >
          </label>
          <label class="form-control w-full">
            <span class="label-text">Race</span>
            <input
              type="text"
              bind:value={viewModel.editRace}
              class="input input-bordered w-full"
              onblur={() => viewModel.saveField({ field: 'race', value: viewModel.editRace })}
            >
          </label>
          <label class="form-control w-full">
            <span class="label-text">Class</span>
            <input
              type="text"
              bind:value={viewModel.editClass}
              class="input input-bordered w-full"
              onblur={() => viewModel.saveField({ field: 'class', value: viewModel.editClass })}
            >
          </label>
          <label class="form-control w-full">
            <span class="label-text">Level</span>
            <input
              type="number"
              bind:value={viewModel.editLevel}
              class="input input-bordered w-full"
              min="1"
              max="20"
              onblur={() => viewModel.saveField({ field: 'level', value: viewModel.editLevel })}
            >
          </label>
          <label class="form-control w-full">
            <span class="label-text">Visibility</span>
            <select
              bind:value={viewModel.editVisibility}
              class="select select-bordered w-full"
              onchange={() => viewModel.saveField({ field: 'visibility', value: viewModel.editVisibility })}
            >
              <option value="private">Private</option>
              <option value="public">Public</option>
            </select>
          </label>
          <label class="form-control w-full col-span-2">
            <span class="label-text">Personality (for AI roleplay)</span>
            <textarea
              bind:value={viewModel.editPersonality}
              class="textarea textarea-bordered w-full"
              rows="3"
              onblur={() => viewModel.saveField({ field: 'personality', value: viewModel.editPersonality })}
            ></textarea>
          </label>
          <label class="form-control w-full col-span-2">
            <span class="label-text">Notes</span>
            <textarea
              bind:value={viewModel.editNotes}
              class="textarea textarea-bordered w-full"
              rows="3"
              onblur={() => viewModel.saveField({ field: 'notes', value: viewModel.editNotes })}
            ></textarea>
          </label>
        </div>
        <div class="modal-action">
          <button type="button" class="btn btn-primary" onclick={() => viewModel.closeEditModal()}>
            Done
          </button>
        </div>
      </div>
      <button
        class="modal-backdrop border-none bg-transparent p-0"
        type="button"
        onclick={() => viewModel.closeEditModal()}
        onkeydown={(event) => viewModel.handleEditModalKeydown({ event })}
        aria-label="Close"
      ></button>
    </div>
  {/if}
</BaseViewModelContainer>
