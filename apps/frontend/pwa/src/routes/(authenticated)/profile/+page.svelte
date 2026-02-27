<script lang="ts">
import { getProfileViewModel } from '$lib/views/profile/profile-view-model.svelte.ts';

const _viewModel = getProfileViewModel({
  className: 'ProfileViewModel',
});
</script>

<ProfileView {viewModel} />
