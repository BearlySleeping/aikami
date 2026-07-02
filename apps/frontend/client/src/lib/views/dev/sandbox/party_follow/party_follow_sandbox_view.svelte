<script lang="ts">
  // apps/frontend/client/src/lib/views/dev/sandbox/party_follow/party_follow_sandbox_view.svelte
  //
  // View for the Party Follow sandbox — renders the game canvas,
  // party member list with recruit/toggle controls, and debug info.

  import type { PartyFollowSandboxViewModelInterface } from './party_follow_sandbox_view_model.svelte.ts';

  type Props = {
    viewModel: PartyFollowSandboxViewModelInterface;
  };

  const { viewModel }: Props = $props();

  let canvasElement = $state<HTMLCanvasElement | undefined>(undefined);

  $effect(() => {
    if (canvasElement) {
      void viewModel.initializeEngine(canvasElement);
    }
  });
</script>

<div class="relative h-screen w-screen overflow-hidden bg-black">
  <!-- Status overlays -->
  {#if viewModel.engineError}
    <div
      class="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/90"
    >
      <div class="rounded-xl bg-error/20 p-6 text-center">
        <p class="text-lg font-bold text-error">Engine Error</p>
        <p class="mt-2 text-sm text-error-content">{viewModel.engineError}</p>
      </div>
    </div>
  {:else if !viewModel.engineReady}
    <div
      class="pointer-events-auto absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/95"
    >
      <span class="loading loading-spinner loading-lg text-primary"></span>
      <p class="text-xl font-bold text-white">Initializing engine...</p>
      <p class="text-sm text-white/40">Loading PixiJS + Web Worker + tilemap</p>
    </div>
  {:else if !viewModel.mapLoaded}
    <div
      class="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/90"
    >
      <p class="text-lg text-white/60">Loading party follow sandbox map...</p>
    </div>
  {/if}

  <!-- Game canvas -->
  <div class="absolute inset-0">
    <canvas
      id="party-follow-sandbox-canvas"
      class="h-full w-full"
      bind:this={canvasElement}
    ></canvas>
  </div>

  <!-- HUD: Player position -->
  {#if viewModel.engineReady}
    <div
      class="pointer-events-none absolute left-4 top-4 z-10 rounded-lg bg-black/70 px-4 py-3 font-mono text-sm text-white backdrop-blur-sm"
    >
      <div class="mb-1 text-xs font-bold uppercase tracking-wider text-primary/70">Player</div>
      <div>X: {Math.round(viewModel.playerX)} Y: {Math.round(viewModel.playerY)}</div>
      <div class="mt-1 text-xs text-white/50">Active followers: {viewModel.activeCount}</div>
    </div>
  {/if}

  <!-- Party Control Panel — floating bottom-center -->
  {#if viewModel.engineReady}
    <div
      class="pointer-events-auto absolute bottom-6 inset-x-0 mx-auto w-fit max-w-md rounded-xl border border-base-300 bg-base-200/90 p-4 shadow-lg backdrop-blur-sm"
    >
      <div class="mb-2 text-center">
        <span class="text-sm font-bold text-base-content">🧑‍🤝‍🧑 Party Members</span>
      </div>

      <div class="flex flex-col gap-2">
        {#each viewModel.partyMembers as member (member.id)}
          <div class="flex items-center justify-between gap-3 rounded-lg bg-base-100/60 px-3 py-2">
            <div class="flex items-center gap-2">
              <!-- Status indicator -->
              <span
                class="inline-block h-2 w-2 rounded-full {member.active ? 'bg-green-400' : 'bg-base-400'}"
              ></span>
              <span class="text-sm font-medium text-base-content">{member.name}</span>
            </div>

            <button
              class="btn btn-xs {member.active ? 'btn-error btn-outline' : 'btn-success'}"
              onclick={() => viewModel.togglePartyMember(member.id)}
            >
              {member.active ? 'Leave' : 'Recruit'}
            </button>
          </div>
        {/each}
      </div>

      {#if viewModel.activeCount > 0}
        <p class="mt-3 text-center text-xs text-base-content/50">
          {viewModel.activeCount}
          companion{viewModel.activeCount !== 1 ? 's' : ''}
          following — move with WASD / Arrow Keys
        </p>
      {:else}
        <p class="mt-3 text-center text-xs text-base-content/40">
          Recruit companions to see them follow your character
        </p>
      {/if}
    </div>
  {/if}
</div>
