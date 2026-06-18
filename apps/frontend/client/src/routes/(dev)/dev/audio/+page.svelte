<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/audio/+page.svelte
  //
  // Dev sandbox route for testing BGM and SFX via the AudioService.
  // Navigate to /dev/settings to change volume, then come back to verify.
  import DevAudioView from '$lib/views/dev/audio/dev_audio_view.svelte';
  import { getDevAudioViewModel } from '$lib/views/dev/audio/dev_audio_view_model.svelte';

  const viewModel = getDevAudioViewModel({ className: 'DevAudioViewModel' });
</script>

<DevAudioView {viewModel} />
