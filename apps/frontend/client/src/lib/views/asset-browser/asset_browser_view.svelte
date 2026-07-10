<script lang="ts">
// apps/frontend/client/src/lib/views/asset-browser/asset_browser_view.svelte
import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import type { AssetBrowserViewModelInterface } from './asset_browser_view_model.svelte';

type Props = { viewModel: AssetBrowserViewModelInterface };
const { viewModel }: Props = $props();

// Drag state
let isDragging = $state(false);
let dragCounter = 0;
let droppedFileNames = $state<string[]>([]);
let showDropInfo = $state(false);

const handleDragEnter = (e: DragEvent) => {
  e.preventDefault();
  dragCounter++;
  isDragging = true;
};
const handleDragLeave = (e: DragEvent) => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    isDragging = false;
  }
};
const handleDragOver = (e: DragEvent) => {
  e.preventDefault();
};
const handleDrop = (e: DragEvent) => {
  e.preventDefault();
  isDragging = false;
  dragCounter = 0;
  const files = e.dataTransfer?.files;
  if (files?.length) {
    droppedFileNames = Array.from(files).map((f) => f.name);
    showDropInfo = true;
  }
};
const handleGlobalClick = () => {
  if (viewModel.contextMenu.open) {
    viewModel.closeContextMenu();
  }
};
</script>

<svelte:window onclick={handleGlobalClick} />

