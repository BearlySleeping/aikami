<!-- apps/frontend/client/src/lib/views/settings/providers/tabs/image_tab.svelte -->
<script lang="ts">
  import type { ProvidersViewModelInterface } from '../providers_view_model.svelte';

  type Props = {
    viewModel: ProvidersViewModelInterface;
  };

  let { viewModel }: Props = $props();

  const imageConfig = $derived(viewModel.config.image);
</script>

<div class="space-y-6">
  <!-- ═══════════════════════════════════════════════════════════════
       Provider Selector
       ═══════════════════════════════════════════════════════════════ -->
  <div class="form-control">
    <div class="label py-1">
      <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
        Image Provider
      </span>
    </div>
    <select
      class="select select-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
      value={imageConfig.provider}
      onchange={(e: Event) =>
        viewModel.setField('image', 'provider', (e.target as HTMLSelectElement).value)}
    >
      {#each viewModel.imageProviders as prov}
        <option value={prov.id}>{prov.label}</option>
      {/each}
    </select>
    <div class="label py-1">
      <span class="text-xs text-[#938ea1]">
        {viewModel.imageProviders.find((p) => p.id === imageConfig.provider)?.description ?? ''}
      </span>
    </div>
  </div>

  <!-- ═══════════════════════════════════════════════════════════════
       ComfyUI-specific settings
       ═══════════════════════════════════════════════════════════════ -->
  {#if imageConfig.provider === 'comfyui'}
    <div class="space-y-4 p-4 bg-white/[0.04] rounded-lg border border-white/[0.06]">
      <h3 class="font-['JetBrains_Mono'] text-sm text-[#cabeff] uppercase tracking-wider">
        ComfyUI Settings
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
          placeholder="http://localhost:8188"
          value={imageConfig.url ?? ''}
          oninput={(e: Event) =>
            viewModel.setField('image', 'url', (e.target as HTMLInputElement).value)}
        >
      </div>

      <div class="form-control">
        <div class="label py-1">
          <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
            Workflow (JSON)
          </span>
        </div>
        <textarea
          class="textarea textarea-bordered font-['JetBrains_Mono'] text-xs bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff] h-24"
          placeholder="ComfyUI workflow JSON"
          value={imageConfig.comfyWorkflow ?? ''}
          oninput={(e: Event) =>
            viewModel.setField('image', 'comfyWorkflow', (e.target as HTMLTextAreaElement).value)}
        ></textarea>
      </div>
    </div>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════
       NovelAI-specific settings
       ═══════════════════════════════════════════════════════════════ -->
  {#if imageConfig.provider === 'novelai'}
    <div class="space-y-4 p-4 bg-white/[0.04] rounded-lg border border-white/[0.06]">
      <h3 class="font-['JetBrains_Mono'] text-sm text-[#cabeff] uppercase tracking-wider">
        NovelAI Settings
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
          value={imageConfig.apiKey ?? ''}
          oninput={(e: Event) =>
            viewModel.setField('image', 'apiKey', (e.target as HTMLInputElement).value)}
        >
      </div>

      <div class="form-control">
        <div class="label py-1">
          <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
            Noise Schedule
          </span>
        </div>
        <input
          type="text"
          class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
          placeholder="karras"
          value={imageConfig.novelAiNoiseSchedule ?? ''}
          oninput={(e: Event) =>
            viewModel.setField(
              'image',
              'novelAiNoiseSchedule',
              (e.target as HTMLInputElement).value,
            )}
        >
      </div>
    </div>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════
       Cloud provider API key (dalle, stability, fal, openai-compat)
       ═══════════════════════════════════════════════════════════════ -->
  {#if ['dalle', 'stability', 'fal', 'openai-compat', 'webui'].includes(imageConfig.provider)}
    <div class="space-y-4 p-4 bg-white/[0.04] rounded-lg border border-white/[0.06]">
      <h3 class="font-['JetBrains_Mono'] text-sm text-[#cabeff] uppercase tracking-wider">
        {imageConfig.provider === 'webui' ? 'WebUI Settings' : 'API Configuration'}
      </h3>

      {#if imageConfig.provider === 'webui'}
        <div class="form-control">
          <div class="label py-1">
            <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
              Server URL
            </span>
          </div>
          <input
            type="text"
            class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
            placeholder="http://localhost:7860"
            value={imageConfig.url ?? ''}
            oninput={(e: Event) =>
              viewModel.setField('image', 'url', (e.target as HTMLInputElement).value)}
          >
        </div>
      {:else}
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
            value={imageConfig.apiKey ?? ''}
            oninput={(e: Event) =>
              viewModel.setField('image', 'apiKey', (e.target as HTMLInputElement).value)}
          >
        </div>
      {/if}
    </div>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════
       Common generation settings
       ═══════════════════════════════════════════════════════════════ -->
  <div class="space-y-4 p-4 bg-white/[0.04] rounded-lg border border-white/[0.06]">
    <h3 class="font-['JetBrains_Mono'] text-sm text-[#cabeff] uppercase tracking-wider">
      Generation Settings
    </h3>

    <div class="grid grid-cols-2 gap-4">
      <div class="form-control">
        <div class="label py-1">
          <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
            Width
          </span>
        </div>
        <input
          type="number"
          class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
          value={imageConfig.width}
          oninput={(e: Event) =>
            viewModel.setField('image', 'width', Number.parseInt((e.target as HTMLInputElement).value, 10))}
        >
      </div>
      <div class="form-control">
        <div class="label py-1">
          <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
            Height
          </span>
        </div>
        <input
          type="number"
          class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
          value={imageConfig.height}
          oninput={(e: Event) =>
            viewModel.setField('image', 'height', Number.parseInt((e.target as HTMLInputElement).value, 10))}
        >
      </div>
    </div>

    <div class="grid grid-cols-2 gap-4">
      <div class="form-control">
        <div class="label py-1">
          <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
            Steps
          </span>
        </div>
        <input
          type="number"
          class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
          value={imageConfig.steps}
          oninput={(e: Event) =>
            viewModel.setField('image', 'steps', Number.parseInt((e.target as HTMLInputElement).value, 10))}
        >
      </div>
      <div class="form-control">
        <div class="label py-1">
          <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
            CFG Scale
          </span>
        </div>
        <input
          type="number"
          class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
          step="0.5"
          value={imageConfig.cfgScale}
          oninput={(e: Event) =>
            viewModel.setField('image', 'cfgScale', Number.parseFloat((e.target as HTMLInputElement).value))}
        >
      </div>
    </div>

    <div class="grid grid-cols-2 gap-4">
      <div class="form-control">
        <div class="label py-1">
          <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
            Sampler
          </span>
        </div>
        <input
          type="text"
          class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
          placeholder="euler_a"
          value={imageConfig.sampler ?? ''}
          oninput={(e: Event) =>
            viewModel.setField('image', 'sampler', (e.target as HTMLInputElement).value)}
        >
      </div>
      <div class="form-control">
        <div class="label py-1" />
        <div class="flex items-center gap-2 h-12">
          <input
            type="checkbox"
            class="toggle toggle-primary"
            checked={imageConfig.enableI2I ?? false}
            onchange={(e: Event) =>
              viewModel.setField('image', 'enableI2I', (e.target as HTMLInputElement).checked)}
          >
          <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
            Enable img2img
          </span>
        </div>
      </div>
    </div>
  </div>
</div>
