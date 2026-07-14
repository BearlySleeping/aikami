<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/music/+page.svelte
//
// Dev sandbox for the Music DJ Audio Player (C-249).
// Renders the music settings UI with track library, tag filters,
// scene-type overrides, and preview controls.
import SettingsMusicView from '$views/settings/music/settings_music_view.svelte';
import { getSettingsMusicViewModel } from '$views/settings/music/settings_music_view_model.svelte';

const viewModel = getSettingsMusicViewModel({ className: 'SettingsMusicViewModel' });
</script>

<div data-testid="game-ready" class="hidden"></div>
<SettingsMusicView {viewModel} />
