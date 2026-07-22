<script lang="ts">
// apps/frontend/client/src/lib/views/settings/providers/providers_generation_params.svelte
import type { GenerationParams, InstructTemplate } from '$types';

type Props = {
  params: GenerationParams;
  instructTemplate: InstructTemplate;
  instructTemplates: readonly string[];
  onsetParam: (field: keyof GenerationParams, value: number) => void;
  onsetTemplate: (template: InstructTemplate) => void;
};

const { params, instructTemplate, instructTemplates, onsetParam, onsetTemplate }: Props = $props();

// ── Slider definitions ─────────────────────────────────────────────────

type ParamSlider = {
  field: keyof GenerationParams;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
};

const SLIDERS: readonly ParamSlider[] = [
  {
    field: 'temperature',
    label: 'Temperature',
    min: 0,
    max: 2,
    step: 0.05,
    format: (v: number) => v.toFixed(2),
  },
  {
    field: 'topP',
    label: 'Top P',
    min: 0,
    max: 1,
    step: 0.05,
    format: (v: number) => v.toFixed(2),
  },
  {
    field: 'topK',
    label: 'Top K',
    min: 1,
    max: 200,
    step: 1,
    format: (v: number) => `${v}`,
  },
  {
    field: 'repetitionPenalty',
    label: 'Repetition Penalty',
    min: 1,
    max: 2,
    step: 0.05,
    format: (v: number) => v.toFixed(2),
  },
  {
    field: 'presencePenalty',
    label: 'Presence Penalty',
    min: -2,
    max: 2,
    step: 0.1,
    format: (v: number) => v.toFixed(1),
  },
] as const;

const NUMBER_FIELDS: readonly { field: keyof GenerationParams; label: string; min: number }[] = [
  { field: 'maxTokens', label: 'Max Tokens', min: 1 },
  { field: 'contextSize', label: 'Context Size', min: 256 },
] as const;
</script>

<div class="grid gap-6">
  <!-- Generation Parameters -->
  <div class="rounded-lg border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl p-6">
    <h2 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.1em] text-[#cabeff] mb-4">
      Generation Parameters
    </h2>
    <p class="text-sm text-[#938ea1] mb-6 font-['Inter']">
      Fine-tune how the AI generates responses. These settings apply globally to all text generation
      requests.
    </p>

    <div class="grid gap-4">
      {#each SLIDERS as slider}
        <div class="form-control">
          <div class="label py-1">
            <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
              {slider.label}
            </span>
            <span class="font-['JetBrains_Mono'] text-xs text-[#00e3fd] tabular-nums">
              {slider.format(params[slider.field] as number)}
            </span>
          </div>
          <input
            type="range"
            min={slider.min}
            max={slider.max}
            step={slider.step}
            class="range range-sm range-primary"
            value={params[slider.field] as number}
            oninput={(e: Event) =>
              onsetParam(slider.field, Number.parseFloat((e.target as HTMLInputElement).value))}
          >
        </div>
      {/each}
    </div>
  </div>

  <!-- Token Limits -->
  <div class="rounded-lg border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl p-6">
    <h2 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.1em] text-[#cabeff] mb-4">
      Token Limits
    </h2>

    <div class="grid grid-cols-2 gap-4">
      {#each NUMBER_FIELDS as field}
        <div class="form-control">
          <div class="label py-1">
            <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
              {field.label}
            </span>
          </div>
          <input
            type="number"
            min={field.min}
            class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
            value={params[field.field] as number}
            oninput={(e: Event) =>
              onsetParam(
                field.field,
                Number.parseInt((e.target as HTMLInputElement).value, 10),
              )}
          >
        </div>
      {/each}
    </div>
  </div>

  <!-- Instruct Template -->
  <div class="rounded-lg border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl p-6">
    <h2 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.1em] text-[#cabeff] mb-4">
      Instruct Template
    </h2>
    <p class="text-sm text-[#938ea1] mb-4 font-['Inter']">
      Select the prompt formatting template used for system/user/assistant message structure.
    </p>

    <div class="form-control">
      <select
        class="select select-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
        value={instructTemplate}
        onchange={(e: Event) =>
          onsetTemplate((e.target as HTMLSelectElement).value as InstructTemplate)}
      >
        {#each instructTemplates as tpl}
          <option value={tpl}>{tpl}</option>
        {/each}
      </select>
    </div>
  </div>
</div>
