<script lang="ts">
  // apps/frontend/client/src/lib/views/gm/push_story_button_view.svelte
  import type { PushStoryButtonViewModelInterface } from './push_story_button_view_model.svelte.ts';

  type Props = {
    viewModel: PushStoryButtonViewModelInterface;
  };

  const { viewModel }: Props = $props();
</script>

<button
  class="btn btn-primary btn-sm"
  onclick={() => viewModel.pushStory()}
  disabled={viewModel.isPushing}
>
  {#if viewModel.isPushing}
    <span class="loading loading-spinner loading-xs"></span>
    Generating...
  {:else}
    Push Story
  {/if}
</button>
