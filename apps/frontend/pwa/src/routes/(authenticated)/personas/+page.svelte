<script lang="ts">
    import PersonaListView from "$lib/views/persona/list/PersonaListView.svelte";
    import { getPersonaListViewModel } from "$lib/views/persona/list/persona-list-view-model.svelte";

    const viewModel = getPersonaListViewModel({
        className: "PersonaListViewModel",
    });
</script>

<PersonaListView {viewModel} />
