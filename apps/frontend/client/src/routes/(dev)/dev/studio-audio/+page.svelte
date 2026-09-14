<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/studio-audio/+page.svelte
//
// C-521 dev sandbox route: the Studio audio review panel against a deterministic
// synthetic loop candidate, so AC-4's waveform / play-pause / loop audition /
// mute / announcement behaviour can be inspected without an audio engine.
import StudioAudioReviewView from '$lib/views/dev/studio-audio/studio_audio_review_view.dev.svelte';
import { getStudioAudioReviewDevViewModel } from '$lib/views/dev/studio-audio/studio_audio_review_view_model.dev.svelte.ts';

const viewModel = getStudioAudioReviewDevViewModel({ className: 'StudioAudioReviewDevViewModel' });
</script>

<StudioAudioReviewView {viewModel} />
