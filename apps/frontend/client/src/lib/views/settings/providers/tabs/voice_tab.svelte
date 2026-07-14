<!-- apps/frontend/client/src/lib/views/settings/providers/tabs/voice_tab.svelte -->
<script lang="ts">
import type { ProvidersViewModelInterface } from '../providers_view_model.svelte';

type Props = {
  viewModel: ProvidersViewModelInterface;
};

let { viewModel }: Props = $props();

const voiceConfig = $derived(viewModel.config.voice);
</script>

<div class="space-y-6">
  <!-- ═══════════════════════════════════════════════════════════════
       Provider Selector
       ═══════════════════════════════════════════════════════════════ -->
  <div class="form-control">
    <div class="label py-1">
      <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
        TTS Provider
      </span>
    </div>
    <select
      class="select select-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
      value={voiceConfig.provider}
      onchange={(e: Event) =>
        viewModel.setField('voice', 'provider', (e.target as HTMLSelectElement).value)}
    >
      {#each viewModel.voiceProviders as prov}
        <option value={prov.id}>{prov.label}</option>
      {/each}
    </select>
    <div class="label py-1">
      <span class="text-xs text-[#938ea1]">
        {viewModel.voiceProviders.find((p) => p.id === voiceConfig.provider)?.description ?? ''}
      </span>
    </div>
  </div>

  <!-- ═══════════════════════════════════════════════════════════════
       Custom URL (voicevox, fish-speech, kokoro)
       ═══════════════════════════════════════════════════════════════ -->
  {#if voiceConfig.provider === 'voicevox' || voiceConfig.provider === 'fish-speech' || voiceConfig.provider === 'kokoro'}
    <div class="p-4 bg-white/[0.04] rounded-lg border border-white/[0.06] space-y-4">
      <h3 class="font-['JetBrains_Mono'] text-sm text-[#cabeff] uppercase tracking-wider">
        Server Settings
      </h3>

      <div class="form-control">
        <div class="label py-1">
          <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
            Server URL
          </span>
        </div>
        <input
          type="text"
          class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
          placeholder={voiceConfig.provider === 'voicevox'
            ? 'http://localhost:50021'
            : voiceConfig.provider === 'kokoro'
              ? 'http://localhost:8880'
              : 'http://localhost:8080'}
          value={voiceConfig.url ?? ''}
          oninput={(e: Event) =>
            viewModel.setField('voice', 'url', (e.target as HTMLInputElement).value)}
        >
      </div>
    </div>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════
       API Key (elevenlabs, openai)
       ═══════════════════════════════════════════════════════════════ -->
  {#if voiceConfig.provider === 'elevenlabs' || voiceConfig.provider === 'openai'}
    <div class="p-4 bg-white/[0.04] rounded-lg border border-white/[0.06] space-y-4">
      <h3 class="font-['JetBrains_Mono'] text-sm text-[#cabeff] uppercase tracking-wider">
        API Configuration
      </h3>

      <div class="form-control">
        <div class="label py-1">
          <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
            API Key
          </span>
        </div>
        <input
          type="password"
          class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
          placeholder="sk-..."
          value={voiceConfig.apiKey ?? ''}
          oninput={(e: Event) =>
            viewModel.setField('voice', 'apiKey', (e.target as HTMLInputElement).value)}
        >
      </div>
    </div>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════
       Common voice settings
       ═══════════════════════════════════════════════════════════════ -->
  <div class="p-4 bg-white/[0.04] rounded-lg border border-white/[0.06] space-y-4">
    <h3 class="font-['JetBrains_Mono'] text-sm text-[#cabeff] uppercase tracking-wider">
      Voice Settings
    </h3>

    <div class="form-control">
      <div class="label py-1">
        <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
          Voice ID
        </span>
      </div>
      <input
        type="text"
        class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
        value={voiceConfig.voiceId}
        oninput={(e: Event) =>
          viewModel.setField('voice', 'voiceId', (e.target as HTMLInputElement).value)}
      >
    </div>

    <div class="grid grid-cols-2 gap-4">
      <div class="form-control">
        <div class="label py-1">
          <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
            Speed ({voiceConfig.speed.toFixed(1)}×)
          </span>
        </div>
        <input
          type="range"
          min="0.5"
          max="2.0"
          step="0.1"
          class="range range-primary range-sm"
          value={voiceConfig.speed}
          oninput={(e: Event) =>
            viewModel.setField('voice', 'speed', Number.parseFloat((e.target as HTMLInputElement).value))}
        >
      </div>
      <div class="form-control">
        <div class="label py-1">
          <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
            Pitch ({voiceConfig.pitch})
          </span>
        </div>
        <input
          type="range"
          min="-20"
          max="20"
          step="1"
          class="range range-primary range-sm"
          value={voiceConfig.pitch}
          oninput={(e: Event) =>
            viewModel.setField('voice', 'pitch', Number.parseInt((e.target as HTMLInputElement).value, 10))}
        >
      </div>
    </div>

    <div class="form-control">
      <div class="label py-1 cursor-pointer">
        <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
          Auto-Speech
        </span>
        <span class="font-['JetBrains_Mono'] text-[10px] text-[#938ea1]">
          Automatically generate TTS for NPC dialogue
        </span>
      </div>
      <input
        type="checkbox"
        class="toggle toggle-primary"
        checked={voiceConfig.autoSpeech}
        onchange={(e: Event) =>
          viewModel.setField('voice', 'autoSpeech', (e.target as HTMLInputElement).checked)}
      >
    </div>

    <div class="pt-2">
      <button
        type="button"
        class="btn btn-sm btn-ghost font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#cabeff]"
        onclick={() => viewModel.testVoice()}
        disabled={viewModel.isTestingVoice}
      >
        {#if viewModel.isTestingVoice}
          <span class="loading loading-spinner loading-xs"></span>
          Testing...
        {:else}
          Test Voice
        {/if}
      </button>
    </div>
  </div>
</div>
