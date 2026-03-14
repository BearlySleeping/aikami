<script lang="ts">
  import ProfileView from '$views/profile/ProfileView.svelte';
  import { getProfileViewModel } from '$views/profile/profile-view-model.svelte.ts';

  const viewModel = getProfileViewModel({
    className: 'ProfileViewModel',
  });
</script>

<ProfileView {viewModel} />
