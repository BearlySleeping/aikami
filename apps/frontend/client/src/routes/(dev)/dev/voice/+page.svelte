<script lang="ts">
import { getVoiceViewModel } from '$views/dev/voice/voice_composition';
// apps/frontend/client/src/routes/(dev)/dev/voice/+page.svelte
import VoiceView from '$views/dev/voice/voice_view.svelte';

const viewModel = getVoiceViewModel({
  className: 'VoiceViewModel',
});
</script>

<VoiceView {viewModel} />
