<script lang="ts">
    import ProfileView from "$lib/views/profile/ProfileView.svelte";
    import { getProfileViewModel } from "$lib/views/profile/profile-view-model.svelte";

    const viewModel = getProfileViewModel({
        className: "ProfileViewModel",
    });
</script>

<ProfileView {viewModel} />
