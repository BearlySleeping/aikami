<script lang="ts">
    import { CharacterLibraryViewModel } from "./character-library-view-model.svelte";

    const vm = new CharacterLibraryViewModel();
    let fileInput: HTMLInputElement;

    function onFileChange(e: Event) {
        const target = e.target as HTMLInputElement;
        if (target.files) {
            vm.handleFileUpload(target.files);
        }
    }
</script>

<div class="p-4">
    <header class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold">Character Library</h1>
        <button
            class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg"
            onclick={() => fileInput.click()}
        >
            Import Character
        </button>
        <input
            bind:this={fileInput}
            type="file"
            accept=".png,.json"
            multiple
            class="hidden"
            onchange={onFileChange}
        />
    </header>

    <div
        class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
    >
        {#each vm.characters as char}
            <button
                class="bg-gray-800 rounded-lg overflow-hidden hover:ring-2 ring-blue-500 transition text-left"
                onclick={() => vm.selectCharacter(char)}
            >
                <div class="h-48 bg-gray-700 relative">
                    <!-- TODO: Display avatar -->
                    <div
                        class="absolute inset-0 flex items-center justify-center text-gray-500"
                    >
                        Avatar
                    </div>
                </div>
                <div class="p-3">
                    <h3 class="font-bold text-white truncate">{char.name}</h3>
                    <p class="text-gray-400 text-sm line-clamp-2">
                        {char.description}
                    </p>
                </div>
            </button>
        {/each}

        {#if vm.characters.length === 0}
            <div class="col-span-full text-center text-gray-500 py-10">
                No characters found. Import one to get started!
            </div>
        {/if}
    </div>
</div>
