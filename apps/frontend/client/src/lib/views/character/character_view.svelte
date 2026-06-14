<script lang="ts">
  // apps/frontend/client/src/lib/views/character/character_view.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { CharacterViewModelInterface } from './character_view_model.svelte.ts';

  type Props = {
    viewModel: CharacterViewModelInterface;
  };

  const { viewModel }: Props = $props();

  let messagesContainer = $state<HTMLDivElement>();

  $effect(() => {
    void viewModel.messages.length;
    if (messagesContainer) {
      requestAnimationFrame(() => {
        if (messagesContainer) {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
      });
    }
  });
</script>

<svelte:head>
  <title>Character Creation - Dev Console</title>
</svelte:head>

<BaseViewModelContainer {viewModel}>
  <div class="flex flex-col items-center min-h-full p-4 md:p-8 gap-6">
    <div class="w-full max-w-3xl">
      <h1 class="mb-2 text-2xl font-bold">Character Creation</h1>
      <p class="mb-2 text-base-content/60">
        Chat with the DM to create your D&D character, then tweak stats and generate an avatar.
      </p>

      <!-- Debug panel -->
      <div class="collapse collapse-arrow bg-base-300 mb-4">
        <input type="checkbox" bind:checked={viewModel.debugOpen}>
        <div class="collapse-title text-xs font-mono opacity-60">
          Debug: phase={viewModel.phase}
          | msgs={viewModel.messages.length}
          | streaming={viewModel.isStreaming}
          | loading={viewModel.showLoadingView}
          | avatar={viewModel.avatarUrl ? '✓' : '✗'}
          | persona={viewModel.persona ? '✓' : '✗'}
        </div>
        <div class="collapse-content text-xs font-mono opacity-60">
          <pre>{JSON.stringify({
            phase: viewModel.phase,
            messageCount: viewModel.messages.length,
            isStreaming: viewModel.isStreaming,
            showLoadingView: viewModel.showLoadingView,
            hasAvatar: !!viewModel.avatarUrl,
            hasPersona: !!viewModel.persona,
            errorMessage: viewModel.errorMessage ?? 'none',
          }, null, 2)}</pre>
        </div>
      </div>

      <!-- ═══ CHAT Phase ═══ -->
      {#if viewModel.phase === 'CHAT'}
        <!-- Chat messages -->
        <div class="card bg-base-200 shadow mb-6">
          <div class="card-body p-0">
            <div
              bind:this={messagesContainer}
              class="flex flex-col gap-3 p-4 max-h-96 overflow-y-auto min-h-64"
            >
              {#if viewModel.messages.length === 0}
                <div class="flex items-center justify-center h-64 text-base-content/40 text-sm">
                  <div class="text-center">
                    <p class="mb-2 text-lg">⚔️</p>
                    <p>Describe your character to the Dungeon Master.</p>
                    <p class="text-xs mt-1">
                      Example: "I want to play a chaotic neutral goblin rogue"
                    </p>
                  </div>
                </div>
              {:else}
                {#each viewModel.messages as message}
                  {#if message.role === 'system'}
                  <!-- System messages are hidden from the chat UI -->
                  {:else if message.role === 'user'}
                    <div class="chat chat-end">
                      <div class="chat-bubble chat-bubble-primary">{message.content}</div>
                    </div>
                  {:else if message.role === 'assistant'}
                    <div class="chat chat-start">
                      <div class="chat-bubble chat-bubble-secondary">{message.content}</div>
                    </div>
                  {/if}
                {/each}
              {/if}

              {#if viewModel.isStreaming}
                <div class="chat chat-start">
                  <div class="chat-bubble chat-bubble-secondary">
                    <span class="loading loading-dots loading-sm"></span>
                  </div>
                </div>
              {/if}
            </div>
          </div>
        </div>

        <!-- Input area -->
        <div class="card bg-base-200 shadow mb-4">
          <div class="card-body p-4">
            <div class="flex gap-3 items-end">
              <textarea
                class="textarea textarea-bordered flex-1 min-h-16"
                placeholder="Describe your character..."
                bind:value={viewModel.chatInput}
                disabled={viewModel.isStreaming}
                onkeydown={(e) => viewModel.handleKeydown(e)}
                rows="2"
              ></textarea>
              <button
                class="btn btn-primary"
                onclick={() => viewModel.handleSend()}
                disabled={!viewModel.chatInput.trim() || viewModel.isStreaming}
              >
                Send
              </button>
            </div>
            <div class="label mt-1">
              <span class="label-text-alt text-base-content/40"
                >Enter to send, Shift+Enter for new line</span
              >
            </div>
          </div>
        </div>

        <!-- Generate button -->
        <div class="flex justify-center">
          <button
            class="btn btn-accent btn-wide"
            onclick={() => viewModel.generateCharacter()}
            disabled={viewModel.isStreaming}
          >
            {viewModel.generateButtonLabel}
          </button>
        </div>
      {/if}

      <!-- ═══ GENERATING Phase ═══ -->
      {#if viewModel.phase === 'GENERATING'}
        <div class="card bg-base-200 shadow">
          <div class="card-body items-center py-16 gap-6">
            <span class="loading loading-spinner loading-lg text-primary"></span>
            <h2 class="text-xl font-semibold">Generating Your Character</h2>
            <p class="text-base-content/60 text-sm text-center max-w-md">
              The AI is analyzing your conversation and creating a D&D character sheet. This usually
              takes a few seconds...
            </p>
          </div>
        </div>
      {/if}

      <!-- ═══ TWEAK Phase ═══ -->
      {#if viewModel.phase === 'TWEAK' && viewModel.persona}
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <!-- Avatar card -->
          <div class="card bg-base-200 shadow">
            <div class="card-body items-center gap-4">
              <h2 class="card-title text-lg">Character Avatar</h2>
              <div
                class="w-48 h-48 rounded-xl bg-base-300 flex items-center justify-center overflow-hidden"
              >
                {#if viewModel.avatarUrl}
                  <img
                    src={viewModel.avatarUrl}
                    alt="Character avatar"
                    class="object-cover w-full h-full"
                  >
                {:else if viewModel.isImageGenReady}
                  <span class="loading loading-spinner loading-md text-primary"></span>
                {:else}
                  <div class="text-center px-4">
                    <p class="text-3xl mb-2">🖼️</p>
                    <p class="text-xs text-base-content/40">No image generation</p>
                    <button
                      class="btn btn-xs btn-ghost mt-2"
                      onclick={() => viewModel.configureImageGen()}
                    >
                      Configure
                    </button>
                  </div>
                {/if}
              </div>
              {#if !viewModel.avatarUrl && viewModel.isImageGenReady}
                <p class="text-xs text-base-content/40">Generating avatar...</p>
              {:else if !viewModel.isImageGenReady}
                <p class="text-xs text-warning">
                  ComfyUI not detected. Set up image generation in Config.
                </p>
              {/if}

              <!-- Regenerate button -->
              {#if viewModel.avatarUrl && viewModel.isImageGenReady}
                <button
                  class="btn btn-xs btn-ghost text-[#cabeff] mt-1"
                  onclick={() => viewModel.toggleRegenerationPanel()}
                  disabled={viewModel.isRegenerating}
                >
                  {viewModel.isRegenerating ? 'Generating...' : '🔄 Regenerate'}
                </button>
              {/if}

              <!-- LPC Sprite Preview -->
              {#if viewModel.lpcPreviewUrl}
                <div class="divider text-xs text-base-content/40 my-0">LPC Sprite</div>
                <a
                  href={viewModel.lpcPreviewUrl}
                  target="_blank"
                  rel="noopener"
                  class="btn btn-xs btn-outline btn-accent"
                >
                  🎮 View LPC Sprite
                </a>
                <p class="text-[10px] text-base-content/40">Opens in LPC debugger</p>
              {/if}
            </div>
          </div>

          <!-- Basic info card -->
          <div class="card bg-base-200 shadow">
            <div class="card-body gap-4">
              <h2 class="card-title text-lg">Character Details</h2>

              <!-- Name -->
              <label class="form-control w-full">
                <div class="label py-0.5">
                  <span class="label-text font-semibold">Name</span>
                </div>
                <input
                  type="text"
                  class="input input-bordered w-full"
                  bind:value={viewModel.persona.name}
                  placeholder="Character name"
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
                    bind:value={viewModel.persona.race}
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
                    bind:value={viewModel.persona.class}
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
                    bind:value={viewModel.persona.subclass}
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
                    bind:value={viewModel.persona.level}
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
                    bind:value={viewModel.persona.alignment}
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
                  bind:value={viewModel.persona.background}
                  placeholder="Character background story..."
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
                    bind:value={viewModel.persona.hitPoints}
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
                    bind:value={viewModel.persona.armorClass}
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
                    bind:value={viewModel.persona.speed}
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
                  value={viewModel.persona.appearance?.physicalDescription ?? ''}
                  oninput={(e: Event) => viewModel.updateAppearanceDescription((e.target as HTMLTextAreaElement).value)}
                  placeholder="Physical description for avatar generation"
                  rows="3"
                ></textarea>
              </label>

              <!-- Languages -->
              <label class="form-control w-full">
                <div class="label py-0.5">
                  <span class="label-text font-semibold">Languages</span
                  ><span class="label-text-alt text-base-content/40">comma-separated</span>
                </div>
                <input
                  type="text"
                  class="input input-bordered w-full text-sm"
                  value={viewModel.persona.languages?.join(', ') ?? ''}
                  oninput={(e: Event) => { if (viewModel.persona) viewModel.persona.languages = (e.target as HTMLInputElement).value.split(',').map((s: string) => s.trim()).filter(Boolean); }}
                  placeholder="Common, Elvish, Dwarvish..."
                >
              </label>

              <!-- Proficiencies -->
              <label class="form-control w-full">
                <div class="label py-0.5">
                  <span class="label-text font-semibold">Proficiencies</span
                  ><span class="label-text-alt text-base-content/40">comma-separated</span>
                </div>
                <input
                  type="text"
                  class="input input-bordered w-full text-sm"
                  value={viewModel.persona.proficiencies?.join(', ') ?? ''}
                  oninput={(e: Event) => { if (viewModel.persona) viewModel.persona.proficiencies = (e.target as HTMLInputElement).value.split(',').map((s: string) => s.trim()).filter(Boolean); }}
                  placeholder="Arcana, Stealth, Persuasion..."
                >
              </label>

              <!-- Equipment -->
              <label class="form-control w-full">
                <div class="label py-0.5">
                  <span class="label-text font-semibold">Equipment</span
                  ><span class="label-text-alt text-base-content/40">comma-separated</span>
                </div>
                <input
                  type="text"
                  class="input input-bordered w-full text-sm"
                  value={viewModel.persona.equipment?.join(', ') ?? ''}
                  oninput={(e: Event) => { if (viewModel.persona) viewModel.persona.equipment = (e.target as HTMLInputElement).value.split(',').map((s: string) => s.trim()).filter(Boolean); }}
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
                    bind:value={viewModel.persona.personalityTraits}
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
                    bind:value={viewModel.persona.ideals}
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
                    bind:value={viewModel.persona.bonds}
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
                    bind:value={viewModel.persona.flaws}
                    placeholder="Flaws..."
                  >
                </label>
              </div>
            </div>
          </div>

          <!-- Stats card -->
          <div class="card bg-base-200 shadow lg:col-span-2">
            <div class="card-body gap-4">
              <h2 class="card-title text-lg">Ability Scores</h2>

              {#if viewModel.persona.abilityScores}
                <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {#each viewModel.scoreLabels as stat}
                    <div class="form-control">
                      <div class="label">
                        <span class="label-text font-semibold">{stat.label}</span>
                        <span class="label-text-alt text-base-content/40">{stat.desc}</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <button
                          class="btn btn-sm btn-ghost btn-square"
                          onclick={() => viewModel.decrementStat(stat.key)}
                        >
                          −
                        </button>
                        <input
                          type="number"
                          class="input input-bordered w-20 text-center"
                          min="8"
                          max="15"
                          bind:value={viewModel.persona.abilityScores[stat.key]}
                        >
                        <button
                          class="btn btn-sm btn-ghost btn-square"
                          onclick={() => viewModel.incrementStat(stat.key)}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  {/each}
                </div>
              {:else}
                <p class="text-sm text-base-content/40 italic">
                  Ability scores not provided by generation. Edit the character details to refine.
                </p>
              {/if}
            </div>
          </div>

          <!-- Actions -->
          <div class="flex justify-center gap-4 lg:col-span-2">
            <button class="btn btn-ghost" onclick={() => viewModel.cancel()}>← Back to Chat</button>
            <button class="btn btn-primary" onclick={() => viewModel.saveCharacter()}>
              💾 Save Character
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>

  <!-- Regenerate Avatar Modal -->
  {#if viewModel.showRegenerationPanel && viewModel.isImageGenReady}
    <dialog
      class="modal modal-open"
      onclick={(e: MouseEvent) => { if (e.target === e.currentTarget) viewModel.toggleRegenerationPanel(); }}
      onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') viewModel.toggleRegenerationPanel(); }}
    >
      <div class="modal-box max-w-lg">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-bold">Regenerate Avatar</h3>
          <button
            class="btn btn-sm btn-ghost btn-square"
            onclick={() => viewModel.toggleRegenerationPanel()}
          >
            ✕
          </button>
        </div>

        <!-- Mode selector -->
        <div class="tabs tabs-bordered mb-4">
          <button
            class="tab tab-sm font-['JetBrains_Mono'] text-xs uppercase tracking-wider {viewModel.regenerationMode === 'appearance'
              ? 'tab-active border-[#cabeff] text-[#cabeff]'
              : 'text-[#938ea1]'}"
            onclick={() => viewModel.setRegenerationMode('appearance')}
          >
            Appearance
          </button>
          <button
            class="tab tab-sm font-['JetBrains_Mono'] text-xs uppercase tracking-wider {viewModel.regenerationMode === 'direct'
              ? 'tab-active border-[#cabeff] text-[#cabeff]'
              : 'text-[#938ea1]'}"
            onclick={() => viewModel.setRegenerationMode('direct')}
          >
            Direct
          </button>
          <button
            class="tab tab-sm font-['JetBrains_Mono'] text-xs uppercase tracking-wider {viewModel.regenerationMode === 'edit'
              ? 'tab-active border-[#cabeff] text-[#cabeff]'
              : 'text-[#938ea1]'}"
            onclick={() => viewModel.setRegenerationMode('edit')}
          >
            Edit
          </button>
        </div>

        <!-- Mode content -->
        {#if viewModel.regenerationMode === 'appearance'}
          <p class="text-sm text-base-content/60 mb-4">
            Regenerate using the Appearance description. The text will be enhanced for better image
            quality.
          </p>
        {:else if viewModel.regenerationMode === 'direct'}
          <label class="form-control w-full mb-4">
            <div class="label py-0.5">
              <span class="label-text text-xs font-semibold">Direct Prompt</span>
            </div>
            <textarea
              class="textarea textarea-bordered w-full min-h-24 font-mono text-xs"
              bind:value={viewModel.directPrompt}
              placeholder="Describe the image directly..."
              disabled={viewModel.isRegenerating}
            ></textarea>
          </label>
        {:else if viewModel.regenerationMode === 'edit'}
          <label class="form-control w-full mb-4">
            <div class="label py-0.5">
              <span class="label-text text-xs font-semibold">Edit Instruction</span>
              <span class="label-text-alt text-base-content/40">e.g. "make the hair green"</span>
            </div>
            <input
              type="text"
              class="input input-bordered w-full font-mono text-sm"
              bind:value={viewModel.editInstruction}
              placeholder="make the hair green, add a crown..."
              disabled={viewModel.isRegenerating}
            >
          </label>
        {/if}

        <div class="modal-action">
          <button class="btn btn-ghost btn-sm" onclick={() => viewModel.toggleRegenerationPanel()}>
            Cancel
          </button>
          <button
            class="btn btn-primary btn-sm"
            onclick={() => viewModel.regenerateAvatar()}
            disabled={viewModel.isRegenerating}
          >
            {viewModel.isRegenerating ? 'Generating...' : '🔄 Generate'}
          </button>
        </div>
      </div>
    </dialog>
  {/if}
</BaseViewModelContainer>
