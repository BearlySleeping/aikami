<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/audio/+page.svelte
//
// Dev sandbox route for testing BGM and SFX via the AudioService.
// Navigate to /dev/settings to change volume, then come back to verify.
import DevAudioView from '$lib/views/dev/audio/audio_view.dev.svelte';
import { getDevAudioViewModel } from '$lib/views/dev/audio/audio_view_model.dev.svelte.ts';

const viewModel = getDevAudioViewModel({ className: 'DevAudioViewModel' });
</script>

<DevAudioView {viewModel} />
