<!-- apps/frontend/client/src/lib/views/dev/studio-audio/studio_audio_review_view.dev.svelte

  C-521 AC-4 dev sandbox view — the Studio audio review panel against a
  deterministic synthetic loop candidate.

  Contract: C-521 Music and SFX generation with audio preparation
-->
<script lang="ts">
import { BaseViewModelContainer } from '$components';
import StudioAudioReview from '$lib/views/studio/studio_audio_review.svelte';
import type { StudioAudioReviewDevViewModelInterface } from './studio_audio_review_view_model.dev.svelte.ts';

type Props = {
  viewModel: StudioAudioReviewDevViewModelInterface;
};
const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel} fillHeight={true}>
  <div class="mx-auto flex w-full max-w-3xl flex-col gap-4 p-8">
    <header class="flex flex-col gap-1">
      <h1 class="text-2xl font-bold">Studio audio review sandbox</h1>
      <p class="text-sm text-base-content/70">
        A synthetic 400 Hz stereo loop with authored sample bounds. The panel below is the same
        component <code>/studio/assets</code> renders for an audio candidate.
      </p>
    </header>

    <StudioAudioReview review={viewModel.review} candidateLabel={viewModel.candidateLabel} />

    <dl class="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1 text-xs">
      <dt class="font-semibold">Authored bounds</dt>
      <dd class="font-mono">{viewModel.loopDescription}</dd>
      <dt class="font-semibold">Loaded</dt>
      <dd class="font-mono">{viewModel.review.loaded ? 'yes' : 'no'}</dd>
      <dt class="font-semibold">Sampled duration</dt>
      <dd class="font-mono">{viewModel.review.durationSeconds.toFixed(2)} s</dd>
    </dl>

    <button type="button" class="btn btn-sm btn-outline w-fit" onclick={() => viewModel.reload()}>
      Re-decode candidate
    </button>
  </div>
</BaseViewModelContainer>
