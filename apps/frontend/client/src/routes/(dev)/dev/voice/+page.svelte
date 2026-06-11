<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/voice/+page.svelte
  import VoiceView from '$views/dev/voice/voice_view.svelte';
  import { getVoiceViewModel } from '$views/dev/voice/voice_view_model.svelte';

  const viewModel = getVoiceViewModel({
    className: 'VoiceViewModel',
  });
</script>

<VoiceView {viewModel} />
