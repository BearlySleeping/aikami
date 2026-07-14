<script lang="ts">
// apps/frontend/client/src/routes/game/+page.svelte
//
// Production /game route. The GameViewModel owns the composition root
// lifecycle and all sub-ViewModels. The View is a pure shell.
//
// Contract: C-314 — Production game composition root

import GameView from '$lib/views/game/game_view.svelte';
import { getGameViewModel } from '$lib/views/game/game_view_model.svelte';

const viewModel = getGameViewModel({ className: 'GameViewModel' });
</script>

<GameView {viewModel} />