<BaseViewModelContainer {viewModel}>
  <div class="flex h-full">
    <aside class="w-56 shrink-0 border-r border-base-300 overflow-y-auto">
      <div class="p-2">
        <h3 class="text-xs font-semibold mb-2 text-base-content/50 uppercase tracking-wider">
          Assets
        </h3>
        <ul class="menu menu-xs bg-base-200 rounded-box w-full">
          {#each viewModel.folderTree as category}
            <li>
              <details open>
                <summary>
                  <svg
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke-width="1.5"
                    stroke="currentColor"
                    class="h-4 w-4"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                    />
                  </svg>
                  {category.name}
                  {#if category.children.length > 0}
                    <span class="badge badge-xs ml-auto">{category.children.length}</span>
                  {/if}
                </summary>
                <ul>
                  {#each category.children as entry}
                    {#if entry.isDirectory}
                      <li>
                        <details open>
                          <summary>
                            <svg
                              aria-hidden="true"
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke-width="1.5"
                              stroke="currentColor"
                              class="h-4 w-4"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                              />
                            </svg>
                            {entry.name}
                          </summary>
                          <ul>
                            {#each entry.children as child}
                              <li>
                                {#if child.isDirectory}
                                  <details open>
                                    <summary>
                                      <svg
                                        aria-hidden="true"
                                        xmlns="http://www.w3.org/2000/svg"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke-width="1.5"
                                        stroke="currentColor"
                                        class="h-4 w-4"
                                      >
                                        <path
                                          stroke-linecap="round"
                                          stroke-linejoin="round"
                                          d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                                        />
                                      </svg>
                                      {child.name}
                                    </summary>
                                    <ul>
                                      {#each child.children as leaf}
                                        <li>
                                          <a
                                            href="."
                                            onclick={(e) => { e.preventDefault(); viewModel.navigateToFolder(child.path); }}
                                            ><svg
                                              aria-hidden="true"
                                              xmlns="http://www.w3.org/2000/svg"
                                              fill="none"
                                              viewBox="0 0 24 24"
                                              stroke-width="1.5"
                                              stroke="currentColor"
                                              class="h-4 w-4"
                                            >
                                              <path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
                                              />
                                            </svg> {leaf.name}</a
                                          >
                                        </li>
                                      {/each}
                                    </ul>
                                  </details>
                                {:else}
                                  <a
                                    href="."
                                    onclick={(e) => { e.preventDefault(); viewModel.navigateToFolder(entry.path); }}
                                    ><svg
                                      aria-hidden="true"
                                      xmlns="http://www.w3.org/2000/svg"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke-width="1.5"
                                      stroke="currentColor"
                                      class="h-4 w-4"
                                    >
                                      <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                                      />
                                    </svg> {child.name}</a
                                  >
                                {/if}
                              </li>
                            {/each}
                          </ul>
                        </details>
                      </li>
                    {:else}
                      <li>
                        <a
                          href="."
                          onclick={(e) => { e.preventDefault(); viewModel.navigateToFolder(category.path); }}
                          ><svg
                            aria-hidden="true"
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke-width="1.5"
                            stroke="currentColor"
                            class="h-4 w-4"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                            />
                          </svg> {entry.name}</a
                        >
                      </li>
                    {/if}
                  {/each}
                </ul>
              </details>
            </li>
          {/each}
        </ul>
      </div>
    </aside>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="flex-1 flex flex-col min-w-0 relative"
      ondragenter={handleDragEnter}
      ondragleave={handleDragLeave}
      ondragover={handleDragOver}
      ondrop={handleDrop}
    >
      <div class="tabs tabs-boxed tabs-sm m-2">
        <button
          type="button"
          class="tab"
          class:tab-active={viewModel.activeCategory === 'all'}
          onclick={() => viewModel.setCategory('all')}
        >
          All
        </button>
        <button
          type="button"
          class="tab"
          class:tab-active={viewModel.activeCategory === 'music'}
          onclick={() => viewModel.setCategory('music')}
        >
          🎵 Music
        </button>
        <button
          type="button"
          class="tab"
          class:tab-active={viewModel.activeCategory === 'sfx'}
          onclick={() => viewModel.setCategory('sfx')}
        >
          🔊 SFX
        </button>
        <button
          type="button"
          class="tab"
          class:tab-active={viewModel.activeCategory === 'ambient'}
          onclick={() => viewModel.setCategory('ambient')}
        >
          🌿 Ambient
        </button>
        <button
          type="button"
          class="tab"
          class:tab-active={viewModel.activeCategory === 'sprites'}
          onclick={() => viewModel.setCategory('sprites')}
        >
          👾 Sprites
        </button>
        <button
          type="button"
          class="tab"
          class:tab-active={viewModel.activeCategory === 'backgrounds'}
          onclick={() => viewModel.setCategory('backgrounds')}
        >
          🖼️ Backgrounds
        </button>
      </div>

      <div class="flex items-center gap-2 px-2 py-1">
        <button
          type="button"
          class="btn btn-sm btn-outline"
          onclick={() => viewModel.openUploadInfo()}
        >
          + Add Assets
        </button>
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          onclick={() => viewModel.openAssetsFolder()}
        >
          📂 Open Folder
        </button>
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          onclick={() => viewModel.fetchManifest()}
          disabled={viewModel.isLoading}
        >
          {viewModel.isLoading ? '⟳' : '⟳'}
          Refresh
        </button>
        {#if viewModel.assetError}
          <span class="text-error text-xs">{viewModel.assetError}</span>
        {/if}
      </div>

      <div class="flex-1 overflow-y-auto p-2">
        {#if viewModel.isLoading}
          <div class="flex items-center justify-center h-32">
            <span class="loading loading-spinner loading-lg"></span>
          </div>
        {:else if viewModel.currentFiles.length === 0}
          <div class="flex flex-col items-center justify-center h-full text-base-content/40 gap-2">
            <p class="text-4xl">📂</p>
            <p>No assets in this folder.</p>
            <p class="text-xs">
              Place files in
              <code class="font-mono bg-base-300 px-1 rounded">static/game-assets/</code>
            </p>
          </div>
        {:else}
          <div
            class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2"
          >
            {#each viewModel.currentFiles as file}
              <button
                type="button"
                class="card card-compact bg-base-200 hover:bg-base-300 cursor-pointer text-center transition-colors"
                onclick={() => viewModel.openAssetPreview(file)}
                oncontextmenu={(e) => { e.preventDefault(); e.stopPropagation(); viewModel.openContextMenu(file, e.clientX, e.clientY); }}
              >
                <div class="card-body p-2 items-center gap-1">
                  <div class="text-2xl leading-none">
                    {['.png','.jpg','.jpeg','.gif','.webp','.svg'].includes(file.ext) ? '🖼️' : ['.mp3','.ogg','.wav','.flac','.m4a'].includes(file.ext) ? '🎵' : '📄'}
                  </div>
                  <p class="text-xs font-mono truncate max-w-full leading-tight">{file.name}</p>
                  <span class="badge badge-xs badge-outline">{file.category}</span>
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      {#if showDropInfo}
        <div
          class="absolute inset-0 z-40 flex items-center justify-center bg-base-300/50 backdrop-blur-sm"
        >
          <div class="bg-base-100 rounded-box p-8 shadow-lg text-center max-w-md">
            <p class="text-3xl mb-2">📥</p>
            <p class="font-bold text-lg mb-2">Files detected</p>
            <ul class="text-sm text-left mb-4 max-h-32 overflow-y-auto">
              {#each droppedFileNames as name}
                <li class="font-mono text-xs py-0.5">📄 {name}</li>
              {/each}
            </ul>
            <p class="text-sm text-base-content/50 mb-4">
              Copy these files to:<br>
              <code class="font-mono text-xs bg-base-300 px-1 rounded"
                >static/game-assets/&lt;category&gt;/</code
              >
            </p>
            <p class="text-xs text-base-content/40 mb-4">
              Then run
              <code class="font-mono text-xs bg-base-300 px-1 rounded"
                >bun run scripts/src/lib/ops/scan_assets.ts</code
              >
            </p>
            <button
              type="button"
              class="btn btn-sm btn-primary"
              onclick={() => { showDropInfo = false; droppedFileNames = []; }}
            >
              Got it
            </button>
          </div>
        </div>
      {/if}

      {#if isDragging}
        <div
          class="absolute inset-0 z-40 flex items-center justify-center bg-base-300/50 backdrop-blur-sm pointer-events-none"
        >
          <div
            class="bg-base-100 rounded-box p-8 shadow-lg text-center border-2 border-dashed border-primary"
          >
            <p class="text-3xl mb-2">📥</p>
            <p class="font-bold text-lg">Drop files here</p>
            <p class="text-sm text-base-content/50">
              Assets are managed locally — see instructions
            </p>
          </div>
        </div>
      {/if}
    </div>
  </div>

  {#if viewModel.contextMenu.open && viewModel.contextMenu.asset}
    {@const asset = viewModel.contextMenu.asset}
    <!-- svelte-ignore a11y_use_key_with_click_events -->
    <div
      class="fixed z-50 menu menu-sm bg-base-200 rounded-box shadow-lg border border-base-300 p-1 min-w-36"
      style="left: {viewModel.contextMenu.x}px; top: {viewModel.contextMenu.y}px;"
      onclick={(e) => e.stopPropagation()}
      role="menu"
    >
      <button
        type="button"
        class="btn btn-ghost btn-sm justify-start font-normal"
        onclick={() => viewModel.openAssetPreview(asset)}
      >
        👁️ Preview
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-sm justify-start font-normal"
        onclick={() => viewModel.renameAsset(asset)}
      >
        ✏️ Rename
      </button>
      <div class="divider my-0"></div>
      <button
        type="button"
        class="btn btn-ghost btn-sm justify-start font-normal text-error"
        onclick={() => viewModel.deleteAsset(asset)}
      >
        🗑️ Delete
      </button>
    </div>
  {/if}

  {#if viewModel.uploadInfoOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_use_key_with_click_events -->
    <dialog class="modal modal-open" onclick={() => viewModel.closeUploadInfo()}>
      <!-- svelte-ignore a11y_no_static_element_interactions a11y_use_key_with_click_events -->
    <div class="modal-box" onclick={(e) => e.stopPropagation()}>
        <h3 class="font-bold text-lg mb-4">Adding Assets</h3>
        <div class="space-y-4 text-sm">
          <p>
            Assets are managed locally. Drag &amp; drop onto the file grid for instructions, or:
          </p>
          <div class="bg-base-300 rounded-lg p-3">
            <p class="font-semibold mb-1">1. Place your files</p>
            <p class="text-base-content/70">
              Copy files into
              <code class="font-mono text-xs bg-base-100 px-1 rounded">static/game-assets/</code>
            </p>
            <pre
              class="font-mono text-xs bg-base-100 p-2 rounded mt-1 overflow-x-auto"
            >static/game-assets/
├── backgrounds/fantasy/
├── music/exploration/fantasy/calm/
├── sfx/combat/
├── ambient/nature/
└── sprites/generic-fantasy/</pre>
          </div>
          <div class="bg-base-300 rounded-lg p-3">
            <p class="font-semibold mb-1">2. Run the scanner</p>
            <pre
              class="font-mono text-xs bg-base-100 p-2 rounded mt-1"
            >bun run scripts/src/lib/ops/scan_assets.ts</pre>
          </div>
          <div class="bg-base-300 rounded-lg p-3">
            <p class="font-semibold mb-1">3. Refresh</p>
            <p class="text-base-content/70">
              Click <strong>Refresh</strong> to reload the manifest.
            </p>
          </div>
        </div>
        <div class="modal-action">
          <button type="button" class="btn btn-sm" onclick={() => viewModel.closeUploadInfo()}>
            Got it
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop"><button type="button">close</button></form>
    </dialog>
  {/if}

  {#if viewModel.previewModalOpen && viewModel.previewAsset}
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_use_key_with_click_events -->
    <dialog class="modal modal-open" onclick={() => viewModel.closePreview()}>
      <!-- svelte-ignore a11y_no_static_element_interactions a11y_use_key_with_click_events -->
    <div class="modal-box max-w-2xl" onclick={(e) => e.stopPropagation()}>
        <div class="flex items-center gap-3 mb-4">
          <h3 class="font-bold text-lg truncate flex-1">{viewModel.previewAsset.name}</h3>
          <span class="badge badge-sm">{viewModel.previewAsset.category}</span>
        </div>
        <p class="text-xs font-mono text-base-content/50 mb-4">{viewModel.previewAsset.tag}</p>
        {#if viewModel.hasPreview}
          {#if viewModel.previewAsset.ext === '.mp3' || viewModel.previewAsset.ext === '.ogg' || viewModel.previewAsset.ext === '.wav'}
            {#if viewModel.previewUrl}
                            <!-- svelte-ignore a11y_use_media_caption -->
              <audio controls class="w-full"><source src={viewModel.previewUrl} /></audio>
            {/if}
          {:else if viewModel.previewUrl}
            <img
              src={viewModel.previewUrl}
              alt={viewModel.previewAsset.name}
              class="max-w-full rounded"
            >
          {/if}
        {:else}
          <div class="flex flex-col items-center justify-center py-8 text-base-content/40 gap-2">
            <p class="text-4xl">📄</p>
            <p>
              Preview not available for
              <code class="font-mono text-xs bg-base-300 px-1 rounded"
                >{viewModel.previewAsset.ext}</code
              >
              files.
            </p>
          </div>
        {/if}
        <div class="modal-action">
          <button type="button" class="btn btn-sm" onclick={() => viewModel.closePreview()}>
            Close
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop"><button type="button">close</button></form>
    </dialog>
  {/if}
</BaseViewModelContainer>
