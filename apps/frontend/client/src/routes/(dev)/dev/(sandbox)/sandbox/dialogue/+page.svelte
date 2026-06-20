<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/sandbox/dialogue/+page.svelte
  //
  // Isolated Dialogue Action Menu & Interactive Dice sandbox with devtools.
  // Mounts the DialogueOverlay with DialogueDevViewModel for testing C-162:
  //   - Action context menu (Persuasion/Intimidation/Stealth/Attack/Custom)
  //   - Interactive d20 click-to-roll with controlled outcomes
  //   - Toggle between mock AI and real LLM extraction
  //   - NPC persona presets (sage, guard, innkeeper, blacksmith, bandit, merchant)
  //   - Interaction mode switch (menu vs freeform)
  //
  // Contract: C-162 BG3 Action Menu & Dice

  import { browser } from '$app/environment';
  import {
    type DevInteractionMode,
    type DevNpcPreset,
    DialogueDevViewModel,
    type DialogueDevViewModelInterface,
    type DiceOutcome,
  } from '$lib/views/game/ui/overlays/dialogue/dialogue_dev_view_model.svelte';
  import DialogueOverlay from '$lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte';

  /** Navigate back to sandbox index on End Chat / combat transition. */
  const goBack = () => {
    if (browser) {
      window.history.back();
    }
  };

  const MOCK_NPC_DATA = {
    npcId: 'sandbox-elder',
    npcName: 'Elder Thrain',
    dialog: 'Ah, a traveler! Welcome to our humble village. How may I be of assistance?',
    personaId: 'sage',
  };

  const viewModel: DialogueDevViewModelInterface = new DialogueDevViewModel({
    className: 'DialogueSandboxVM',
    npcData: MOCK_NPC_DATA,
    onEndChat: goBack,
    onStartCombat: () => {
      goBack();
    },
    initialDiceOutcome: 'random',
    initialUseMockAi: true,
    initialNpcPreset: 'sage',
    initialInteractionMode: 'menu',
  });

  // ── Devtool state ───────────────────────────────────────────────────
  let devToolsOpen = $state(true);
</script>

<svelte:head>
  <title>Dialogue Action Menu (C-162) — Aikami Dev</title>
</svelte:head>

