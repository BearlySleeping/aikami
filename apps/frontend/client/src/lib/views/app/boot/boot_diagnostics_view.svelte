<script lang="ts">
  // apps/frontend/client/src/lib/views/app/boot/boot_diagnostics_view.svelte
  //
  // Retro-terminal boot diagnostics screen. Displays live connection status
  // for the local AI providers (Ollama/ComfyUI) and gates entry until both
  // are online. Uses Svelte 5 runes, DaisyUI components, and a terminal-
  // inspired design language.

  import type { BootDiagnosticsViewModelInterface } from './boot_diagnostics_view_model.svelte';

  let { viewModel }: { viewModel: BootDiagnosticsViewModelInterface } = $props();

  // Start polling on mount, clean up on unmount.
  $effect(() => {
    viewModel.startPolling();
  });

  // ── Helpers (inline — view-only presentation logic) ──────────────────

  /** Returns the CSS class for a status indicator dot. */
  const statusDotClass = (status: string): string => {
    if (status === 'online') {
      return 'bg-success';
    }
    if (status === 'offline') {
      return 'bg-error';
    }
    return 'bg-warning animate-pulse';
  };

  /** Returns a human-readable label for a provider status. */
  const statusLabel = (status: string): string => {
    if (status === 'online') {
      return 'ONLINE';
    }
    if (status === 'offline') {
      return 'OFFLINE';
    }
    return 'SCANNING...';
  };
</script>

<div
  class="min-h-screen bg-neutral-950 flex items-center justify-center p-4 font-mono"
  role="application"
  aria-label="Boot Diagnostics Terminal"
>
  <div class="w-full max-w-lg">
    <!-- ── Terminal Window Chrome ─────────────────────────────────────── -->
    <div
      class="rounded-t-lg bg-neutral-800 px-4 py-2 flex items-center gap-2 border border-neutral-700 border-b-0"
    >
      <span class="w-3 h-3 rounded-full bg-error/80"></span>
      <span class="w-3 h-3 rounded-full bg-warning/80"></span>
      <span class="w-3 h-3 rounded-full bg-success/80"></span>
      <span class="ml-2 text-xs text-neutral-400">Aikami Core Boot Sequence v2.0</span>
    </div>

    <!-- ── Terminal Body ──────────────────────────────────────────────── -->
    <div class="bg-neutral-900 border border-neutral-700 border-t-0 rounded-b-lg p-6 space-y-6">
      <!-- Header -->
      <div class="space-y-1">
        <h2 class="text-success text-sm tracking-wider">INITIALIZING SUBSYSTEMS...</h2>
        <p class="text-neutral-500 text-xs leading-relaxed">
          The Aikami engine requires local AI providers to render the world. Please ensure Ollama
          and ComfyUI are running before proceeding.
        </p>
      </div>

      <!-- ── Status Row: Text AI (Ollama) ─────────────────────────────── -->
      <div class="border border-neutral-700 rounded p-4 space-y-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <!-- Status dot -->
            <span
              class="w-3 h-3 rounded-full inline-block {statusDotClass(viewModel.ollamaStatus)}"
              aria-label="Ollama status: {statusLabel(viewModel.ollamaStatus)}"
            ></span>
            <span class="text-neutral-200 text-sm font-semibold">Text AI (Ollama)</span>
          </div>
          <span
            class="text-xs font-bold {viewModel.ollamaStatus === 'online'
              ? 'text-success'
              : viewModel.ollamaStatus === 'offline'
                ? 'text-error'
                : 'text-warning'}"
          >
            {statusLabel(viewModel.ollamaStatus)}
          </span>
        </div>

        {#if viewModel.ollamaStatus === 'offline'}
          <div class="text-xs text-neutral-400 leading-relaxed pl-6 border-l-2 border-error/40">
            <p>Awaiting connection…</p>
            <p class="mt-1 text-neutral-500">
              Please launch <code class="text-warning/80">ollama serve</code> from your terminal, or
              start the Ollama desktop application. Ensure the service is listening on port
              <code class="text-warning/80">11434</code>.
            </p>
          </div>
        {:else if viewModel.ollamaStatus === 'pending'}
          <div class="text-xs text-warning/70 pl-6">
            Pinging <code class="text-warning/80">localhost:11434</code>…
          </div>
        {/if}
      </div>

      <!-- ── Status Row: Image AI (ComfyUI) ───────────────────────────── -->
      <div class="border border-neutral-700 rounded p-4 space-y-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <!-- Status dot -->
            <span
              class="w-3 h-3 rounded-full inline-block {statusDotClass(viewModel.comfyStatus)}"
              aria-label="ComfyUI status: {statusLabel(viewModel.comfyStatus)}"
            ></span>
            <span class="text-neutral-200 text-sm font-semibold">Image AI (ComfyUI)</span>
          </div>
          <span
            class="text-xs font-bold {viewModel.comfyStatus === 'online'
              ? 'text-success'
              : viewModel.comfyStatus === 'offline'
                ? 'text-error'
                : 'text-warning'}"
          >
            {statusLabel(viewModel.comfyStatus)}
          </span>
        </div>

        {#if viewModel.comfyStatus === 'offline'}
          <div class="text-xs text-neutral-400 leading-relaxed pl-6 border-l-2 border-error/40">
            <p>Awaiting connection…</p>
            <p class="mt-1 text-neutral-500">
              Please launch ComfyUI from your terminal with
              <code class="text-warning/80">python main.py</code>
              (or your preferred launcher). Ensure the server is running on port
              <code class="text-warning/80">8188</code>.
            </p>
          </div>
        {:else if viewModel.comfyStatus === 'pending'}
          <div class="text-xs text-warning/70 pl-6">
            Pinging <code class="text-warning/80">localhost:8188</code>…
          </div>
        {/if}
      </div>

      <!-- ── Initialize Core Button ───────────────────────────────────── -->
      <div class="pt-2">
        {#if viewModel.canBoot}
          <button class="btn btn-success w-full" onclick={() => viewModel.initializeCore()}>
            Initialize Core
          </button>
        {:else}
          <div
            class="tooltip w-full"
            data-tip="Both Text AI and Image AI providers must be online before you can initialize the core."
          >
            <button class="btn btn-disabled w-full" disabled>
              <span class="loading loading-spinner loading-xs"></span>
              Awaiting Providers…
            </button>
          </div>
        {/if}
      </div>

      <!-- Footer -->
      <p class="text-neutral-600 text-xs text-center pt-2">
        Aikami Core v2.0 — Independent AI Infrastructure Required
      </p>
    </div>
  </div>
</div>

<style>
  /* Subtle terminal cursor blink on the SCANNING label */
  .animate-pulse {
    animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }

  /* Typewriter-style scan line overlay */
  @keyframes scanline {
    0% {
      transform: translateY(-100%);
    }
    100% {
      transform: translateY(100%);
    }
  }
</style>
