<script lang="ts">
  // apps/frontend/client/src/lib/views/app/boot/boot_diagnostics_view.svelte
  //
  // Retro-terminal boot diagnostics screen. Displays live connection status
  // for AI providers. Only a Text provider (local Ollama OR cloud OpenRouter)
  // is required to boot. Image and Voice providers are optional and gracefully
  // degrade. Uses Svelte 5 runes, DaisyUI components, terminal-inspired design.
  //
  // Contract: C-130 (origin), C-133 (flexible provider onboarding)

  import type {
    ActiveImageProvider,
    ActiveTextProvider,
    BootDiagnosticsViewModelInterface,
  } from './boot_diagnostics_view_model.svelte';

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
    if (status === 'offline' || status === 'unconfigured') {
      return 'bg-error';
    }
    if (status === 'disabled') {
      return 'bg-neutral-500';
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
    if (status === 'unconfigured') {
      return 'NO KEY';
    }
    if (status === 'disabled') {
      return 'DISABLED';
    }
    return 'SCANNING...';
  };

  /** Returns the CSS class for a status label. */
  const statusLabelClass = (status: string): string => {
    if (status === 'online') {
      return 'text-success';
    }
    if (status === 'offline' || status === 'unconfigured') {
      return 'text-error';
    }
    if (status === 'disabled') {
      return 'text-neutral-400';
    }
    return 'text-warning';
  };

  /** Whether the image provider warning should be shown. */
  const showImageWarning = $derived(
    viewModel.canBoot &&
      (viewModel.imageStatus === 'offline' || viewModel.imageStatus === 'disabled'),
  );
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
      <span class="ml-2 text-xs text-neutral-400">Aikami Core Boot Sequence v3.0</span>
    </div>

    <!-- ── Terminal Body ──────────────────────────────────────────────── -->
    <div class="bg-neutral-900 border border-neutral-700 border-t-0 rounded-b-lg p-6 space-y-6">
      <!-- Header -->
      <div class="space-y-1">
        <h2 class="text-success text-sm tracking-wider">INITIALIZING SUBSYSTEMS...</h2>
        <p class="text-neutral-500 text-xs leading-relaxed">
          A Text AI provider is required to render the world. Image and Voice are optional and can
          be configured later.
        </p>
      </div>

      <!-- ── Hardware Recommendations ─────────────────────────────────── -->
      <div class="rounded border border-info/30 bg-info/5 px-3 py-2">
        <p class="text-info/70 text-xs leading-relaxed">
          ⚡ <span class="font-semibold text-info/80">Hardware Recommendations:</span>
          Cloud Text + Local Image recommended for standard rigs. Full Local execution requires
          high-tier hardware. OpenRouter requires an API key configured in settings.
        </p>
      </div>

      <!-- ════════════════════════════════════════════════════════════════ -->
      <!-- Required Systems                                                    -->
      <!-- ════════════════════════════════════════════════════════════════ -->
      <div class="space-y-3">
        <div class="flex items-center gap-2">
          <span class="text-xs tracking-wider text-error/70 font-bold">REQUIRED SYSTEM</span>
          <span class="flex-1 border-t border-error/20"></span>
        </div>

        <!-- Text AI Provider -->
        <div class="border border-neutral-700 rounded p-4 space-y-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <!-- Status dot -->
              <span
                class="w-3 h-3 rounded-full inline-block {statusDotClass(viewModel.textStatus)}"
                aria-label="Text AI status: {statusLabel(viewModel.textStatus)}"
              ></span>
              <span class="text-neutral-200 text-sm font-semibold">Text AI (Logic Engine)</span>
            </div>
            <span class="text-xs font-bold {statusLabelClass(viewModel.textStatus)}">
              {statusLabel(viewModel.textStatus)}
            </span>
          </div>

          <!-- Provider Toggle: Ollama / OpenRouter -->
          <div class="join w-full" role="group" aria-label="Text Provider Selection">
            <button
              class="join-item btn btn-xs flex-1 {viewModel.activeTextProvider === 'ollama'
                ? 'btn-primary'
                : 'btn-outline btn-neutral'}"
              onclick={() => viewModel.setActiveTextProvider('ollama')}
            >
              Local (Ollama)
            </button>
            <button
              class="join-item btn btn-xs flex-1 {viewModel.activeTextProvider === 'openrouter'
                ? 'btn-primary'
                : 'btn-outline btn-neutral'}"
              onclick={() => viewModel.setActiveTextProvider('openrouter')}
            >
              Cloud (OpenRouter)
            </button>
          </div>

          {#if viewModel.textStatus === 'offline'}
            <div class="text-xs text-neutral-400 leading-relaxed pl-6 border-l-2 border-error/40">
              {#if viewModel.activeTextProvider === 'ollama'}
                <p>Awaiting connection…</p>
                <p class="mt-1 text-neutral-500">
                  Please launch <code class="text-warning/80">ollama serve</code> from your
                  terminal, or start the Ollama desktop application. Ensure the service is listening
                  on port <code class="text-warning/80">11434</code>.
                </p>
              {:else}
                <p class="text-neutral-400">
                  Enter your OpenRouter API key to activate cloud text generation:
                </p>
                <div class="flex items-center gap-2 mt-2">
                  <input
                    type="password"
                    class="input input-bordered input-sm w-full max-w-xs font-mono text-xs"
                    placeholder="sk-or-v1-..."
                    value={viewModel.tempOpenRouterKey}
                    oninput={(e) => (viewModel.tempOpenRouterKey = e.currentTarget.value)}
                  >
                  <button
                    class="btn btn-primary btn-sm"
                    disabled={!viewModel.tempOpenRouterKey.trim()}
                    onclick={() => viewModel.saveOpenRouterKey()}
                  >
                    Save Key
                  </button>
                </div>
              {/if}
            </div>
          {:else if viewModel.textStatus === 'unconfigured'}
            <div class="text-xs text-neutral-400 leading-relaxed pl-6 border-l-2 border-error/40">
              <p>OpenRouter API key not found.</p>
              <div class="flex items-center gap-2 mt-2">
                <input
                  type="password"
                  class="input input-bordered input-sm w-full max-w-xs font-mono text-xs"
                  placeholder="sk-or-v1-..."
                  value={viewModel.tempOpenRouterKey}
                  oninput={(e) => (viewModel.tempOpenRouterKey = e.currentTarget.value)}
                >
                <button
                  class="btn btn-primary btn-sm"
                  disabled={!viewModel.tempOpenRouterKey.trim()}
                  onclick={() => viewModel.saveOpenRouterKey()}
                >
                  Save Key
                </button>
              </div>
            </div>
          {:else if viewModel.textStatus === 'pending'}
            <div class="text-xs text-warning/70 pl-6">
              {#if viewModel.activeTextProvider === 'ollama'}
                Pinging <code class="text-warning/80">localhost:11434</code>…
              {:else}
                Verifying OpenRouter API key…
              {/if}
            </div>
          {/if}
        </div>
      </div>

      <!-- ════════════════════════════════════════════════════════════════ -->
      <!-- Optional Subsystems                                                -->
      <!-- ════════════════════════════════════════════════════════════════ -->
      <div class="space-y-3">
        <div class="flex items-center gap-2">
          <span class="text-xs tracking-wider text-warning/60 font-bold">OPTIONAL SUBSYSTEMS</span>
          <span class="flex-1 border-t border-warning/20"></span>
        </div>

        <!-- Image AI Provider -->
        <div class="border border-neutral-700 rounded p-4 space-y-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <span
                class="w-3 h-3 rounded-full inline-block {statusDotClass(viewModel.imageStatus)}"
                aria-label="Image AI status: {statusLabel(viewModel.imageStatus)}"
              ></span>
              <span class="text-neutral-200 text-sm font-semibold">Image AI (Visual Engine)</span>
            </div>
            <span class="text-xs font-bold {statusLabelClass(viewModel.imageStatus)}">
              {statusLabel(viewModel.imageStatus)}
            </span>
          </div>

          {#if viewModel.imageStatus === 'offline'}
            <div class="text-xs text-neutral-400 leading-relaxed pl-6 border-l-2 border-error/40">
              <p>Awaiting connection…</p>
              <p class="mt-1 text-neutral-500">
                Please launch ComfyUI with <code class="text-warning/80">python main.py</code>
                on port <code class="text-warning/80">8188</code>, or switch to Cloud / Disabled.
              </p>
            </div>
          {:else if viewModel.imageStatus === 'pending'}
            <div class="text-xs text-warning/70 pl-6">
              Pinging <code class="text-warning/80">localhost:8188</code>…
            </div>
          {:else if viewModel.imageStatus === 'disabled'}
            <div class="text-xs text-neutral-500 pl-6">
              Image generation is disabled. NPCs will use fallback sprites.
            </div>
          {/if}
        </div>

        <!-- Voice AI (Native WebGPU) -->
        <div class="border border-neutral-700 rounded p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <span
                class="w-3 h-3 rounded-full inline-block {statusDotClass(viewModel.voiceStatus)}"
                aria-label="Voice AI status: {statusLabel(viewModel.voiceStatus)}"
              ></span>
              <span class="text-neutral-200 text-sm font-semibold">Voice AI (Kokoro WebGPU)</span>
            </div>
            <span class="text-xs font-bold {statusLabelClass(viewModel.voiceStatus)}">
              {statusLabel(viewModel.voiceStatus)}
            </span>
          </div>
          <p class="text-xs text-neutral-500 mt-2 pl-9">
            Browser-native text-to-speech via Kokoro 82M WebGPU worker. Available automatically.
          </p>
        </div>
      </div>

      <!-- ── Initialize Core Button ───────────────────────────────────── -->
      <div class="pt-2">
        {#if viewModel.canBoot}
          <div class="space-y-2">
            {#if showImageWarning}
              <div
                class="rounded bg-warning/10 border border-warning/30 px-3 py-2 text-xs text-warning/80 leading-relaxed"
              >
                ⚠ Booting without Image Generation. NPCs will use fallback sprites. You can
                configure image generation later in Settings.
              </div>
            {/if}
            <button class="btn btn-success w-full" onclick={() => viewModel.initializeCore()}>
              {showImageWarning ? 'Initialize Core (Text Only)' : 'Initialize Core'}
            </button>
          </div>
        {:else}
          <div
            class="tooltip w-full"
            data-tip="A Text AI provider (Local Ollama or Cloud OpenRouter) must be online before you can initialize the core."
          >
            <button class="btn btn-disabled w-full" disabled>
              <span class="loading loading-spinner loading-xs"></span>
              Awaiting Text Provider…
            </button>
          </div>
        {/if}
      </div>

      <!-- Footer -->
      <p class="text-neutral-600 text-xs text-center pt-2">
        Aikami Core v3.0 — Hybrid AI Architecture
      </p>
    </div>
  </div>
</div>

<style>
  /* Subtle terminal cursor blink on the SCANNING label */
  .animate-pulse {
    animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
</style>