<div class="fixed inset-0 bg-black">
  <!-- Dialogue Overlay (full-screen) -->
  <DialogueOverlay {viewModel} />

  <!-- DevTools Panel — top-right overlay -->
  {#if devToolsOpen}
    <div
      class="pointer-events-auto fixed right-0 top-0 z-50 flex h-full w-80 flex-col gap-3 overflow-y-auto bg-base-300/95 p-4 pt-2 shadow-2xl backdrop-blur-sm"
    >
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-base-content/10 pb-2">
        <div class="flex items-center gap-2">
          <span class="text-xs font-bold text-primary">🛠️ DevTools</span>
          <span class="badge badge-xs badge-accent">C-162</span>
        </div>
        <button
          class="btn btn-ghost btn-xs text-base-content/60"
          onclick={() => (devToolsOpen = false)}
        >
          ✕
        </button>
      </div>

      <!-- Dice Outcome -->
      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider"
          >🎲 Dice Outcome</span
        >
        <div class="join join-vertical">
          {#each (['random', 'always_succeed', 'always_fail'] as const) as outcome}
            <button
              class="btn btn-xs join-item {viewModel.diceOutcome === outcome
                ? 'btn-active btn-success'
                : 'btn-ghost'}"
              onclick={() => viewModel.setDiceOutcome(outcome as DiceOutcome)}
            >
              {outcome === 'random'
                ? '🎰 Random'
                : outcome === 'always_succeed'
                  ? '✅ Always Succeed'
                  : '❌ Always Fail'}
            </button>
          {/each}
        </div>
      </div>

      <!-- AI Mode -->
      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider"
          >🤖 AI Mode</span
        >
        <div class="join">
          <button
            class="btn btn-xs join-item {viewModel.useMockAi ? 'btn-active btn-warning' : 'btn-ghost'}"
            onclick={() => viewModel.setUseMockAi(true)}
          >
            🎭 Mock AI
          </button>
          <button
            class="btn btn-xs join-item {!viewModel.useMockAi ? 'btn-active btn-info' : 'btn-ghost'}"
            onclick={() => viewModel.setUseMockAi(false)}
          >
            🌐 Real LLM
          </button>
        </div>
        {#if viewModel.useMockAi}
          <span class="text-xs text-base-content/40 italic"
            >Pre-written narratives, 800ms simulated latency</span
          >
        {:else}
          <span class="text-xs text-warning/70 italic"
            >⚠️ Requires configured text provider (OpenRouter API key)</span
          >
        {/if}
      </div>

      <!-- NPC Persona -->
      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider"
          >👤 NPC Persona</span
        >
        <div class="flex flex-wrap gap-1">
          {#each (['sage', 'guard', 'innkeeper', 'blacksmith', 'bandit', 'merchant'] as const) as preset}
            <button
              class="btn btn-xs {viewModel.mockNpcPreset === preset
                ? 'btn-active btn-primary'
                : 'btn-outline'}"
              onclick={() => viewModel.setMockNpcPreset(preset as DevNpcPreset)}
            >
              {preset === 'sage'
                ? '🧙 Sage'
                : preset === 'guard'
                  ? '🛡️ Guard'
                  : preset === 'innkeeper'
                    ? '🍺 Innkeeper'
                    : preset === 'blacksmith'
                      ? '⚒️ Smith'
                      : preset === 'bandit'
                        ? '🗡️ Bandit'
                        : '💰 Merchant'}
            </button>
          {/each}
        </div>
      </div>

      <!-- Interaction Mode -->
      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider"
          >📋 Interaction Mode</span
        >
        <div class="join">
          <button
            class="btn btn-xs join-item {viewModel.interactionMode === 'menu'
              ? 'btn-active btn-secondary'
              : 'btn-ghost'}"
            onclick={() => viewModel.setInteractionMode('menu' as DevInteractionMode)}
          >
            📜 Action Menu
          </button>
          <button
            class="btn btn-xs join-item {viewModel.interactionMode === 'freeform'
              ? 'btn-active btn-accent'
              : 'btn-ghost'}"
            onclick={() => viewModel.setInteractionMode('freeform' as DevInteractionMode)}
          >
            ✏️ Freeform
          </button>
        </div>
        <span class="text-xs text-base-content/40 italic">
          {viewModel.interactionMode === 'menu'
            ? 'C-162 BG3-style buttons'
            : 'Legacy text input (C-128/C-157)'}
        </span>
      </div>

      <!-- Auto Image Generation -->
      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider"
          >🖼️ Image Gen</span
        >
        <div class="join">
          <button
            class="btn btn-xs join-item {viewModel.autoGenerateImage ? 'btn-active btn-success' : 'btn-ghost'}"
            onclick={() => viewModel.setAutoGenerateImage(true)}
          >
            🤖 Auto
          </button>
          <button
            class="btn btn-xs join-item {!viewModel.autoGenerateImage ? 'btn-active btn-ghost' : 'btn-ghost'}"
            onclick={() => viewModel.setAutoGenerateImage(false)}
          >
            ✋ Manual
          </button>
        </div>
        {#if viewModel.autoGenerateImage}
          <span class="text-xs text-base-content/40 italic"
            >Generates scene image on each skill check resolution</span
          >
        {/if}
      </div>

      <!-- Quick Actions -->
      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider"
          >⚡ Quick Actions</span
        >
        <div class="flex flex-col gap-1">
          <!-- Generate Scene Image -->
          <button
            class="btn btn-xs btn-accent btn-outline"
            onclick={() => viewModel.generateSceneImage()}
          >
            🖼️ Generate Scene Image
          </button>
          <!-- End Chat -->
          <button class="btn btn-xs btn-error btn-outline" onclick={() => viewModel.endChat()}>
            🚪 End Chat
          </button>
          <!-- Reset (re-create the VM) -->
          <button
            class="btn btn-xs btn-ghost"
            onclick={() => {
              viewModel.setMockNpcPreset('sage');
              viewModel.setDiceOutcome('random');
              viewModel.setUseMockAi(true);
              viewModel.setInteractionMode('menu');
            }}
          >
            🔄 Reset All
          </button>
        </div>
      </div>

      <!-- State Inspector -->
      <div class="flex flex-col gap-1.5 border-t border-base-content/10 pt-3">
        <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider"
          >🔍 Inspector</span
        >
        <div class="flex flex-col gap-1 text-xs font-mono text-base-content/60">
          <span>Phase: <strong class="text-primary">{viewModel.dialoguePhase}</strong></span>
          <span
            >Dice:
            <strong class="text-accent">{viewModel.skillCheckState?.phase ?? 'none'}</strong></span
          >
          <span>Selected: <strong>{viewModel.selectedActionId ?? '—'}</strong></span>
          <span>Streaming: <strong>{viewModel.isStreaming ? 'yes' : 'no'}</strong></span>
          <span>Resolving: <strong>{viewModel.isResolvingSkillCheck ? 'yes' : 'no'}</strong></span>
          {#if viewModel.generatedImageUrl}
            <span class="text-success">Image:</span>
            <a
              href={viewModel.generatedImageUrl}
              target="_blank"
              class="text-xs text-info underline truncate"
              rel="noreferrer"
              >{viewModel.generatedImageUrl}</a
            >
          {/if}
          {#if viewModel.streamError}
            <span class="text-error">Error: {viewModel.streamError}</span>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- DevTools toggle button (when panel is closed) -->
  {#if !devToolsOpen}
    <button
      class="pointer-events-auto fixed right-2 top-2 z-50 btn btn-xs btn-ghost"
      onclick={() => (devToolsOpen = true)}
    >
      🛠️ DevTools
    </button>
  {/if}
</div>
